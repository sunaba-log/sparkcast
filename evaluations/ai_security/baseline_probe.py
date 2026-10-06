"""Observe publication boundaries with fake external services; never call live APIs.

Run from apps/automator/app:
  uv run --frozen python ../../../evaluations/ai_security/baseline_probe.py

This is a characterization report, not a passing security acceptance suite.
Exit 0 means the observations were collected, including any reported gaps.
"""

from __future__ import annotations

import json
import logging
import socket
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps/automator/app/src"))

from domain.models import DirectorIntervention, FactCheckAuditMetric, Summary  # noqa: E402
from domain.models.transcript import TranscriptSegment  # noqa: E402
from services.episode_transcription import TranscriptionResult  # noqa: E402
from services.fact_check_auditor import FactCheckAuditor  # noqa: E402
from usecases.auto_post_sns import AutoPostSnsUsecase  # noqa: E402
from usecases.process_podcast_workflow import (  # noqa: E402
    ProcessPodcastWorkflow,
    ProcessPodcastWorkflowInput,
)


def workflow_observation(mode: str) -> dict:
    client = AsyncMock()
    client.system_one.side_effect = RuntimeError("synthetic audit outage")
    auditor = FactCheckAuditor(client=client)
    if mode == "empty_response":
        client.system_one.side_effect = None
        client.system_one.return_value = SimpleNamespace(answers={})
    if mode == "intervention":
        client.system_one.side_effect = None
        client.system_one.return_value = SimpleNamespace(answers={
            "noul": SimpleNamespace(noul=0.9),
            "score": SimpleNamespace(score=4, confidence=0.9),
            "choice": SimpleNamespace(choice="numerical_data"),
        })
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
        segments=[] if mode == "no_segments" else [
            TranscriptSegment(start=0, end=3, text="The value is ten.", speaker="Speaker A")
        ],
        meta={"engine": "synthetic"},
    )
    generator = MagicMock()
    generator.generate_intervention.return_value = DirectorIntervention.create(
        chunk_id="seg_00001", target_speaker="Speaker A", insert_timestamp_ms=3000,
        correction_script="Synthetic correction", reason="Synthetic reason",
        audit_metrics=FactCheckAuditMetric(noul=0.9, score=4, choice="numerical_data"),
    )
    workflow = ProcessPodcastWorkflow(
        transcript_provider=provider, object_storage=storage,
        blob_source=MagicMock(), notifier=notifier,
        rss_manager_factory=lambda **kwargs: feed,
        audio_converter=lambda *args: b"synthetic mp3",
        audio_info_reader=lambda **kwargs: [13, "00:00:03"],
        firestore_manager=MagicMock(), episode_repository=repository,
        logger=logging.getLogger("probe"), transcription=transcription,
        fact_check_auditor=auditor, director_script_generator=generator,
    )
    workflow.run(ProcessPodcastWorkflowInput(
        project_id="synthetic", sns_schedule_offset_hours=1,
        gcs_bucket="synthetic", gcs_trigger_object_name="podcasts/p1/episodes/e1/source/audio.mp3",
        r2_bucket="synthetic", r2_key_prefix="synthetic",
        ai_model_id="unused-synthetic-model", r2_custom_domain="example.invalid",
    ))
    uploads = [call.kwargs["remote_key"] for call in storage.upload_file.call_args_list]
    return {
        "id": mode, "requirement": "PUB-02",
        "expected": "No public writes when review is incomplete or awaiting approval",
        "observed_public_write_keys": uploads,
        "audit_api_attempts": client.system_one.call_count,
        "awaiting_approval": repository.mark_awaiting_approval.called,
        "completed": repository.mark_completed.called,
        "notification_calls": notifier.send_discord_message.call_count,
        "status": "gap" if uploads else "observed_stop",
    }


def sns_observation() -> dict:
    firestore = MagicMock()
    firestore.get_pending_sns_promotions.return_value = [{
        "doc_id": "synthetic", "reference_path": "podcasts/p1/episodes_contents/e1/sns_promotions/synthetic",
        "status": "pending", "scheduled_time": "2000-01-01T00:00:00+00:00",
        "message": "Synthetic unapproved message",
    }]
    secrets = MagicMock()
    secrets.get_channel_credentials.return_value = SimpleNamespace(
        x_api_key=None, x_api_secret=None, x_access_token=None, x_access_token_secret=None,
    )
    default_client = MagicMock()
    default_client.post_thread.return_value = True
    AutoPostSnsUsecase(
        firestore_manager=firestore, secret_provider=secrets, x_client=default_client,
    ).run()
    return {
        "id": "sns_unapproved_missing_credentials", "requirement": "PUB-01/PUB-03",
        "expected": "No send for an unapproved post or unresolved channel credentials",
        "default_client_send_calls": default_client.post_thread.call_count,
        "status": "gap" if default_client.post_thread.called else "observed_stop",
    }


def main() -> None:
    logging.disable(logging.CRITICAL)
    with (
        patch.object(socket.socket, "connect", side_effect=AssertionError("Network forbidden in probe")),
        patch.object(socket, "getaddrinfo", side_effect=AssertionError("Network forbidden in probe")),
    ):
        observations = [workflow_observation(mode) for mode in (
            "audit_outage", "empty_response", "no_segments", "intervention",
        )]
        observations.append(sns_observation())
    print(json.dumps({
        "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "executed_at_utc": datetime.now(UTC).isoformat(),
        "method": "real use cases with injected synthetic dependencies and blocked sockets",
        "live_services_tested": False,
        "observations": observations,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
