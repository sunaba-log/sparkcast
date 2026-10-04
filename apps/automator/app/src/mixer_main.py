"""ブラウザ収録(#166)のミックス Job のエントリポイント.

UI が収録を確定したときに Cloud Run Jobs API で env を上書きして起動する
(RECORDING_SESSION_ID / PODCAST_ID / EPISODE_ID / OUTPUT_OBJECT_PATH)。
app Job と同じイメージを使い、ENTRYPOINT を `python -m mixer_main` で上書きする。

R2 の recordings バケットからチャンクを読み、ミックスした FLAC を GCS 入力バケットの
podcasts/{pid}/episodes/{eid}/source/ に置く。そこから先は既存パイプライン(Eventarc → Workflows → app Job)。
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

import boto3
from google.api_core.exceptions import PreconditionFailed
from google.cloud import storage

from infrastructure.notifier import Notifier
from infrastructure.recording_repository import PostgresRecordingRepository
from services.recording_mixer.mixer import mix_session

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(message)s", force=True)

DEFAULT_CLOUDFLARE_ACCOUNT_ID = "8ed20f6872cea7c9219d68bfcf5f98ae"


def _required_env(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        logger.error("%s environment variable is required.", key)
        raise SystemExit(1)
    return value


class R2RecordingObjects:
    """R2(S3 互換)の recordings バケット."""

    def __init__(self, *, bucket: str, endpoint_url: str, access_key: str, secret_key: str) -> None:
        """Create the client."""
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
        )

    def list_keys(self, prefix: str) -> set[str]:
        """Prefix 配下のキー一覧."""
        keys: set[str] = set()
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            keys.update(item["Key"] for item in page.get("Contents", []))
        return keys

    def download(self, key: str, path: Path) -> None:
        """キーをファイルに落とす."""
        path.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(path))

    def upload(self, path: Path, key: str, content_type: str) -> None:
        """ファイルを置く."""
        self.client.upload_file(str(path), self.bucket, key, ExtraArgs={"ContentType": content_type})


def upload_aligned_tracks(bucket_name: str, session_id: str, speakers: list) -> None:
    """話者別トラックを作業用バケットに置く(音声認識は GCS からしか読めないため).

    入力バケットに置くと既存パイプラインが起動してしまうので、必ず別のバケットにする。
    パスは services.episode_transcription.aligned_track_uri と揃える。
    """
    bucket = storage.Client().bucket(bucket_name)
    for speaker in speakers:
        if speaker.aligned_path is None:
            continue
        blob = bucket.blob(f"recordings/{session_id}/aligned/{speaker.participant_id}.flac")
        blob.upload_from_filename(str(speaker.aligned_path), content_type="audio/flac")


def upload_to_gcs(bucket_name: str, object_path: str, path: Path) -> None:
    """GCS に置く。同じパスが既にあれば上書きしない(Job の再実行で既存パイプラインを二重に起動しない)."""
    blob = storage.Client().bucket(bucket_name).blob(object_path)
    try:
        blob.upload_from_filename(str(path), content_type="audio/flac", if_generation_match=0)
    except PreconditionFailed:
        logger.warning("gs://%s/%s already exists; skipping upload", bucket_name, object_path)


def main() -> None:
    """Mix a recording session and hand it to the existing pipeline."""
    session_id = _required_env("RECORDING_SESSION_ID")
    podcast_id = _required_env("PODCAST_ID")
    episode_id = _required_env("EPISODE_ID")
    object_path = _required_env("OUTPUT_OBJECT_PATH")
    expected_prefix = f"podcasts/{podcast_id}/episodes/{episode_id}/source/"
    if not object_path.startswith(expected_prefix) or not object_path.endswith(".flac"):
        logger.error("OUTPUT_OBJECT_PATH must be under %s and end with .flac", expected_prefix)
        raise SystemExit(1)

    repository = PostgresRecordingRepository(database_url=_required_env("DATABASE_URL"))
    notifier = Notifier(os.environ.get("DISCORD_WEBHOOK_ERROR_URL"))
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", DEFAULT_CLOUDFLARE_ACCOUNT_ID)
    objects = R2RecordingObjects(
        bucket=_required_env("RECORDINGS_BUCKET"),
        endpoint_url=os.environ.get("R2_ENDPOINT_URL", f"https://{account_id}.r2.cloudflarestorage.com"),
        access_key=_required_env("CLOUDFLARE_ACCESS_KEY_ID"),
        secret_key=_required_env("CLOUDFLARE_SECRET_ACCESS_KEY"),
    )

    try:
        with tempfile.TemporaryDirectory() as tmp:
            result = mix_session(session_id=session_id, objects=objects, workdir=Path(tmp))
            for speaker in result.speakers:
                if speaker.aligned_key:
                    repository.set_aligned_track(
                        session_id=session_id, participant_id=speaker.participant_id, object_key=speaker.aligned_key
                    )
            work_bucket = os.environ.get("WORK_BUCKET")
            if work_bucket:
                upload_aligned_tracks(work_bucket, session_id, result.speakers)
            else:
                logger.warning("WORK_BUCKET is not set; the transcript will not be split by speaker")
            upload_to_gcs(_required_env("GCS_BUCKET"), object_path, result.output_path)
        repository.mark_episode_uploaded(episode_id=episode_id)
        repository.mark_session_done(session_id=session_id)
        logger.info("Recording %s mixed (%.1fs) -> %s", session_id, result.duration_seconds, object_path)
    except Exception as error:
        logger.exception("Mixing failed for recording session %s", session_id)
        repository.mark_failed(session_id=session_id, episode_id=episode_id, error=str(error))
        notifier.send_discord_message(
            f"⚠️ 収録のミックスに失敗しました(session {session_id} / episode {episode_id}): {error}"
        )
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
