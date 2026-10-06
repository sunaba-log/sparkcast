"""AIディレクターによる高速監査と訂正介入のドメインモデル(#170)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from domain.models.transcript import TranscriptSegment

# エラー分類
ChoiceCategory = Literal[
    "technology",
    "proper_noun",
    "numerical_data",
    "historical_fact",
    "other",
]


@dataclass(frozen=True)
class UtteranceChunk:
    """話者とミリ秒単位タイムスタンプを持つ発話チャンク."""

    chunk_id: str
    speaker: str
    start_ms: int
    end_ms: int
    text: str
    speaker_id: str | None = None

    @classmethod
    def from_segment(cls, segment: TranscriptSegment, index: int) -> UtteranceChunk:
        """TranscriptSegment からミリ秒タイムスタンプ付きチャンクを生成する."""
        return cls(
            chunk_id=f"seg_{index:05d}",
            speaker=segment.speaker,
            speaker_id=segment.speaker_id,
            start_ms=round(segment.start * 1000),
            end_ms=round(segment.end * 1000),
            text=segment.text,
        )


@dataclass(frozen=True)
class FactCheckAuditMetric:
    """TypeSafe AI (Jev) による型付き判定メトリクス."""

    noul: float  # 0.0〜1.0 (客観的事実主張の確率)
    score: int  # 1〜5 (深刻度: 1=軽微な言い間違い/スルー可 〜 5=致命的な誤認/要訂正)
    choice: ChoiceCategory  # technology, proper_noun, numerical_data, historical_fact, other
    confidence: float | None = None
    raw_response: dict[str, Any] | None = None


@dataclass(frozen=True)
class DirectorIntervention:
    """AIディレクターによる訂正介入スクリプト."""

    intervention_id: str
    chunk_id: str
    target_speaker: str
    insert_timestamp_ms: int
    correction_script: str
    reason: str
    audit_metrics: FactCheckAuditMetric
    status: str = "pending"
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    @classmethod
    def create(
        cls,
        *,
        chunk_id: str,
        target_speaker: str,
        insert_timestamp_ms: int,
        correction_script: str,
        reason: str,
        audit_metrics: FactCheckAuditMetric,
        status: str = "pending",
        intervention_id: str | None = None,
        created_at: str | None = None,
    ) -> DirectorIntervention:
        """新規ディレクター介入モデルを構築する."""
        return cls(
            intervention_id=intervention_id or str(uuid.uuid4()),
            chunk_id=chunk_id,
            target_speaker=target_speaker,
            insert_timestamp_ms=insert_timestamp_ms,
            correction_script=correction_script,
            reason=reason,
            audit_metrics=audit_metrics,
            status=status,
            created_at=created_at or datetime.now(UTC).isoformat(),
        )

    def to_dict(self) -> dict[str, Any]:
        """Firestore 等のシリアライズ用辞書を返す."""
        return {
            "intervention_id": self.intervention_id,
            "chunk_id": self.chunk_id,
            "target_speaker": self.target_speaker,
            "insert_timestamp_ms": self.insert_timestamp_ms,
            "correction_script": self.correction_script,
            "reason": self.reason,
            "status": self.status,
            "audit_metrics": {
                "noul": self.audit_metrics.noul,
                "score": self.audit_metrics.score,
                "choice": self.audit_metrics.choice,
                "confidence": self.audit_metrics.confidence,
            },
            "created_at": self.created_at,
        }
