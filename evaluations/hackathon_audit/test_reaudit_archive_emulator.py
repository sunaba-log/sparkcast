"""I-03（修正後）：再監査の前に、以前の指摘・訂正介入・判断を履歴へ保存する。[エミュレータ] Firestore."""

from __future__ import annotations

import os
import uuid

import pytest

from services.firestore_manager import FirestoreManager

pytestmark = pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="Firestore emulator required")


def test_archive_review_copies_previous_decisions_and_reports_whether_any_existed():
    fm = FirestoreManager(project_id="demo-sparkcast-audit-eval")
    pid, eid = "p-archive", uuid.uuid4().hex[:8]
    assert fm.archive_review(podcast_id=pid, episode_id=eid, reason="reaudit") is False
    root = fm._client.collection("podcasts").document(pid).collection("episodes_contents").document(eid)  # noqa: SLF001
    root.collection("policy_findings").document("f1").set({"status": "approved", "evidence_text": "x"})
    root.collection("director_interventions").document("i1").set({"status": "pending", "correction_script": "s"})
    root.collection("policy_reviews").document("current").set({"version": 3, "lockedPlanId": "plan"})
    assert fm.archive_review(podcast_id=pid, episode_id=eid, reason="reaudit") is True
    archives = list(root.collection("review_history").stream())
    assert len(archives) == 1
    archive = archives[0].reference
    assert archives[0].to_dict()["counts"] == {"policy_findings": 1, "director_interventions": 1, "policy_reviews": 1}
    assert archive.collection("policy_findings").document("f1").get().to_dict()["status"] == "approved"
    assert archive.collection("director_interventions").document("i1").get().to_dict()["status"] == "pending"
    assert archive.collection("policy_reviews").document("current").get().to_dict()["lockedPlanId"] == "plan"
