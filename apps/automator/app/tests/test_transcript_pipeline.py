from __future__ import annotations

# ruff: noqa: ARG002, ARG005
import logging
import shutil
import subprocess
from datetime import timedelta
from types import SimpleNamespace

import pytest

from domain.interfaces import RecordingSpeaker, RecordingSpeakers
from domain.models.transcript import (
    TranscriptSegment,
    drop_empty_sections,
    extract_topics,
    format_timestamp,
    normalize_minutes,
    parse_timestamp,
    render_transcript,
    topic_count_hint,
    transcript_minutes,
)
from infrastructure.episode_repository import split_cast_names
from infrastructure.speech_transcriber import (
    ChirpTranscriber,
    Word,
    clean_transcript,
    result_words,
    results_to_segments,
    sentences_to_segments,
    words_to_segments,
)
from services.episode_transcription import EpisodeTranscription, NoSpeechError, aligned_track_uri
from services.speech_audio import speech_audio_uri, to_speech_flac
from services.transcript_builder import SpeakerTrack, is_crosstalk, merge_speaker_tracks

# ---- 時刻・目次 ----


def test_format_and_parse_timestamps() -> None:
    assert format_timestamp(0) == "0:00"
    assert format_timestamp(65.9) == "1:05"
    assert format_timestamp(3725) == "1:02:05"
    assert parse_timestamp("1:05") == 65
    assert parse_timestamp("1:02:05") == 3725
    assert parse_timestamp("abc") is None


def test_render_transcript() -> None:
    text = render_transcript(
        [TranscriptSegment(0, 2, "こんにちは", "小野"), TranscriptSegment(65, 70, "本題です", "数森")]
    )
    assert text == "[0:00] 小野: こんにちは\n[1:05] 数森: 本題です"


def test_extract_topics_from_minutes() -> None:
    minutes = "# 議事録\n\n## 【目次】\n0:00 オープニング\n- 5:12 **新機能**の話\n1:02:30 まとめ\n\n## 本文\n内容"
    assert extract_topics(minutes) == [
        {"time": "0:00", "title": "オープニング"},
        {"time": "5:12", "title": "新機能の話"},
        {"time": "1:02:30", "title": "まとめ"},
    ]
    assert extract_topics("目次なし") == []
    # 文字起こしに倣って角括弧を付けた目次(dev で実際に出た形)
    assert extract_topics("## 目次\n\n[0:03] ブラウザ収録\n[1:02:36] 文字起こし\n") == [
        {"time": "0:03", "title": "ブラウザ収録"},
        {"time": "1:02:36", "title": "文字起こし"},
    ]


def test_extract_topics_from_the_new_minutes_format() -> None:
    minutes = (
        "## 要約\n収録ルームの話。\n\n## 【目次】\n0:00 近況\n2:10 チャットの感想\n\n"
        "## 話題ごとのまとめ\n\n### 0:00〜2:10 近況\n- けんたは実装済み\n\n### 2:10〜5:40 チャットの感想\n- 便利\n"
    )
    assert extract_topics(minutes) == [
        {"time": "0:00", "title": "近況"},
        {"time": "2:10", "title": "チャットの感想"},
    ]


def test_drop_empty_sections() -> None:
    minutes = "## 要約\n話した。\n\n## 決定事項\nなし\n\n## ToDo\n- 特になし\n\n## 次回に向けて\n- 配色の話\n"
    assert drop_empty_sections(minutes) == "## 要約\n話した。\n\n## 次回に向けて\n- 配色の話"
    # 見出しの下に中身が無いだけの節や、ふつうの本文は消さない
    assert drop_empty_sections("## 要約\nなしで進める案を話した。\n") == "## 要約\nなしで進める案を話した。"


def test_normalize_minutes_adds_the_missing_summary_heading() -> None:
    minutes = "収録の話をした。\n\n## 【目次】\n0:00 収録\n\n## 決定事項\nなし\n"
    assert normalize_minutes(minutes) == "## 要約\n収録の話をした。\n\n## 【目次】\n0:00 収録"
    assert normalize_minutes("## 要約\nそのまま\n") == "## 要約\nそのまま"


