"""The enabled Jev review must complete before publication."""

from __future__ import annotations

import logging
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from domain.errors import ReviewIncompleteError
from domain.models import FactCheckAuditMetric, Summary, UtteranceChunk
from domain.models.transcript import TranscriptSegment, TranscriptWord
from services.episode_transcription import TranscriptionResult
from services.fact_check_auditor import FactCheckAuditor
from services.policy_edit_plan import DuplicatePolicyEditError
from usecases.process_podcast_workflow import ProcessPodcastWorkflow, ProcessPodcastWorkflowInput


def _workflow(*, auditor, segments: list[TranscriptSegment] | None = None):
    storage = MagicMock()
    storage.download_file.return_value = b"<rss/>"
    storage.generate_public_url.return_value = "https://example.invalid/audio.mp3"
    feed = MagicMock()
    feed.get_total_episodes.return_value = 0
    feed.get_rss_xml.return_value = "<rss/>"
    repository = MagicMock()
    notifier = MagicMock()
    provider = MagicMock()
    provider.summarize_transcript.return_value = Summary(title="Synthetic", description="Synthetic summary")
    provider.generate_sns_promotions.return_value = SimpleNamespace(promotions=[])
    transcription = MagicMock()
    transcription.run.return_value = TranscriptionResult(
        minutes="Synthetic minutes",
        segments=segments if segments is not None else [TranscriptSegment(0, 3, "Ten.", speaker="Speaker A")],
    )
    usecase = ProcessPodcastWorkflow(
        transcript_provider=provider,
        object_storage=storage,
        blob_source=MagicMock(download_blob_as_bytes=MagicMock(return_value=b"synthetic source")),
        notifier=notifier,
        rss_manager_factory=lambda **_kwargs: feed,
        audio_converter=lambda *_args: b"synthetic mp3",
        audio_info_reader=lambda **_kwargs: [13, "00:00:03"],
        firestore_manager=MagicMock(),
        episode_repository=repository,
        logger=logging.getLogger("boundary-test"),
        transcription=transcription,
        fact_check_auditor=auditor,
        director_script_generator=MagicMock(),
    )
    request = ProcessPodcastWorkflowInput(
        project_id="synthetic",
        sns_schedule_offset_hours=1,
        gcs_bucket="synthetic",
        gcs_trigger_object_name="podcasts/p1/episodes/e1/source/audio.mp3",
        r2_bucket="synthetic",
        r2_key_prefix="synthetic",
        ai_model_id="unused",
        r2_custom_domain="example.invalid",
    )
    return SimpleNamespace(usecase=usecase, request=request, storage=storage, feed=feed, repository=repository)


def _assert_not_published(case) -> None:
    case.storage.upload_file.assert_not_called()
    case.feed.add_episode.assert_not_called()
    case.repository.mark_completed.assert_not_called()


def test_api_failure_stops_publication_without_leaking_upstream_error(caplog):
    client = AsyncMock()
    client.system_one.side_effect = RuntimeError("sensitive upstream response")
    case = _workflow(auditor=FactCheckAuditor(client=client))

    with pytest.raises(ReviewIncompleteError):
        case.usecase.run(case.request)

    _assert_not_published(case)
    case.repository.mark_failed.assert_called_once()
    assert "sensitive upstream response" not in caplog.text


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(answers={}),
        SimpleNamespace(
            answers={
                "noul": SimpleNamespace(noul=0.9),
                "score": SimpleNamespace(score=float("nan"), confidence=0.9),
                "choice": SimpleNamespace(choice="other"),
            }
        ),
    ],
)
def test_invalid_response_stops_publication(response):
    client = AsyncMock()
    client.system_one.return_value = response
    case = _workflow(auditor=FactCheckAuditor(client=client))

    with pytest.raises(ReviewIncompleteError):
        case.usecase.run(case.request)

    _assert_not_published(case)


