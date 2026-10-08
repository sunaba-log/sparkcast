from __future__ import annotations

# ruff: noqa: ARG002, ARG005
import logging
from dataclasses import dataclass

import pytest

from domain.errors import ReviewIncompleteError
from domain.models import SnsPromotionContent, SnsPromotionsResponse, Summary
from domain.models.director import FactCheckAuditMetric
from domain.models.transcript import TranscriptSegment
from services.episode_transcription import EpisodeTranscription, TranscriptionResult
from usecases.process_podcast_workflow import (
    ProcessPodcastWorkflow,
    ProcessPodcastWorkflowInput,
    _duration_to_seconds,
)


class _TranscriptProvider:
    def __init__(self, *, transcript: str = "transcript") -> None:
        self.transcript = transcript

    def generate_transcript(
        self, source_uri: str, model_id: str | None = None, cast_names: list[str] | None = None
    ) -> str:
        return self.transcript

    def generate_minutes(self, transcript_text: str, cast_names=None, model_id=None) -> str:
        self.minutes_input = transcript_text
        return "【目次】\n0:00 はじめに\n1:05 本題\n\n本文"

    def assign_speakers(self, gcs_uri: str, segments, cast_names=None, model_id=None):
        return [segment.with_speaker("小野") for segment in segments]

    def summarize_transcript(
        self,
        transcript: str,
        prompt: str | None = None,
        model_id: str | None = None,
    ) -> Summary:
        return Summary(title="Generated title", description="Generated description")

    def generate_sns_promotions(
        self,
        summary_description: str,
        num_promotions: int = 3,
        model_id: str | None = None,
    ) -> SnsPromotionsResponse:
        return SnsPromotionsResponse(
            promotions=[
                SnsPromotionContent(message=f"Promotion {index}", hashtags=[f"#Tag{index}"])
                for index in range(1, num_promotions + 1)
            ]
        )


class _ObjectStorage:
    def __init__(self) -> None:
        self.uploads: list[str] = []

    def download_file(self, remote_key: str) -> bytes:
        return b"<rss />"

    def upload_file(self, file_content: bytes, remote_key: str, content_type: str, *, public: bool = True) -> None:
        self.uploads.append(remote_key)

    def generate_public_url(self, remote_key: str, custom_domain: str | None = None) -> str:
        return f"https://{custom_domain}/{remote_key}"


class _BlobSource:
    def download_blob_as_bytes(self, bucket_name: str, blob_name: str) -> bytes:
        return b"audio"


class _Notifier:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def send_discord_message(self, message: str) -> bool:
        self.messages.append(message)
        return True


class _RssManager:
    def __init__(self, *, rss_xml: str) -> None:
        self.episodes: list[dict[str, object]] = []

    def get_total_episodes(self) -> int:
        return 3

    def add_episode(self, new_episode_data: dict) -> None:
        self.episodes.append(new_episode_data)

    def get_rss_xml(self) -> str:
        return "<rss />"


@dataclass
class _EpisodeRepository:
    processing: tuple[str, str, str] | None = None
    completed: dict[str, object] | None = None
    failed: tuple[str, str, str] | None = None
    interim_metadata: dict[str, object] | None = None

    def mark_processing(self, *, podcast_id: str, episode_id: str, source_audio_path: str) -> None:
        self.processing = (podcast_id, episode_id, source_audio_path)

    def mark_completed(self, **values: object) -> None:
        self.completed = values

    def update_metadata(self, **values: object) -> None:
        self.interim_metadata = values

    def mark_failed(self, *, podcast_id: str, episode_id: str, error_message: str) -> None:
        self.failed = (podcast_id, episode_id, error_message)

    def mark_auditing(self, *, podcast_id: str, episode_id: str) -> None:
        self.auditing = (podcast_id, episode_id)

    def mark_awaiting_approval(self, *, podcast_id: str, episode_id: str) -> None:
        self.awaiting_approval = (podcast_id, episode_id)

    def get_cast_names(self, *, podcast_id: str) -> list[str]:
        return ["小野", "数森"]

    def find_recording_speakers(self, *, episode_id: str):
        return None