def test_topic_count_follows_the_length_of_the_recording() -> None:
    assert transcript_minutes("[0:04] a: b\n[1:56] a: c") == 2
    assert transcript_minutes("[1:02:30] a: b") == 63
    assert transcript_minutes("") == 1
    assert [topic_count_hint(m) for m in (1, 2, 10, 30, 60, 120)] == [1, 1, 2, 6, 12, 12]


def test_split_cast_names() -> None:
    assert split_cast_names("小野、数森, 高島\n佐藤") == ["小野", "数森", "高島", "佐藤"]
    assert split_cast_names(None) == []


# ---- 音声認識の結果を発話にする ----


def test_words_to_segments_splits_on_sentence_end_and_pause() -> None:
    words = [
        Word("今日は", 0.0, 0.5),
        Word("いい", 0.5, 0.8),
        Word("天気です。", 0.8, 1.4),
        Word("そうですね", 1.5, 2.0),
        Word("では", 4.0, 4.3),  # 2 秒のポーズ
        Word("始めます", 4.3, 5.0),
    ]
    segments = words_to_segments(words)
    assert [(s.start, s.end, s.text) for s in segments] == [
        (0.0, 1.4, "今日はいい天気です。"),
        (1.5, 2.0, "そうですね"),
        (4.0, 5.0, "では始めます"),
    ]


def test_words_to_segments_keeps_spaces_between_latin_words() -> None:
    segments = words_to_segments([Word("Cloud", 0, 0.3), Word("Run", 0.3, 0.6), Word("を使う", 0.6, 1.0)])
    assert segments[0].text == "Cloud Runを使う"


def _result(transcript: str, words: list[tuple[str, float, float]], end: float):
    return SimpleNamespace(
        alternatives=[
            SimpleNamespace(
                transcript=transcript,
                words=[
                    SimpleNamespace(word=w, start_offset=timedelta(seconds=s), end_offset=timedelta(seconds=e))
                    for w, s, e in words
                ],
            )
        ],
        result_end_offset=timedelta(seconds=end),
    )


def test_result_words_uses_word_offsets_or_falls_back_to_result_bounds() -> None:
    results = [
        _result("こんにちは。", [("こんにちは。", 1.0, 1.8)], 2.0),
        _result("時刻なし", [], 5.0),
        SimpleNamespace(alternatives=[], result_end_offset=timedelta(seconds=6)),
    ]
    words = result_words(results)  # type: ignore[arg-type]
    assert words == [Word("こんにちは。", 1.0, 1.8), Word("時刻なし", 2.0, 5.0)]


def test_sentences_keep_punctuation_and_take_times_from_words() -> None:
    words = [
        Word("今日は", 10.0, 10.4),
        Word("晴れ", 10.4, 10.8),
        Word("です", 10.8, 11.1),
        Word("明日も", 12.0, 12.5),
        Word("晴れ", 12.5, 12.9),
        Word("ますか", 12.9, 13.4),
    ]
    segments = sentences_to_segments("今日は晴れです。明日も晴れますか\uff1f", words)
    assert [(s.start, s.end, s.text) for s in segments] == [
        (10.0, 11.1, "今日は晴れです。"),
        (12.0, 13.4, "明日も晴れますか\uff1f"),
    ]


def test_results_to_segments_cleans_spaces_and_falls_back_to_pauses() -> None:
    assert clean_transcript("議事録の目 次 の時刻 Cloud Run を使う") == "議事録の目次の時刻Cloud Runを使う"
    with_punctuation = _result("議事録の目 次です。", [("議事録の", 1.0, 1.5), ("目次です", 1.5, 2.2)], 2.5)
    without_punctuation = _result(
        "では始めます それでは", [("では", 5.0, 5.3), ("始めます", 5.3, 6.0), ("それでは", 8.0, 8.6)], 9.0
    )
    segments = results_to_segments([with_punctuation, without_punctuation])  # type: ignore[list-item]
    assert [(s.start, s.end, s.text) for s in segments] == [
        (1.0, 2.2, "議事録の目次です。"),
        (5.0, 6.0, "では始めます"),
        (8.0, 8.6, "それでは"),
    ]


