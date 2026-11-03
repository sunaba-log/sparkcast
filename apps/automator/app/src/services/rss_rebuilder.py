"""Podcast RSS full rebuild service.

Rebuilds complete feed.xml from DB (Firestore and PostgreSQL) as Single Source of Truth (SSOT).
"""

from __future__ import annotations

import datetime
import email.utils
import logging
import uuid
from typing import TYPE_CHECKING, Any

import psycopg
import pytz

from services.rss_manager import PodcastRssManager
from services.rss_validator import PodcastRssValidator

if TYPE_CHECKING:
    from domain.interfaces.gateways import ObjectStorageGateway
    from services.firestore_manager import FirestoreManager

logger = logging.getLogger(__name__)


def _to_utc_datetime(dt_val: Any) -> datetime.datetime:  # noqa: PLR0911
    """Normalize timestamp/string to a timezone-aware UTC datetime."""
    if isinstance(dt_val, datetime.datetime):
        if dt_val.tzinfo is None:
            return pytz.UTC.localize(dt_val)
        return dt_val.astimezone(pytz.UTC)
    if hasattr(dt_val, "to_datetime"):
        # Firestore Timestamp object
        res = dt_val.to_datetime()
        if res.tzinfo is None:
            return pytz.UTC.localize(res)
        return res.astimezone(pytz.UTC)
    if isinstance(dt_val, str):
        # ISO string or RFC 2822
        try:
            parsed = datetime.datetime.fromisoformat(dt_val)
            if parsed.tzinfo is None:
                return pytz.UTC.localize(parsed)
            return parsed.astimezone(pytz.UTC)
        except (ValueError, TypeError):
            try:
                parsed = email.utils.parsedate_to_datetime(dt_val)
                if parsed.tzinfo is None:
                    return pytz.UTC.localize(parsed)
                return parsed.astimezone(pytz.UTC)
            except (ValueError, TypeError):
                pass
    return datetime.datetime.now(pytz.UTC)


def _format_duration(duration_seconds: int | None, fallback_str: str | None = None) -> str:
    """Format duration into HH:MM:SS format."""
    if fallback_str:
        colons = fallback_str.count(":")
        if colons == 1:
            return f"00:{fallback_str}"
        if colons == 2:  # noqa: PLR2004
            return fallback_str
    if duration_seconds is not None and duration_seconds >= 0:
        hours = duration_seconds // 3600
        minutes = (duration_seconds % 3600) // 60
        seconds = duration_seconds % 60
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return "00:00:00"


