"""Tests for AudioConverter."""

import io

import pytest
from pydub import AudioSegment
from pydub.generators import Sine

from services import AudioConverter, AudioCutIn, AudioCutInEditor


def test_convert_to_mp3_passthrough_for_mp3() -> None:
    """MP3 input should be returned as-is without conversion."""
    sample_bytes = b"fake-mp3-data"
    output_bytes = AudioConverter.convert_to_mp3(sample_bytes, ".mp3")
    assert output_bytes == sample_bytes


def test_convert_to_mp3_unsupported_extension() -> None:
    """Unsupported extensions should raise ValueError."""
    with pytest.raises(ValueError, match="Unsupported audio format"):
        AudioConverter.convert_to_mp3(b"data", ".ogg")


def _wav_bytes(audio: AudioSegment) -> bytes:
    output = io.BytesIO()
    audio.export(output, format="wav")
    return output.getvalue()


def test_cut_in_editor_offsets_each_original_timeline_timestamp_and_recalculates_metadata(monkeypatch) -> None:
    """Each later insertion includes the complete rendered duration of earlier cut-ins."""
    source = Sine(440).to_audio_segment(duration=1000).apply_gain(-18)
    cut_in = Sine(880).to_audio_segment(duration=200).apply_gain(-8)
    source_bytes = _wav_bytes(source)
    cut_in_bytes = _wav_bytes(cut_in)

    def export_mp3(self, output, **kwargs):
        assert kwargs["format"] == "mp3"
        output.write(b"synthetic-mp3")

    monkeypatch.setattr(AudioSegment, "export", export_mp3)

    result = AudioCutInEditor(silence_ms=75, crossfade_ms=50).edit_to_mp3(
        source_bytes,
        "wav",
        [
            AudioCutIn(insert_timestamp_ms=600, audio_bytes=cut_in_bytes, audio_format="wav"),
            AudioCutIn(insert_timestamp_ms=100, audio_bytes=cut_in_bytes, audio_format="wav"),
        ],
    )

    assert [(item.source_timestamp_ms, item.output_timestamp_ms) for item in result.applied_cut_ins] == [
        (100, 100),
        (600, 950),
    ]
    assert [item.inserted_duration_ms for item in result.applied_cut_ins] == [350, 350]
    assert result.duration_seconds == 2
    assert result.duration_str == "00:00:02"
    assert result.mp3_bytes == b"synthetic-mp3"
    assert result.file_size_bytes == len(result.mp3_bytes)


def test_cut_in_editor_rejects_timestamp_outside_original_master() -> None:
    """Cut-ins must identify a position on the unedited source timeline."""
    source = Sine(440).to_audio_segment(duration=100)
    cut_in = Sine(880).to_audio_segment(duration=100)

    with pytest.raises(ValueError, match="source duration"):
        AudioCutInEditor().edit_to_mp3(
            _wav_bytes(source),
            "wav",
            [AudioCutIn(insert_timestamp_ms=101, audio_bytes=_wav_bytes(cut_in), audio_format="wav")],
        )


def test_cut_in_editor_requires_natural_silence_range() -> None:
    """Boundary silence follows the specified 50-100 ms natural transition range."""
    with pytest.raises(ValueError, match="between 50 and 100"):
        AudioCutInEditor(silence_ms=49)
