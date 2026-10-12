"""検証2：音声編集の機械的な正しさ（合成信号）。

[モック] 実際の発話ではなく、区間ごとに固有の周波数を持つ合成音を使う。
「機密語」の区間（1100Hz）が出力にどれだけ残るか、前後の区間をどれだけ削るかを測る。
STT の単語時刻の誤差は、編集範囲をずらして再現する（実際の誤差の大きさは実音声の評価で測る）。
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path

import numpy as np
import pytest
from pydub import AudioSegment
from pydub.generators import Sine

from services.audio_policy_editor import PolicyAudioEdit, export_audio, render_policy_audio

RATE = 48_000
# 1秒ずつ：前(300Hz) / 案件コード(700) / スイレン742(1100, 削除対象) / です(1500) / 後(1900)
PLAN = [("前", 300), ("案件コード", 700), ("SECRET", 1100), ("です", 1500), ("後", 1900)]
SECRET_START, SECRET_END = 2000, 3000
RESULTS: list[dict] = []


def _source() -> AudioSegment:
    audio = AudioSegment.silent(0, frame_rate=RATE)
    for _, hz in PLAN:
        audio += Sine(hz, sample_rate=RATE).to_audio_segment(duration=1000, volume=-12).set_channels(1)
    return audio.set_frame_rate(RATE).set_channels(1).set_sample_width(2)


def _presence_ms(audio: AudioSegment, hz: float, window_ms: int = 10) -> int:
    """指定周波数が支配的な 10ms 窓の合計時間（ms）."""
    samples = np.array(audio.get_array_of_samples(), dtype=np.float64)
    n = int(RATE * window_ms / 1000)
    total = 0
    for i in range(0, len(samples) - n + 1, n):
        frame = samples[i : i + n] * np.hanning(n)
        spec = np.abs(np.fft.rfft(frame))
        freqs = np.fft.rfftfreq(n, 1 / RATE)
        if spec.max() < 50:  # 無音
            continue
        band = spec[(freqs > hz - 60) & (freqs < hz + 60)].max()
        if band >= 0.5 * spec.max():
            total += window_ms
    return total


def _wav(audio: AudioSegment) -> bytes:
    return export_audio(audio, "wav")


def _record(case: str, **values) -> None:
    RESULTS.append({"case": case, **values})


@pytest.fixture(scope="module", autouse=True)
def _dump():
    yield
    out = os.environ.get("EVIDENCE_DIR")
    if out:
        Path(out, "audio_edit_signal.json").write_text(json.dumps(RESULTS, ensure_ascii=False, indent=1))


def test_v2_10_cut_removes_secret_and_keeps_neighbors():
    src = _source()
    out, timeline = render_policy_audio(src, [PolicyAudioEdit(SECRET_START, SECRET_END, "cut")])
    secret, before, after = _presence_ms(out, 1100), _presence_ms(out, 700), _presence_ms(out, 1500)
    _record("V2-10 cut", length_ms=len(out), secret_ms=secret, prev_word_ms=before, next_word_ms=after)
    assert len(out) == 4000 and secret == 0
    assert before >= 980 and after >= 980


def test_v2_11_silence_keeps_duration_and_removes_secret():
    out, _ = render_policy_audio(_source(), [PolicyAudioEdit(SECRET_START, SECRET_END, "silence")])
    secret = _presence_ms(out, 1100)
    region = np.array(out[SECRET_START:SECRET_END].get_array_of_samples())
    _record("V2-11 silence", length_ms=len(out), secret_ms=secret, region_max_abs=int(np.abs(region).max()))
    assert len(out) == 5000 and secret == 0 and np.abs(region).max() == 0


def test_v2_12_replace_inserts_replacement_only():
    replacement = Sine(2600, sample_rate=RATE).to_audio_segment(duration=800, volume=-12).set_channels(1)
    out, timeline = render_policy_audio(_source(), [PolicyAudioEdit(SECRET_START, SECRET_END, "replace", _wav(replacement))])
    secret, repl = _presence_ms(out, 1100), _presence_ms(out, 2600)
    _record("V2-12 replace", length_ms=len(out), secret_ms=secret, replacement_ms=repl, timeline=timeline)
    assert len(out) == 4800 and secret == 0 and repl >= 780


@pytest.mark.parametrize("start_err,end_err", [(0, 0), (50, 0), (150, 0), (300, 0), (0, -150), (-150, 150), (-300, 300)])
def test_v2_13_range_error_leaves_secret_or_overcuts(start_err, end_err):
    """編集範囲の開始・終了が単語時刻の誤差でずれたとき、機密語の残り（ms）と前後の削りすぎ（ms）."""
    out, _ = render_policy_audio(_source(), [PolicyAudioEdit(SECRET_START + start_err, SECRET_END + end_err, "cut")])
    residual = _presence_ms(out, 1100)
    lost_prev = 1000 - _presence_ms(out, 700)
    lost_next = 1000 - _presence_ms(out, 1500)
    _record(f"V2-13 cut start{start_err:+d}ms end{end_err:+d}ms", secret_residual_ms=residual, prev_lost_ms=lost_prev, next_lost_ms=lost_next)
    expected_residual = max(0, start_err) + max(0, -end_err)
    assert abs(residual - expected_residual) <= 20
    assert abs(lost_prev - max(0, -start_err)) <= 20 and abs(lost_next - max(0, end_err)) <= 20


def test_v2_14_join_after_edit_has_no_fade_in():
    """編集の直後に続く元音声（末尾以外）には fade-in がかからず、接合部で波形が急に始まる（クリック音の可能性）."""
    src = _source()
    edits = [PolicyAudioEdit(1000, 1100, "cut"), PolicyAudioEdit(SECRET_START, SECRET_END, "cut")]
    out, timeline = render_policy_audio(src, edits)
    join = timeline[1]["outputEndMs"]  # 1つ目の編集の直後
    samples = np.array(out.get_array_of_samples(), dtype=np.int32)
    i = int(join * RATE / 1000)
    first_ms_peak = int(np.abs(samples[i : i + RATE // 1000]).max())
    _record("V2-14 join after first edit", join_ms=join, peak_in_first_ms_after_join=first_ms_peak, full_scale=32767)
    assert first_ms_peak > 1000  # 立ち上がりが急（観測値を記録）


def test_v2_15_mp3_export_roundtrip_does_not_reintroduce_secret():
    out, _ = render_policy_audio(_source(), [PolicyAudioEdit(SECRET_START, SECRET_END, "cut")])
    decoded = AudioSegment.from_file(io.BytesIO(export_audio(out)), format="mp3").set_frame_rate(RATE).set_channels(1)
    secret = _presence_ms(decoded, 1100)
    _record("V2-15 mp3 roundtrip", secret_ms=secret, length_ms=len(decoded))
    assert secret == 0
