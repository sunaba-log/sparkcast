"""Tests for AuditTraceRecorder and AuditChunkTrace (#220)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from domain.models import (
    AuditChunkTrace,
    FactCheckAuditMetric,
    PolicyFinding,
    UtteranceChunk,
)
from services.audit_trace_recorder import (
    AuditTraceRecorder,
    GcsTraceStorage,
    InMemoryTraceStorage,
    LocalTraceStorage,
)


def _sample_chunk() -> UtteranceChunk:
    return UtteranceChunk(
        chunk_id="seg_00001",
        speaker="話者1",
        start_ms=0,
        end_ms=4500,
        text="Python 3.12 で GIL が完全に削除されたんですよね。",
        is_complete_sentence=True,
        completion_reason="sentence_terminator",
    )


def _sample_metric() -> FactCheckAuditMetric:
    return FactCheckAuditMetric(
        noul=0.95,
        score=4,
        choice="technology",
        confidence=0.92,
        raw_response={
            "noul": 0.95,
            "score": 3.0,
            "choice": "technology",
            "confidence": 0.92,
        },
    )


def test_audit_chunk_trace_to_dict_schema():
    """トレースレコードの出力辞書が Issue #220 の仕様と完全一致すること."""
    chunk = _sample_chunk()
    metric = _sample_metric()
    state = f"話者: {chunk.speaker}\n発話: {chunk.text}\n注記: この発話は文末まで確認できた完結文です。"
    questions = {
        "noul": "客観的な事実主張が含まれていますか?",
        "score": "深刻度を評価してください。",
        "choice": "誤認のカテゴリを選択してください。",
    }

    trace = AuditChunkTrace.create(
        chunk=chunk,
        metric=metric,
        input_state=state,
        questions=questions,
        latency_ms=142,
        model="jev-default",
        policy_version="v1",
        podcast_id="podcast_123",
        episode_id="episode_456",
        timestamp="2026-10-10T18:30:00Z",
    )

    data = trace.to_dict()

    assert data["timestamp"] == "2026-10-10T18:30:00Z"
    assert data["podcast_id"] == "podcast_123"
    assert data["episode_id"] == "episode_456"
    assert data["chunk_id"] == "seg_00001"
    assert data["speaker"] == "話者1"
    assert data["start_ms"] == 0
    assert data["end_ms"] == 4500
    assert data["text"] == "Python 3.12 で GIL が完全に削除されたんですよね。"
    assert data["is_complete_sentence"] is True
    assert data["completion_reason"] == "sentence_terminator"
    assert data["input_state"] == state
    assert data["questions"] == questions
    assert data["raw_answers"] == {
        "noul": 0.95,
        "score": 3.0,
        "choice": "technology",
        "confidence": 0.92,
    }
    assert data["parsed_metric"] == {
        "noul": 0.95,
        "score": 4,
        "choice": "technology",
        "should_intervene": True,
    }
    assert data["policy_findings"] == []
    assert data["metadata"] == {
        "model": "jev-default",
        "latency_ms": 142,
        "policy_version": "v1",
    }


def test_audit_chunk_trace_with_policy_findings():
    """音声校正ポリシー検知結果が正しくトレースへ反映されること."""
    chunk = _sample_chunk()
    metric = _sample_metric()
    trace = AuditChunkTrace.create(
        chunk=chunk,
        metric=metric,
        input_state="state",
        questions={},
    )
    finding = PolicyFinding.create(
        chunk=chunk,
        category="confidential_information",
        source="presidio",
        policy_version="v2",
    )

    updated_trace = trace.with_policy_findings([finding], policy_version="v2")
    data = updated_trace.to_dict(podcast_id="p1", episode_id="e1")

    assert data["podcast_id"] == "p1"
    assert data["episode_id"] == "e1"
    assert len(data["policy_findings"]) == 1
    assert data["policy_findings"][0]["category"] == "confidential_information"
    assert data["metadata"]["policy_version"] == "v2"


def test_in_memory_trace_storage():
    """InMemoryTraceStorage でトレースが保存・検索できること."""
    storage = InMemoryTraceStorage(prefix="custom_traces")
    uri = storage.save_trace(
        podcast_id="pod1",
        episode_id="ep1",
        content='{"test": 1}\n',
    )
    assert uri == "mem://custom_traces/pod1/ep1/trace.jsonl"
    assert storage.traces["custom_traces/pod1/ep1/trace.jsonl"] == '{"test": 1}\n'


def test_local_trace_storage(tmp_path):
    """LocalTraceStorage で指定ディレクトリに JSONL ファイルが正しく作成されること."""
    storage = LocalTraceStorage(base_dir=tmp_path, prefix="audit_traces")
    file_path = storage.save_trace(
        podcast_id="pod1",
        episode_id="ep1",
        content='{"chunk": "001"}\n{"chunk": "002"}\n',
    )
    assert str(tmp_path) in file_path
    saved_file = tmp_path / "audit_traces" / "pod1" / "ep1" / "trace.jsonl"
    assert saved_file.exists()
    assert saved_file.read_text(encoding="utf-8") == '{"chunk": "001"}\n{"chunk": "002"}\n'


