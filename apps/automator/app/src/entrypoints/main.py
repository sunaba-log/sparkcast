"""Podcast processor entrypoint."""

from __future__ import annotations

import json
import logging
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import TYPE_CHECKING

import psycopg

from infrastructure.ai_analyzer import AudioAnalyzer
from infrastructure.episode_repository import PostgresEpisodeRepository
from infrastructure.knowledge_reindexer import HttpKnowledgeReindexer
from infrastructure.notifier import Notifier
from infrastructure.secret_manager import SecretManagerClient
from infrastructure.speech_transcriber import ChirpTranscriber
from infrastructure.storage import GCSClient, R2Client, get_audio_info
from services.audio_converter import AudioConverter
from services.director_script_generator import DirectorScriptGenerator
from services.episode_transcription import EpisodeTranscription
from services.fact_check_auditor import FactCheckAuditor
from services.firestore_manager import FirestoreManager
from services.rss_manager import PodcastRssManager
from services.speech_audio import GcsSpeechAudioPreparer
from services.track_energy import load_track_energy
from services.voiced_audio import GcsVoicedTrackPreparer
from usecases import ProcessPodcastWorkflow, ProcessPodcastWorkflowInput

if TYPE_CHECKING:
    from collections.abc import Mapping


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(message)s", force=True)


@dataclass(frozen=True)
class PodcastEnvConfig:
    """Resolved environment variables for podcast workflow."""

    project_id: str
    database_url: str
    sns_schedule_offset_hours: int
    gcs_bucket: str
    gcs_trigger_object_name: str
    r2_bucket: str
    r2_key_prefix: str
    secret_name: str | None
    r2_endpoint_url: str
    r2_access_key_id: str | None
    r2_secret_access_key: str | None
    discord_webhook_info_url: str | None
    ai_model_id: str
    r2_custom_domain: str
    sns_promotion_count: int
    speech_enabled: bool = True
    speech_location: str = "asia-northeast1"
    speech_model: str = "long"
    # 急がない処理(ダイナミックバッチ、1 分 $0.003)にするか。結果は作業用バケットに書かせる
    speech_dynamic_batch: bool = False
    speech_timeout_seconds: float = 3600
    work_bucket: str | None = None
    # チャット用の索引の作り直し(UI の URL と、定期実行と同じ CRON_SECRET)。無ければ毎朝の定期実行だけ
    app_base_url: str | None = None
    cron_secret: str | None = None
    # Jev 高速監査・Gemini ディレクター介入(#170)
    typesafe_api_key: str | None = None
    jev_enabled: bool = True
    director_enabled: bool = True
    resume_from_audit: bool = False


def _required_env(environ: Mapping[str, str], key: str) -> str:
    """Return required environment value or raise ValueError."""
    value = environ.get(key)
    if value is None:
        msg = f"{key} environment variable is required."
        logger.error(msg)
        raise ValueError(msg)
    return value


