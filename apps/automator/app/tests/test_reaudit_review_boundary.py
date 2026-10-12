"""再監査で、以前の確認事項を意図せず消して公開しない (I-03)."""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import MagicMock

from domain.models import FactCheckAuditMetric
from domain.models.director import AuditBundle, PolicyFinding
from domain.models.transcript import TranscriptSegment
from tests.test_review_publication_boundary import _assert_not_published, _workflow


class _Auditor:
    def __init__(self, findings: bool) -> None:
        self.findings = findings

    def audit_bundle(self, chunks, *, policy):
        return AuditBundle(
            fact_check_results=[(c, FactCheckAuditMetric(0.9, 1, "none")) for c in chunks],
            policy_findings=[
                PolicyFinding.create(chunk=c, category="pii", source="presidio", policy_version="v1") for c in chunks
            ]
            if self.findings
            else [],
            traces=[],
        )


def _case(*, had_review: bool, findings: bool):
    case = _workflow(auditor=_Auditor(findings))
    fs = case.usecase._firestore_manager
    fs.archive_review.return_value = had_review
    fs.get_episode_content.return_value = {
        "minutes": "m",
        "transcript_summary": "s",
        "ai_generated_meta": {"title": "#1 t"},
    }
    fs.get_transcript_segments.return_value = [TranscriptSegment(0, 3, "Ten.", speaker="Speaker A")]
    return case, replace(case.request, resume_from_audit=True)


def test_reaudit_without_findings_after_earlier_review_waits_for_publish_confirmation():
    case, request = _case(had_review=True, findings=False)
    case.usecase.run(request)
    _assert_not_published(case)
    case.repository.mark_awaiting_publish_confirmation.assert_called_once()
    case.usecase._firestore_manager.archive_review.assert_called_once_with(
        podcast_id="p1", episode_id="e1", reason="reaudit"
    )


def test_reaudit_with_new_findings_returns_to_review():
    case, request = _case(had_review=True, findings=True)
    case.usecase.run(request)
    _assert_not_published(case)
    case.repository.mark_awaiting_approval.assert_called()
    case.repository.mark_awaiting_publish_confirmation.assert_not_called()


def test_first_audit_without_findings_still_publishes():
    case, request = _case(had_review=False, findings=False)
    case.usecase.run(request)
    case.repository.mark_completed.assert_called_once()
    case.repository.mark_awaiting_publish_confirmation.assert_not_called()


def test_archive_is_taken_before_new_results_overwrite_old_ones():
    case, request = _case(had_review=True, findings=True)
    order = MagicMock()
    fs = case.usecase._firestore_manager
    fs.archive_review.side_effect = lambda **_k: order("archive") or True
    fs.save_policy_findings.side_effect = lambda **_k: order("save_findings")
    fs.save_director_interventions.side_effect = lambda **_k: order("save_interventions")
    case.usecase.run(request)
    assert [c.args[0] for c in order.call_args_list][:2] == ["archive", "save_findings"]
