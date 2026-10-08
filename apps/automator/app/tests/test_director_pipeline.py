"""Tests for Jev fast audit and Gemini director intervention pipeline (#170)."""

# ruff: noqa: ARG001, ARG002, ARG005
from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock

import pytest

from domain.errors import ReviewIncompleteError
from domain.models.common import SnsPromotionsResponse, Summary
from domain.models.director import (
    DirectorIntervention,
    FactCheckAuditMetric,
    UtteranceChunk,
)
from domain.models.transcript import TranscriptSegment
from services.director_script_generator import (
    DirectorScriptGenerator,
)
from services.episode_transcription import TranscriptionResult
from services.fact_check_auditor import FactCheckAuditor
from services.firestore_manager import FirestoreManager
from usecases.process_podcast_workflow import (
    ProcessPodcastWorkflow,
    ProcessPodcastWorkflowInput,
)

# --- Jev Auditor Tests ---


@pytest.mark.anyio
async def test_fact_check_auditor_mock_success():
    """Jev API との疎通・モックテスト: Noul, Score, Choice の3基準が正しくパースされること."""
    mock_client = AsyncMock()

    # モックレスポンスの作成 (重大な誤認: 深刻度4 -> Jev 0始まりインデックス: 3.0)
    mock_noul_ans = MagicMock()
    mock_noul_ans.noul = 0.95

    mock_score_ans = MagicMock()
    mock_score_ans.score = 3.0
    mock_score_ans.confidence = 0.92

    mock_choice_ans = MagicMock()
    mock_choice_ans.choice = "technology"
    mock_choice_ans.confidence = 0.88

    mock_response = MagicMock()
    mock_response.answers = {
        "noul": mock_noul_ans,
        "score": mock_score_ans,
        "choice": mock_choice_ans,
    }

    mock_client.system_one.return_value = mock_response

    auditor = FactCheckAuditor(client=mock_client)

    chunk = UtteranceChunk(
        chunk_id="seg_00001",
        speaker="小野",
        start_ms=1000,
        end_ms=4500,
        text="Python 3.12 では GIL が完全に削除されたんですよね。",
    )

    _, metric = await auditor.audit_single_chunk_async(mock_client, chunk)

    assert metric.noul == 0.95
    assert metric.score == 4
    assert metric.choice == "technology"
    assert metric.confidence == 0.92

    # API呼び出しの引数検証
    mock_client.system_one.assert_called_once()
    call_kwargs = mock_client.system_one.call_args.kwargs
    assert "小野" in call_kwargs["state"]
    assert "GIL" in call_kwargs["state"]
    assert "noul" in call_kwargs["questions"]
    assert "score" in call_kwargs["questions"]
    assert "choice" in call_kwargs["questions"]


def test_fact_check_auditor_sync_batch_multiple_chunks():
    """複数チャンクの非同期バッチ監査が同期インターフェースで正しく実行されること."""
    mock_client = AsyncMock()

    # 1つ目は軽微な言い間違い (深刻度 1 -> Jev 0始まりインデックス: 0.0)
    ans1 = {
        "noul": MagicMock(noul=0.1),
        "score": MagicMock(score=0.0, confidence=0.99),
        "choice": MagicMock(choice="other"),
    }
    # 2つ目は重大な誤認 (深刻度 4 -> Jev 0始まりインデックス: 3.0)
    ans2 = {
        "noul": MagicMock(noul=0.9),
        "score": MagicMock(score=3.0, confidence=0.85),
        "choice": MagicMock(choice="proper_noun"),
    }

    resp1 = MagicMock(answers=ans1)
    resp2 = MagicMock(answers=ans2)
    mock_client.system_one.side_effect = [resp1, resp2]

    auditor = FactCheckAuditor(client=mock_client)

    chunks = [
        UtteranceChunk("seg_00001", "数森", 0, 2000, "えーと、こんにちは。"),
        UtteranceChunk("seg_00002", "高島", 2100, 6000, "あのサービス、GoogleじゃなくてAppleが買収したんですよ。"),
    ]

    results = auditor.audit_chunks(chunks)

    assert len(results) == 2
    assert results[0][1].score == 1
    assert results[0][1].choice == "other"
    assert results[1][1].score == 4
    assert results[1][1].choice == "proper_noun"


