from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from services.recording_mixer.alignment import ANALYSIS_RATE, find_lag
from services.recording_mixer.ffmpeg_tools import Piece, build_mix_filter, build_speaker_filter, decode_pcm
from services.recording_mixer.manifest import Chunk, build_segments
from services.recording_mixer.mixer import _clip_piece, mix_session

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")

SID = "11111111-1111-4111-8111-111111111111"
HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
GUEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
ORIGIN = 1_700_000_000_000


def _chunk(kind: str, pid: str, segment: str, seq: int, start_ms: int = 0, mime: str = "audio/webm", **extra) -> Chunk:
    return Chunk(
        kind=kind,
        participant_id=pid,
        uploader_id=pid,
        segment=segment,
        seq=seq,
        segment_start_ms=start_ms,
        chunk_start_ms=extra.get("chunk_start_ms", start_ms),
        duration_ms=None,
        bytes=1,
        sha256="x",
        mime=mime,
        sample_rate=extra.get("sample_rate"),
        key=f"sessions/{SID}/{kind}/{pid}/{segment}/{seq:06d}.webm",
    )


def test_build_segments_truncates_webm_at_the_first_missing_chunk() -> None:
    chunks = [_chunk("local", GUEST, "s1", seq) for seq in (0, 1, 3, 4)]
    chunks += [_chunk("local", GUEST, "s2", seq) for seq in (1, 2)]  # 先頭が無いので使えない
    segments = build_segments(chunks)
    assert len(segments) == 1
    assert [chunk.seq for chunk in segments[0].chunks] == [0, 1]


def test_build_segments_splits_wav_runs_and_uses_chunk_start() -> None:
    chunks = [
        _chunk(
            "local",
            GUEST,
            "w1",
            seq,
            start_ms=1000,
            mime="audio/wav",
            chunk_start_ms=1000 + seq * 10_000,
            sample_rate=44100,
        )
        for seq in (0, 1, 3)
    ]
    segments = build_segments(chunks)
    assert [(segment.start_ms, [c.seq for c in segment.chunks]) for segment in segments] == [
        (1000, [0, 1]),
        (31000, [3]),
    ]


def test_clip_piece_trims_to_the_timeline() -> None:
    piece = _clip_piece(Piece(source=Path("x"), src_start=0, duration=10, dst_start=-2, tempo=1.0), total=5)
    assert piece == Piece(source=Path("x"), src_start=2, duration=5, dst_start=0, tempo=1.0)
    assert _clip_piece(Piece(source=Path("x"), src_start=0, duration=10, dst_start=6), total=5) is None


def test_filters_are_well_formed() -> None:
    inputs, graph = build_speaker_filter(
        [
            Piece(source=Path("a.webm"), src_start=0, duration=10, dst_start=1.5, tempo=0.9999),
            Piece(source=Path("b.webm"), src_start=2, duration=3, dst_start=12),
        ],
        total_duration=20,
    )
    assert inputs == ["-i", "a.webm", "-i", "b.webm"]
    assert "adelay=1500:all=1[p0]" in graph
    assert "atempo=0.999900000" in graph
    assert "amix=inputs=2:normalize=0" in graph
    assert graph.endswith("atrim=0:20.000000[out]")
    assert build_mix_filter(1).count("[s0]") == 2
    assert "amix=inputs=3" in build_mix_filter(3)


# ---- ffmpeg を使った結合テスト ----