class PodcastRssRebuilder:
    """Rebuilds complete podcast RSS feed from database state and uploads to R2."""

    def __init__(
        self,
        *,
        database_url: str,
        object_storage: ObjectStorageGateway,
        firestore_manager: FirestoreManager | None = None,
        validator: PodcastRssValidator | None = None,
        logger_instance: logging.Logger | None = None,
    ) -> None:
        """Initialize PodcastRssRebuilder.

        Args:
            database_url: PostgreSQL connection URL.
            object_storage: Object storage gateway for R2 upload.
            firestore_manager: Optional FirestoreManager for episode contents.
            validator: Optional PodcastRssValidator for XML validation.
            logger_instance: Optional Logger instance.
        """
        self._database_url = database_url
        self._object_storage = object_storage
        self._firestore_manager = firestore_manager
        self._validator = validator or PodcastRssValidator(strict=True)
        self._logger = logger_instance or logger

    def rebuild(
        self,
        *,
        podcast_id: str,
        r2_key_prefix: str = "sunabalog",
        r2_custom_domain: str = "podcast.sunabalog.com",
    ) -> str:
        """Fetch all published episodes, reconstruct feed.xml in memory, and upload to R2.

        Returns:
            The generated RSS XML string.
        """
        self._logger.info("Starting complete RSS rebuild for podcast %s...", podcast_id)

        # 1. Fetch podcast metadata from PostgreSQL
        with psycopg.connect(self._database_url) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT title, description, cover_image_url, rss_feed_path
                FROM podcasts
                WHERE podcast_id = %s
                """,
                (podcast_id,),
            )
            podcast_row = cur.fetchone()
            if not podcast_row:
                msg = f"Podcast {podcast_id} not found in database."
                self._logger.error(msg)
                raise LookupError(msg)

            p_title, p_desc, p_cover, p_rss_path = podcast_row

            remote_key = p_rss_path or f"{r2_key_prefix}/feed.xml"
            if not p_rss_path:
                cur.execute(
                    """
                    UPDATE podcasts
                    SET rss_feed_path = %s
                    WHERE podcast_id = %s
                    """,
                    (remote_key, podcast_id),
                )
                conn.commit()

            # 2. Fetch all published episodes from PostgreSQL (newest first for standard RSS)
            cur.execute(
                """
                SELECT episode_id, title, description, audio_file_path, duration_seconds, published_at
                FROM episodes
                WHERE podcast_id = %s AND status = 'completed' AND published_at IS NOT NULL
                ORDER BY published_at DESC
                """,
                (podcast_id,),
            )
            episodes = cur.fetchall()

        self._logger.info("Found %d published episode(s) in DB for podcast %s", len(episodes), podcast_id)

        # 3. Initialize FeedGenerator with Channel Metadata
        rss_manager = PodcastRssManager()
        show_link = f"https://{r2_custom_domain}"
        rss_link = f"https://{r2_custom_domain}/{remote_key}"
        cover_url = p_cover or f"https://{r2_custom_domain}/cover.jpg"

        rss_manager.generate_podcast_rss(
            title=p_title,
            description=p_desc or "SparkCast Podcast",
            language="ja",
            category="Technology",
            cover_url=cover_url,
            owner_name="sunabalog",
            owner_email="admin@sunabalog.com",
            author="sunabalog",
            rss_link=rss_link,
            show_link=show_link,
        )

        total_episodes_count = len(episodes)

        # 4. Map each episode to an RSS <item>
        for index_from_latest, (ep_id, db_title, db_desc, audio_url, dur_sec, db_pub_date) in enumerate(episodes):
            if not audio_url:
                self._logger.warning("Episode %s has no audio_file_path; skipping from RSS feed", ep_id)
                continue

            fs_content: dict[str, Any] = {}
            if self._firestore_manager is not None:
                try:
                    fs_content = (
                        self._firestore_manager.get_episode_content(
                            podcast_id=podcast_id,
                            episode_id=str(ep_id),
                        )
                        or {}
                    )
                except Exception as exc:  # noqa: BLE001
                    self._logger.warning("Could not fetch Firestore content for episode %s: %s", ep_id, exc)

            # Check if explicitly unpublished in Firestore
            if fs_content.get("is_published") is False:
                self._logger.info("Episode %s is marked is_published=False in Firestore; excluding from RSS", ep_id)
                continue

            # Resolve rss_guid (must be permanent)
            rss_guid = fs_content.get("rss_guid")
            if not rss_guid:
                # Issue new permanent UUID for this episode and persist it
                rss_guid = str(uuid.uuid4())
                self._logger.info("Issuing new permanent rss_guid for episode %s: %s", ep_id, rss_guid)
                if self._firestore_manager is not None:
                    try:
                        self._firestore_manager.update_episode_fields(
                            podcast_id=podcast_id,
                            episode_id=str(ep_id),
                            fields={"rss_guid": rss_guid},
                        )
                    except Exception as exc:  # noqa: BLE001
                        self._logger.warning("Failed to persist rss_guid for episode %s: %s", ep_id, exc)

            # Resolve published_at (must be permanent)
            fs_published_at = fs_content.get("published_at")
            if fs_published_at:
                pub_date_dt = _to_utc_datetime(fs_published_at)
            elif db_pub_date:
                pub_date_dt = _to_utc_datetime(db_pub_date)
                # Persist to Firestore if missing there
                if self._firestore_manager is not None:
                    try:
                        self._firestore_manager.update_episode_fields(
                            podcast_id=podcast_id,
                            episode_id=str(ep_id),
                            fields={"published_at": pub_date_dt},
                        )
                    except Exception as exc:  # noqa: BLE001
                        self._logger.warning("Failed to persist published_at for episode %s: %s", ep_id, exc)
            else:
                pub_date_dt = datetime.datetime.now(pytz.UTC)

            # Audio metadata & file size
            audio_meta = fs_content.get("audio_metadata", {})
            file_size = int(audio_meta.get("file_size_bytes") or 10000000)
            duration_str = _format_duration(dur_sec, audio_meta.get("duration_str"))
            mime_type = audio_meta.get("mime_type") or "audio/mpeg"

            # Title and description
            title = db_title or fs_content.get("ai_generated_meta", {}).get("title") or f"Episode {ep_id}"
            description = db_desc or fs_content.get("ai_generated_meta", {}).get("description") or ""

            # Episode number: chronological episode number
            episode_num = total_episodes_count - index_from_latest

            rss_manager.add_episode(
                {
                    "guid": rss_guid,
                    "title": title,
                    "description": description,
                    "audio_url": audio_url,
                    "file_size": file_size,
                    "mime_type": mime_type,
                    "itunes_duration": duration_str,
                    "pub_date": pub_date_dt,
                    "itunes_episode_number": episode_num,
                    "itunes_episode_type": "full",
                }
            )

        # 5. Extract XML string and validate
        rss_xml = rss_manager.get_rss_xml()
        self._validator.validate(rss_xml)
        self._logger.info("RSS feed XML successfully validated against Apple Podcasts specifications.")

        # 6. Upload rebuilt XML to Cloudflare R2
        self._object_storage.upload_file(
            file_content=rss_xml.encode("utf-8"),
            remote_key=remote_key,
            content_type="application/rss+xml; charset=utf-8",
            public=True,
        )
        self._logger.info(
            "Successfully rebuilt and uploaded RSS feed to R2 key '%s' (%d episodes)",
            remote_key,
            rss_manager.get_total_episodes(),
        )

        return rss_xml