class _FakeSpeechClient:
    def __init__(self) -> None:
        self.batch_requests = []
        self.sync_requests = []

    def batch_recognize(self, request):
        self.batch_requests.append(request)
        results = {
            file.uri: SimpleNamespace(
                error=None,
                transcript=SimpleNamespace(results=[_result("長い。", [("長い。", 70.0, 71.0)], 72.0)]),
            )
            for file in request.files
        }
        return SimpleNamespace(result=lambda timeout: SimpleNamespace(results=results))

    def recognize(self, request):
        self.sync_requests.append(request)
        return SimpleNamespace(results=[_result("短い。", [("短い。", 1.0, 2.0)], 2.0)])


def test_transcriber_uses_batch_for_long_audio_and_sync_for_short_audio() -> None:
    client = _FakeSpeechClient()
    transcriber = ChirpTranscriber(project_id="p", client=client)  # type: ignore[arg-type]
    output = transcriber.transcribe({"gs://b/long.flac": 3600, "gs://b/long2.flac": 600, "gs://b/short.flac": 30})

    # inline の結果は 1 リクエスト 1 ファイルまで
    assert [[f.uri for f in request.files] for request in client.batch_requests] == [
        ["gs://b/long.flac"],
        ["gs://b/long2.flac"],
    ]
    assert output["gs://b/long2.flac"][0].text == "長い。"
    assert client.sync_requests[0].uri == "gs://b/short.flac"
    assert client.batch_requests[0].config.model == "long"
    assert client.batch_requests[0].config.features.enable_word_time_offsets is True
    assert client.batch_requests[0].recognizer == "projects/p/locations/asia-northeast1/recognizers/_"
    assert output["gs://b/long.flac"][0].text == "長い。"
    assert output["gs://b/short.flac"][0].start == 1.0


# ---- 話者ごとの結合と回り込みの除去 ----


def test_merge_orders_by_time_and_labels_speakers() -> None:
    merged = merge_speaker_tracks(
        [
            SpeakerTrack(
                "host", "小野", [TranscriptSegment(0, 2, "はじめます"), TranscriptSegment(10, 12, "なるほど")]
            ),
            SpeakerTrack("guest", "佐藤", [TranscriptSegment(3, 8, "よろしくお願いします")]),
        ]
    )
    assert [(s.start, s.speaker, s.speaker_id) for s in merged] == [
        (0, "小野", "host"),
        (3, "佐藤", "guest"),
        (10, "小野", "host"),
    ]


def test_crosstalk_keeps_the_louder_track() -> None:
    host = TranscriptSegment(5.0, 9.0, "今日は新機能について話します", speaker_id="host")
    leaked = TranscriptSegment(5.1, 9.1, "今日は新機能について話しま", speaker_id="guest")
    assert is_crosstalk(host, leaked)
    assert not is_crosstalk(host, TranscriptSegment(5.0, 9.0, "全然違う発言です", speaker_id="guest"))

    tracks = [SpeakerTrack("host", "小野", [host]), SpeakerTrack("guest", "佐藤", [leaked])]
    louder_host = merge_speaker_tracks(tracks, lambda speaker, start, end: 1.0 if speaker == "host" else 0.1)
    assert [s.speaker for s in louder_host] == ["小野"]
    louder_guest = merge_speaker_tracks(tracks, lambda speaker, start, end: 0.1 if speaker == "host" else 1.0)
    assert [s.speaker for s in louder_guest] == ["佐藤"]


def test_overlapping_but_different_speech_is_kept() -> None:
    tracks = [
        SpeakerTrack("host", "小野", [TranscriptSegment(0, 4, "それでどうなったの")]),
        SpeakerTrack("guest", "佐藤", [TranscriptSegment(1, 3, "うんうん")]),
    ]
    assert len(merge_speaker_tracks(tracks)) == 2


# ---- エピソードの文字起こし ----


class _Provider:
    def __init__(self) -> None:
        self.minutes_input: str | None = None
        self.assign_calls = 0

    def generate_transcript(self, source_uri, model_id=None, cast_names=None):
        return f"legacy minutes ({','.join(cast_names or [])})"

    def generate_minutes(self, transcript_text, cast_names=None, model_id=None):
        self.minutes_input = transcript_text
        return "minutes"

    def assign_speakers(self, gcs_uri, segments, cast_names=None, model_id=None):
        self.assign_calls += 1
        return [segment.with_speaker(cast_names[index % len(cast_names)]) for index, segment in enumerate(segments)]


