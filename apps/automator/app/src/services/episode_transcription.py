"""エピソードの文字起こしと議事録を作る(#166).

1. 音声認識(Chirp 2)で時刻つきの発話を作る
   - ブラウザ収録のエピソード: 話者ごとの位置合わせ済みトラックを話者ごとに認識し、話者名を付けてまとめる
   - それ以外: ミックス済みの音声を認識し、各発話の話者を Gemini に推定させる
2. 時刻・話者つきの文字起こしから、Gemini が議事録を作る(目次の時刻は文字起こしの時刻)

音声認識に失敗したときは、以前の方式(Gemini に音声から直接議事録を作らせる)で続ける。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from domain.models.transcript import UNKNOWN_SPEAKER, TranscriptSegment, render_transcript
from services.transcript_builder import EnergyFn, SpeakerTrack, merge_speaker_tracks

if TYPE_CHECKING:
    from domain.interfaces import EpisodeRepository, RecordingSpeakers, SpeechTranscriber, TranscriptProvider

ENGINE = "chirp_2"

# 位置合わせ済みトラックの URI 一覧 → 区間の音量を返す関数(読めなければ None)
EnergyLoader = Callable[[dict[str, str]], EnergyFn | None]


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
        logger: logging.Logger | None = None,
    ) -> None:
        """Wire dependencies."""
        self._provider = transcript_provider
        self._repository = episode_repository
        self._speech = speech
        self._work_bucket = work_bucket
        self._energy_loader = energy_loader
        self._logger = logger or logging.getLogger(__name__)

    def run(
        self,
        *,
        gcs_uri: str,
        podcast_id: str,
        episode_id: str,
        duration_seconds: float,
        model_id: str | None,
    ) -> TranscriptionResult:
        """文字起こしと議事録を作る."""
        cast = self._cast_names(podcast_id)
        recording = self._recording(episode_id)
        if self._speech is not None:
            try:
                if recording is not None and self._work_bucket:
                    segments = self._transcribe_recording(recording, duration_seconds)
                    source = "recording"
                    cast = [speaker.name for speaker in recording.speakers]
                else:
                    segments = self._transcribe_mixed(gcs_uri, duration_seconds, cast, model_id)
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
                self._logger.warning("Speech recognition returned no speech; falling back to Gemini audio minutes")
            except Exception:
                self._logger.exception("Speech recognition failed; falling back to Gemini audio minutes")

        minutes = self._provider.generate_transcript(gcs_uri, model_id=model_id, cast_names=cast or None)
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
        results = self._speech.transcribe(dict.fromkeys(uris.values(), duration_seconds))
        tracks = [
            SpeakerTrack(
                speaker_id=speaker.participant_id,
                name=speaker.name,
                segments=results.get(uris[speaker.participant_id], []),
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

    def _transcribe_mixed(
        self,
        gcs_uri: str,
        duration_seconds: float,
        cast: list[str],
        model_id: str | None,
    ) -> list[TranscriptSegment]:
        assert self._speech is not None  # noqa: S101
        segments = self._speech.transcribe({gcs_uri: duration_seconds}).get(gcs_uri, [])
        if not segments:
            return segments
        try:
            return self._provider.assign_speakers(gcs_uri, segments, cast or None, model_id)
        except Exception:
            self._logger.exception("Speaker assignment failed; keeping unknown speakers")
            return segments
