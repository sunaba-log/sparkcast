"""Tests for Podcast RSS full rebuild service."""

from __future__ import annotations

import datetime
from unittest.mock import MagicMock, patch

import feedparser
import pytz

from services.rss_rebuilder import PodcastRssRebuilder


class _FakeObjectStorage:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []

    def upload_file(self, **kwargs: object) -> None:
        self.uploads.append(kwargs)

    def generate_public_url(self, remote_key: str, custom_domain: str | None = None) -> str:
        return f"https://{custom_domain or 'example.com'}/{remote_key}"


class _FakeFirestoreManager:
    def __init__(self, contents: dict[str, dict[str, object]] | None = None) -> None:
        self.contents = contents or {}
        self.updates: list[dict[str, object]] = []

    def get_episode_content(self, *, podcast_id: str, episode_id: str) -> dict[str, object] | None:  # noqa: ARG002
        return self.contents.get(str(episode_id))

    def update_episode_fields(self, *, podcast_id: str, episode_id: str, fields: dict[str, object]) -> None:
        if str(episode_id) in self.contents:
            self.contents[str(episode_id)].update(fields)
        else:
            self.contents[str(episode_id)] = fields
        self.updates.append({"podcast_id": podcast_id, "episode_id": episode_id, **fields})


def test_rss_rebuilder_generates_valid_feed_and_uploads():
    storage = _FakeObjectStorage()
    dt_pub1 = datetime.datetime(2025, 12, 17, 14, 35, 58, tzinfo=pytz.UTC)
    dt_pub2 = datetime.datetime(2025, 12, 10, 11, 53, 58, tzinfo=pytz.UTC)

    firestore = _FakeFirestoreManager(
        contents={
            "3": {
                "rss_guid": "guid-ep-3-custom",
                "published_at": dt_pub1,
                "is_published": True,
                "audio_metadata": {
                    "file_size_bytes": 43352371,
                    "duration_str": "00:52:37",
                    "audio_url": "https://podcast.sunabalog.com/sunabalog/ep/3/audio.mp3",
                    "mime_type": "audio/mpeg",
                },
            },
            "2": {
                "rss_guid": "guid-ep-2-custom",
                "published_at": dt_pub2,
                "is_published": True,
                "audio_metadata": {
                    "file_size_bytes": 40892218,
                    "duration_str": "00:50:05",
                    "audio_url": "https://podcast.sunabalog.com/sunabalog/ep/2/audio.mp3",
                    "mime_type": "audio/mpeg",
                },
            },
        }
    )

    fake_conn = MagicMock()
    fake_conn.__enter__.return_value = fake_conn
    fake_cur = MagicMock()
    fake_conn.cursor.return_value.__enter__.return_value = fake_cur

    # Mock podcast row and episode rows
    # 1st fetch: podcast row
    # 2nd fetch: episodes rows
    fake_cur.fetchone.return_value = (
        "sunabalog",
        "Tech podcast",
        "https://example.com/cover.jpg",
        "sunabalog/feed.xml",
    )
    fake_cur.fetchall.return_value = [
        (
            3,
            "Episode 3 Title",
            "Episode 3 Desc",
            "https://podcast.sunabalog.com/sunabalog/ep/3/audio.mp3",
            3157,
            dt_pub1,
        ),
        (
            2,
            "Episode 2 Title",
            "Episode 2 Desc",
            "https://podcast.sunabalog.com/sunabalog/ep/2/audio.mp3",
            3005,
            dt_pub2,
        ),
    ]

    with patch("psycopg.connect", return_value=fake_conn):
        rebuilder = PodcastRssRebuilder(
            database_url="postgresql://user:pass@localhost:5432/db",
            object_storage=storage,
            firestore_manager=firestore,
        )

        xml_1 = rebuilder.rebuild(podcast_id="1", r2_key_prefix="sunabalog")

    assert len(storage.uploads) == 1
    upload = storage.uploads[0]
    assert upload["remote_key"] == "sunabalog/feed.xml"
    assert upload["content_type"] == "application/rss+xml; charset=utf-8"

    feed_1 = feedparser.parse(xml_1)
    assert len(feed_1.entries) == 2
    assert feed_1.entries[0].id == "guid-ep-3-custom"
    assert feed_1.entries[0].title == "Episode 3 Title"
    assert feed_1.entries[1].id == "guid-ep-2-custom"
    assert feed_1.entries[1].title == "Episode 2 Title"

    # Rebuilding a second time produces identical guids and pubDates (Diff safety)
    with patch("psycopg.connect", return_value=fake_conn):
        xml_2 = rebuilder.rebuild(podcast_id="1", r2_key_prefix="sunabalog")

    feed_2 = feedparser.parse(xml_2)
    assert feed_2.entries[0].id == feed_1.entries[0].id
    assert feed_2.entries[0].published == feed_1.entries[0].published
    assert feed_2.entries[1].id == feed_1.entries[1].id
    assert feed_2.entries[1].published == feed_1.entries[1].published