class _Repository:
    def __init__(self, recording: RecordingSpeakers | None = None) -> None:
        self.recording = recording

    def get_cast_names(self, *, podcast_id):
        return ["小野", "数森"]

    def find_recording_speakers(self, *, episode_id):
        return self.recording


class _Speech:
    def __init__(self, output=None, error: Exception | None = None) -> None:
        self.output = output or {}
        self.error = error
        self.calls = []

    def transcribe(self, files, timeout=3600):
        self.calls.append(files)
        if self.error:
            raise self.error
        return self.output


def _service(provider, repository, speech, energy_loader=None):
    return EpisodeTranscription(
        transcript_provider=provider,
        episode_repository=repository,
        speech=speech,
        work_bucket="work",
        energy_loader=energy_loader,
        logger=logging.getLogger("test"),
    )


def test_recording_episode_transcribes_each_speaker_track() -> None:
    recording = RecordingSpeakers(
        session_id="sid",
        speakers=[RecordingSpeaker("p-host", "小野", "host"), RecordingSpeaker("p-guest", "ゲスト", "guest")],
    )
    host_uri = aligned_track_uri("work", "sid", "p-host")
    guest_uri = aligned_track_uri("work", "sid", "p-guest")
    assert host_uri == "gs://work/recordings/sid/aligned/p-host.flac"
    speech = _Speech(
        {
            host_uri: [TranscriptSegment(0.0, 2.0, "こんにちは"), TranscriptSegment(9.0, 10.0, "ありがとう")],
            guest_uri: [TranscriptSegment(3.0, 6.0, "よろしく")],
        }
    )
    provider = _Provider()
    loaded = []
    result = _service(provider, _Repository(recording), speech, energy_loader=lambda uris: loaded.append(uris)).run(
        gcs_uri="gs://in/podcasts/1/episodes/2/source/recording-sid.flac",
        podcast_id="1",
        episode_id="2",
        duration_seconds=600,
        model_id="m",
    )

    assert speech.calls == [{host_uri: 600, guest_uri: 600}]
    assert loaded == [{"p-host": host_uri, "p-guest": guest_uri}]
    assert [(s.speaker, s.text) for s in result.segments] == [
        ("小野", "こんにちは"),
        ("ゲスト", "よろしく"),
        ("小野", "ありがとう"),
    ]
    assert provider.minutes_input == "[0:00] 小野: こんにちは\n[0:03] ゲスト: よろしく\n[0:09] 小野: ありがとう"
    assert provider.assign_calls == 0
    assert result.meta["speaker_source"] == "recording"
    assert result.meta["segment_count"] == 3


def test_uploaded_episode_assigns_speakers_with_gemini() -> None:
    uri = "gs://in/podcasts/1/episodes/2/source/a.m4a"
    speech = _Speech({uri: [TranscriptSegment(0, 1, "a"), TranscriptSegment(2, 3, "b")]})
    provider = _Provider()
    result = _service(provider, _Repository(), speech).run(
        gcs_uri=uri, podcast_id="1", episode_id="2", duration_seconds=90, model_id="m"
    )
    assert [s.speaker for s in result.segments] == ["小野", "数森"]
    assert result.meta["speaker_source"] == "gemini"


def test_falls_back_to_gemini_audio_minutes_when_speech_fails() -> None:
    provider = _Provider()
    result = _service(provider, _Repository(), _Speech(error=RuntimeError("quota"))).run(
        gcs_uri="gs://in/x.m4a", podcast_id="1", episode_id="2", duration_seconds=90, model_id="m"
    )
    assert result.minutes == "legacy minutes (小野,数森)"
    assert result.segments == []
    assert result.meta["engine"] == "gemini_audio"


def test_without_speech_uses_legacy_minutes() -> None:
    result = _service(_Provider(), _Repository(), None).run(
        gcs_uri="gs://in/x.m4a", podcast_id="1", episode_id="2", duration_seconds=90, model_id="m"
    )
    assert result.minutes.startswith("legacy minutes")


