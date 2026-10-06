"""Audio file converter service.

This module handles conversion of audio files (FLAC, WAV, AAC/m4a) to MP3 format.
"""

import io
import logging
import math
from collections.abc import Sequence
from dataclasses import dataclass

from pydub import AudioSegment

logger = logging.getLogger(__name__)

# Supported audio formats
SUPPORTED_FORMATS = {".flac", ".wav", ".m4a", ".mp3"}
MIN_SILENCE_MS = 50
MAX_SILENCE_MS = 100


@dataclass(frozen=True)
class AudioCutIn:
    """A synthesized audio clip to insert at a source-timeline position."""

    insert_timestamp_ms: int
    audio_bytes: bytes
    audio_format: str = "mp3"


@dataclass(frozen=True)
class AppliedAudioCutIn:
    """The actual insertion position after preceding cut-ins shifted the master."""

    source_timestamp_ms: int
    output_timestamp_ms: int
    inserted_duration_ms: int


@dataclass(frozen=True)
class EditedAudio:
    """MP3 master and metadata recalculated after cut-in editing."""

    mp3_bytes: bytes
    file_size_bytes: int
    duration_str: str
    duration_seconds: int
    applied_cut_ins: tuple[AppliedAudioCutIn, ...]


class AudioCutInEditor:
    """Insert normalized director audio into a master track with timeline-safe offsets."""

    def __init__(self, *, silence_ms: int = 75, crossfade_ms: int = 50, reference_window_ms: int = 500) -> None:
        """Configure the edit boundaries and the local loudness reference window."""
        if not MIN_SILENCE_MS <= silence_ms <= MAX_SILENCE_MS:
            msg = "silence_ms must be between 50 and 100 milliseconds."
            raise ValueError(msg)
        if crossfade_ms < 0:
            msg = "crossfade_ms must be non-negative."
            raise ValueError(msg)
        if reference_window_ms <= 0:
            msg = "reference_window_ms must be positive."
            raise ValueError(msg)
        self._silence_ms = silence_ms
        self._crossfade_ms = crossfade_ms
        self._reference_window_ms = reference_window_ms

    def edit_to_mp3(
        self,
        source_audio: bytes,
        source_format: str,
        cut_ins: Sequence[AudioCutIn],
        *,
        bitrate: str = "192k",
    ) -> EditedAudio:
        """Insert cut-ins specified on the original timeline and return an MP3 master.

        Each subsequent insertion is shifted by the exact rendered length of all
        earlier cut-ins, including its silence boundaries.  This keeps timestamps
        supplied by transcript correction UI stable even after multiple edits.
        """
        source_format = source_format.removeprefix(".").lower()
        if f".{source_format}" not in SUPPORTED_FORMATS:
            msg = f"Unsupported audio format: .{source_format}. Supported formats: {SUPPORTED_FORMATS}"
            raise ValueError(msg)
        master = AudioSegment.from_file(io.BytesIO(source_audio), format=source_format)
        original_duration_ms = len(master)
        ordered_cut_ins = sorted(enumerate(cut_ins), key=lambda item: (item[1].insert_timestamp_ms, item[0]))

        offset_ms = 0
        applied: list[AppliedAudioCutIn] = []
        for _, cut_in in ordered_cut_ins:
            if not 0 <= cut_in.insert_timestamp_ms <= original_duration_ms:
                msg = (
                    f"insert_timestamp_ms {cut_in.insert_timestamp_ms} must be within "
                    f"the source duration (0-{original_duration_ms})."
                )
                raise ValueError(msg)
            if not cut_in.audio_bytes:
                msg = "Cut-in audio must not be empty."
                raise ValueError(msg)

            output_timestamp_ms = cut_in.insert_timestamp_ms + offset_ms
            synthesized = AudioSegment.from_file(
                io.BytesIO(cut_in.audio_bytes),
                format=cut_in.audio_format.removeprefix(".").lower(),
            )
            prepared = self._prepare_cut_in(synthesized, master, output_timestamp_ms)
            master, inserted_duration_ms = self._insert_with_crossfade(master, prepared, output_timestamp_ms)
            applied.append(
                AppliedAudioCutIn(
                    source_timestamp_ms=cut_in.insert_timestamp_ms,
                    output_timestamp_ms=output_timestamp_ms,
                    inserted_duration_ms=inserted_duration_ms,
                )
            )
            offset_ms += inserted_duration_ms

        output = io.BytesIO()
        master.export(output, format="mp3", bitrate=bitrate)
        mp3_bytes = output.getvalue()
        duration_seconds = math.ceil(len(master) / 1000)
        return EditedAudio(
            mp3_bytes=mp3_bytes,
            file_size_bytes=len(mp3_bytes),
            duration_str=_format_duration(duration_seconds),
            duration_seconds=duration_seconds,
            applied_cut_ins=tuple(applied),
        )

    def _prepare_cut_in(self, cut_in: AudioSegment, master: AudioSegment, timestamp_ms: int) -> AudioSegment:
        """Loudness-match a synthesized clip and soften both edges before insertion."""
        normalized = self._normalize_to_local_rms(cut_in, master, timestamp_ms)
        fade_ms = min(self._crossfade_ms, len(normalized) // 2)
        if fade_ms:
            normalized = normalized.fade_in(fade_ms).fade_out(fade_ms)
        silence = (
            AudioSegment.silent(duration=self._silence_ms + self._crossfade_ms, frame_rate=normalized.frame_rate)
            .set_channels(normalized.channels)
            .set_sample_width(normalized.sample_width)
        )
        return silence + normalized + silence

    def _insert_with_crossfade(
        self, master: AudioSegment, cut_in: AudioSegment, timestamp_ms: int
    ) -> tuple[AudioSegment, int]:
        """Join both sides with a micro-crossfade without shortening configured silence."""
        prefix, suffix = master[:timestamp_ms], master[timestamp_ms:]
        leading_crossfade = min(self._crossfade_ms, len(prefix), len(cut_in))
        combined = prefix.append(cut_in, crossfade=leading_crossfade)
        trailing_crossfade = min(self._crossfade_ms, len(combined), len(suffix))
        edited = combined.append(suffix, crossfade=trailing_crossfade)
        return edited, len(edited) - len(master)

    def _normalize_to_local_rms(self, cut_in: AudioSegment, master: AudioSegment, timestamp_ms: int) -> AudioSegment:
        """Match the synthesized clip RMS to audio adjacent to its insertion point."""
        start = max(0, timestamp_ms - self._reference_window_ms)
        end = min(len(master), timestamp_ms + self._reference_window_ms)
        reference = master[start:end]
        if cut_in.rms == 0 or reference.rms == 0:
            return cut_in
        gain_db = 20 * math.log10(reference.rms / cut_in.rms)
        return cut_in.apply_gain(gain_db)


def _format_duration(duration_seconds: int) -> str:
    """Format rounded-up duration seconds for RSS iTunes metadata."""
    hours, remainder = divmod(duration_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02}"


class AudioConverter:
    """Audio format converter using pydub."""

    @staticmethod
    def convert_to_mp3(audio_data: bytes, file_extension: str, bitrate: str = "192k") -> bytes:
        """Convert audio file to MP3 format.

        Args:
            audio_data: Raw audio file data as bytes
            file_extension: File extension including the dot (e.g., '.flac', '.wav', '.m4a')
            bitrate: Target bitrate for MP3 (default: '192k')

        Returns:
            MP3 encoded audio data as bytes

        Raises:
            ValueError: If file extension is not supported
            Exception: If conversion fails

        Examples:
            >>> converter = AudioConverter()
            >>> with open("audio.flac", "rb") as f:
            ...     audio_data = f.read()
            >>> mp3_data = converter.convert_to_mp3(audio_data, ".flac")
        """
        file_extension = file_extension.lower()

        if file_extension not in SUPPORTED_FORMATS:
            msg = f"Unsupported audio format: {file_extension}. Supported formats: {SUPPORTED_FORMATS}"
            logger.error(msg)
            raise ValueError(msg)

        # If already MP3, return as is
        if file_extension == ".mp3":
            logger.info("Audio is already in MP3 format, skipping conversion")
            return audio_data

        try:
            # Load audio from bytes
            logger.info("Loading audio from bytes (format: %s)", file_extension)
            audio = AudioSegment.from_file(io.BytesIO(audio_data), format=file_extension[1:])

            # Export to MP3
            logger.info("Converting audio to MP3 with bitrate %s", bitrate)
            output_buffer = io.BytesIO()
            audio.export(output_buffer, format="mp3", bitrate=bitrate)
            output_buffer.seek(0)
            mp3_data = output_buffer.read()

            logger.info("Audio conversion successful, output size: %d bytes", len(mp3_data))
            return mp3_data

        except Exception as e:
            logger.exception("Failed to convert audio to MP3")
            raise