def _load_podcast_env(environ: Mapping[str, str]) -> PodcastEnvConfig:
    """Load and validate environment variables for podcast workflow."""
    project_id = _required_env(environ, "PROJECT_ID")
    database_url = _required_env(environ, "DATABASE_URL")
    gcs_bucket = _required_env(environ, "GCS_BUCKET")
    gcs_trigger_object_name = _required_env(environ, "GCS_TRIGGER_OBJECT_NAME")
    r2_bucket = _required_env(environ, "R2_BUCKET")

    sns_schedule_offset_hours = int(environ.get("SNS_SCHEDULE_OFFSET_HOURS", "1"))
    r2_key_prefix = environ.get("R2_KEY_PREFIX", "test")
    secret_name = environ.get("SECRET_NAME")
    r2_account_id = environ.get("CLOUDFLARE_ACCOUNT_ID", "8ed20f6872cea7c9219d68bfcf5f98ae")
    r2_endpoint_url = environ.get("R2_ENDPOINT_URL", f"https://{r2_account_id}.r2.cloudflarestorage.com")
    r2_access_key_id = environ.get("CLOUDFLARE_ACCESS_KEY_ID")
    r2_secret_access_key = environ.get("CLOUDFLARE_SECRET_ACCESS_KEY")
    discord_webhook_info_url = environ.get("DISCORD_WEBHOOK_INFO_URL")
    ai_model_id = environ.get("AI_MODEL_ID", "gemini-2.5-flash")
    r2_custom_domain = environ.get("R2_CUSTOM_DOMAIN", "podcast.sunabalog.com")
    sns_promotion_count = int(environ.get("SNS_PROMOTION_COUNT", "3"))
    # 話者・時刻つきの文字起こし(#166)。SPEECH_ENABLED=false で従来の Gemini 音声方式に戻せる
    speech_enabled = environ.get("SPEECH_ENABLED", "true").lower() != "false"
    speech_location = environ.get("SPEECH_LOCATION", "asia-northeast1")
    speech_model = environ.get("SPEECH_MODEL", "long")
    speech_dynamic_batch = environ.get("SPEECH_DYNAMIC_BATCH", "false").lower() == "true"
    speech_timeout_seconds = float(environ.get("SPEECH_TIMEOUT_SECONDS", "3600"))
    work_bucket = environ.get("WORK_BUCKET") or None
    app_base_url = environ.get("APP_BASE_URL") or None
    cron_secret = environ.get("CRON_SECRET") or None
    typesafe_api_key = environ.get("TYPESAFE_API_KEY") or environ.get("JEV_API_KEY") or None
    jev_enabled = environ.get("JEV_ENABLED", "true").lower() != "false"
    director_enabled = environ.get("DIRECTOR_ENABLED", "true").lower() != "false"
    resume_from_audit = environ.get("RESUME_FROM_AUDIT", "false").lower() in ("true", "1")

    if secret_name is None and (r2_access_key_id is None or r2_secret_access_key is None):
        msg = "Either SECRET_NAME or both R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be provided."
        logger.error(msg)
        raise ValueError(msg)

    return PodcastEnvConfig(
        project_id=project_id,
        database_url=database_url,
        sns_schedule_offset_hours=sns_schedule_offset_hours,
        gcs_bucket=gcs_bucket,
        gcs_trigger_object_name=gcs_trigger_object_name,
        r2_bucket=r2_bucket,
        r2_key_prefix=r2_key_prefix,
        secret_name=secret_name,
        r2_endpoint_url=r2_endpoint_url,
        r2_access_key_id=r2_access_key_id,
        r2_secret_access_key=r2_secret_access_key,
        discord_webhook_info_url=discord_webhook_info_url,
        ai_model_id=ai_model_id,
        r2_custom_domain=r2_custom_domain,
        sns_promotion_count=sns_promotion_count,
        speech_enabled=speech_enabled,
        speech_location=speech_location,
        speech_model=speech_model,
        speech_dynamic_batch=speech_dynamic_batch,
        speech_timeout_seconds=speech_timeout_seconds,
        work_bucket=work_bucket,
        app_base_url=app_base_url,
        cron_secret=cron_secret,
        typesafe_api_key=typesafe_api_key,
        jev_enabled=jev_enabled,
        director_enabled=director_enabled,
        resume_from_audit=resume_from_audit,
    )


def _log_environment(config: PodcastEnvConfig) -> None:
    """Log resolved environment settings."""
    logger.info("## Environment Variables ##")
    logger.info("PROJECT_ID: %s", config.project_id)
    logger.info("DATABASE_URL configured: %s", bool(config.database_url))
    logger.info("SNS_SCHEDULE_OFFSET_HOURS: %s", config.sns_schedule_offset_hours)
    logger.info("SECRET_NAME: %s", config.secret_name)
    logger.info("GCS_BUCKET: %s", config.gcs_bucket)
    logger.info("GCS_TRIGGER_OBJECT_NAME: %s", config.gcs_trigger_object_name)
    logger.info("R2_ENDPOINT_URL: %s", config.r2_endpoint_url)
    logger.info("R2_BUCKET: %s", config.r2_bucket)
    logger.info("R2_KEY_PREFIX: %s", config.r2_key_prefix)
    logger.info("AI_MODEL_ID: %s", config.ai_model_id)
    logger.info("R2_CUSTOM_DOMAIN: %s", config.r2_custom_domain)
    logger.info("SNS_PROMOTION_COUNT: %s", config.sns_promotion_count)
    logger.info(
        "SPEECH_ENABLED: %s (%s %s, dynamic batch %s, timeout %ss)",
        config.speech_enabled,
        config.speech_model,
        config.speech_location,
        config.speech_dynamic_batch,
        config.speech_timeout_seconds,
    )
    logger.info("WORK_BUCKET: %s", config.work_bucket)
    logger.info("APP_BASE_URL: %s (reindex %s)", config.app_base_url, "on" if config.cron_secret else "off")
    logger.info("JEV_ENABLED: %s (api_key configured: %s)", config.jev_enabled, bool(config.typesafe_api_key))
    logger.info("DIRECTOR_ENABLED: %s", config.director_enabled)
    logger.info("###########################\n")


