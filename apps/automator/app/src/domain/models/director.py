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

# 客観的事実主張と判定する最小のNoul閾値(感想・挨拶・相槌の除外)
MIN_FACT_NOUL_THRESHOLD: float = 0.6

# 軽微な誤り(Score 2)でもリスナーへの誤解防止のため訂正介入を検討する重要カテゴリ
CRITICAL_INTERVENTION_CATEGORIES: frozenset[ChoiceCategory] = frozenset(
    {
        "technology",
        "numerical_data",
        "proper_noun",
    }
)

# Score 2 の軽微な誤りにおいて、重要カテゴリで介入するための高いNoul確信度閾値
HIGH_CONFIDENCE_FACT_NOUL_THRESHOLD: float = 0.8

# 事実誤認判定スコアの定数
BENIGN_SCORE_THRESHOLD: int = 1
MINOR_ERROR_SCORE: int = 2
SEVERE_ERROR_MIN_SCORE: int = 3


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

    def should_intervene(
        self,
        *,
        min_noul: float = MIN_FACT_NOUL_THRESHOLD,
        high_noul: float = HIGH_CONFIDENCE_FACT_NOUL_THRESHOLD,
        critical_categories: frozenset[ChoiceCategory] = CRITICAL_INTERVENTION_CATEGORIES,
    ) -> bool:
        """Noul (事実性), score (深刻度), choice (カテゴリ) を組み合わせた複合介入判定.

        1. 客観的事実主張の確率 (noul) が基準値未満(感想・挨拶・比喩など)は除外。
        2. Score 3以上(明確・重大な事実誤認)かつ noul >= min_noul は介入対象。
        3. Score 2(軽微な誤り/グレーゾーン)でも、厳密性が求められる重要カテゴリ
           (technology, numerical_data, proper_noun) かつ noul >= high_noul であれば
           リスナーへの誤解・信頼性低下防止のため介入対象とする。
        4. Score 1(スルー可/事実に基づく)は常に介入不要。
        """
        if self.score <= BENIGN_SCORE_THRESHOLD:
            return False

        if self.noul < min_noul:
            return False

        if self.score >= SEVERE_ERROR_MIN_SCORE:
            return True

        return self.score == MINOR_ERROR_SCORE and self.choice in critical_categories and self.noul >= high_noul


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