def _voice(seconds: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(seconds * 48000)
    tone = np.sin(2 * np.pi * rng.uniform(150, 300) * np.arange(n) / 48000)
    noise = np.convolve(rng.standard_normal(n), np.ones(24) / 24, mode="same")
    envelope = np.zeros(n)
    position = 0
    while position < n:
        talk = int(rng.uniform(0.6, 2.0) * 48000)
        envelope[position : position + talk] = 1.0
        position += talk + int(rng.uniform(0.3, 1.2) * 48000)
    return ((0.3 * tone + 2.0 * noise) * envelope * 0.4).astype(np.float32)


def _encode_webm(signal: np.ndarray, path: Path, bitrate: str = "128k") -> None:
    subprocess.run(
        [
            shutil.which("ffmpeg") or "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "f32le",
            "-ar",
            "48000",
            "-ac",
            "1",
            "-i",
            "-",
            "-c:a",
            "libopus",
            "-b:a",
            bitrate,
            str(path),
        ],
        input=signal.tobytes(),
        check=True,
    )


class _FakeObjects:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.uploaded: dict[str, Path] = {}

    def put_bytes(self, key: str, data: bytes) -> None:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def list_keys(self, prefix: str) -> set[str]:
        return {key for key in self._all_keys() if key.startswith(prefix)}

    def _all_keys(self) -> set[str]:
        return {str(path.relative_to(self.root)) for path in self.root.rglob("*") if path.is_file()}

    def download(self, key: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(self.root / key, path)

    def upload(self, path: Path, key: str, content_type: str) -> None:
        assert content_type == "audio/flac"
        self.uploaded[key] = path


def _split_bytes(data: bytes, parts: int) -> list[bytes]:
    """MediaRecorder のチャンクと同じく、連続したバイト列を任意の位置で切る。"""
    size = len(data) // parts + 1
    return [data[i : i + size] for i in range(0, len(data), size)]


@needs_ffmpeg
def test_mix_session_aligns_guest_and_fills_gaps_from_backup(tmp_path: Path) -> None:
    total = 40.0
    host_voice = _voice(total, seed=1)
    guest_voice = _voice(total, seed=2)
    objects = _FakeObjects(tmp_path / "r2")
    chunks: list[dict] = []

    def add_segment(kind: str, pid: str, segment: str, signal: np.ndarray, start_ms: int, parts: int) -> None:
        encoded = tmp_path / f"{kind}-{pid}-{segment}.webm"
        _encode_webm(signal, encoded, "128k" if kind == "local" else "32k")
        for seq, data in enumerate(_split_bytes(encoded.read_bytes(), parts)):
            key = f"sessions/{SID}/{kind}/{pid}/{segment}/{seq:06d}.webm"
            objects.put_bytes(key, data)
            chunks.append(
                {
                    "kind": kind,
                    "participantId": pid,
                    "uploaderId": HOST if kind == "backup" else pid,
                    "segment": segment,
                    "seq": seq,
                    "segmentStartMs": start_ms,
                    "chunkStartMs": start_ms,
                    "durationMs": None,
                    "bytes": len(data),
                    "sha256": "x",
                    "mime": "audio/webm",
                    "sampleRate": None,
                    "key": key,
                }
            )

    # ホストは全編を録れた
    add_segment("local", HOST, "h1", host_voice, ORIGIN, parts=4)
    # ゲストの local は時刻が 180ms ずれて記録され、20〜26 秒(リロード)が抜けている
    skew_ms = 180
    add_segment("local", GUEST, "g1", guest_voice[: 20 * 48000], ORIGIN + skew_ms, parts=3)
    add_segment("local", GUEST, "g2", guest_voice[26 * 48000 :], ORIGIN + 26_000 + skew_ms, parts=3)
    # ホストが受信していたゲストの音(正しい時刻)
    add_segment("backup", GUEST, "b1", guest_voice, ORIGIN, parts=5)

    manifest = {
        "sessionId": SID,
        "recording": {"startedAtMs": ORIGIN, "stoppedAtMs": ORIGIN + int(total * 1000)},
        "participants": [
            {"participantId": HOST, "name": "ホスト", "role": "host"},
            {"participantId": GUEST, "name": "ゲスト", "role": "guest"},
        ],
        "chunks": chunks,
    }
    objects.put_bytes(f"sessions/{SID}/manifest.json", json.dumps(manifest).encode())

    workdir = tmp_path / "work"
    workdir.mkdir()
    result = mix_session(session_id=SID, objects=objects, workdir=workdir)

    assert sorted(objects.uploaded) == [
        f"sessions/{SID}/aligned/{HOST}.flac",
        f"sessions/{SID}/aligned/{GUEST}.flac",
    ]
    guest_report = next(s for s in result.speakers if s.participant_id == GUEST)
    assert guest_report.filled_seconds == pytest.approx(6.0, abs=0.3)
    # 記録上の 180ms のずれが補正されている
    assert all(abs(a.offset + skew_ms / 1000) < 0.01 for a in guest_report.alignments)

    aligned = decode_pcm(objects.uploaded[f"sessions/{SID}/aligned/{GUEST}.flac"], ANALYSIS_RATE)
    assert len(aligned) / ANALYSIS_RATE == pytest.approx(total, abs=0.05)
    truth = decode_pcm(_write_wav(tmp_path / "truth.wav", guest_voice), ANALYSIS_RATE)
    for at in (5.0, 23.0, 33.0):  # local の区間・補完した区間・local の区間
        window = aligned[int(at * ANALYSIS_RATE) : int((at + 3) * ANALYSIS_RATE)]
        search = truth[int((at - 0.5) * ANALYSIS_RATE) : int((at + 3.5) * ANALYSIS_RATE)]
        lag, correlation = find_lag(window, search, int(0.5 * ANALYSIS_RATE))
        assert abs(lag) <= int(0.01 * ANALYSIS_RATE), f"at {at}s lag={lag}"
        assert correlation > 0.6

    mixed = decode_pcm(result.output_path, ANALYSIS_RATE)
    assert len(mixed) / ANALYSIS_RATE == pytest.approx(total, abs=0.1)
    assert np.max(np.abs(mixed)) < 0.95


def _write_wav(path: Path, signal: np.ndarray) -> Path:
    subprocess.run(
        [
            shutil.which("ffmpeg") or "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "f32le",
            "-ar",
            "48000",
            "-ac",
            "1",
            "-i",
            "-",
            str(path),
        ],
        input=signal.tobytes(),
        check=True,
    )
    return path
