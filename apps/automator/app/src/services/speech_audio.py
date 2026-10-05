"""音声認識に渡す音声を用意する(#166).

Speech-to-Text v2 の自動判別は、m4a(MP4 コンテナの AAC)を「Provided file is empty.」で読めないことがある
(dev で確認)。アップロードされた音声は形式を問わず 16kHz・モノラルの FLAC にして作業用バケットに置き、
それを認識に使う(入力バケットに置くと既存パイプラインが起動してしまうため)。
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from google.cloud import storage

from services.recording_mixer.ffmpeg_tools import ffmpeg_binary

SPEECH_SAMPLE_RATE = 16000


def to_speech_flac(audio: bytes) -> bytes:
    """音声のバイト列を 16kHz・モノラルの FLAC にする.

    入出力はパイプにしない。m4a は末尾の情報を読む必要があり、パイプからだと途中までしか読めない
    (「partial file」)。また FLAC をパイプに書くと、ヘッダの総サンプル数を書き戻せず 0 のままになり、
    Speech-to-Text が「Provided file is empty.」とする(どちらも dev で確認)。
    """
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "source"
        target = Path(tmp) / "speech.flac"
        source.write_bytes(audio)
        # 引数はここで組み立てたものだけ(シェルを通さない)
        result = subprocess.run(  # noqa: S603
            [
                ffmpeg_binary(),
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source),
                "-ac",
                "1",
                "-ar",
                str(SPEECH_SAMPLE_RATE),
                "-c:a",
                "flac",
                str(target),
            ],
            check=False,
            capture_output=True,
        )
        if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
            message = f"ffmpeg could not convert audio for speech: {result.stderr.decode(errors='replace')[-500:]}"
            raise RuntimeError(message)
        return target.read_bytes()


def speech_audio_uri(work_bucket: str, podcast_id: str, episode_id: str) -> str:
    """作業用バケット上の、認識用の音声の場所."""
    return f"gs://{work_bucket}/transcribe/{podcast_id}/{episode_id}.flac"


class GcsSpeechAudioPreparer:
    """アップロードされた音声を FLAC にして作業用バケットに置く."""

    def __init__(self, work_bucket: str, client: storage.Client | None = None) -> None:
        """Create the uploader."""
        self._work_bucket = work_bucket
        self._client = client

    def __call__(self, audio: bytes, podcast_id: str, episode_id: str) -> str:
        """FLAC にして置き、その gs:// URI を返す."""
        uri = speech_audio_uri(self._work_bucket, podcast_id, episode_id)
        name = uri.removeprefix(f"gs://{self._work_bucket}/")
        client = self._client or storage.Client()
        client.bucket(self._work_bucket).blob(name).upload_from_string(to_speech_flac(audio), content_type="audio/flac")
        return uri
