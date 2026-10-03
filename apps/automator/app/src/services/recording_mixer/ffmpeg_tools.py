"""ffmpeg まわり(#166)。音声はメモリに全部載せず、ffmpeg にストリームで処理させる."""

from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path  # noqa: TC003 (dataclass のフィールド型として実行時に使う)
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from services.recording_mixer.manifest import Segment

logger = logging.getLogger(__name__)

OUTPUT_RATE = 48000
# これより 1 に近い速度は補正しない
TEMPO_EPSILON = 1e-7


def ffmpeg_binary() -> str:
    """Ffmpeg の絶対パス."""
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg is not installed")
    return path


def _run(args: list[str]) -> None:
    # 引数はこのモジュールが組み立てたものだけ(シェルを通さない)
    result = subprocess.run(  # noqa: S603
        [ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-y", *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        message = f"ffmpeg failed ({result.returncode}): {result.stderr.strip()[-2000:]}"
        raise RuntimeError(message)


@dataclass(frozen=True)
class Piece:
    """時間軸に置く 1 片。source の [src_start, src_start + duration) を dst_start から鳴らす."""

    source: Path
    src_start: float
    duration: float
    dst_start: float
    tempo: float = 1.0


def build_segment_file(segment: Segment, chunk_paths: list[Path], out_dir: Path) -> Path:
    """セグメントのチャンクを 1 本のファイルにする.

    WebM/Ogg はバイト連結(先頭チャンクにヘッダがある)。WAV は ffmpeg の concat で FLAC にまとめる。
    """
    name = f"{segment.kind}-{segment.participant_id}-{segment.segment}-{segment.chunks[0].seq}"
    if not segment.is_wav:
        out = out_dir / f"{name}.{segment.container}"
        with out.open("wb") as output:
            for path in chunk_paths:
                output.write(path.read_bytes())
        return out

    out = out_dir / f"{name}.flac"
    listing = out_dir / f"{name}.txt"
    listing.write_text("".join(f"file '{path.as_posix()}'\n" for path in chunk_paths))
    _run(
        [
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(listing),
            "-ac",
            "1",
            "-ar",
            str(OUTPUT_RATE),
            "-c:a",
            "flac",
            str(out),
        ]
    )
    return out


def decode_pcm(path: Path, rate: int) -> np.ndarray:
    """モノラル float32 の PCM にデコードする(シークしないので Duration の無い WebM でも読める)."""
    result = subprocess.run(  # noqa: S603
        [
            ffmpeg_binary(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-ac",
            "1",
            "-ar",
            str(rate),
            "-f",
            "s16le",
            "-",
        ],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0 and not result.stdout:
        message = f"ffmpeg decode failed: {result.stderr.decode(errors='replace')[-1000:]}"
        raise RuntimeError(message)
    if result.returncode != 0:
        # 末尾が欠けたファイルでも、読めたところまでは使う
        logger.warning("Decoded %s partially: %s", path.name, result.stderr.decode(errors="replace")[-300:])
    return np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def _atempo_chain(tempo: float) -> str:
    if abs(tempo - 1.0) < TEMPO_EPSILON:
        return ""
    # atempo は 0.5〜2.0 の範囲。時計の速度差は ±0.05% 程度なので 1 段で足りる
    return f",atempo={tempo:.9f}"


def build_speaker_filter(pieces: list[Piece], total_duration: float) -> tuple[list[str], str]:
    """話者 1 人分のトラックを時間軸どおりに並べる ffmpeg の入力と filter_complex を作る."""
    inputs: list[str] = []
    labels: list[str] = []
    filters: list[str] = []
    for index, piece in enumerate(pieces):
        inputs += ["-i", str(piece.source)]
        delay_ms = max(0, round(piece.dst_start * 1000))
        filters.append(
            f"[{index}:a]atrim=start={piece.src_start:.6f}:duration={piece.duration:.6f},asetpts=PTS-STARTPTS,"
            f"aresample={OUTPUT_RATE},aformat=sample_fmts=fltp:channel_layouts=mono{_atempo_chain(piece.tempo)},"
            f"adelay={delay_ms}:all=1[p{index}]"
        )
        labels.append(f"[p{index}]")
    tail = f"apad=whole_dur={total_duration:.6f},atrim=0:{total_duration:.6f}[out]"
    if len(labels) == 1:
        filters.append(f"{labels[0]}{tail}")
    else:
        filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:dropout_transition=0,{tail}")
    return inputs, ";".join(filters)


def render_speaker(pieces: list[Piece], total_duration: float, out_path: Path) -> None:
    """話者 1 人分の位置合わせ済みトラックを FLAC で書き出す."""
    inputs, graph = build_speaker_filter(pieces, total_duration)
    _run(
        [
            *inputs,
            "-filter_complex",
            graph,
            "-map",
            "[out]",
            "-ac",
            "1",
            "-ar",
            str(OUTPUT_RATE),
            "-sample_fmt",
            "s16",
            "-c:a",
            "flac",
            str(out_path),
        ]
    )


def build_mix_filter(speaker_count: int) -> str:
    """話者ごとに音量を揃えてから重ね、全体を -16 LUFS に整える filter_complex."""
    filters = [
        f"[{index}:a]loudnorm=I=-18:TP=-2:LRA=11,aresample={OUTPUT_RATE}[s{index}]" for index in range(speaker_count)
    ]
    labels = "".join(f"[s{index}]" for index in range(speaker_count))
    mixed = (
        f"{labels}amix=inputs={speaker_count}:normalize=0:dropout_transition=0"
        if speaker_count > 1
        else f"{labels}anull"
    )
    filters.append(
        f"{mixed},loudnorm=I=-16:TP=-1.5:LRA=11,aresample={OUTPUT_RATE},alimiter=limit=0.89:level=false[out]"
    )
    return ";".join(filters)


def render_mix(speaker_paths: list[Path], out_path: Path) -> None:
    """話者別トラックをミックスして FLAC で書き出す."""
    inputs: list[str] = []
    for path in speaker_paths:
        inputs += ["-i", str(path)]
    _run(
        [
            *inputs,
            "-filter_complex",
            build_mix_filter(len(speaker_paths)),
            "-map",
            "[out]",
            "-ac",
            "1",
            "-ar",
            str(OUTPUT_RATE),
            "-sample_fmt",
            "s16",
            "-c:a",
            "flac",
            str(out_path),
        ]
    )
