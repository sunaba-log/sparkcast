"""話者ごとの発話を 1 本の文字起こしにまとめる(#166).

収録ルームでは話者ごとのトラックを別々に認識する。スピーカーで聞いている参加者がいると、
相手の声がマイクに入り込み、同じ発話が 2 人分のトラックに出る。時間が重なり本文も似ている
発話は、その区間の音量が大きい(=本人の)トラックだけを残す。
"""

from __future__ import annotations

import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from domain.models.transcript import TranscriptSegment

# 重なりがこの割合以上(短い方に対して)で、本文の類似度がこの値以上なら同じ発話とみなす
OVERLAP_RATIO = 0.5
SIMILARITY = 0.6


@dataclass(frozen=True)
class SpeakerTrack:
    """1 人分の認識結果."""

    speaker_id: str
    name: str
    segments: list[TranscriptSegment]


# (speaker_id, start, end) → その区間の音量(RMS)
EnergyFn = Callable[[str, float, float], float]


def _normalize(text: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKC", text) if ch.isalnum())


def _overlap_ratio(a: TranscriptSegment, b: TranscriptSegment) -> float:
    overlap = min(a.end, b.end) - max(a.start, b.start)
    shorter = min(a.end - a.start, b.end - b.start)
    if overlap <= 0 or shorter <= 0:
        return 0.0
    return overlap / shorter


def is_crosstalk(a: TranscriptSegment, b: TranscriptSegment) -> bool:
    """別々の話者のトラックに出た、同じ発話(回り込み)か."""
    if a.speaker_id == b.speaker_id or _overlap_ratio(a, b) < OVERLAP_RATIO:
        return False
    left, right = _normalize(a.text), _normalize(b.text)
    if not left or not right:
        return False
    return SequenceMatcher(None, left, right).ratio() >= SIMILARITY


def merge_speaker_tracks(tracks: list[SpeakerTrack], energy: EnergyFn | None = None) -> list[TranscriptSegment]:
    """話者ごとの発話に話者名を付けて時刻順に並べ、回り込みを取り除く."""
    labelled = [
        segment.with_speaker(track.name, track.speaker_id)
        for track in tracks
        for segment in track.segments
        if segment.text.strip()
    ]
    labelled.sort(key=lambda segment: (segment.start, segment.end))

    dropped: set[int] = set()
    for i, segment in enumerate(labelled):
        if i in dropped:
            continue
        for j in range(i + 1, len(labelled)):
            other = labelled[j]
            if other.start >= segment.end:
                break
            if j in dropped or not is_crosstalk(segment, other):
                continue
            if energy is None:
                # 音量が分からなければ長い方(より多く聞き取れた方)を残す
                keep_first = len(segment.text) >= len(other.text)
            else:
                start, end = max(segment.start, other.start), min(segment.end, other.end)
                keep_first = energy(segment.speaker_id or "", start, end) >= energy(other.speaker_id or "", start, end)
            if keep_first:
                dropped.add(j)
            else:
                dropped.add(i)
                break
    return [segment for index, segment in enumerate(labelled) if index not in dropped]
