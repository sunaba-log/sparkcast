"""One-shot migration script: parse existing feed.xml and synchronize to Firestore and PostgreSQL.

This script parses existing podcast RSS items and populates:
- Firestore: rss_guid, published_at, audio_metadata, is_published=True
- PostgreSQL: published_at, audio_file_path, duration_seconds, status='completed'
"""

from __future__ import annotations

import argparse
import datetime
import email.utils
import logging
import os
import re
import sys
from typing import Any

import feedparser
import psycopg
import pytz

# Add src directory to path if run as standalone script
script_dir = os.path.dirname(os.path.abspath(__file__))
src_dir = os.path.join(os.path.dirname(script_dir), "src")
if src_dir not in sys.path:
    sys.path.insert(0, src_dir)

from services.firestore_manager import FirestoreManager  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def parse_rfc2822_date(date_str: str) -> datetime.datetime:
    """Parse RFC 2822 date string into a timezone-aware UTC datetime."""
    try:
        dt = email.utils.parsedate_to_datetime(date_str)
        if dt.tzinfo is None:
            return pytz.UTC.localize(dt)
        return dt.astimezone(pytz.UTC)
    except Exception:
        return datetime.datetime.now(pytz.UTC)


def parse_duration_to_seconds(dur_str: str | None) -> int:
    """Convert HH:MM:SS or MM:SS or seconds string to integer seconds."""
    if not dur_str:
        return 0
    parts = dur_str.strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        if len(parts) == 1:
            return int(parts[0])
    except ValueError:
        return 0
    return 0


def extract_episode_id_from_title(title: str, fallback_idx: int) -> int:
    """Extract episode number from title like '#3 ...' or fallback to index."""
    match = re.search(r"#(\d+)", title)
    if match:
        return int(match.group(1))
    return fallback_idx


