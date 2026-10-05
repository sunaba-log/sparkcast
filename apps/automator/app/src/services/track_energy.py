"""話者別トラックの区間の音量(回り込みの判定用、#166)."""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from google.cloud import storage

from services.recording_mixer.alignment import ANALYSIS_RATE
from services.recording_mixer.ffmpeg_tools import decode_pcm

if TYPE_CHECKING:
    from services.transcript_builder import EnergyFn

logger = logging.getLogger(__name__)


def energy_from_signals(signals: dict[str, np.ndarray], rate: int = ANALYSIS_RATE) -> EnergyFn:
    """話者 ID → 信号 から、区間の RMS を返す関数を作る."""

    def energy(speaker_id: str, start: float, end: float) -> float:
        signal = signals.get(speaker_id)
        if signal is None:
            return 0.0
        lo, hi = max(0, int(start * rate)), min(len(signal), int(end * rate))
        if hi <= lo:
            return 0.0
        return float(np.sqrt(np.mean(np.square(signal[lo:hi], dtype=np.float64))))

    return energy


def load_track_energy(uris: dict[str, str], client: storage.Client | None = None) -> EnergyFn | None:
    """GCS の話者別トラック(話者 ID → gs:// URI)を 8kHz で読み、音量関数を返す。読めなければ None."""
    try:
        gcs = client or storage.Client()
        signals: dict[str, np.ndarray] = {}
        with tempfile.TemporaryDirectory() as tmp:
            for speaker_id, uri in uris.items():
                bucket, _, name = uri.removeprefix("gs://").partition("/")
                path = Path(tmp) / f"{speaker_id}.flac"
                gcs.bucket(bucket).blob(name).download_to_filename(str(path))
                signals[speaker_id] = decode_pcm(path, ANALYSIS_RATE)
                path.unlink()
        return energy_from_signals(signals)
    except Exception:
        logger.exception("Failed to load speaker tracks for crosstalk detection")
        return None
