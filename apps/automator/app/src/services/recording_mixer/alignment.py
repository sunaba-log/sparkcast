"""話者ごとの録音の位置合わせ(#166).

ゲストの端末で録った高音質トラック(local)は、サーバー時刻で記録した開始時刻で大まかに置ける。
ただし端末ごとに音声の時計がわずかに違うため、1 時間で数十〜数百 ms ずれていく。
そこで、ホストが受信音声として録っていた同じ話者のバックアップ(reference)と
区間ごとに相互相関をとり、ずれ(lag)を時刻の 1 次式で近似して補正する。

- 相互相関は 8kHz に落とした信号で行い、メモリと計算量を抑える。
- 無音の区間は相関が取れないので飛ばす。
- 外れ値(ネットワークの揺らぎで一時的にずれた区間など)は残差で除いてから当てはめる。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

ANALYSIS_RATE = 8000

# 1 つの窓の長さ・窓の最大数・探索するずれの幅。
# 窓が長いと、窓の中で時計の速度差によるずれ(150ppm なら 8 秒で 1.2ms)が積もって相関が鈍るため短めにする。
WINDOW_SECONDS = 8.0
MAX_WINDOWS = 60
MAX_LAG_SECONDS = 1.5
# この相関係数を下回る窓は使わない
MIN_CORRELATION = 0.3
# 時計の速度差の上限(ppm)。これを超える推定は誤りとみなして捨てる
MAX_DRIFT = 500e-6
# 当てはめで外れ値とみなす残差(秒)
OUTLIER_SECONDS = 0.03
# 速度差まで推定するのに要る窓の数と時間幅(秒)
MIN_FIT_SAMPLES = 3
MIN_FIT_SPAN_SECONDS = 60


@dataclass(frozen=True)
class LagSample:
    """1 つの窓で測ったずれ."""

    # セグメント先頭からの時刻(秒、local の時計)
    at: float
    # 実際の位置 - 名目上の位置(秒)。正なら名目より後ろに置くべき
    lag: float
    correlation: float


@dataclass(frozen=True)
class Alignment:
    """セグメントの補正量。位置 = 名目の開始 + offset + τ x (1 + drift)."""

    offset: float
    drift: float
    samples_used: int

    @property
    def tempo(self) -> float:
        """Atempo に渡す速度(local を timeline の長さに合わせる)."""
        return 1.0 / (1.0 + self.drift)


NO_ALIGNMENT = Alignment(offset=0.0, drift=0.0, samples_used=0)


def _rms(signal: np.ndarray) -> float:
    if signal.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(signal, dtype=np.float64))))


def find_lag(window: np.ndarray, search: np.ndarray, max_lag: int) -> tuple[int, float]:
    """`search` の中で `window` が最もよく一致する位置を探す.

    `search` は名目上の位置から前後 `max_lag` サンプル広げた区間(長さ len(window) + 2 * max_lag)。

    Returns:
        (ずれのサンプル数, 正規化相互相関)。ずれは名目上の位置からの差(正なら後ろ)。
    """
    window = window.astype(np.float64) - float(np.mean(window))
    search = search.astype(np.float64) - float(np.mean(search))
    n = len(window) + len(search)
    size = 1 << (n - 1).bit_length()
    spectrum = np.fft.rfft(search, size) * np.conj(np.fft.rfft(window, size))
    corr = np.fft.irfft(spectrum, size)[: len(search) - len(window) + 1]
    # 各位置での search 側のエネルギーで割って正規化する
    cumulative = np.concatenate(([0.0], np.cumsum(np.square(search))))
    energy = cumulative[len(window) :] - cumulative[: len(search) - len(window) + 1]
    window_energy = float(np.sum(np.square(window)))
    denom = np.sqrt(np.maximum(energy, 1e-12) * max(window_energy, 1e-12))
    normalized = corr / denom
    best = int(np.argmax(normalized))
    return best - max_lag, float(normalized[best])


def measure_lags(
    local: np.ndarray,
    reference: np.ndarray,
    nominal_start: float,
    rate: int = ANALYSIS_RATE,
    window_seconds: float = WINDOW_SECONDS,
    max_windows: int = MAX_WINDOWS,
    max_lag_seconds: float = MAX_LAG_SECONDS,
) -> list[LagSample]:
    """セグメント全体に窓を等間隔に置き、窓ごとのずれを測る.

    Args:
        local: セグメントの信号(rate Hz・モノラル)
        reference: 収録全体の時間軸に置いたバックアップ(rate Hz、無い区間は 0)
        nominal_start: セグメントの名目上の開始位置(収録開始からの秒)
        rate: サンプリングレート
        window_seconds: 窓の長さ
        max_windows: 窓の最大数
        max_lag_seconds: 探索するずれの幅
    """
    window_len = int(window_seconds * rate)
    max_lag = int(max_lag_seconds * rate)
    window_len = min(window_len, len(local))
    if window_len < rate * 2:
        return []

    count = max(1, min(max_windows, len(local) // window_len))
    starts = np.linspace(0, len(local) - window_len, count).astype(int)
    noise_floor = max(_rms(reference) * 0.1, 1e-4)
    samples: list[LagSample] = []
    for start in starts:
        window = local[start : start + window_len]
        nominal = round(nominal_start * rate) + int(start)
        lo = nominal - max_lag
        hi = nominal + window_len + max_lag
        if lo < 0 or hi > len(reference):
            continue
        search = reference[lo:hi]
        if _rms(window) < noise_floor or _rms(search) < noise_floor:
            continue
        lag, correlation = find_lag(window, search, max_lag)
        if correlation < MIN_CORRELATION or abs(lag) >= max_lag:
            continue
        samples.append(LagSample(at=float(start) / rate, lag=lag / rate, correlation=correlation))
    return samples


def fit_alignment(samples: list[LagSample]) -> Alignment:
    """ずれのサンプルを lag = offset + drift x τ で近似する(外れ値を除いて重み付き最小二乗)."""
    if not samples:
        return NO_ALIGNMENT
    points = list(samples)
    if len(points) < MIN_FIT_SAMPLES or (points[-1].at - points[0].at) < MIN_FIT_SPAN_SECONDS:
        # 時間幅が短いと速度差は推定できないので、ずれ(中央値)だけ補正する
        return Alignment(offset=float(np.median([p.lag for p in points])), drift=0.0, samples_used=len(points))

    offset, drift = 0.0, 0.0
    for _ in range(3):
        at = np.array([p.at for p in points])
        lag = np.array([p.lag for p in points])
        weight = np.array([p.correlation for p in points])
        design = np.vstack([np.ones_like(at), at]).T * weight[:, None]
        solution, *_ = np.linalg.lstsq(design, lag * weight, rcond=None)
        offset, drift = float(solution[0]), float(solution[1])
        residual = np.abs(lag - (offset + drift * at))
        kept = [p for p, r in zip(points, residual, strict=True) if r <= OUTLIER_SECONDS]
        if len(kept) == len(points) or len(kept) < MIN_FIT_SAMPLES:
            break
        points = kept

    if abs(drift) > MAX_DRIFT:
        return Alignment(offset=float(np.median([p.lag for p in points])), drift=0.0, samples_used=len(points))
    return Alignment(offset=offset, drift=drift, samples_used=len(points))


# 隣り合う窓のずれがこれ以上変わったら、そこで遅れが段差状に変わったとみなす(回線断からの復帰など)。
# 時計の速度差による変化は窓の間隔ぶんでも数十 ms 未満なので、ここでは区切らない。
STEP_SECONDS = 0.05


@dataclass(frozen=True)
class AlignedRange:
    """セグメントのうち、同じ補正量を使う区間(local の時計で、セグメント先頭からの秒)."""

    start: float
    # None ならセグメントの終わりまで
    end: float | None
    alignment: Alignment


def fit_piecewise(samples: list[LagSample], window_seconds: float = WINDOW_SECONDS) -> list[AlignedRange]:
    """ずれが途中で段差状に変わるとき(回線断から戻ると受信側の遅れが変わる)は、段差の前後で別々に当てはめる.

    1 つの窓だけ飛んだもの(相関の取り違え)は区間にせず捨てる。段差が無ければ fit_alignment と同じ。
    """
    if len(samples) < 2:  # noqa: PLR2004
        return [AlignedRange(start=0.0, end=None, alignment=fit_alignment(samples))]
    groups: list[list[LagSample]] = [[samples[0]]]
    for sample in samples[1:]:
        if abs(sample.lag - groups[-1][-1].lag) > STEP_SECONDS:
            groups.append([sample])
        else:
            groups[-1].append(sample)
    kept: list[list[LagSample]] = []
    for group in groups:
        if len(group) < 2:  # noqa: PLR2004
            continue
        # 飛んだ窓を捨てた結果、前後が同じ水準に戻っていれば 1 つの区間にまとめる
        if kept and abs(group[0].lag - kept[-1][-1].lag) <= STEP_SECONDS:
            kept[-1].extend(group)
        else:
            kept.append(group)
    if len(kept) <= 1:
        return [AlignedRange(start=0.0, end=None, alignment=fit_alignment(kept[0] if kept else samples))]

    ranges: list[AlignedRange] = []
    for index, group in enumerate(kept):
        # 区切りは、前の区間の最後の窓と、この区間の最初の窓の中ほど(窓の中心どうしの中点)
        start = 0.0 if index == 0 else (kept[index - 1][-1].at + group[0].at) / 2 + window_seconds / 2
        end = None if index == len(kept) - 1 else (group[-1].at + kept[index + 1][0].at) / 2 + window_seconds / 2
        ranges.append(AlignedRange(start=start, end=end, alignment=fit_alignment(group)))
    return ranges


def coverage_gaps(
    covered: list[tuple[float, float]],
    start: float,
    end: float,
    min_gap: float = 0.2,
) -> list[tuple[float, float]]:
    """[start, end) のうち `covered` で覆われていない区間を返す(短すぎる隙間は無視)."""
    gaps: list[tuple[float, float]] = []
    cursor = start
    for lo, hi in sorted(covered):
        if hi <= cursor:
            continue
        if lo > cursor and lo - cursor >= min_gap:
            gaps.append((cursor, min(lo, end)))
        cursor = max(cursor, hi)
        if cursor >= end:
            break
    if end - cursor >= min_gap:
        gaps.append((cursor, end))
    return [(lo, hi) for lo, hi in gaps if hi > lo]