def send_discord_notification(
    message: str,
    webhook_url: str | None = None,
    environ: Mapping[str, str] | None = None,
    logger: logging.Logger | None = None,
) -> None:
    """Send a message to Discord via webhook if configured."""
    if environ is None:
        environ = os.environ
    if logger is None:
        logger = logging.getLogger(__name__)

    if webhook_url is None:
        webhook_url = environ.get("DISCORD_WEBHOOK_INFO_URL")
    if not webhook_url:
        return
    parsed_url = urllib.parse.urlparse(webhook_url)
    if parsed_url.scheme not in {"http", "https"}:
        logger.warning("Discord webhook has unsupported scheme: %s", parsed_url.scheme)
        return

    payload = json.dumps({"content": message}, ensure_ascii=True).encode("utf-8")
    request = urllib.request.Request(  # noqa: S310
        webhook_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "podcast-automator/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            response.read()
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read(2048).decode("utf-8", errors="replace")
        except OSError:
            body = ""
        detail = body.strip() or str(exc.reason)
        logger.exception("Discord webhook returned HTTP %s: %s", exc.code, detail)
    except Exception:
        logger.exception("Failed to send Discord notification")


def process_podcast_workflow() -> None:
    """GCSへのファイルアップロードをトリガーに実行されるメイン関数."""
    config = _load_podcast_env(os.environ)
    _log_environment(config)

    if config.secret_name:
        secret_manager_client = SecretManagerClient(project_id=config.project_id, secret_name=config.secret_name)
        r2_access_key, r2_secret_key = secret_manager_client.get_r2_credentials()
        discord_webhook_url = secret_manager_client.get_discord_webhook_url()
    else:
        r2_access_key = config.r2_access_key_id
        r2_secret_key = config.r2_secret_access_key
        discord_webhook_url = config.discord_webhook_info_url

    notifier_client = Notifier(discord_webhook_url=discord_webhook_url)
    audio_analyzer = AudioAnalyzer(project_id=config.project_id)
    firestore_manager = FirestoreManager(project_id=config.project_id)
    episode_repository = PostgresEpisodeRepository(database_url=config.database_url)
    r2_client = R2Client(
        project_id=config.project_id,
        endpoint_url=config.r2_endpoint_url,
        bucket_name=config.r2_bucket,
        access_key=r2_access_key,
        secret_key=r2_secret_key,
    )
    gcs_client = GCSClient(project_id=config.project_id)

    usecase = ProcessPodcastWorkflow(
        transcript_provider=audio_analyzer,
        object_storage=r2_client,
        blob_source=gcs_client,
        notifier=notifier_client,
        rss_manager_factory=PodcastRssManager,
        audio_converter=AudioConverter.convert_to_mp3,
        audio_info_reader=get_audio_info,
        firestore_manager=firestore_manager,
        episode_repository=episode_repository,
        logger=logger,
        transcription=EpisodeTranscription(
            transcript_provider=audio_analyzer,
            episode_repository=episode_repository,
            speech=ChirpTranscriber(
                project_id=config.project_id,
                location=config.speech_location,
                model=config.speech_model,
                dynamic_batch_output=f"gs://{config.work_bucket}/transcribe/results"
                if config.speech_dynamic_batch and config.work_bucket
                else None,
                timeout_seconds=config.speech_timeout_seconds,
            )
            if config.speech_enabled
            else None,
            work_bucket=config.work_bucket,
            energy_loader=load_track_energy,
            audio_preparer=GcsSpeechAudioPreparer(config.work_bucket) if config.work_bucket else None,
            voiced_preparer=GcsVoicedTrackPreparer(config.work_bucket) if config.work_bucket else None,
            logger=logger,
        ),
        knowledge_reindexer=HttpKnowledgeReindexer(base_url=config.app_base_url, secret=config.cron_secret)
        if config.app_base_url and config.cron_secret
        else None,
        fact_check_auditor=FactCheckAuditor(api_key=config.typesafe_api_key) if config.jev_enabled else None,
        director_script_generator=DirectorScriptGenerator(
            project_id=config.project_id,
            model_id=config.ai_model_id,
        )
        if config.director_enabled
        else None,
    )
    usecase.run(
        ProcessPodcastWorkflowInput(
            project_id=config.project_id,
            sns_schedule_offset_hours=config.sns_schedule_offset_hours,
            gcs_bucket=config.gcs_bucket,
            gcs_trigger_object_name=config.gcs_trigger_object_name,
            r2_bucket=config.r2_bucket,
            r2_key_prefix=config.r2_key_prefix,
            ai_model_id=config.ai_model_id,
            r2_custom_domain=config.r2_custom_domain,
            sns_promotion_count=config.sns_promotion_count,
            resume_from_audit=config.resume_from_audit,
        )
    )


def sync_podcast_rss(environ: Mapping[str, str]) -> None:
    """Sync the podcast RSS feed in R2 with published episodes in PostgreSQL."""
    podcast_id = environ.get("PODCAST_ID")
    if not podcast_id:
        logger.error("PODCAST_ID environment variable is required for sync_rss")
        return

    database_url = _required_env(environ, "DATABASE_URL")
    project_id = _required_env(environ, "PROJECT_ID")
    r2_bucket = _required_env(environ, "R2_BUCKET")
    r2_key_prefix = environ.get("R2_KEY_PREFIX", "test")
    r2_account_id = environ.get("CLOUDFLARE_ACCOUNT_ID", "8ed20f6872cea7c9219d68bfcf5f98ae")
    r2_endpoint_url = environ.get("R2_ENDPOINT_URL", f"https://{r2_account_id}.r2.cloudflarestorage.com")
    r2_access_key = environ.get("CLOUDFLARE_ACCESS_KEY_ID")
    r2_secret_key = environ.get("CLOUDFLARE_SECRET_ACCESS_KEY")
    secret_name = environ.get("SECRET_NAME")

    if secret_name and (not r2_access_key or not r2_secret_key):
        secrets_client = SecretManagerClient(project_id)
        if not r2_access_key:
            r2_access_key = secrets_client.access_secret(secret_name)
        if not r2_secret_key:
            r2_secret_key = secrets_client.access_secret(secret_name)

    r2_client = R2Client(
        project_id=project_id,
        endpoint_url=r2_endpoint_url,
        bucket_name=r2_bucket,
        access_key=r2_access_key,
        secret_key=r2_secret_key,
    )

    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT title, description, cover_image_url
            FROM podcasts
            WHERE podcast_id = %s
            """,
            (podcast_id,),
        )
        podcast_row = cur.fetchone()
        if not podcast_row:
            logger.error("Podcast %s not found", podcast_id)
            return
        p_title, p_desc, p_cover = podcast_row

        cur.execute(
            """
            SELECT episode_id, title, description, audio_file_path, duration_seconds, published_at
            FROM episodes
            WHERE podcast_id = %s AND status = 'completed' AND published_at IS NOT NULL
            ORDER BY published_at ASC
            """,
            (podcast_id,),
        )
        episodes = cur.fetchall()

    rss_manager = PodcastRssManager()
    rss_manager.generate_podcast_rss(
        title=p_title,
        description=p_desc or "30 Days to Build (or Not)",
        language="ja",
        category="Technology",
        cover_url=p_cover or "https://podcast.sunabalog.com/cover.jpg",
        owner_name="sunabalog",
        owner_email="admin@sunabalog.com",
    )

    for i, (ep_id, title, desc, audio_url, dur_sec, pub_date) in enumerate(episodes):
        if not audio_url:
            continue
        dur_str = (
            f"{dur_sec // 3600:02d}:{(dur_sec % 3600) // 60:02d}:{dur_sec % 60:02d}"
            if dur_sec is not None
            else "00:00:00"
        )
        rss_manager.add_episode(
            {
                "guid": f"sparkcast-ep-{ep_id}",
                "title": title,
                "description": desc or "",
                "audio_url": audio_url,
                "file_size": 10000000,
                "mime_type": "audio/mpeg",
                "itunes_duration": dur_str,
                "pub_date": pub_date,
                "itunes_episode_number": i + 1,
                "itunes_episode_type": "full",
            }
        )

    rss_xml = rss_manager.get_rss_xml()
    r2_client.upload_file(
        file_content=rss_xml.encode("utf-8"),
        remote_key=f"{r2_key_prefix}/feed.xml",
        content_type="application/rss+xml; charset=utf-8",
        public=True,
    )
    logger.info("Successfully synced RSS feed for podcast %s with %d episodes", podcast_id, len(episodes))


def main() -> None:
    """Main entry point for the podcast processor."""
    for arg in sys.argv:
        logger.info("Argument: %s", arg)
    action = os.environ.get("ACTION")
    if action == "sync_rss":
        sync_podcast_rss(os.environ)
    else:
        process_podcast_workflow()


if __name__ == "__main__":
    main()
