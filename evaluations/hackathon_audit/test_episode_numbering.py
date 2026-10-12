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


def _row(eid: int):
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        cur.execute("SELECT episode_number, title, audio_file_path FROM episodes WHERE episode_id=%s", (eid,))
        return cur.fetchone()


def test_v1_10_episode_number_and_audio_key_are_unique_regardless_of_publish_order():
    """修正後（I-02）：3件アップロード済みの番組で E1・E3 を公開し、承認待ちだった E2 を後から原音声で公開する.

    修正前は3件とも #4・ep/4/audio.mp3 になり、後の公開が前の公開音声を上書きした（evidence/before）。
    修正後は、番号を処理開始時に一度だけ採番し、公開音声キーは番組ID・エピソードIDで決まる。
    """
    pid, (e1, e2, e3) = _seed()
    k1 = _publish(pid, e1)
    k3 = _publish(pid, e3)
    k2 = _publish(pid, e2, publish_original=True)
    rows = {e: _row(e) for e in (e1, e2, e3)}
    print({"case": "V1-10", "keys": {"E1": k1, "E3": k3, "E2(later)": k2}, "rows": rows})
    assert len({k1, k2, k3}) == 3
    assert k2 == f"synthetic/podcasts/{pid}/episodes/{e2}/audio.mp3"
    assert sorted(r[0] for r in rows.values()) == [1, 2, 3]
    assert rows[e1][1].startswith("#1 ") and rows[e3][1].startswith("#2 ") and rows[e2][1].startswith("#3 ")


def test_v1_11_number_is_stable_on_reprocessing_and_existing_urls_are_kept():
    """同じ回を再処理しても番号は変わらない。既存の公開回（旧形式のURL）は他の回の公開で変更されない."""
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO podcasts (title) VALUES ('EVAL sequential') RETURNING podcast_id")
        pid = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO episodes (podcast_id, title, status, audio_file_path, episode_number, published_at) "
            "VALUES (%s, '#7 既存回', 'completed', 'https://example.invalid/sunabalog/ep/7/audio.mp3', 7, now()) RETURNING episode_id",
            (pid,),
        )
        old = cur.fetchone()[0]
        cur.execute("INSERT INTO episodes (podcast_id, title, status) VALUES (%s, 'S1', 'uploaded') RETURNING episode_id", (pid,))
        eid = cur.fetchone()[0]
        conn.commit()
    k_first = _publish(pid, eid)
    n_first = _row(eid)[0]
    k_again = _publish(pid, eid, publish_original=True)
    print({"case": "V1-11", "keys": [k_first, k_again], "number": [n_first, _row(eid)[0]], "existing": _row(old)})
    assert n_first == 8 and _row(eid)[0] == 8
    assert k_first == k_again == f"synthetic/podcasts/{pid}/episodes/{eid}/audio.mp3"
    assert _row(old) == (7, "#7 既存回", "https://example.invalid/sunabalog/ep/7/audio.mp3")
