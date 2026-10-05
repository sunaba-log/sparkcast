from __future__ import annotations

# ruff: noqa: ARG002, ARG005
import logging

import numpy as np

from domain.interfaces import RecordingSpeaker, RecordingSpeakers
from domain.models.transcript import TranscriptSegment
from services.episode_transcription import EpisodeTranscription, aligned_track_uri
from services.voiced_audio import TimeMap, VoicedTrack, condense, find_voiced_regions, remap_segments

RATE = 16000


def _track(seconds: float, bursts: list[tuple[float, float, float]]) -> np.ndarray:
    rng = np.random.default_rng(0)
    signal = rng.normal(0, 0.001, int(seconds * RATE)).astype(np.float32)  # 約 -60dB の雑音
    for start, end, amplitude in bursts:
        t = np.arange(int((end - start) * RATE)) / RATE
        signal[int(start * RATE) : int(start * RATE) + len(t)] += amplitude * np.sin(2 * np.pi * 220 * t)
    return signal


def test_finds_speech_with_padding_and_joins_short_pauses() -> None:
    signal = _track(12, [(1.0, 2.5, 0.3), (2.9, 3.5, 0.3), (6.0, 7.0, 0.3), (9.0, 9.6, 0.01)])
    regions = find_voiced_regions(signal, RATE)
    # 0.4 秒の息継ぎはつながり、小さめの声(約 -43dB)も拾う。前後に余白が付く
    assert len(regions) == 3
    (a0, a1), (b0, b1), (c0, c1) = regions
    assert a0 <= 0.65
    assert a1 >= 3.9
    assert b0 <= 5.65
    assert b1 >= 7.4
    assert c0 <= 8.65
    assert c1 >= 9.9


def test_silent_track_has_no_regions() -> None:
    assert find_voiced_regions(_track(5, []), RATE) == []


def test_condensed_times_map_back_to_the_track() -> None:
    signal = _track(12, [(1.0, 2.0, 0.3), (6.0, 7.0, 0.3)])
    regions = [(0.6, 2.5), (5.6, 7.5)]
    condensed, time_map = condense(signal, RATE, regions)
    assert abs(len(condensed) / RATE - (1.9 + 0.5 + 1.9)) < 0.01
    assert abs(time_map.duration - 4.3) < 0.01
    assert abs(time_map.to_original(0.4) - 1.0) < 0.01
    assert abs(time_map.to_original(2.4 + 0.4) - 6.0) < 0.01
    # 区間のあいだの無音は次の区間の始まりに寄せる
    assert abs(time_map.to_original(2.1) - 5.6) < 0.01
    segments = remap_segments([TranscriptSegment(2.6, 3.0, "あ", "小野")], time_map)
    assert abs(segments[0].start - 5.8) < 0.01
    assert segments[0].speaker == "小野"


class _Speech:
    def __init__(self, output):
        self.output = output
        self.calls = []

    def transcribe(self, files, timeout=None):
        self.calls.append(files)
        return self.output


class _Provider:
    def generate_minutes(self, transcript_text, cast_names=None, model_id=None):
        return "minutes"


class _Repository:
    def __init__(self, recording):
        self.recording = recording

    def get_cast_names(self, *, podcast_id):
        return []

    def find_recording_speakers(self, *, episode_id):
        return self.recording


def _service(speech, preparer):
    return EpisodeTranscription(
        transcript_provider=_Provider(),
        episode_repository=_Repository(
            RecordingSpeakers(
                session_id="sid",
                speakers=[RecordingSpeaker("p1", "小野", "host"), RecordingSpeaker("p2", "数森", "guest")],
            )
        ),
        speech=speech,
        work_bucket="work",
        voiced_preparer=preparer,
        logger=logging.getLogger("test"),
    )


def test_recording_transcribes_only_voiced_audio_and_restores_times() -> None:
    voiced = {
        "p1": VoicedTrack("gs://work/v1.flac", 120.0, TimeMap(((0.0, 600.0, 120.0),))),
        "p2": None,  # 黙っていた人は認識しない
    }
    speech = _Speech({"gs://work/v1.flac": [TranscriptSegment(10.0, 12.0, "こんにちは。")]})
    result = _service(speech, lambda uris: voiced).run(
        gcs_uri="gs://in/x.flac", podcast_id="1", episode_id="2", duration_seconds=3600, model_id="m"
    )
    assert speech.calls == [{"gs://work/v1.flac": 120.0}]
    assert [(s.start, s.speaker, s.text) for s in result.segments] == [(610.0, "小野", "こんにちは。")]


def test_falls_back_to_whole_tracks_when_cutting_fails() -> None:
    def broken(uris):
        raise RuntimeError("ffmpeg")

    whole = aligned_track_uri("work", "sid", "p1")
    speech = _Speech({whole: [TranscriptSegment(10.0, 12.0, "こんにちは。")]})
    result = _service(speech, broken).run(
        gcs_uri="gs://in/x.flac", podcast_id="1", episode_id="2", duration_seconds=3600, model_id="m"
    )
    assert speech.calls == [{whole: 3600, aligned_track_uri("work", "sid", "p2"): 3600}]
    assert result.segments[0].start == 10.0
