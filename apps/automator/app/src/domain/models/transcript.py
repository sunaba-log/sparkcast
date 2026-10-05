"""話者と時刻つきの文字起こし(#166)."""

from __future__ import annotations

import re
from dataclasses import dataclass, replace

UNKNOWN_SPEAKER = "不明"


@dataclass(frozen=True)
class TranscriptSegment:
    """1 つの発話。時刻はエピソード音声の先頭からの秒."""

    start: float
    end: float
    text: str
    speaker: str = UNKNOWN_SPEAKER
    # 収録ルームの参加者 ID など、話者を一意に指す値(無ければ None)
    speaker_id: str | None = None

    def with_speaker(self, speaker: str, speaker_id: str | None = None) -> TranscriptSegment:
        """話者を差し替えた写しを返す."""
        return replace(self, speaker=speaker, speaker_id=speaker_id)


def format_timestamp(seconds: float) -> str:
    """`m:ss`(1 時間以上は `h:mm:ss`)。議事録の目次と同じ書き方."""
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def parse_timestamp(value: str) -> float | None:
    """`m:ss` / `h:mm:ss` を秒にする。形式が違えば None."""
    parts = value.strip().split(":")
    if not 2 <= len(parts) <= 3 or not all(part.isdigit() for part in parts):  # noqa: PLR2004
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return float(seconds)


def render_transcript(segments: list[TranscriptSegment]) -> str:
    """議事録の生成や検索に渡すテキスト。1 行 1 発話で `[m:ss] 話者: 本文`."""
    return "\n".join(f"[{format_timestamp(s.start)}] {s.speaker}: {s.text}" for s in segments)


# 目次の 1 行。モデルが文字起こしに倣って `[0:03] タイトル` と角括弧を付けることもある
_TOC_LINE = re.compile(r"^\s*[-*・]?\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*[-\u2013:\uff1a]?\s*(.+?)\s*$")


_EMPTY_BODY = re.compile(r"^[-*・\s]*(なし|特になし|該当なし|ありません|特にありません|なし。|特になし。)\s*$")


def drop_empty_sections(minutes: str) -> str:
    """中身が「なし」だけの見出し(## 決定事項 など)を取り除く.

    モデルは「該当が無い節は書かない」と指示しても「なし」と書くことがあり、読む人にも検索にも雑音になる。
    """
    blocks: list[list[str]] = [[]]
    for line in minutes.splitlines():
        if line.startswith("## "):
            blocks.append([line])
        else:
            blocks[-1].append(line)
    kept: list[str] = []
    for block in blocks:
        body = [line for line in block[1:] if line.strip()]
        if block and block[0].startswith("## ") and body and all(_EMPTY_BODY.match(line) for line in body):
            continue
        kept.extend(block)
    return "\n".join(kept).strip()


def extract_topics(minutes: str) -> list[dict[str, str]]:
    """議事録の【目次】から `{time, title}` を取り出す(見つからなければ空)."""
    topics: list[dict[str, str]] = []
    in_toc = False
    for line in minutes.splitlines():
        stripped = line.strip().strip("#").strip()
        if "目次" in stripped and len(stripped) <= 12:  # noqa: PLR2004
            in_toc = True
            continue
        if not in_toc:
            continue
        match = _TOC_LINE.match(line.replace("**", ""))
        if match:
            topics.append({"time": match.group(1), "title": match.group(2)})
        elif topics and stripped:
            # 目次の後ろの最初の見出しや本文で終わり
            break
    return topics
