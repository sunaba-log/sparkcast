"""Render non-overlapping source-timeline policy edits without exposing removed audio."""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Literal

from pydub import AudioSegment


@dataclass(frozen=True)
class PolicyAudioEdit:
    """One approved operation on a half-open original-audio interval."""

    start_ms: int
    end_ms: int
    action: Literal["cut", "silence", "replace", "insert"]
    replacement: bytes | None = None


def render_policy_audio(source: AudioSegment, edits: list[PolicyAudioEdit]) -> tuple[AudioSegment, list[dict]]:
    """Assemble original slices once and return an exact piecewise timeline map."""
    result = source[:0]
    cursor = 0
    timeline = []
    for edit in sorted(edits, key=lambda item: (item.start_ms, item.end_ms)):
        if not cursor <= edit.start_ms <= edit.end_ms <= len(source) or (
            edit.start_ms == edit.end_ms and edit.action != "insert"
        ):
            raise ValueError("Editing ranges overlap, are empty, or exceed the source audio.")
        if edit.action not in {"cut", "silence", "replace", "insert"}:
            raise ValueError("Unknown policy audio action.")
        prefix = source[cursor : edit.start_ms]
        if len(prefix):
            timeline.append(
                {
                    "sourceStartMs": cursor,
                    "sourceEndMs": edit.start_ms,
                    "outputStartMs": len(result),
                    "outputEndMs": len(result) + len(prefix),
                    "kind": "original",
                }
            )
        # Fades use only retained samples. Removed samples never enter a crossfade.
        result += prefix.fade_out(min(8, len(prefix))) if len(prefix) else prefix
        output_start = len(result)
        if edit.action == "silence":
            replacement = AudioSegment.silent(duration=edit.end_ms - edit.start_ms, frame_rate=source.frame_rate)
        elif edit.action in {"replace", "insert"}:
            if not edit.replacement:
                raise ValueError("Replacement audio is required.")
            replacement = AudioSegment.from_file(io.BytesIO(edit.replacement), format="wav")
            if not len(replacement):
                raise ValueError("Replacement audio is empty.")
            replacement = replacement.fade_in(min(8, len(replacement))).fade_out(min(8, len(replacement)))
        else:
            replacement = source[:0]
        result += (
            replacement.set_frame_rate(source.frame_rate)
            .set_channels(source.channels)
            .set_sample_width(source.sample_width)
        )
        timeline.append(
            {
                "sourceStartMs": edit.start_ms,
                "sourceEndMs": edit.end_ms,
                "outputStartMs": output_start,
                "outputEndMs": len(result),
                "kind": edit.action,
            }
        )
        cursor = edit.end_ms
    suffix = source[cursor:]
    if len(suffix):
        timeline.append(
            {
                "sourceStartMs": cursor,
                "sourceEndMs": len(source),
                "outputStartMs": len(result),
                "outputEndMs": len(result) + len(suffix),
                "kind": "original",
            }
        )
    result += suffix.fade_in(min(8, len(suffix))) if edits and len(suffix) else suffix
    return result, timeline


def export_audio(audio: AudioSegment, audio_format: str = "mp3") -> bytes:
    """Encode the final assembled PCM once."""
    output = io.BytesIO()
    audio.export(output, format=audio_format, **({"bitrate": "192k"} if audio_format == "mp3" else {}))
    return output.getvalue()