@pytest.mark.anyio
async def test_fact_check_auditor_error_preserves_cause_and_details():
    """Jev API 呼び出し失敗時に ReviewIncompleteError にエラー種別が含まれること."""
    mock_client = AsyncMock()
    mock_client.system_one.side_effect = RuntimeError("Connection timed out to Jev gateway")

    auditor = FactCheckAuditor(client=mock_client)
    chunk = UtteranceChunk("seg_00001", "小野", 0, 1000, "テスト発話")

    with pytest.raises(ReviewIncompleteError) as exc_info:
        await auditor.audit_single_chunk_async(mock_client, chunk)

    assert "RuntimeError" in str(exc_info.value)


def test_fact_check_auditor_missing_api_key_raises_error(monkeypatch: pytest.MonkeyPatch):
    """APIキーが未設定の場合に明確なエラーを発生させること."""
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.delenv("JEV_API_KEY", raising=False)

    auditor = FactCheckAuditor(api_key=None)
    with pytest.raises(ReviewIncompleteError, match="TypeSafe \\(Jev\\) API key is missing"):
        auditor._get_client()


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("jev_score", "expected_domain_score"),
    [
        (0.0, 1),
        (0.4, 1),
        (0.6, 2),
        (1.0, 2),
        (1.8, 3),
        (2.0, 3),
        (3.0, 4),
        (3.7, 5),
        (4.0, 5),
    ],
)
async def test_fact_check_auditor_score_levels_mapping(jev_score: float, expected_domain_score: int):
    """Jev の 0 始まりスコア (0.0〜4.0) がドメイン深刻度 (1〜5) に正しくマッピングされること."""
    mock_client = AsyncMock()
    mock_resp = MagicMock(
        answers={
            "noul": MagicMock(noul=0.5),
            "score": MagicMock(score=jev_score, confidence=0.9),
            "choice": MagicMock(choice="technology"),
        }
    )
    mock_client.system_one.return_value = mock_resp
    auditor = FactCheckAuditor(client=mock_client)
    chunk = UtteranceChunk("seg_00001", "小野", 0, 1000, "テスト発話")

    _, metric = await auditor.audit_single_chunk_async(mock_client, chunk)
    assert metric.score == expected_domain_score


@pytest.mark.anyio
@pytest.mark.parametrize("invalid_score", [-0.5, 4.5, float("inf"), float("nan")])
async def test_fact_check_auditor_rejects_out_of_bounds_score(invalid_score: float):
    """Jev スコアが許容範囲外の場合に ReviewIncompleteError (ValueError) となること."""
    mock_client = AsyncMock()
    mock_resp = MagicMock(
        answers={
            "noul": MagicMock(noul=0.5),
            "score": MagicMock(score=invalid_score, confidence=0.9),
            "choice": MagicMock(choice="technology"),
        }
    )
    mock_client.system_one.return_value = mock_resp
    auditor = FactCheckAuditor(client=mock_client)
    chunk = UtteranceChunk("seg_00001", "小野", 0, 1000, "テスト発話")

    with pytest.raises(ReviewIncompleteError, match="ValueError"):
        await auditor.audit_single_chunk_async(mock_client, chunk)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("jitter_score", "expected_domain_score"),
    [
        (-0.00005, 1),
        (4.00005, 5),
    ],
)
async def test_fact_check_auditor_tolerates_numerical_jitter(jitter_score: float, expected_domain_score: int):
    """浮動小数点数の微小なジッター (tolerance 内) が許容されクランプされること."""
    mock_client = AsyncMock()
    mock_resp = MagicMock(
        answers={
            "noul": MagicMock(noul=0.5),
            "score": MagicMock(score=jitter_score, confidence=0.9),
            "choice": MagicMock(choice="technology"),
        }
    )
    mock_client.system_one.return_value = mock_resp
    auditor = FactCheckAuditor(client=mock_client)
    chunk = UtteranceChunk("seg_00001", "小野", 0, 1000, "テスト発話")

    _, metric = await auditor.audit_single_chunk_async(mock_client, chunk)
    assert metric.score == expected_domain_score