def test_missing_audit_result_stops_publication():
    auditor = MagicMock()
    auditor.audit_chunks.return_value = []
    case = _workflow(auditor=auditor)

    with pytest.raises(ReviewIncompleteError, match="全発話"):
        case.usecase.run(case.request)

    _assert_not_published(case)


def test_missing_segments_stops_enabled_review():
    auditor = MagicMock()
    case = _workflow(auditor=auditor, segments=[])

    with pytest.raises(ReviewIncompleteError, match="文字起こし"):
        case.usecase.run(case.request)

    auditor.audit_chunks.assert_not_called()
    _assert_not_published(case)


def test_completed_low_score_review_still_publishes():
    auditor = MagicMock()
    chunk = UtteranceChunk("seg_00001", "Speaker A", 0, 3000, "Ten.")
    auditor.audit_chunks.return_value = [(chunk, FactCheckAuditMetric(0.9, 1, "other"))]
    case = _workflow(auditor=auditor)

    case.usecase.run(case.request)

    assert case.storage.upload_file.call_count == 2
    case.repository.mark_completed.assert_called_once()


def test_frozen_policy_edit_publishes_rendered_audio_and_preserves_original_transcripts(monkeypatch):
    case = _workflow(auditor=MagicMock())
    fs = case.usecase._firestore_manager
    fs.get_episode_content.return_value = {"minutes": "Original minutes", "ai_generated_meta": {"title": "Original"}}
    fs.get_transcript_segments.return_value = [
        TranscriptSegment(
            0,
            3,
            "公開秘密続き",
            words=(
                TranscriptWord("公開", 0, 1),
                TranscriptWord("秘密", 1, 2),
                TranscriptWord("続き", 2, 3),
            ),
        )
    ]
    provider = case.usecase._transcript_provider
    provider.generate_minutes.return_value = "Edited minutes"
    timeline = [
        {"sourceStartMs": 0, "sourceEndMs": 1000, "outputStartMs": 0, "outputEndMs": 1000, "kind": "original"},
        {"sourceStartMs": 1000, "sourceEndMs": 2000, "outputStartMs": 1000, "outputEndMs": 1000, "kind": "cut"},
        {"sourceStartMs": 2000, "sourceEndMs": 3000, "outputStartMs": 1000, "outputEndMs": 2000, "kind": "original"},
    ]
    monkeypatch.setattr(
        "usecases.process_podcast_workflow.apply_saved_policy_plan",
        lambda *_args: (b"edited mp3", timeline, {"operations": []}),
    )
    completed = MagicMock()
    monkeypatch.setattr("usecases.process_podcast_workflow.finish_policy_plan", completed)
    case.usecase.run(replace(case.request, edit_plan_id="plan", resume_from_audit=True))
    assert case.storage.upload_file.call_args_list[0].kwargs["file_content"] == b"edited mp3"
    assert "/renditions/plan.mp3" in case.storage.upload_file.call_args_list[0].kwargs["remote_key"]
    assert "秘密" not in provider.generate_minutes.call_args.args[0]
    fs.save_transcript_segments.assert_not_called()
    fs.save_transcript_chunks.assert_not_called()
    fs.save_rendition_segments.assert_called_once()
    case.repository.mark_processing.assert_not_called()
    completed.assert_called_once()


def test_duplicate_policy_job_does_not_change_episode_state_or_publish(monkeypatch):
    case = _workflow(auditor=MagicMock())
    fs = case.usecase._firestore_manager
    fs.get_episode_content.return_value = {"minutes": "Original minutes", "ai_generated_meta": {"title": "Original"}}
    fs.get_transcript_segments.return_value = [TranscriptSegment(0, 3, "Original")]

    def duplicate(*_args):
        raise DuplicatePolicyEditError

    monkeypatch.setattr("usecases.process_podcast_workflow.apply_saved_policy_plan", duplicate)
    case.usecase.run(replace(case.request, edit_plan_id="plan", resume_from_audit=True))
    _assert_not_published(case)
    case.repository.mark_processing.assert_not_called()
    case.repository.mark_failed.assert_not_called()