class _FirestoreManager:
    def __init__(self) -> None:
        self.episode_content: dict[str, object] | None = None
        self.transcript: dict[str, object] | None = None
        self.promotions: list[dict[str, object]] = []

    def save_episode_content(self, **values: object) -> str:
        self.episode_content = values
        return str(values["episode_id"])

    def get_episode_content(self, **values: object) -> dict[str, object] | None:
        return self.episode_content

    def get_transcript_segments(self, **values: object) -> list:
        return getattr(self, "segments", {}).get("segments", [])

    def save_transcript_chunks(self, **values: object) -> list[str]:
        self.transcript = values
        return ["chunk_0001"]

    def save_transcript_segments(self, **values: object) -> int:
        self.segments = values
        return len(values["segments"])  # type: ignore[arg-type]

    def create_sns_promotion(self, **values: object) -> str:
        self.promotions.append(values)
        return f"promotion-{len(self.promotions)}"


def _request(object_path: str = "podcasts/1/episodes/42/source/recording.mp3") -> ProcessPodcastWorkflowInput:
    return ProcessPodcastWorkflowInput(
        project_id="project",
        sns_schedule_offset_hours=1,
        gcs_bucket="bucket",
        gcs_trigger_object_name=object_path,
        r2_bucket="r2",
        r2_key_prefix="dev",
        ai_model_id="model",
        r2_custom_domain="podcast.example.com",
        sns_promotion_count=2,
    )


def _workflow(
    *,
    repository: _EpisodeRepository,
    firestore: _FirestoreManager,
    transcript_provider: _TranscriptProvider | None = None,
    knowledge_reindexer=None,
) -> ProcessPodcastWorkflow:
    return ProcessPodcastWorkflow(
        transcript_provider=transcript_provider or _TranscriptProvider(),
        object_storage=_ObjectStorage(),
        blob_source=_BlobSource(),
        notifier=_Notifier(),
        rss_manager_factory=_RssManager,
        audio_converter=lambda audio, suffix: b"mp3",
        audio_info_reader=lambda file_buffer, audio_format: [3, "01:02:03"],
        firestore_manager=firestore,
        episode_repository=repository,
        logger=logging.getLogger("test-workflow"),
        knowledge_reindexer=knowledge_reindexer,
    )


class _Reindexer:
    def __init__(self, repository: _EpisodeRepository, error: Exception | None = None) -> None:
        self.repository = repository
        self.error = error
        self.calls: list[tuple[str, bool]] = []

    def reindex(self, podcast_id: str) -> None:
        # 索引は完了したエピソードだけが対象なので、完了にしたあとで呼ばれること
        self.calls.append((podcast_id, self.repository.completed is not None))
        if self.error:
            raise self.error


def test_workflow_reindexes_chat_knowledge_after_completion() -> None:
    repository = _EpisodeRepository()
    reindexer = _Reindexer(repository)

    _workflow(repository=repository, firestore=_FirestoreManager(), knowledge_reindexer=reindexer).run(_request())

    assert reindexer.calls == [("1", True)]


def test_reindex_failure_does_not_fail_the_episode() -> None:
    repository = _EpisodeRepository()
    reindexer = _Reindexer(repository, error=TimeoutError("slow"))

    _workflow(repository=repository, firestore=_FirestoreManager(), knowledge_reindexer=reindexer).run(_request())

    assert repository.completed is not None
    assert repository.failed is None


def test_failed_episode_is_not_reindexed() -> None:
    repository = _EpisodeRepository()
    reindexer = _Reindexer(repository)
    workflow = _workflow(
        repository=repository,
        firestore=_FirestoreManager(),
        transcript_provider=_TranscriptProvider(transcript=""),
        knowledge_reindexer=reindexer,
    )
    with pytest.raises(ValueError, match="Failed to make transcript"):
        workflow.run(_request())
    assert reindexer.calls == []


def test_workflow_uses_object_path_ids_for_cloud_sql_and_firestore() -> None:
    repository = _EpisodeRepository()
    firestore = _FirestoreManager()

    _workflow(repository=repository, firestore=firestore).run(_request())

    assert repository.processing == ("1", "42", "podcasts/1/episodes/42/source/recording.mp3")
    assert repository.completed == {
        "podcast_id": "1",
        "episode_id": "42",
        "title": "#4 Generated title",
        "description": "Generated description",
        "audio_url": "https://podcast.example.com/dev/ep/4/audio.mp3",
        "duration_seconds": 3723,
    }
    assert repository.failed is None
    assert firestore.episode_content is not None
    assert firestore.episode_content["podcast_id"] == "1"
    assert firestore.episode_content["episode_id"] == "42"
    assert firestore.transcript is not None
    assert firestore.transcript["episode_id"] == "42"
    assert len(firestore.promotions) == 2
    assert firestore.promotions[0]["episode_id"] == "42"
    assert firestore.promotions[0]["podcast_id"] == "1"
    assert firestore.promotions[0]["message"] == "Promotion 1"
    assert firestore.promotions[1]["episode_id"] == "42"
    assert firestore.promotions[1]["message"] == "Promotion 2"


