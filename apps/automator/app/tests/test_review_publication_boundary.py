"""The enabled Jev review must complete before publication."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from domain.errors import ReviewIncompleteError
from domain.models import FactCheckAuditMetric, Summary, UtteranceChunk
from domain.models.transcript import TranscriptSegment
from services.episode_transcription import TranscriptionResult
from services.fact_check_auditor import FactCheckAuditor
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
        blob_source=MagicMock(),
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
