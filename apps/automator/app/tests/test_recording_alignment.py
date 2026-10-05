from __future__ import annotations

import numpy as np
import pytest

from services.recording_mixer.alignment import (
    ANALYSIS_RATE,
    WINDOW_SECONDS,
    LagSample,
    coverage_gaps,
    find_lag,
    fit_alignment,
    fit_piecewise,
    measure_lags,
)

RATE = ANALYSIS_RATE


def _speech_like(seconds: float, seed: int) -> np.ndarray:
    """発話っぽい信号(ノイズのバーストと無音が交互に来る)。"""
    rng = np.random.default_rng(seed)
    n = int(seconds * RATE)
    signal = rng.standard_normal(n).astype(np.float32)
    envelope = np.zeros(n, dtype=np.float32)
    position = 0
    while position < n:
        talk = int(rng.uniform(0.5, 3.0) * RATE)
        pause = int(rng.uniform(0.2, 1.5) * RATE)
        envelope[position : position + talk] = 1.0
        position += talk + pause
    # 声の帯域(おおむね 1kHz 以下)に寄せる
    smoothed = np.convolve(signal, np.ones(5, dtype=np.float32) / 5, mode="same")
    return smoothed * envelope * 0.3


def _resample(signal: np.ndarray, factor: float) -> np.ndarray:
    """時計の速度差を模す(factor > 1 なら local の時計が速い=サンプル数が増える)。"""
    n = int(len(signal) * factor)
    positions = np.arange(n) / factor
    return np.interp(positions, np.arange(len(signal)), signal).astype(np.float32)


def test_find_lag_detects_shift() -> None:
    reference = _speech_like(10, seed=1)
    window = reference[RATE * 3 : RATE * 5]
    max_lag = RATE // 2
    # 名目では 2.9 秒の位置だが、実際は 3.0 秒の位置にある → +0.1 秒
    nominal = int(RATE * 2.9)
    search = reference[nominal - max_lag : nominal + len(window) + max_lag]
    lag, correlation = find_lag(window, search, max_lag)
    assert lag == int(RATE * 0.1)
    assert correlation > 0.99


@pytest.mark.parametrize(("offset", "drift_ppm"), [(0.0, 0.0), (0.237, 0.0), (-0.41, 80.0), (0.12, -150.0)])
def test_measure_and_fit_recover_offset_and_drift(offset: float, drift_ppm: float) -> None:
    duration = 30 * 60
    truth = _speech_like(duration + 5, seed=7)
    segment_start = 2.0
    # reference は収録全体の時間軸(ホストが受信した音)。local は端末の時計で録った同じ話者の音。
    reference = truth.copy()
    true_start = segment_start + offset
    local = truth[int(true_start * RATE) : int((true_start + duration - 10) * RATE)]
    local = _resample(local, 1.0 / (1.0 + drift_ppm * 1e-6))
    reference = reference + np.random.default_rng(3).standard_normal(len(reference)).astype(np.float32) * 0.01

    samples = measure_lags(local, reference, nominal_start=segment_start)
    alignment = fit_alignment(samples)

    assert alignment.samples_used >= 10
    assert alignment.offset == pytest.approx(offset, abs=0.003)
    assert alignment.drift * 1e6 == pytest.approx(drift_ppm, abs=15)


def test_measure_skips_silent_windows() -> None:
    reference = np.zeros(RATE * 120, dtype=np.float32)
    local = np.zeros(RATE * 100, dtype=np.float32)
    assert measure_lags(local, reference, nominal_start=5.0) == []


def test_fit_rejects_outliers() -> None:
    samples = [LagSample(at=float(t), lag=0.05 + 1e-5 * t, correlation=0.9) for t in range(0, 1800, 120)]
    samples.append(LagSample(at=900.0, lag=0.4, correlation=0.8))
    alignment = fit_alignment(samples)
    assert alignment.offset == pytest.approx(0.05, abs=1e-4)
    assert alignment.drift == pytest.approx(1e-5, abs=1e-6)


def test_fit_uses_median_for_short_segments_and_implausible_drift() -> None:
    short = [LagSample(at=0.0, lag=0.1, correlation=0.9), LagSample(at=20.0, lag=0.12, correlation=0.9)]
    assert fit_alignment(short).drift == 0.0
    assert fit_alignment(short).offset == pytest.approx(0.11)

    wild = [LagSample(at=float(t), lag=0.01 * t, correlation=0.9) for t in range(0, 600, 60)]
    assert fit_alignment(wild).drift == 0.0
    assert fit_alignment([]).samples_used == 0


def test_coverage_gaps() -> None:
    assert coverage_gaps([(0, 10), (12, 20)], 0, 30) == [(10, 12), (20, 30)]
    assert coverage_gaps([(5, 10)], 0, 10) == [(0, 5)]
    # 短い隙間は無視する
    assert coverage_gaps([(0, 10), (10.1, 20)], 0, 20) == []
    assert coverage_gaps([], 0, 3) == [(0, 3)]
    # 重なりと範囲外
    assert coverage_gaps([(-5, 4), (2, 8), (25, 40)], 0, 30) == [(8, 25)]


def test_fit_piecewise_splits_at_a_latency_step() -> None:
    # dev で実際に出た形: 回線断から戻ると、受信側の遅れが 0.13s → 0.213s に段差状に変わる
    samples = [LagSample(at=float(t), lag=0.13, correlation=0.95) for t in (16, 33, 41, 58, 74)]
    samples.append(LagSample(at=82.0, lag=0.6, correlation=0.4))  # 1 つだけ飛んだ窓は捨てる
    samples += [LagSample(at=float(t), lag=0.213, correlation=0.95) for t in (99, 115, 123, 132, 140, 156, 164)]
    ranges = fit_piecewise(samples)
    assert len(ranges) == 2
    assert ranges[0].start == 0.0
    assert ranges[0].alignment.offset == pytest.approx(0.13, abs=1e-6)
    assert ranges[1].alignment.offset == pytest.approx(0.213, abs=1e-6)
    boundary = (74 + 99) / 2 + WINDOW_SECONDS / 2
    assert ranges[0].end == pytest.approx(boundary)
    assert ranges[1].start == pytest.approx(boundary)
    assert ranges[1].end is None


def test_fit_piecewise_keeps_one_range_for_drift_and_isolated_outliers() -> None:
    # 速度差による緩やかな変化(120 秒で 18ms)は区切らない
    drift = [LagSample(at=float(t), lag=0.05 + 150e-6 * t, correlation=0.9) for t in range(0, 1800, 120)]
    drift.insert(5, LagSample(at=610.0, lag=0.9, correlation=0.4))
    ranges = fit_piecewise(drift)
    assert len(ranges) == 1
    assert ranges[0].alignment.drift == pytest.approx(150e-6, abs=5e-6)
    assert fit_piecewise([])[0].alignment.samples_used == 0
