"""エピソードの文字起こしと議事録を作る(#166).

1. 音声認識(Speech-to-Text v2 の long モデル)で時刻つきの発話を作る
   - ブラウザ収録のエピソード: 話者ごとの位置合わせ済みトラックを話者ごとに認識し、話者名を付けてまとめる
   - それ以外: ミックス済みの音声を認識し、各発話の話者を Gemini に推定させる
2. 時刻・話者つきの文字起こしから、Gemini が議事録を作る(目次の時刻は文字起こしの時刻)

音声認識に失敗したときは、以前の方式(Gemini に音声から直接議事録を作らせる)で続ける。
音声認識が成功して発話が 1 つも無いとき(無音など)は、議事録を作らずに失敗させる
(Gemini に音声を渡すと「音声がありません」という返事が議事録として公開されてしまう)。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from domain.models.transcript import UNKNOWN_SPEAKER, TranscriptSegment, render_transcript
from services.transcript_builder import EnergyFn, SpeakerTrack, merge_speaker_tracks
from services.voiced_audio import VoicedTrack, remap_segments

if TYPE_CHECKING:
    from domain.interfaces import EpisodeRepository, RecordingSpeakers, SpeechTranscriber, TranscriptProvider

ENGINE = "speech_v2_long"

# 話者の推定(Gemini)を試す回数
SPEAKER_ATTEMPTS = 3

# 音声に会話が無いとき、Gemini に議事録の代わりに返させる印(ai_analyzer.generate_transcript と揃える)
NO_SPEECH_MARKER = "NO_SPEECH"
NO_SPEECH_MESSAGE = (
    "音声から発話を聞き取れませんでした。マイクがミュートのままだったか、録音が届いていない可能性があります。"
)


class NoSpeechError(ValueError):
    """音声に発話が無く、議事録を作れない."""


# 位置合わせ済みトラックの URI 一覧 → 区間の音量を返す関数(読めなければ None)
EnergyLoader = Callable[[dict[str, str]], EnergyFn | None]
# アップロードされた音声のバイト列 → 認識用に置いた音声の gs:// URI(services.speech_audio)
SpeechAudioPreparer = Callable[[bytes, str, str], str]
# 話者 ID → トラックの URI から、声のある区間だけの音声(services.voiced_audio)
VoicedTrackPreparer = Callable[[dict[str, str]], dict[str, VoicedTrack | None]]


@dataclass
class TranscriptionResult:
    """文字起こしと議事録."""

    minutes: str
    segments: list[TranscriptSegment] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)


def aligned_track_uri(work_bucket: str, session_id: str, participant_id: str) -> str:
    """Mixer が作業用バケットに置く、話者別の位置合わせ済みトラック."""
    return f"gs://{work_bucket}/recordings/{session_id}/aligned/{participant_id}.flac"


class EpisodeTranscription:
    """文字起こしと議事録の生成."""

    def __init__(
        self,
        *,
        transcript_provider: TranscriptProvider,
        episode_repository: EpisodeRepository,
        speech: SpeechTranscriber | None,
        work_bucket: str | None,
        energy_loader: EnergyLoader | None = None,
        audio_preparer: SpeechAudioPreparer | None = None,
        voiced_preparer: VoicedTrackPreparer | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        """Wire dependencies."""
        self._provider = transcript_provider
        self._repository = episode_repository
        self._speech = speech
        self._work_bucket = work_bucket
        self._energy_loader = energy_loader
        self._audio_preparer = audio_preparer
        self._voiced_preparer = voiced_preparer
        self._logger = logger or logging.getLogger(__name__)

    def run(
        self,
        *,
        gcs_uri: str,
        podcast_id: str,
        episode_id: str,
        duration_seconds: float,
        model_id: str | None,
        source_audio: bytes | None = None,
    ) -> TranscriptionResult:
        """文字起こしと議事録を作る.

        source_audio(アップロードされた音声のバイト列)を渡すと、認識用に FLAC にしてから認識する。
        """
        cast = self._cast_names(podcast_id)
        recording = self._recording(episode_id)
        no_speech = False
        if self._speech is not None:
            try:
                if recording is not None and self._work_bucket:
                    segments = self._transcribe_recording(recording, duration_seconds)
                    source = "recording"
                    cast = [speaker.name for speaker in recording.speakers]
                else:
                    speech_uri = gcs_uri
                    if self._audio_preparer is not None and source_audio is not None:
                        speech_uri = self._audio_preparer(source_audio, podcast_id, episode_id)
                    segments = self._transcribe_mixed(gcs_uri, speech_uri, duration_seconds, cast, model_id)
                    source = "gemini" if any(s.speaker != UNKNOWN_SPEAKER for s in segments) else "none"
                if segments:
                    minutes = self._provider.generate_minutes(render_transcript(segments), cast, model_id)
                    return TranscriptionResult(
                        minutes=minutes,
                        segments=segments,
                        meta={
                            "engine": ENGINE,
                            "speaker_source": source,
                            "segment_count": len(segments),
                            "generated_at": datetime.now(UTC).isoformat(),
                        },
                    )
                no_speech = True
            except Exception:
                self._logger.exception("Speech recognition failed; falling back to Gemini audio minutes")
        if no_speech:
            raise NoSpeechError(NO_SPEECH_MESSAGE)

        minutes = self._provider.generate_transcript(gcs_uri, model_id=model_id, cast_names=cast or None)
        if minutes and minutes.strip().strip("`").strip() == NO_SPEECH_MARKER:
            raise NoSpeechError(NO_SPEECH_MESSAGE)
        if not minutes:
            raise ValueError("Failed to make transcript.")
        return TranscriptionResult(
            minutes=minutes,
            meta={"engine": "gemini_audio", "speaker_source": "none", "generated_at": datetime.now(UTC).isoformat()},
        )

    def _cast_names(self, podcast_id: str) -> list[str]:
        try:
            return self._repository.get_cast_names(podcast_id=podcast_id)
        except Exception:
            self._logger.exception("Failed to load cast names")
            return []

    def _recording(self, episode_id: str) -> RecordingSpeakers | None:
        try:
            return self._repository.find_recording_speakers(episode_id=episode_id)
        except Exception:
            self._logger.exception("Failed to look up the recording session")
            return None

    def _transcribe_recording(self, recording: RecordingSpeakers, duration_seconds: float) -> list[TranscriptSegment]:
        assert self._speech is not None  # noqa: S101
        assert self._work_bucket is not None  # noqa: S101
        uris = {
            speaker.participant_id: aligned_track_uri(self._work_bucket, recording.session_id, speaker.participant_id)
            for speaker in recording.speakers
        }
        per_speaker = self._recognize_voiced(uris)
        if per_speaker is None:
            results = self._speech.transcribe(dict.fromkeys(uris.values(), duration_seconds))
            per_speaker = {speaker_id: results.get(uri, []) for speaker_id, uri in uris.items()}
        tracks = [
            SpeakerTrack(
                speaker_id=speaker.participant_id,
                name=speaker.name,
                segments=per_speaker.get(speaker.participant_id, []),
            )
            for speaker in recording.speakers
        ]
        energy = self._energy_loader(uris) if self._energy_loader else None
        segments = merge_speaker_tracks(tracks, energy)
        self._logger.info(
            "Recording transcript: %d segments from %d speakers",
            len(segments),
            len(recording.speakers),
        )
        return segments

    def _recognize_voiced(self, uris: dict[str, str]) -> dict[str, list[TranscriptSegment]] | None:
        """声のある区間だけを認識する(音声認識は長さで課金されるため)。用意できなければ None(トラック全体を認識する)."""
        if self._voiced_preparer is None:
            return None
        assert self._speech is not None  # noqa: S101
        try:
            voiced = self._voiced_preparer(uris)
        except Exception:
            self._logger.exception("Failed to cut voiced regions; transcribing whole tracks")
            return None
        files = {track.uri: track.duration_seconds for track in voiced.values() if track is not None}
        results = self._speech.transcribe(files) if files else {}
        return {
            speaker_id: remap_segments(results.get(track.uri, []), track.time_map) if track is not None else []
            for speaker_id, track in voiced.items()
        }

    def _transcribe_mixed(
        self,
        gcs_uri: str,
        speech_uri: str,
        duration_seconds: float,
        cast: list[str],
        model_id: str | None,
    ) -> list[TranscriptSegment]:
        """音声認識は speech_uri(FLAC)、話者の推定は元の音声(gcs_uri)で行う."""
        assert self._speech is not None  # noqa: S101
        segments = self._speech.transcribe({speech_uri: duration_seconds}).get(speech_uri, [])
        if not segments:
            return segments
        # Gemini はときどき空の応答を返す(dev の 60 分の音声で 3 回に 1 回)。失敗すると全員の話者が
        # 不明になり議事録から名前が消えるので、何度か試す
        for attempt in range(1, SPEAKER_ATTEMPTS + 1):
            try:
                return self._provider.assign_speakers(gcs_uri, segments, cast or None, model_id)
            except Exception:
                self._logger.exception("Speaker assignment failed (attempt %d/%d)", attempt, SPEAKER_ATTEMPTS)
        self._logger.error("Speaker assignment failed; keeping unknown speakers")
        return segments