def migrate_rss_to_db(
    *,
    xml_content: str,
    podcast_id: str,
    project_id: str | None = None,
    database_url: str | None = None,
    dry_run: bool = False,
    firestore_manager: FirestoreManager | None = None,
) -> list[dict[str, Any]]:
    """Parse RSS feed XML and upsert records into Firestore and PostgreSQL."""
    feed = feedparser.parse(xml_content)
    if feed.bozo and not feed.entries:
        msg = f"Failed to parse RSS XML: {feed.bozo_exception}"
        logger.error(msg)
        raise ValueError(msg)

    logger.info("Found %d entries in RSS feed", len(feed.entries))

    if not dry_run and firestore_manager is None and project_id:
        firestore_manager = FirestoreManager(project_id=project_id)

    migrated_episodes: list[dict[str, Any]] = []

    for idx, entry in enumerate(feed.entries, start=1):
        title = entry.get("title", f"Episode {idx}")
        ep_id = extract_episode_id_from_title(title, idx)
        guid = entry.get("id") or entry.get("guid") or f"migrated-guid-{ep_id}"
        description = entry.get("description") or entry.get("summary") or ""

        # Enclosure (audio URL, size, mime)
        enclosures = entry.get("enclosures", [])
        audio_url = ""
        file_size = 0
        mime_type = "audio/mpeg"
        if enclosures:
            enc = enclosures[0]
            audio_url = enc.get("href") or enc.get("url") or ""
            try:
                file_size = int(enc.get("length", 0))
            except (ValueError, TypeError):
                file_size = 0
            mime_type = enc.get("type") or "audio/mpeg"

        # PubDate
        pub_date_str = entry.get("published") or entry.get("pubDate")
        pub_date = parse_rfc2822_date(pub_date_str) if pub_date_str else datetime.datetime.now(pytz.UTC)

        # Duration
        duration_str = entry.get("itunes_duration", "00:00:00")
        duration_seconds = parse_duration_to_seconds(duration_str)

        episode_info: dict[str, Any] = {
            "episode_id": ep_id,
            "title": title,
            "description": description,
            "guid": guid,
            "audio_url": audio_url,
            "file_size": file_size,
            "mime_type": mime_type,
            "pub_date": pub_date,
            "duration_str": duration_str,
            "duration_seconds": duration_seconds,
        }
        migrated_episodes.append(episode_info)

        logger.info(
            "[%s] Episode #%d: guid=%s, pubDate=%s, audio=%s (%d bytes)",
            "DRY-RUN" if dry_run else "MIGRATE",
            ep_id,
            guid,
            pub_date.isoformat(),
            audio_url[:60] + "..." if len(audio_url) > 60 else audio_url,
            file_size,
        )

        if dry_run:
            continue

        # 1. Upsert into Firestore
        if firestore_manager is not None:
            audio_metadata = {
                "file_size_bytes": file_size,
                "duration_str": duration_str,
                "audio_url": audio_url,
                "mime_type": mime_type,
            }
            ai_generated_meta = {
                "title": title,
                "description": description,
                "prompt_version": "migration",
                "generated_at": pub_date.isoformat(),
            }
            firestore_manager.save_episode_content(
                podcast_id=podcast_id,
                episode_id=str(ep_id),
                episode_number=ep_id,
                updated_at=pub_date.isoformat(),
                transcript_summary=description,
                ai_generated_meta=ai_generated_meta,
                show_notes_summary={"overview": description, "topics": []},
                audio_metadata=audio_metadata,
                rss_guid=guid,
                published_at=pub_date,
                is_published=True,
            )
            logger.info("  -> Saved Firestore document podcasts/%s/episodes_contents/%s", podcast_id, ep_id)

        # 2. Upsert into PostgreSQL
        if database_url:
            with psycopg.connect(database_url) as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT episode_id FROM episodes
                    WHERE podcast_id = %s AND episode_id = %s
                    """,
                    (podcast_id, ep_id),
                )
                existing = cur.fetchone()

                if existing:
                    cur.execute(
                        """
                        UPDATE episodes
                        SET title = %s,
                            description = %s,
                            audio_file_path = %s,
                            duration_seconds = %s,
                            status = 'completed',
                            published_at = %s,
                            updated_at = now()
                        WHERE podcast_id = %s AND episode_id = %s
                        """,
                        (title, description, audio_url, duration_seconds, pub_date, podcast_id, ep_id),
                    )
                    logger.info("  -> Updated PostgreSQL episode %s", ep_id)
                else:
                    cur.execute(
                        """
                        INSERT INTO episodes (
                            episode_id, podcast_id, title, description, audio_file_path,
                            duration_seconds, status, published_at, created_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, 'completed', %s, %s)
                        """,
                        (ep_id, podcast_id, title, description, audio_url, duration_seconds, pub_date, pub_date),
                    )
                    logger.info("  -> Inserted PostgreSQL episode %s", ep_id)
                conn.commit()

    logger.info("Migration completed successfully for %d episodes.", len(migrated_episodes))
    return migrated_episodes


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(description="Migrate existing RSS feed.xml into Firestore & PostgreSQL.")
    parser.add_argument("--feed-file", default="data/rss_feed.xml", help="Path to RSS feed XML file")
    parser.add_argument("--podcast-id", default="1", help="Target podcast ID")
    parser.add_argument("--project-id", default=os.environ.get("PROJECT_ID"), help="GCP Project ID")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), help="PostgreSQL connection string")
    parser.add_argument("--dry-run", action="store_true", help="Preview migration without modifying databases")

    args = parser.parse_args()

    feed_path = args.feed_file
    if not os.path.exists(feed_path):
        # Try relative to repo root or automator app dir
        alt_path = os.path.join(os.path.dirname(script_dir), feed_path)
        if os.path.exists(alt_path):
            feed_path = alt_path
        else:
            logger.error("Feed XML file not found at '%s'", args.feed_file)
            sys.exit(1)

    logger.info("Reading feed file from: %s", feed_path)
    with open(feed_path, encoding="utf-8") as f:
        xml_content = f.read()

    migrate_rss_to_db(
        xml_content=xml_content,
        podcast_id=args.podcast_id,
        project_id=args.project_id,
        database_url=args.database_url,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