def test_raises_when_no_minutes_at_all() -> None:
    provider = _Provider()
    provider.generate_transcript = lambda *a, **k: None  # type: ignore[method-assign]
    with pytest.raises(ValueError, match="Failed to make transcript"):
        _service(provider, _Repository(), None).run(
            gcs_uri="gs://in/x.m4a", podcast_id="1", episode_id="2", duration_seconds=90, model_id="m"
        )


def test_no_speech_fails_instead_of_asking_gemini_to_write_minutes() -> None:
    provider = _Provider()
    called = []
    provider.generate_transcript = lambda *a, **k: called.append(a) or "申し訳ございませんが…"  # type: ignore[method-assign]
    with pytest.raises(NoSpeechError, match="発話を聞き取れませんでした"):
        _service(provider, _Repository(), _Speech({"gs://in/x.flac": []})).run(
            gcs_uri="gs://in/x.flac", podcast_id="1", episode_id="2", duration_seconds=30, model_id="m"
        )
    assert called == []
    assert provider.minutes_input is None


def test_no_speech_in_recording_tracks_fails() -> None:
    recording = RecordingSpeakers(session_id="sid", speakers=[RecordingSpeaker("p-host", "小野", "host")])
    with pytest.raises(NoSpeechError):
        _service(_Provider(), _Repository(recording), _Speech({})).run(
            gcs_uri="gs://in/x.flac", podcast_id="1", episode_id="2", duration_seconds=30, model_id="m"
        )


def test_gemini_audio_minutes_reporting_no_speech_fails() -> None:
    provider = _Provider()
    provider.generate_transcript = lambda *a, **k: "```\nNO_SPEECH\n```"  # type: ignore[method-assign]
    with pytest.raises(NoSpeechError):
        _service(provider, _Repository(), _Speech(error=RuntimeError("quota"))).run(
            gcs_uri="gs://in/x.m4a", podcast_id="1", episode_id="2", duration_seconds=30, model_id="m"
        )


def test_uploaded_audio_is_converted_before_recognition_but_speakers_use_the_original() -> None:
    original = "gs://in/podcasts/1/episodes/2/source/a.m4a"
    flac = speech_audio_uri("work", "1", "2")
    assert flac == "gs://work/transcribe/1/2.flac"
    speech = _Speech({flac: [TranscriptSegment(0, 1, "a")]})
    provider = _Provider()
    prepared: list[tuple[bytes, str, str]] = []
    service = EpisodeTranscription(
        transcript_provider=provider,
        episode_repository=_Repository(),
        speech=speech,
        work_bucket="work",
        audio_preparer=lambda audio, pid, eid: prepared.append((audio, pid, eid)) or flac,
        logger=logging.getLogger("test"),
    )
    assigned_uris: list[str] = []
    original_assign = provider.assign_speakers

    def assign(gcs_uri, segments, cast_names=None, model_id=None):
        assigned_uris.append(gcs_uri)
        return original_assign(gcs_uri, segments, cast_names, model_id)

    provider.assign_speakers = assign  # type: ignore[method-assign]
    result = service.run(
        gcs_uri=original, podcast_id="1", episode_id="2", duration_seconds=90, model_id="m", source_audio=b"m4a"
    )
    assert prepared == [(b"m4a", "1", "2")]
    assert speech.calls == [{flac: 90}]
    assert assigned_uris == [original]
    assert result.segments[0].text == "a"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_to_speech_flac_reads_m4a_fully_and_writes_the_sample_count(tmp_path) -> None:
    # m4a を作る。パイプから読むと途中までしか読めず、パイプに書くと総サンプル数が 0 になっていた
    m4a = tmp_path / "in.m4a"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-c:a",
            "aac",
            str(m4a),
        ],
        check=True,
    )
    flac = to_speech_flac(m4a.read_bytes())
    assert flac[:4] == b"fLaC"
    # STREAMINFO(先頭の "fLaC" 4 バイトとブロックヘッダ 4 バイトの後ろ)の 14〜18 バイト目の下位 36bit が総サンプル数
    streaminfo = flac[8:42]
    total_samples = int.from_bytes(streaminfo[13:18], "big") & 0xFFFFFFFFF
    assert total_samples == pytest.approx(3 * 16000, rel=0.02)
