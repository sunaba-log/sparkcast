"""Enabled review must finish before any audio/RSS/SNS publication side effect."""

from __future__ import annotations

import logging
import socket
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from domain.errors import ReviewIncompleteError
from domain.models import DirectorIntervention, FactCheckAuditMetric, Summary, UtteranceChunk
from domain.models.transcript import TranscriptSegment
from services.episode_transcription import TranscriptionResult
from services.fact_check_auditor import FactCheckAuditor
from usecases.process_podcast_workflow import ProcessPodcastWorkflow, ProcessPodcastWorkflowInput


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Live network is forbidden in publication boundary tests")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)


def response(*, noul=0.9, score=1.0, choice="other", confidence=0.9):
    return SimpleNamespace(
        answers={
            "noul": SimpleNamespace(noul=noul),
            "score": SimpleNamespace(score=score, confidence=confidence),
            "choice": SimpleNamespace(choice=choice),
        }
    )


def workflow(*, auditor, segments=True, generator=True, persistence=True):
    storage = MagicMock()
    storage.download_file.return_value = b"<rss/>"
    storage.generate_public_url.return_value = "https://example.invalid/audio.mp3"
    feed = MagicMock()
    feed.get_total_episodes.return_value = 0
    feed.get_rss_xml.return_value = "<rss/>"
    repository = MagicMock()
    repository.get_cast_names.return_value = ["Speaker A"]
    notifier = MagicMock()
    provider = MagicMock()
    provider.summarize_transcript.return_value = Summary(title="Synthetic", description="Synthetic summary")
    provider.generate_sns_promotions.return_value = SimpleNamespace(promotions=[])
    transcription = MagicMock()
    transcription.run.return_value = TranscriptionResult(
        minutes="Synthetic minutes",
        segments=[TranscriptSegment(start=0, end=3, text="Ten.", speaker="Speaker A")] if segments else [],
    )
    director = MagicMock() if generator else None
    if director is not None:
        director.generate_intervention.return_value = DirectorIntervention.create(
            chunk_id="seg_00001",
            target_speaker="Speaker A",
            insert_timestamp_ms=3000,
            correction_script="Synthetic correction",
            reason="Synthetic reason",
            audit_metrics=FactCheckAuditMetric(noul=0.9, score=4, choice="numerical_data"),
        )
    firestore = MagicMock() if persistence else None
    usecase = ProcessPodcastWorkflow(
        transcript_provider=provider,
        object_storage=storage,
        blob_source=MagicMock(),
        notifier=notifier,
        rss_manager_factory=lambda **_kwargs: feed,
        audio_converter=lambda *_args: b"synthetic mp3",
        audio_info_reader=lambda **_kwargs: [13, "00:00:03"],
        firestore_manager=firestore,
        episode_repository=repository,
        logger=logging.getLogger("boundary-test"),
        transcription=transcription,
        fact_check_auditor=auditor,
        director_script_generator=director,
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
    return SimpleNamespace(
        usecase=usecase,
        request=request,
        storage=storage,
        feed=feed,
        repository=repository,
        notifier=notifier,
        provider=provider,
        firestore=firestore,
        director=director,
    )


def assert_no_publication(case):
    case.storage.upload_file.assert_not_called()
    case.feed.add_episode.assert_not_called()
    case.repository.mark_completed.assert_not_called()
    case.provider.generate_sns_promotions.assert_not_called()
    if case.firestore is not None:
        case.firestore.create_sns_promotion.assert_not_called()


@pytest.mark.parametrize("failure", [RuntimeError("sensitive upstream body"), TimeoutError("timeout")])
def test_audit_failure_stops_publication_and_records_sanitized_reason(failure, caplog):
    client = AsyncMock()
    client.system_one.side_effect = failure
    case = workflow(auditor=FactCheckAuditor(client=client))
    with pytest.raises(ReviewIncompleteError):
        case.usecase.run(case.request)
    assert_no_publication(case)
    case.repository.mark_failed.assert_called_once()
    assert "公開前監査" in case.repository.mark_failed.call_args.kwargs["error_message"]
    assert "sensitive upstream body" not in caplog.text
    assert "sensitive upstream body" not in str(case.notifier.mock_calls)


@pytest.mark.parametrize(
    "invalid",
    [
        SimpleNamespace(answers={}),
        SimpleNamespace(answers={"noul": SimpleNamespace(noul=0.1)}),
        response(score=None),
        response(score=True),
        response(score="1"),
        response(score=float("nan")),
        response(score=float("inf")),
        response(score=0),
        response(score=6),
        response(noul=-0.1),
        response(noul=float("nan")),
        response(choice="unexpected"),
        response(confidence=2),
    ],
)
def test_incomplete_or_invalid_response_stops_publication(invalid):
    client = AsyncMock()
    client.system_one.return_value = invalid
    case = workflow(auditor=FactCheckAuditor(client=client))
    with pytest.raises(ReviewIncompleteError):
        case.usecase.run(case.request)
    assert_no_publication(case)
    case.repository.mark_failed.assert_called_once()


def test_missing_segments_stops_enabled_review_before_audit_call():
    auditor = MagicMock()
    case = workflow(auditor=auditor, segments=False)
    with pytest.raises(ReviewIncompleteError, match="文字起こし"):
        case.usecase.run(case.request)
    auditor.audit_chunks.assert_not_called()
    assert_no_publication(case)
    case.repository.mark_failed.assert_called_once()


@pytest.mark.parametrize("mode", ["missing", "duplicate", "wrong_chunk"])
def test_partial_or_mismatched_batch_cannot_authorize_publication(mode):
    auditor = MagicMock()
    chunk = UtteranceChunk("seg_00001", "Speaker A", 0, 3000, "Ten.")
    metric = FactCheckAuditMetric(noul=0.1, score=1, choice="other")
    auditor.audit_chunks.return_value = {
        "missing": [],
        "duplicate": [(chunk, metric), (chunk, metric)],
        "wrong_chunk": [(UtteranceChunk("seg_00001", "Speaker A", 0, 3000, "Different."), metric)],
    }[mode]
    case = workflow(auditor=auditor)
    with pytest.raises(ReviewIncompleteError, match="全発話"):
        case.usecase.run(case.request)
    assert_no_publication(case)


@pytest.mark.parametrize("mode", ["generator_disabled", "empty_script", "missing_storage", "save_failure"])
def test_severe_result_requires_a_saved_correction_before_awaiting_approval(mode):
    client = AsyncMock()
    client.system_one.return_value = response(score=4)
    case = workflow(
        auditor=FactCheckAuditor(client=client),
        generator=mode != "generator_disabled",
        persistence=mode != "missing_storage",
    )
    if mode == "empty_script":
        case.director.generate_intervention.return_value = SimpleNamespace(correction_script=" ")
    if mode == "save_failure":
        case.firestore.save_director_interventions.side_effect = RuntimeError("synthetic save failure")
    with pytest.raises(RuntimeError):
        case.usecase.run(case.request)
    assert_no_publication(case)
    case.repository.mark_awaiting_approval.assert_not_called()
    case.repository.mark_failed.assert_called_once()


def test_successful_low_score_review_keeps_automatic_publication():
    client = AsyncMock()
    client.system_one.return_value = response(score=1.7)
    case = workflow(auditor=FactCheckAuditor(client=client))
    case.usecase.run(case.request)
    assert case.storage.upload_file.call_count == 2
    case.repository.mark_completed.assert_called_once()
    case.repository.mark_failed.assert_not_called()


def test_disabled_review_keeps_existing_no_segments_publication():
    case = workflow(auditor=None, segments=False)
    case.usecase.run(case.request)
    assert case.storage.upload_file.call_count == 2
    case.repository.mark_completed.assert_called_once()
    case.repository.mark_failed.assert_not_called()


def test_correction_waits_for_approval_without_publication():
    client = AsyncMock()
    client.system_one.return_value = response(score=4)
    case = workflow(auditor=FactCheckAuditor(client=client))
    case.usecase.run(case.request)
    assert_no_publication(case)
    case.firestore.save_director_interventions.assert_called_once()
    case.repository.mark_awaiting_approval.assert_called_once()
    case.repository.mark_failed.assert_not_called()
