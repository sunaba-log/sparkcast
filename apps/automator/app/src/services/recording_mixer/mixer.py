"""収録セッションをミックスして 1 本の FLAC にする(#166).

1. R2 から manifest.json とチャンクを取り寄せ、セグメント(連結できる並び)にまとめる
2. 話者ごとに、ゲストの local をホストのバックアップと突き合わせて位置とずれを補正する
3. local が無い区間はバックアップで埋める
4. 話者別の位置合わせ済みトラック(R2 に保存・編集用)を作り、ミックスして GCS の source/ に置く
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path  # noqa: TC003 (dataclass のフィールド型として実行時に使う)
from typing import Protocol

import numpy as np

from services.recording_mixer.alignment import (
    ANALYSIS_RATE,
    NO_ALIGNMENT,
    AlignedRange,
    Alignment,
    coverage_gaps,
    fit_piecewise,
    measure_lags,
)
from services.recording_mixer.ffmpeg_tools import Piece, build_segment_file, decode_pcm, render_mix, render_speaker
from services.recording_mixer.manifest import Manifest, Segment, build_segments

logger = logging.getLogger(__name__)

# これより短い片は捨てる(秒)
MIN_PIECE_SECONDS = 0.01
# バックアップで埋める最短の隙間(秒)
MIN_FILL_SECONDS = 0.2


class RecordingObjects(Protocol):
    """R2 の recordings バケット."""

    def list_keys(self, prefix: str) -> set[str]:
        """Prefix 配下のキー一覧."""
        ...

    def download(self, key: str, path: Path) -> None:
        """キーをファイルに落とす."""
        ...

    def upload(self, path: Path, key: str, content_type: str) -> None:
        """ファイルを置く."""
        ...


@dataclass
class SpeakerReport:
    """話者ごとの処理結果(ログと通知用)."""

    participant_id: str
    name: str
    local_seconds: float = 0.0
    filled_seconds: float = 0.0
    alignments: list[Alignment] = field(default_factory=list)
    aligned_key: str | None = None
    # 作業ディレクトリ内の位置合わせ済み FLAC(呼び出し側が GCS にも置く)
    aligned_path: Path | None = None


@dataclass
class MixResult:
    """ミックス結果."""

    duration_seconds: float
    speakers: list[SpeakerReport]
    output_path: Path


class MixError(RuntimeError):
    """ミックスできない(録音が無いなど)."""


def _download_all(objects: RecordingObjects, keys: list[str], workdir: Path) -> dict[str, Path]:
    paths = {key: workdir / "chunks" / key.replace("/", "_") for key in keys}
    (workdir / "chunks").mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(lambda key: objects.download(key, paths[key]), keys))
    return paths


def _place(reference: np.ndarray, signal: np.ndarray, start_seconds: float) -> None:
    start = round(start_seconds * ANALYSIS_RATE)
    if start >= len(reference):
        return
    src_lo = max(0, -start)
    dst_lo = max(0, start)
    length = min(len(signal) - src_lo, len(reference) - dst_lo)
    if length > 0:
        reference[dst_lo : dst_lo + length] = signal[src_lo : src_lo + length]


def _clip_piece(piece: Piece, total: float) -> Piece | None:
    """時間軸 [0, total) に収まるよう切る。timeline 上の長さは duration / tempo."""
    src_start, duration, dst = piece.src_start, piece.duration, piece.dst_start
    if dst < 0:
        cut = -dst * piece.tempo
        src_start += cut
        duration -= cut
        dst = 0.0
    timeline_length = duration / piece.tempo
    if dst + timeline_length > total:
        duration = (total - dst) * piece.tempo
    if duration <= MIN_PIECE_SECONDS or dst >= total:
        return None
    return Piece(source=piece.source, src_start=src_start, duration=duration, dst_start=dst, tempo=piece.tempo)


def plan_speaker(
    local: list[tuple[Segment, Path, np.ndarray]],
    backup: list[tuple[Segment, Path, np.ndarray]],
    origin_ms: int,
    total: float,
    align_to_backup: bool,
) -> tuple[list[Piece], SpeakerReport]:
    """話者 1 人分の片の並びを決める(位置合わせと補完)."""
    report = SpeakerReport(participant_id="", name="")
    reference: np.ndarray | None = None
    if align_to_backup and backup:
        reference = np.zeros(int((total + 5) * ANALYSIS_RATE), dtype=np.float32)
        for segment, _, signal in backup:
            _place(reference, signal, (segment.start_ms - origin_ms) / 1000)

    pieces: list[Piece] = []
    covered: list[tuple[float, float]] = []
    for segment, path, signal in local:
        nominal = (segment.start_ms - origin_ms) / 1000
        duration = len(signal) / ANALYSIS_RATE
        ranges = [AlignedRange(start=0.0, end=None, alignment=NO_ALIGNMENT)]
        if reference is not None:
            ranges = fit_piecewise(measure_lags(signal, reference, nominal_start=nominal))
        for aligned in ranges:
            alignment = aligned.alignment
            report.alignments.append(alignment)
            range_end = duration if aligned.end is None else min(aligned.end, duration)
            piece = _clip_piece(
                Piece(
                    source=path,
                    src_start=aligned.start,
                    duration=range_end - aligned.start,
                    # 位置 = 名目の開始 + offset + τ x (1 + drift)
                    dst_start=nominal + alignment.offset + aligned.start * (1 + alignment.drift),
                    tempo=alignment.tempo,
                ),
                total,
            )
            if piece is None:
                continue
            pieces.append(piece)
            end = piece.dst_start + piece.duration / piece.tempo
            covered.append((piece.dst_start, end))
            report.local_seconds += end - piece.dst_start

    # local が無い区間をバックアップで埋める
    for gap_lo, gap_hi in coverage_gaps(covered, 0.0, total):
        for segment, path, signal in backup:
            start = (segment.start_ms - origin_ms) / 1000
            end = start + len(signal) / ANALYSIS_RATE
            lo, hi = max(gap_lo, start), min(gap_hi, end)
            if hi - lo < MIN_FILL_SECONDS:
                continue
            piece = _clip_piece(Piece(source=path, src_start=lo - start, duration=hi - lo, dst_start=lo), total)
            if piece is not None:
                pieces.append(piece)
                report.filled_seconds += piece.duration
    return pieces, report


def mix_session(
    *,
    session_id: str,
    objects: RecordingObjects,
    workdir: Path,
) -> MixResult:
    """セッションをミックスし、話者別トラックを R2 に置く。最終 FLAC のパスを返す(アップロードは呼び出し側)."""
    prefix = f"sessions/{session_id}/"
    manifest_path = workdir / "manifest.json"
    objects.download(f"{prefix}manifest.json", manifest_path)
    manifest = Manifest.from_json(json.loads(manifest_path.read_text()))
    manifest = manifest.only_existing(objects.list_keys(prefix))
    if not manifest.chunks:
        raise MixError("録音データがありません")

    origin_ms = manifest.started_at_ms or min(chunk.segment_start_ms for chunk in manifest.chunks)
    if manifest.stopped_at_ms:
        end_ms = manifest.stopped_at_ms
    else:
        end_ms = max(chunk.chunk_start_ms + (chunk.duration_ms or 10_000) for chunk in manifest.chunks)
    total = max(1.0, (end_ms - origin_ms) / 1000)

    chunk_paths = _download_all(objects, [chunk.key for chunk in manifest.chunks], workdir)
    segments = build_segments(manifest.chunks)
    segment_dir = workdir / "segments"
    segment_dir.mkdir(exist_ok=True)
    roles = {participant.participant_id: participant for participant in manifest.participants}

    speaker_paths: list[Path] = []
    reports: list[SpeakerReport] = []
    participant_ids = sorted({segment.participant_id for segment in segments})
    for participant_id in participant_ids:
        decoded: dict[str, list[tuple[Segment, Path, np.ndarray]]] = {"local": [], "backup": []}
        for segment in (s for s in segments if s.participant_id == participant_id):
            path = build_segment_file(segment, [chunk_paths[chunk.key] for chunk in segment.chunks], segment_dir)
            try:
                signal = decode_pcm(path, ANALYSIS_RATE)
            except RuntimeError:
                logger.exception("Skipping undecodable segment %s", path.name)
                continue
            if signal.size == 0:
                continue
            decoded[segment.kind].append((segment, path, signal))

        participant = roles.get(participant_id)
        pieces, report = plan_speaker(
            decoded["local"],
            decoded["backup"],
            origin_ms,
            total,
            align_to_backup=participant is None or participant.role != "host",
        )
        report.participant_id = participant_id
        report.name = participant.name if participant else ""
        if not pieces:
            logger.warning("No audio for participant %s", participant_id)
            continue
        out = workdir / f"speaker-{participant_id}.flac"
        render_speaker(pieces, total, out)
        report.aligned_key = f"{prefix}aligned/{participant_id}.flac"
        report.aligned_path = out
        objects.upload(out, report.aligned_key, "audio/flac")
        speaker_paths.append(out)
        reports.append(report)
        for alignment in report.alignments:
            logger.info(
                "Aligned %s: offset=%.3fs drift=%.1fppm windows=%d",
                participant_id,
                alignment.offset,
                alignment.drift * 1e6,
                alignment.samples_used,
            )
        logger.info("Speaker %s: local=%.1fs filled=%.1fs", participant_id, report.local_seconds, report.filled_seconds)

    if not speaker_paths:
        raise MixError("デコードできる録音がありません")
    output = workdir / "mix.flac"
    render_mix(speaker_paths, output)
    return MixResult(duration_seconds=total, speakers=reports, output_path=output)