def test_gcs_trace_storage_calls_blob_upload():
    """GcsTraceStorage が GCS バケットの所定パスへ JSONL をアップロードすること."""
    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_blob = MagicMock()
    mock_client.bucket.return_value = mock_bucket
    mock_bucket.blob.return_value = mock_blob

    storage = GcsTraceStorage("test-audit-bucket", prefix="audit_traces", client=mock_client)
    uri = storage.save_trace(
        podcast_id="pod1",
        episode_id="ep1",
        content='{"chunk": 1}\n',
    )

    assert uri == "gs://test-audit-bucket/audit_traces/pod1/ep1/trace.jsonl"
    mock_client.bucket.assert_called_once_with("test-audit-bucket")
    mock_bucket.blob.assert_called_once_with("audit_traces/pod1/ep1/trace.jsonl")
    mock_blob.upload_from_string.assert_called_once_with(
        '{"chunk": 1}\n',
        content_type="application/x-ndjson; charset=utf-8",
    )


def test_audit_trace_recorder_records_jsonl():
    """AuditTraceRecorder が複数チャンクを 1行1チャンクの JSONL 形式で保存すること."""
    storage = InMemoryTraceStorage()
    recorder = AuditTraceRecorder(storage=storage, enabled=True)

    chunk1 = _sample_chunk()
    metric1 = _sample_metric()
    trace1 = AuditChunkTrace.create(chunk=chunk1, metric=metric1, input_state="state1", questions={})

    chunk2 = UtteranceChunk(
        chunk_id="seg_00002",
        speaker="話者2",
        start_ms=4600,
        end_ms=8000,
        text="それは 3.13 からの実験的導入ですね。",
    )
    metric2 = FactCheckAuditMetric(noul=0.1, score=1, choice="other")
    trace2 = AuditChunkTrace.create(chunk=chunk2, metric=metric2, input_state="state2", questions={})

    uri = recorder.record(podcast_id="podA", episode_id="epB", traces=[trace1, trace2])

    assert uri == "mem://audit_traces/podA/epB/trace.jsonl"
    content = storage.traces["audit_traces/podA/epB/trace.jsonl"]
    lines = [json.loads(line) for line in content.strip().split("\n")]
    assert len(lines) == 2
    assert lines[0]["chunk_id"] == "seg_00001"
    assert lines[0]["podcast_id"] == "podA"
    assert lines[0]["episode_id"] == "epB"
    assert lines[1]["chunk_id"] == "seg_00002"
    assert lines[1]["podcast_id"] == "podA"
    assert lines[1]["episode_id"] == "epB"


def test_audit_trace_recorder_disabled_does_nothing():
    """無効設定の場合、ストレージ書き込みは実行されず None が返ること."""
    storage = InMemoryTraceStorage()
    recorder = AuditTraceRecorder(storage=storage, enabled=False)

    trace = AuditChunkTrace.create(chunk=_sample_chunk(), metric=_sample_metric(), input_state="s", questions={})
    uri = recorder.record(podcast_id="p", episode_id="e", traces=[trace])

    assert uri is None
    assert len(storage.traces) == 0


def test_audit_trace_recorder_handles_storage_exception_gracefully():
    """ストレージ障害時でも例外を送出せず、None を返して公開停止を妨げないこと."""
    mock_storage = MagicMock()
    mock_storage.save_trace.side_effect = RuntimeError("GCS upload failed: permission denied")
    recorder = AuditTraceRecorder(storage=mock_storage, enabled=True)

    trace = AuditChunkTrace.create(chunk=_sample_chunk(), metric=_sample_metric(), input_state="s", questions={})
    # 例外が外へ漏れ出ないこと
    uri = recorder.record(podcast_id="p", episode_id="e", traces=[trace])
    assert uri is None


def test_audit_trace_recorder_from_env():
    """環境変数から AuditTraceRecorder が適切に設定されること."""
    # 1. 有効 + GCS バケット
    env1 = {
        "AUDIT_TRACE_ENABLED": "true",
        "AUDIT_TRACE_GCS_BUCKET": "my-audit-bucket",
    }
    rec1 = AuditTraceRecorder.from_env(env1)
    assert rec1.is_enabled is True
    assert isinstance(rec1._storage, GcsTraceStorage)
    assert rec1._storage._bucket_name == "my-audit-bucket"

    # 2. 有効 + ローカルパス
    env2 = {
        "AUDIT_TRACE_ENABLED": "1",
        "AUDIT_TRACE_LOCAL_DIR": "/tmp/debug_traces",
    }
    rec2 = AuditTraceRecorder.from_env(env2)
    assert rec2.is_enabled is True
    assert isinstance(rec2._storage, LocalTraceStorage)

    # 3. 無効 (デフォルト)
    env3 = {}
    rec3 = AuditTraceRecorder.from_env(env3)
    assert rec3.is_enabled is False

    # 4. 有効だがストレージ未指定
    env4 = {"AUDIT_TRACE_ENABLED": "true"}
    rec4 = AuditTraceRecorder.from_env(env4)
    assert rec4.is_enabled is False