def test_workflow_marks_episode_failed_and_reraises() -> None:
    repository = _EpisodeRepository()
    firestore = _FirestoreManager()
    workflow = _workflow(
        repository=repository,
        firestore=firestore,
        transcript_provider=_TranscriptProvider(transcript=""),
    )

    with pytest.raises(ValueError, match="Failed to make transcript"):
        workflow.run(_request())

    assert repository.failed == ("1", "42", "Failed to make transcript.")
    assert repository.completed is None


def test_workflow_rejects_invalid_path_before_database_update() -> None:
    repository = _EpisodeRepository()

    with pytest.raises(ValueError, match="GCS object path must match"):
        _workflow(repository=repository, firestore=_FirestoreManager()).run(_request("recording.mp3"))

    assert repository.processing is None
    assert repository.failed is None


@pytest.mark.parametrize(
    ("duration", "expected"),
    [
        ("01:02:03", 3723),
        ("00:00:00", 0),
        ("1:60:00", None),
        ("invalid", None),
    ],
)
def test_duration_to_seconds(duration: str, expected: int | None) -> None:
    assert _duration_to_seconds(duration) == expected


def test_workflow_saves_timestamped_segments_and_topics() -> None:
    class _Speech:
        def transcribe(self, files, timeout=3600):
            return {uri: [TranscriptSegment(0, 2, "はじめます"), TranscriptSegment(65, 70, "本題")] for uri in files}

    repository = _EpisodeRepository()
    firestore = _FirestoreManager()
    provider = _TranscriptProvider()
    workflow = ProcessPodcastWorkflow(
        transcript_provider=provider,
        object_storage=_ObjectStorage(),
        blob_source=_BlobSource(),
        notifier=_Notifier(),
        rss_manager_factory=_RssManager,
        audio_converter=lambda audio, suffix: b"mp3",
        audio_info_reader=lambda file_buffer, audio_format: [3, "00:01:30"],
        firestore_manager=firestore,
        episode_repository=repository,
        logger=logging.getLogger("test-workflow"),
        transcription=EpisodeTranscription(
            transcript_provider=provider,
            episode_repository=repository,
            speech=_Speech(),
            work_bucket="work",
        ),
    )
    workflow.run(_request())

    assert provider.minutes_input == "[0:00] 小野: はじめます\n[1:05] 小野: 本題"
    assert [s.text for s in firestore.segments["segments"]] == ["はじめます", "本題"]
    assert firestore.transcript is None
    content = firestore.episode_content
    assert content is not None
    assert content["minutes"].startswith("【目次】")
    assert content["show_notes_summary"]["topics"] == [
        {"time": "0:00", "title": "はじめに"},
        {"time": "1:05", "title": "本題"},
    ]
    assert content["transcript_meta"]["engine"] == "speech_v2_long"


