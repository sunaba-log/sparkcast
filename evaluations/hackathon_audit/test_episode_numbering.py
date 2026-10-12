"""検証1（公開先の対応）：エピソード番号と公開音声キーの決まり方。

[エミュレータ] 実際の PostgresEpisodeRepository をローカル PostgreSQL（apps/ui/migrations 適用済み）で使う。
R2 への書き込みは記録用の代替。EVAL_DATABASE_URL（localhost）が無ければスキップ。
"""

from __future__ import annotations

import os
from dataclasses import replace
from unittest.mock import MagicMock

import psycopg
import pytest

from domain.models import FactCheckAuditMetric
from infrastructure.episode_repository import PostgresEpisodeRepository
from tests.test_review_publication_boundary import _workflow

DB = os.environ.get("EVAL_DATABASE_URL", "")
pytestmark = pytest.mark.skipif("127.0.0.1" not in DB and "localhost" not in DB, reason="local PostgreSQL required")


def _seed() -> tuple[int, list[int]]:
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO podcasts (title) VALUES ('EVAL numbering') RETURNING podcast_id")
        pid = cur.fetchone()[0]
        eids = []
        for title in ("E1", "E2", "E3"):
            cur.execute("INSERT INTO episodes (podcast_id, title, status) VALUES (%s, %s, 'uploaded') RETURNING episode_id", (pid, title))
            eids.append(cur.fetchone()[0])
        conn.commit()
    return pid, eids


def _publish(pid: int, eid: int, *, publish_original: bool = False) -> str:
    auditor = MagicMock()
    auditor.audit_chunks.return_value = []
    case = _workflow(auditor=None)
    repo = PostgresEpisodeRepository(database_url=DB)
    case.usecase._episode_repository = repo
    fs = case.usecase._firestore_manager
    fs.get_episode_content.return_value = {"minutes": "m", "transcript_summary": "s"}
    fs.get_transcript_segments.return_value = []
    request = replace(case.request, gcs_trigger_object_name=f"podcasts/{pid}/episodes/{eid}/source/a.mp3", publish_original=publish_original, resume_from_audit=publish_original)
    case.usecase._rss_rebuilder = MagicMock()
    case.usecase.run(request)
    keys = [c.kwargs["remote_key"] for c in case.storage.upload_file.call_args_list]
    return keys[0]


def test_v1_10_episode_number_and_audio_key_collide_when_an_earlier_upload_is_published_later():
    """3件アップロード済みの番組で E1・E3 を公開し、承認待ちだった E2 を後から原音声で公開する.

    番号は「その番組の全エピソード行数（未公開・処理中を含む）+1」で公開時に決まるため、
    3件とも #4 になり、同じ公開音声キー ep/4/audio.mp3 に書き込まれる（前の公開音声を上書き）。
    """
    pid, (e1, e2, e3) = _seed()
    k1 = _publish(pid, e1)
    k3 = _publish(pid, e3)
    k2 = _publish(pid, e2, publish_original=True)
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        cur.execute("SELECT episode_id, title, audio_file_path FROM episodes WHERE podcast_id=%s ORDER BY episode_id", (pid,))
        rows = cur.fetchall()
    print({"case": "V1-10", "keys": {"E1": k1, "E3": k3, "E2(later)": k2}, "rows": rows})
    assert k1.endswith("/ep/4/audio.mp3")  # 1件目の公開でも番号は 件数(3)+1
    assert k1 == k3 == k2  # 後の公開が前のエピソードの公開音声を上書きする


def test_v1_11_sequential_uploads_are_numbered_from_two():
    """1件ずつアップロード・公開しても、番号は自分自身の行を数えるため #2 から始まる（重複はしない）."""
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO podcasts (title) VALUES ('EVAL sequential') RETURNING podcast_id")
        pid = cur.fetchone()[0]
        conn.commit()
    keys = []
    for title in ("S1", "S2"):
        with psycopg.connect(DB) as conn, conn.cursor() as cur:
            cur.execute("INSERT INTO episodes (podcast_id, title, status) VALUES (%s, %s, 'uploaded') RETURNING episode_id", (pid, title))
            eid = cur.fetchone()[0]
            conn.commit()
        keys.append(_publish(pid, eid))
    print({"case": "V1-11", "keys": keys})
    assert keys == ["synthetic/ep/2/audio.mp3", "synthetic/ep/3/audio.mp3"]
