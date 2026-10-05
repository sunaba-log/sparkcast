"""話者別トラックから、本人が話している区間だけを取り出して認識する(#166).

音声認識は音声の長さで課金される。ブラウザ収録は話者ごとのトラックを認識するので、4 人・60 分なら
240 分ぶんになるが、各トラックの大半は本人が黙っている区間(または相手の声の回り込み)である。
本人の声がある区間だけをつないだ短い音声を認識し、結果の時刻を元のトラックの時刻に戻す。

精度を落とさないように:
- 判定はトラックの雑音の水準からの相対(雑音 + 10dB)で行い、小さめの声も拾う
- 区間の前後に余白を付け(話し始め・話し終わりを削らない)、近い区間はつなぐ
- 区間のあいだには短い無音を挟む(認識が文の切れ目として扱えるように)
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
import uuid
import wave
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from google.cloud import storage

from services.recording_mixer.ffmpeg_tools import decode_pcm, ffmpeg_binary

if TYPE_CHECKING:
    from domain.models.transcript import TranscriptSegment

logger = logging.getLogger(__name__)

SPEECH_RATE = 16000
FRAME_SECONDS = 0.03
# 雑音の水準(フレームの音量の下位 20%)より、これだけ大きければ声とみなす
SPEECH_ABOVE_NOISE_DB = 10.0
# 無音のトラックでの下限(これより小さい音は声とみなさない)
MIN_SPEECH_DB = -55.0
PAD_BEFORE_SECONDS = 0.4
PAD_AFTER_SECONDS = 0.5
# これより短い切れ目はつなぐ(文の途中の息継ぎで区間を割らない)
MERGE_GAP_SECONDS = 1.0
# これより短い区間は捨てる(咳払い・物音)。余白を付ける前の長さ
MIN_REGION_SECONDS = 0.15
# 区間のあいだに挟む無音
JOIN_GAP_SECONDS = 0.5


def find_voiced_regions(signal: np.ndarray, rate: int) -> list[tuple[float, float]]:
    """声のある区間(秒、余白込み)の一覧."""
    frame = max(1, int(rate * FRAME_SECONDS))
    count = len(signal) // frame
    if count == 0:
        return []
    frames = signal[: count * frame].reshape(count, frame).astype(np.float64)
    db = 20 * np.log10(np.sqrt(np.mean(np.square(frames), axis=1)) + 1e-9)
    noise = float(np.percentile(db, 20))
    threshold = max(noise + SPEECH_ABOVE_NOISE_DB, MIN_SPEECH_DB)
    voiced = db > threshold

    regions: list[tuple[float, float]] = []
    start: int | None = None
    for index, is_voiced in enumerate([*voiced, False]):
        if is_voiced and start is None:
            start = index
        elif not is_voiced and start is not None:
            if (index - start) * FRAME_SECONDS >= MIN_REGION_SECONDS:
                regions.append((start * FRAME_SECONDS, index * FRAME_SECONDS))
            start = None

    total = len(signal) / rate
    padded: list[tuple[float, float]] = []
    for region_start, region_end in regions:
        begin, end = max(0.0, region_start - PAD_BEFORE_SECONDS), min(total, region_end + PAD_AFTER_SECONDS)
        if padded and begin - padded[-1][1] < MERGE_GAP_SECONDS:
            padded[-1] = (padded[-1][0], end)
        else:
            padded.append((begin, end))
    return padded


@dataclass(frozen=True)
class TimeMap:
    """つないだ音声の時刻 → 元のトラックの時刻."""

    # (つないだ音声での開始, 元のトラックでの開始, 長さ)
    pieces: tuple[tuple[float, float, float], ...]

    def to_original(self, t: float) -> float:
        """つないだ音声の時刻を、元のトラックの時刻にする."""
        if not self.pieces:
            return t
        for condensed_start, original_start, length in self.pieces:
            if t < condensed_start:
                # 区間のあいだの無音は、次の区間の始まりに寄せる
                return original_start
            if t <= condensed_start + length:
                return original_start + (t - condensed_start)
        condensed_start, original_start, length = self.pieces[-1]
        return original_start + length

    @property
    def duration(self) -> float:
        """つないだ音声の長さ."""
        if not self.pieces:
            return 0.0
        condensed_start, _, length = self.pieces[-1]
        return condensed_start + length


def condense(signal: np.ndarray, rate: int, regions: list[tuple[float, float]]) -> tuple[np.ndarray, TimeMap]:
    """区間だけをつないだ信号と、時刻の対応表."""
    gap = np.zeros(int(JOIN_GAP_SECONDS * rate), dtype=signal.dtype)
    parts: list[np.ndarray] = []
    pieces: list[tuple[float, float, float]] = []
    position = 0.0
    for index, (begin, end) in enumerate(regions):
        if index:
            parts.append(gap)
            position += JOIN_GAP_SECONDS
        chunk = signal[int(begin * rate) : int(end * rate)]
        parts.append(chunk)
        pieces.append((position, begin, len(chunk) / rate))
        position += len(chunk) / rate
    condensed = np.concatenate(parts) if parts else np.zeros(0, dtype=signal.dtype)
    return condensed, TimeMap(tuple(pieces))


def remap_segments(segments: list[TranscriptSegment], time_map: TimeMap) -> list[TranscriptSegment]:
    """認識した発話の時刻を、元のトラックの時刻に戻す."""
    return [
        replace(segment, start=time_map.to_original(segment.start), end=time_map.to_original(segment.end))
        for segment in segments
    ]


@dataclass(frozen=True)
class VoicedTrack:
    """認識に回す、声のある区間だけの音声."""

    uri: str
    duration_seconds: float
    time_map: TimeMap


def _write_flac(signal: np.ndarray, rate: int, path: Path) -> None:
    wav = path.with_suffix(".wav")
    pcm = (np.clip(signal, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(str(wav), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())
    # 引数はここで組み立てたものだけ(シェルを通さない)
    result = subprocess.run(  # noqa: S603
        [ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "flac", str(path)],
        check=False,
        capture_output=True,
    )
    wav.unlink(missing_ok=True)
    if result.returncode != 0:
        message = f"ffmpeg could not write FLAC: {result.stderr.decode(errors='replace')[-300:]}"
        raise RuntimeError(message)


class GcsVoicedTrackPreparer:
    """GCS の話者別トラックから、声のある区間だけの FLAC を作って作業用バケットに置く."""

    def __init__(self, work_bucket: str, client: storage.Client | None = None) -> None:
        """Keep the destination bucket."""
        self._work_bucket = work_bucket
        self._client = client

    def __call__(self, uris: dict[str, str]) -> dict[str, VoicedTrack | None]:
        """話者 ID → トラックの URI から、話者 ID → 認識に回す音声(声が無ければ None)."""
        client = self._client or storage.Client()
        prepared: dict[str, VoicedTrack | None] = {}
        with tempfile.TemporaryDirectory() as tmp:
            for speaker_id, uri in uris.items():
                bucket, _, name = uri.removeprefix("gs://").partition("/")
                source = Path(tmp) / f"{speaker_id}-source.flac"
                client.bucket(bucket).blob(name).download_to_filename(str(source))
                signal = decode_pcm(source, SPEECH_RATE)
                source.unlink()
                regions = find_voiced_regions(signal, SPEECH_RATE)
                if not regions:
                    prepared[speaker_id] = None
                    continue
                condensed, time_map = condense(signal, SPEECH_RATE, regions)
                target = Path(tmp) / f"{speaker_id}-voiced.flac"
                _write_flac(condensed, SPEECH_RATE, target)
                # recordings/{session}/aligned/{speaker}.flac → recordings/{session}/voiced/…(トラックの置き場と分ける)
                voiced_name = f"{name.rsplit('/', 2)[0]}/voiced/{uuid.uuid4().hex}-{speaker_id}.flac"
                client.bucket(self._work_bucket).blob(voiced_name).upload_from_filename(
                    str(target), content_type="audio/flac"
                )
                target.unlink()
                logger.info(
                    "Voiced audio for %s: %.0fs of %.0fs (%d regions)",
                    speaker_id,
                    time_map.duration,
                    len(signal) / SPEECH_RATE,
                    len(regions),
                )
                prepared[speaker_id] = VoicedTrack(
                    uri=f"gs://{self._work_bucket}/{voiced_name}",
                    duration_seconds=time_map.duration,
                    time_map=time_map,
                )
        return prepared