def test_workflow_saves_interim_content_even_when_audit_fails() -> None:
    """Jev 監査でエラーが発生しても、文字起こし・要約・トピックが先行保存されていること (#204)."""

    class _FailingAuditor:
        def audit_chunks(self, chunks):
            raise ReviewIncompleteError("Jev audit failed intentionally for testing")

    class _MockTranscription:
        def run(self, **kwargs):
            return TranscriptionResult(
                minutes="## 要約\nテストエピソード\n## 【目次】\n0:00 本編",
                segments=[TranscriptSegment(start=0.0, end=5.0, text="発話テキスト", speaker="小野")],
                meta={"engine": "test"},
            )

    repository = _EpisodeRepository()
    firestore = _FirestoreManager()
    provider = _TranscriptProvider()
    workflow = ProcessPodcastWorkflow(
        transcript_provider=provider,
        object_storage=_ObjectStorage(),
        blob_source=_BlobSource(),
        notifier=_Notifier(),
        rss_manager_factory=_RssManager,
        audio_converter=lambda audio, suffix: b"mp3",
        audio_info_reader=lambda file_buffer, audio_format: [100, "00:05:00"],
        firestore_manager=firestore,
        episode_repository=repository,
        logger=logging.getLogger("test-workflow"),
        transcription=_MockTranscription(),
        fact_check_auditor=_FailingAuditor(),
    )

    with pytest.raises(ReviewIncompleteError):
        workflow.run(_request())

    # 1. DB ステータスは failed に更新された
    assert repository.failed is not None
    # 2. 先行保存されたメタデータ (タイトル・要約) が DB に残っている
    assert repository.interim_metadata is not None
    assert repository.interim_metadata["title"] == "#4 Generated title"
    assert repository.interim_metadata["description"] == "Generated description"
    # 3. Firestore にもエピソードコンテンツとセグメントが保存されている
    assert firestore.episode_content is not None
    assert firestore.episode_content["minutes"] == "## 要約\nテストエピソード\n## 【目次】\n0:00 本編"
    assert len(firestore.segments["segments"]) == 1
    assert firestore.segments["segments"][0].text == "発話テキスト"


def test_workflow_resumes_from_audit_skipping_speech_and_transcription() -> None:
    """resume_from_audit=True の場合、既存のFirestore成果物を用いてStep 1/2をスキップし監査から再開すること (#204)."""

    class _CountingTranscription:
        def __init__(self):
            self.call_count = 0

        def run(self, **kwargs):
            self.call_count += 1
            raise AssertionError("Transcription.run should NOT be called during resumption!")

    class _CountingAuditor:
        def __init__(self):
            self.call_count = 0

        def audit_chunks(self, chunks):
            self.call_count += 1
            return [(chunk, FactCheckAuditMetric(noul=0.1, score=1, choice="other")) for chunk in chunks]

    repository = _EpisodeRepository()
    firestore = _FirestoreManager()
    # 既存のコンテンツとセグメントを Firestore にあらかじめセット
    firestore.episode_content = {
        "episode_id": "456",
        "minutes": "既存の議事録テキスト",
        "transcript_summary": "既存の要約",
        "ai_generated_meta": {"title": "#4 既存のタイトル", "description": "既存の要約"},
        "audio_metadata": {"file_size_bytes": 500, "duration_str": "00:03:00", "mime_type": "audio/mpeg"},
        "transcript_meta": {"engine": "cached"},
    }
    firestore.segments = {"segments": [TranscriptSegment(start=0.0, end=3.0, text="既存セグメント", speaker="数森")]}

    mock_transcription = _CountingTranscription()
    mock_auditor = _CountingAuditor()
    storage = _ObjectStorage()

    workflow = ProcessPodcastWorkflow(
        transcript_provider=_TranscriptProvider(),
        object_storage=storage,
        blob_source=_BlobSource(),
        notifier=_Notifier(),
        rss_manager_factory=_RssManager,
        audio_converter=lambda audio, suffix: b"mp3",
        audio_info_reader=lambda file_buffer, audio_format: [500, "00:03:00"],
        firestore_manager=firestore,
        episode_repository=repository,
        logger=logging.getLogger("test-workflow"),
        transcription=mock_transcription,
        fact_check_auditor=mock_auditor,
    )

    req = _request()
    # resume_from_audit を True にして実行
    resume_req = ProcessPodcastWorkflowInput(
        project_id=req.project_id,
        sns_schedule_offset_hours=req.sns_schedule_offset_hours,
        gcs_bucket=req.gcs_bucket,
        gcs_trigger_object_name=req.gcs_trigger_object_name,
        r2_bucket=req.r2_bucket,
        r2_key_prefix=req.r2_key_prefix,
        ai_model_id=req.ai_model_id,
        r2_custom_domain=req.r2_custom_domain,
        resume_from_audit=True,
    )

    workflow.run(resume_req)

    # 1. 音声認識 (transcription.run) は呼ばれていない
    assert mock_transcription.call_count == 0
    # 2. 監査 (auditor.audit_chunks) は実行された
    assert mock_auditor.call_count == 1
    # 3. 正常に completed に遷移
    assert repository.completed is not None
    assert repository.completed["title"] == "#4 既存のタイトル"
