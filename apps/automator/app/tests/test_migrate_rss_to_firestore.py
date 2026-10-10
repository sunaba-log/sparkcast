"""Tests for RSS to Firestore migration script and end-to-end diff safety."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import feedparser

from scripts.migrate_rss_to_firestore import migrate_rss_to_db
from services.rss_rebuilder import PodcastRssRebuilder


class _MockFirestoreManager:
    def __init__(self) -> None:
        self.documents: dict[str, dict[str, object]] = {}

    def save_episode_content(self, **kwargs: object) -> str:
        ep_id = str(kwargs["episode_id"])
        self.documents[ep_id] = kwargs
        return ep_id

    def get_episode_content(self, *, podcast_id: str, episode_id: str) -> dict[str, object] | None:  # noqa: ARG002
        return self.documents.get(str(episode_id))

    def update_episode_fields(self, *, podcast_id: str, episode_id: str, fields: dict[str, object]) -> None:  # noqa: ARG002
        if str(episode_id) in self.documents:
            self.documents[str(episode_id)].update(fields)


class _MockStorage:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []

    def upload_file(self, **kwargs: object) -> None:
        self.uploads.append(kwargs)


def test_migrate_rss_and_verify_rebuild_diff_consistency():
    feed_path = Path(__file__).resolve().parent.parent / "data" / "rss_feed.xml"
    original_xml = feed_path.read_text(encoding="utf-8")

    orig_parsed = feedparser.parse(original_xml)
    assert len(orig_parsed.entries) == 3

    firestore = _MockFirestoreManager()
    migrated = migrate_rss_to_db(
        xml_content=original_xml,
        podcast_id="1",
        dry_run=False,
        firestore_manager=firestore,
    )

    assert len(migrated) == 3
    # Check that guids in Firestore match original feed items
    orig_guids = [e.id for e in orig_parsed.entries]
    # In original_xml, order is #3, #2, #1
    assert firestore.documents["3"]["rss_guid"] == "5e8dfcde-2e6b-42d8-b19f-df701c06c607"
    assert firestore.documents["2"]["rss_guid"] == "b23c635e-c715-4703-9db7-33ecd566c18d"
    assert firestore.documents["1"]["rss_guid"] == "c88943a0-c88a-49f1-8a20-d23cc8ccf637"

    # Now simulate Rebuild from this Firestore state + PostgreSQL
    storage = _MockStorage()
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
        (
            3,
            firestore.documents["3"]["ai_generated_meta"]["title"],
            "",
            firestore.documents["3"]["audio_metadata"]["audio_url"],
            3157,
            firestore.documents["3"]["published_at"],
        ),
        (
            2,
            firestore.documents["2"]["ai_generated_meta"]["title"],
            "",
            firestore.documents["2"]["audio_metadata"]["audio_url"],
            3005,
            firestore.documents["2"]["published_at"],
        ),
        (
            1,
            firestore.documents["1"]["ai_generated_meta"]["title"],
            "",
            firestore.documents["1"]["audio_metadata"]["audio_url"],
            2055,
            firestore.documents["1"]["published_at"],
        ),
    ]

    with patch("psycopg.connect", return_value=fake_conn):
        rebuilder = PodcastRssRebuilder(
            database_url="postgresql://user:pass@localhost:5432/db",
            object_storage=storage,
            firestore_manager=firestore,
        )
        rebuilt_xml = rebuilder.rebuild(podcast_id="1", r2_key_prefix="sunabalog")

    rebuilt_parsed = feedparser.parse(rebuilt_xml)
    assert len(rebuilt_parsed.entries) == 3

    # CRITICAL: Verify that new feed entries have identical GUIDs and PubDates to original entries
    for i in range(3):
        assert rebuilt_parsed.entries[i].id == orig_guids[i], f"GUID mismatch at index {i}"
        assert rebuilt_parsed.entries[i].published_parsed == orig_parsed.entries[i].published_parsed, (
            f"PubDate mismatch at index {i}"
        )