# --- Director Script Generator Tests ---


def test_director_script_generator_creates_intervention():
    """Score >= 3 のチャンクに対してディレクターのカットイン台詞が生成されること."""
    mock_genai_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = (
        '{"correction_script": "あ、小野さんちょっと待って! Python 3.12じゃなくて、'
        '無料化・実験的無効化は3.13ですよ〜!", "target_speaker": "小野", '
        '"insert_timestamp_ms": 4500, "reason": "GILの自由スレッド化が導入されたのはPython 3.13"}'
    )
    mock_genai_client.models.generate_content.return_value = mock_response

    generator = DirectorScriptGenerator(client=mock_genai_client)

    chunk = UtteranceChunk("seg_00001", "小野", 1000, 4500, "Python 3.12 で GIL なくなったよね")
    metric = FactCheckAuditMetric(noul=0.9, score=4, choice="technology", confidence=0.9)

    intervention = generator.generate_intervention(
        chunk=chunk,
        metric=metric,
        all_chunks=[chunk],
        cast_names=["小野", "数森", "高島"],
    )

    assert intervention.target_speaker == "小野"
    assert "小野さんちょっと待って" in intervention.correction_script
    assert intervention.insert_timestamp_ms == 4500
    assert intervention.status == "pending"
    assert intervention.audit_metrics.score == 4
    assert intervention.audit_metrics.choice == "technology"

    # Gemini 呼び出しのプロンプト検証
    prompt_used = mock_genai_client.models.generate_content.call_args.kwargs["contents"][0]
    assert "専属『AIディレクター』" in prompt_used
    assert "小野、数森、高島" in prompt_used
    assert "第4のパーソナリティ" in prompt_used


# --- Workflow Pipeline Routing Tests ---


class _FakeEpisodeRepository:
    def __init__(self):
        self.status = "upload_pending"
        self.auditing_called = False
        self.awaiting_approval_called = False
        self.completed_called = False
        self.failed_called = False

    def mark_processing(self, *, podcast_id: str, episode_id: str, source_audio_path: str) -> None:
        self.status = "processing"

    def mark_auditing(self, *, podcast_id: str, episode_id: str) -> None:
        self.auditing_called = True
        self.status = "auditing"

    def mark_awaiting_approval(self, *, podcast_id: str, episode_id: str) -> None:
        self.awaiting_approval_called = True
        self.status = "awaiting_approval"

    def mark_completed(self, **kwargs) -> None:
        self.completed_called = True
        self.status = "completed"

    def update_metadata(self, **kwargs) -> None:
        self.metadata_updated = True

    def mark_failed(self, **kwargs) -> None:
        self.failed_called = True
        self.status = "failed"

    def get_cast_names(self, *, podcast_id: str) -> list[str]:
        return ["小野", "数森", "高島"]

    def find_recording_speakers(self, *, episode_id: str):
        return None


class _FakeBlobSource:
    def download_blob_as_bytes(self, bucket: str, path: str) -> bytes:
        return b"fake-audio"


class _FakeObjectStorage:
    def __init__(self):
        self.uploads = []

    def download_file(self, key: str) -> bytes:
        return b"<rss><channel></channel></rss>"

    def upload_file(self, **kwargs) -> None:
        self.uploads.append(kwargs)

    def generate_public_url(self, remote_key: str, custom_domain: str | None = None) -> str:
        return f"https://cdn.example.com/{remote_key}"


class _FakeNotifier:
    def __init__(self):
        self.messages = []

    def send_discord_message(self, message: str) -> bool:
        self.messages.append(message)
        return True


class _FakeRssManager:
    def get_total_episodes(self) -> int:
        return 5

    def add_episode(self, data) -> None:
        pass

    def get_rss_xml(self) -> str:
        return "<rss></rss>"


class _FakeTranscription:
    def __init__(self, segments):
        self.segments = segments

    def run(self, **kwargs):
        return TranscriptionResult(
            minutes="## 要約\nテストエピソード\n## 【目次】\n0:00 オープニング",
            segments=self.segments,
            meta={"engine": "test"},
        )


