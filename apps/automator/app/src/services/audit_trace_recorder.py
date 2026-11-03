"""Jev 監査入出力トレースログ保存サービス (#220).

TypeSafe AI (Jev) 高速監査ゲートキーパーの入力プロンプト (state, questions)、
生出力レスポンス (raw_answers)、パース後メトリクス、音声校正ポリシー検知結果等を
アクセス制御された専用ストレージ (GCS バケット等) へ JSONL 形式で保存する。
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from google.cloud import storage

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from domain.models.director import AuditChunkTrace

logger = logging.getLogger(__name__)

DEFAULT_AUDIT_TRACE_PREFIX = "audit_traces"


class TraceStorage(Protocol):
    """トレースログ保存バックエンドの抽象インターフェース."""

    def save_trace(
        self,
        *,
        podcast_id: str,
        episode_id: str,
        content: str,
    ) -> str:
        """JSONL 形式のトレース文字列を保存し、保存先 URI / パスを返す."""


class GcsTraceStorage:
    """Google Cloud Storage 専用トレース保存バックエンド.

    オブジェクトパス: {prefix}/{podcast_id}/{episode_id}/trace.jsonl
    プレフィックスを統一することで GCS オブジェクトのライフサイクル管理 (例: TTL 90日削除) に対応可能。
    """

    def __init__(
        self,
        bucket_name: str,
        *,
        prefix: str = DEFAULT_AUDIT_TRACE_PREFIX,
        client: storage.Client | None = None,
    ) -> None:
        """Initialize GCS trace storage."""
        self._bucket_name = bucket_name
        self._prefix = prefix.strip("/")
        self._client = client

    def save_trace(
        self,
        *,
        podcast_id: str,
        episode_id: str,
        content: str,
    ) -> str:
        """GCS バケットへトレースをアップロードする."""
        client = self._client or storage.Client()
        object_name = f"{self._prefix}/{podcast_id}/{episode_id}/trace.jsonl"
        bucket = client.bucket(self._bucket_name)
        blob = bucket.blob(object_name)
        blob.upload_from_string(
            content,
            content_type="application/x-ndjson; charset=utf-8",
        )
        return f"gs://{self._bucket_name}/{object_name}"


class LocalTraceStorage:
    """ローカルファイルシステム用トレース保存バックエンド (開発・デバッグ用)."""

    def __init__(
        self,
        base_dir: str | Path,
        *,
        prefix: str = DEFAULT_AUDIT_TRACE_PREFIX,
    ) -> None:
        """Initialize local trace storage."""
        self._base_dir = Path(base_dir)
        self._prefix = prefix.strip("/")

    def save_trace(
        self,
        *,
        podcast_id: str,
        episode_id: str,
        content: str,
    ) -> str:
        """ローカルファイルにトレースを書き込む."""
        file_path = self._base_dir / self._prefix / podcast_id / episode_id / "trace.jsonl"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
        return str(file_path)


class InMemoryTraceStorage:
    """テスト用インメモリトレース保存バックエンド."""

    def __init__(self, *, prefix: str = DEFAULT_AUDIT_TRACE_PREFIX) -> None:
        """Initialize in-memory trace storage."""
        self._prefix = prefix.strip("/")
        self.traces: dict[str, str] = {}

    def save_trace(
        self,
        *,
        podcast_id: str,
        episode_id: str,
        content: str,
    ) -> str:
        """メモリ内ディクショナリにトレースを記録する."""
        key = f"{self._prefix}/{podcast_id}/{episode_id}/trace.jsonl"
        self.traces[key] = content
        return f"mem://{key}"


class AuditTraceRecorder:
    """全チャンクの Jev 監査入出力・判定メトリクスのトレースログを保存するレコーダー."""

    def __init__(
        self,
        *,
        storage: TraceStorage | None = None,
        enabled: bool = False,
        logger_instance: logging.Logger | None = None,
    ) -> None:
        """Initialize audit trace recorder."""
        self._storage = storage
        self._enabled = enabled
        self._logger = logger_instance or logger

    @property
    def is_enabled(self) -> bool:
        """トレース保存が有効かつストレージが利用可能か."""
        return self._enabled and self._storage is not None

    def record(
        self,
        *,
        podcast_id: str,
        episode_id: str,
        traces: Sequence[AuditChunkTrace],
    ) -> str | None:
        """監査トレース配列を 1行1チャンクの JSONL 形式にフォーマットして保存する.

        ストレージ書き込みで例外が発生しても、公開ワークフローを妨げないよう
        安全に例外をキャッチして None を返す。
        """
        if not self.is_enabled or self._storage is None:
            return None

        if not traces:
            self._logger.debug("No audit traces to record for %s/%s", podcast_id, episode_id)
            return None

        try:
            lines = [
                json.dumps(trace.to_dict(podcast_id=podcast_id, episode_id=episode_id), ensure_ascii=False)
                for trace in traces
            ]
            content = "\n".join(lines) + "\n"
            uri = self._storage.save_trace(
                podcast_id=podcast_id,
                episode_id=episode_id,
                content=content,
            )
            self._logger.info("Saved audit trace to %s (%d records)", uri, len(traces))
            return uri
        except Exception:  # noqa: BLE001 - storage failure must not block workflow
            self._logger.exception("Failed to save audit trace for %s/%s", podcast_id, episode_id)
            return None

    @classmethod
    def from_env(
        cls,
        environ: Mapping[str, str] | None = None,
        logger_instance: logging.Logger | None = None,
    ) -> AuditTraceRecorder:
        """環境変数から AuditTraceRecorder を初期化する."""
        env = os.environ if environ is None else environ
        enabled = env.get("AUDIT_TRACE_ENABLED", "false").lower() in ("true", "1")
        gcs_bucket = env.get("AUDIT_TRACE_GCS_BUCKET")
        local_dir = env.get("AUDIT_TRACE_LOCAL_DIR")
        prefix = env.get("AUDIT_TRACE_PREFIX", DEFAULT_AUDIT_TRACE_PREFIX)

        trace_storage: TraceStorage | None = None
        if gcs_bucket:
            trace_storage = GcsTraceStorage(bucket_name=gcs_bucket, prefix=prefix)
        elif local_dir:
            trace_storage = LocalTraceStorage(base_dir=local_dir, prefix=prefix)

        return cls(storage=trace_storage, enabled=enabled, logger_instance=logger_instance)