def test_rss_rebuilder_omits_unpublished_episodes():
    storage = _FakeObjectStorage()
    dt_pub1 = datetime.datetime(2025, 12, 17, 14, 35, 58, tzinfo=pytz.UTC)

    # Episode 1 is marked is_published=False in Firestore
    firestore = _FakeFirestoreManager(
        contents={
            "1": {
                "rss_guid": "guid-ep-1",
                "published_at": dt_pub1,
                "is_published": False,
            },
        }
    )

    fake_conn = MagicMock()
    fake_conn.__enter__.return_value = fake_conn
    fake_cur = MagicMock()
    fake_conn.cursor.return_value.__enter__.return_value = fake_cur
    fake_cur.fetchone.return_value = (
        "sunabalog",
        "Tech podcast",
        "https://example.com/cover.jpg",
        "sunabalog/feed.xml",
    )
    fake_cur.fetchall.return_value = [
        (1, "Unpublished Episode", "Desc", "https://example.com/audio.mp3", 100, dt_pub1),
    ]

    with patch("psycopg.connect", return_value=fake_conn):
        rebuilder = PodcastRssRebuilder(
            database_url="postgresql://user:pass@localhost:5432/db",
            object_storage=storage,
            firestore_manager=firestore,
        )
        xml = rebuilder.rebuild(podcast_id="1", r2_key_prefix="sunabalog")

    feed = feedparser.parse(xml)
    # The unpublished episode must be excluded
    assert len(feed.entries) == 0


def test_rss_rebuilder_updates_null_rss_feed_path():
    storage = _FakeObjectStorage()
    firestore = _FakeFirestoreManager()

    fake_conn = MagicMock()
    fake_conn.__enter__.return_value = fake_conn
    fake_cur = MagicMock()
    fake_conn.cursor.return_value.__enter__.return_value = fake_cur

    # rss_feed_path is NULL in DB
    fake_cur.fetchone.return_value = ("New Channel", "Desc", None, None)
    fake_cur.fetchall.return_value = []

    with patch("psycopg.connect", return_value=fake_conn):
        rebuilder = PodcastRssRebuilder(
            database_url="postgresql://user:pass@localhost:5432/db",
            object_storage=storage,
            firestore_manager=firestore,
        )
        xml = rebuilder.rebuild(podcast_id="2", r2_key_prefix="podcasts/2")

    # Should update DB with remote_key
    fake_cur.execute.assert_any_call(
        """
                    UPDATE podcasts
                    SET rss_feed_path = %s
                    WHERE podcast_id = %s
                    """,
        ("podcasts/2/feed.xml", "2"),
    )
    assert len(storage.uploads) == 1
    assert storage.uploads[0]["remote_key"] == "podcasts/2/feed.xml"
