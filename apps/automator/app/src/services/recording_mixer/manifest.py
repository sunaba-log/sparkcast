"""収録の台帳(Durable Object が R2 に書き出す manifest.json)を読み、セグメントにまとめる(#166).

- WebM/Ogg(MediaRecorder)は、同じセグメントのチャンクを seq 順にバイト連結すると 1 本のファイルになる。
  途中の seq が欠けると、その後ろは正しく復元できないので、欠けた手前までを 1 本として扱う
  (欠けた区間はホストのバックアップで補う)。
- WAV(AudioWorklet のフォールバック)はチャンクごとに独立したファイル。連続した seq の並びを 1 本にまとめ、
  欠けがあればそこで分ける(各並びの開始はチャンク自身の開始時刻)。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Chunk:
    """録音チャンク 1 つ."""

    kind: str
    participant_id: str
    uploader_id: str
    segment: str
    seq: int
    segment_start_ms: int
    chunk_start_ms: int
    duration_ms: int | None
    bytes: int
    sha256: str
    mime: str
    sample_rate: int | None
    key: str

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Chunk:
        """manifest.json の 1 要素から作る."""
        return cls(
            kind=str(data["kind"]),
            participant_id=str(data["participantId"]),
            uploader_id=str(data["uploaderId"]),
            segment=str(data["segment"]),
            seq=int(data["seq"]),
            segment_start_ms=int(data["segmentStartMs"]),
            chunk_start_ms=int(data["chunkStartMs"]),
            duration_ms=None if data.get("durationMs") is None else int(data["durationMs"]),
            bytes=int(data["bytes"]),
            sha256=str(data["sha256"]),
            mime=str(data["mime"]),
            sample_rate=None if data.get("sampleRate") is None else int(data["sampleRate"]),
            key=str(data["key"]),
        )


@dataclass
class Segment:
    """連続して録れた 1 本の音声(ファイル 1 本に連結できる単位)."""

    kind: str
    participant_id: str
    segment: str
    # サーバー時刻(ミリ秒)でのこの並びの開始
    start_ms: int
    container: str
    chunks: list[Chunk] = field(default_factory=list)

    @property
    def is_wav(self) -> bool:
        """WAV チャンクの並びか."""
        return self.container == "wav"


@dataclass(frozen=True)
class Participant:
    """参加者."""

    participant_id: str
    name: str
    role: str


@dataclass
class Manifest:
    """収録の台帳."""

    session_id: str
    started_at_ms: int | None
    stopped_at_ms: int | None
    participants: list[Participant]
    chunks: list[Chunk]

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Manifest:
        """manifest.json から作る."""
        recording = data.get("recording") or {}
        return cls(
            session_id=str(data.get("sessionId", "")),
            started_at_ms=recording.get("startedAtMs"),
            stopped_at_ms=recording.get("stoppedAtMs"),
            participants=[
                Participant(participant_id=str(p["participantId"]), name=str(p.get("name", "")), role=str(p["role"]))
                for p in data.get("participants", [])
            ],
            chunks=[Chunk.from_json(chunk) for chunk in data.get("chunks", [])],
        )

    def only_existing(self, existing_keys: set[str]) -> Manifest:
        """R2 に実在するチャンクだけに絞る(台帳にあっても保存に失敗したものを除く)."""
        return Manifest(
            session_id=self.session_id,
            started_at_ms=self.started_at_ms,
            stopped_at_ms=self.stopped_at_ms,
            participants=self.participants,
            chunks=[chunk for chunk in self.chunks if chunk.key in existing_keys],
        )


def _container(mime: str) -> str:
    if mime == "audio/wav":
        return "wav"
    if mime == "audio/ogg":
        return "ogg"
    return "webm"


def build_segments(chunks: list[Chunk]) -> list[Segment]:
    """チャンクを、ファイル 1 本に連結できる並び(Segment)にまとめる."""
    groups: dict[tuple[str, str, str], list[Chunk]] = {}
    for chunk in chunks:
        groups.setdefault((chunk.kind, chunk.participant_id, chunk.segment), []).append(chunk)

    segments: list[Segment] = []
    for (kind, participant_id, segment_id), group in groups.items():
        ordered = sorted({chunk.seq: chunk for chunk in group}.values(), key=lambda chunk: chunk.seq)
        container = _container(ordered[0].mime)
        if container == "wav":
            run: list[Chunk] = []
            for chunk in ordered:
                if run and chunk.seq != run[-1].seq + 1:
                    segments.append(_wav_segment(kind, participant_id, segment_id, run))
                    run = []
                run.append(chunk)
            if run:
                segments.append(_wav_segment(kind, participant_id, segment_id, run))
            continue

        # WebM/Ogg は先頭(seq 0)にヘッダがある。先頭が無ければ復元できない
        if ordered[0].seq != 0:
            continue
        contiguous = [ordered[0]]
        for chunk in ordered[1:]:
            if chunk.seq != contiguous[-1].seq + 1:
                break
            contiguous.append(chunk)
        segments.append(
            Segment(
                kind=kind,
                participant_id=participant_id,
                segment=segment_id,
                start_ms=contiguous[0].segment_start_ms,
                container=container,
                chunks=contiguous,
            )
        )
    return sorted(segments, key=lambda segment: (segment.participant_id, segment.kind, segment.start_ms))


def _wav_segment(kind: str, participant_id: str, segment_id: str, run: list[Chunk]) -> Segment:
    return Segment(
        kind=kind,
        participant_id=participant_id,
        segment=segment_id,
        start_ms=run[0].chunk_start_ms,
        container="wav",
        chunks=list(run),
    )