class _FakeTranscriptProvider:
    def summarize_transcript(self, *args, **kwargs):
        return Summary(title="テストタイトル", description="テスト概要")

    def generate_sns_promotions(self, *args, **kwargs):
        return SnsPromotionsResponse(promotions=[])


def test_pipeline_routing_skips_score_below_3():
    """Score 3未満の言い間違いはスキップされ、Geminiを呼ばずに通常公開フローへ直行すること."""
    mock_auditor = MagicMock()
    # 全チャンクが Score < 3 (軽微な言い間違い、スルー可)
    mock_auditor.audit_chunks.return_value = [
        (
            UtteranceChunk("seg_00001", "小野", 0, 3000, "ちょっと言葉に詰まりました"),
            FactCheckAuditMetric(noul=0.1, score=1, choice="other"),
        ),
        (
            UtteranceChunk("seg_00002", "数森", 3100, 6000, "まあ大体そんな感じです"),
            FactCheckAuditMetric(noul=0.2, score=2, choice="technology"),
        ),
    ]

    mock_generator = MagicMock()
    repo = _FakeEpisodeRepository()
    storage = _FakeObjectStorage()
    notifier = _FakeNotifier()

    workflow = ProcessPodcastWorkflow(
        transcript_provider=_FakeTranscriptProvider(),
        object_storage=storage,
        blob_source=_FakeBlobSource(),
        notifier=notifier,
        rss_manager_factory=lambda *, rss_xml: _FakeRssManager(),
        audio_converter=lambda b, s: b"mp3",
        audio_info_reader=lambda buf, fmt: [100, "00:01:00"],
        firestore_manager=None,
        episode_repository=repo,
        logger=logging.getLogger("test"),
        transcription=_FakeTranscription(
            [
                TranscriptSegment(start=0.0, end=3.0, text="ちょっと言葉に詰まりました", speaker="小野"),
                TranscriptSegment(start=3.1, end=6.0, text="まあ大体そんな感じです", speaker="数森"),
            ]
        ),
        fact_check_auditor=mock_auditor,
        director_script_generator=mock_generator,
    )

    req = ProcessPodcastWorkflowInput(
        project_id="test-proj",
        sns_schedule_offset_hours=1,
        gcs_bucket="input-bucket",
        gcs_trigger_object_name="podcasts/p1/episodes/e1/source/audio.mp3",
        r2_bucket="out-bucket",
        r2_key_prefix="feed",
        ai_model_id="gemini-2.0-flash",
        r2_custom_domain="test.example.com",
    )

    workflow.run(req)

    # 監査は実行された
    assert repo.auditing_called is True
    # Score 3 未満なので Gemini ジェネレーターは呼ばれていない
    mock_generator.generate_intervention.assert_not_called()
    # 承認待ちにはならず、通常通り完了
    assert repo.awaiting_approval_called is False
    assert repo.completed_called is True
    assert repo.status == "completed"
    # 音声アップロードとRSS更新が実行された
    assert len(storage.uploads) >= 2


def test_pipeline_routing_routes_score_3_or_higher_to_gemini_and_awaits_approval():
    """Score 3以上の重大な誤認は Gemini へルーティングされ、awaiting_approval に更新されて公開がスキップされること."""
    mock_auditor = MagicMock()
    severe_chunk = UtteranceChunk("seg_00002", "高島", 3100, 6000, "あの会社は去年倒産しましたよ")
    severe_metric = FactCheckAuditMetric(noul=0.95, score=4, choice="proper_noun", confidence=0.9)

    mock_auditor.audit_chunks.return_value = [
        (
            UtteranceChunk("seg_00001", "小野", 0, 3000, "こんにちは"),
            FactCheckAuditMetric(noul=0.0, score=1, choice="other"),
        ),
        (severe_chunk, severe_metric),
    ]

    mock_generator = MagicMock()
    mock_intervention = DirectorIntervention.create(
        intervention_id="interv_123",
        chunk_id="seg_00002",
        target_speaker="高島",
        insert_timestamp_ms=6000,
        correction_script="高島さん! 倒産したのは別会社で、その会社は増益ですよ!",
        reason="企業情報の誤認",
        audit_metrics=severe_metric,
    )
    mock_generator.generate_intervention.return_value = mock_intervention

    repo = _FakeEpisodeRepository()
    storage = _FakeObjectStorage()
    notifier = _FakeNotifier()
    mock_firestore = MagicMock()

    workflow = ProcessPodcastWorkflow(
        transcript_provider=_FakeTranscriptProvider(),
        object_storage=storage,
        blob_source=_FakeBlobSource(),
        notifier=notifier,
        rss_manager_factory=lambda *, rss_xml: _FakeRssManager(),
        audio_converter=lambda b, s: b"mp3",
        audio_info_reader=lambda buf, fmt: [100, "00:01:00"],
        firestore_manager=mock_firestore,
        episode_repository=repo,
        logger=logging.getLogger("test"),
        transcription=_FakeTranscription(
            [
                TranscriptSegment(start=0.0, end=3.0, text="こんにちは", speaker="小野"),
                TranscriptSegment(start=3.1, end=6.0, text="あの会社は去年倒産しましたよ", speaker="高島"),
            ]
        ),
        fact_check_auditor=mock_auditor,
        director_script_generator=mock_generator,
    )

    req = ProcessPodcastWorkflowInput(
        project_id="test-proj",
        sns_schedule_offset_hours=1,
        gcs_bucket="input-bucket",
        gcs_trigger_object_name="podcasts/p1/episodes/e1/source/audio.mp3",
        r2_bucket="out-bucket",
        r2_key_prefix="feed",
        ai_model_id="gemini-2.0-flash",
        r2_custom_domain="test.example.com",
    )

    workflow.run(req)

    # 1. 監査が実行された
    assert repo.auditing_called is True
    # 2. Score >= 3 のチャンクのみ Gemini に渡された (1回のみ)
    assert mock_generator.generate_intervention.call_count == 1
    call_kwargs = mock_generator.generate_intervention.call_args.kwargs
    assert call_kwargs["chunk"].chunk_id == "seg_00002"
    assert call_kwargs["metric"].score == 4

    # 3. Firestore に director_interventions が保存された
    mock_firestore.save_director_interventions.assert_called_once()
    save_interventions_kwargs = mock_firestore.save_director_interventions.call_args.kwargs
    assert save_interventions_kwargs["podcast_id"] == "p1"
    assert save_interventions_kwargs["episode_id"] == "e1"
    assert len(save_interventions_kwargs["interventions"]) == 1
    assert save_interventions_kwargs["interventions"][0].intervention_id == "interv_123"

    # 4. エピソードステータスが awaiting_approval に更新された
    assert repo.awaiting_approval_called is True
    assert repo.status == "awaiting_approval"
    # 通常の公開処理(mark_completed, R2へのマスター音源アップロード, RSS更新)はスキップされた
    assert repo.completed_called is False
    assert len(storage.uploads) == 0


# --- Firestore Persistence Tests ---


def test_firestore_save_and_get_director_interventions():
    """生成された訂正原稿および監査メトリクスが Firestore の所定パスに正しく格納されること."""
    mock_client = MagicMock()
    mock_batch = MagicMock()
    mock_client.batch.return_value = mock_batch

    firestore_manager = FirestoreManager(project_id="test-proj", client=mock_client)

    metric = FactCheckAuditMetric(noul=0.92, score=3, choice="historical_fact", confidence=0.88)
    intervention = DirectorIntervention.create(
        intervention_id="int_001",
        chunk_id="seg_00005",
        target_speaker="数森",
        insert_timestamp_ms=15000,
        correction_script="あ、数森さん! それ1995年じゃなくて1998年ですね!",
        reason="年号の誤認",
        audit_metrics=metric,
    )

    count = firestore_manager.save_director_interventions(
        podcast_id="p_tech",
        episode_id="ep_42",
        interventions=[intervention],
    )

    assert count == 1
    mock_batch.commit.assert_called_once()

    # コレクションパスの検証
    col_call = mock_client.collection.call_args_list[0]
    assert col_call.args[0] == "podcasts"
