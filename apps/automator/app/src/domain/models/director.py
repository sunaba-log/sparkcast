"""AIディレクターによる高速監査と訂正介入のドメインモデル(#170)."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from collections.abc import Sequence

    from domain.models.transcript import TranscriptSegment

# エラー分類
ChoiceCategory = Literal[
    "technology",
    "proper_noun",
    "numerical_data",
    "historical_fact",
    "other",
]

PolicyFindingCategory = Literal["pii", "confidential_information", "third_party_risk"]
PolicyFindingSource = Literal["presidio", "jev"]


@dataclass(frozen=True)
class AudioAuditPolicy:
    """番組ごとの音声監査ポリシー。辞書変更は必ず version を更新する。."""

    version: str = "v1"
    confidential_terms: tuple[str, ...] = ()
    allowed_terms: tuple[str, ...] = ()


@dataclass(frozen=True)
class PolicyFinding:
    """公開前に人手判断を必要とする、時刻つき音声監査の検知結果。."""

    finding_id: str
    chunk_id: str
    category: PolicyFindingCategory
    source: PolicyFindingSource
    start_ms: int
    end_ms: int
    text: str
    entity_type: str | None = None
    policy_version: str = "v1"
    review_required: bool = True
    action: str = "silence"
    status: str = "pending"
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    @classmethod
    def create(
        cls,
        *,
        chunk: UtteranceChunk,
        category: PolicyFindingCategory,
        source: PolicyFindingSource,
        policy_version: str,
        entity_type: str | None = None,
    ) -> PolicyFinding:
        """Create a pending finding for the exact audited utterance."""
        return cls(
            finding_id=str(uuid.uuid4()),
            chunk_id=chunk.chunk_id,
            category=category,
            source=source,
            start_ms=chunk.start_ms,
            end_ms=chunk.end_ms,
            text=chunk.text,
            entity_type=entity_type,
            policy_version=policy_version,
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize the finding for Firestore."""
        return {
            "finding_id": self.finding_id,
            "chunk_id": self.chunk_id,
            "category": self.category,
            "source": self.source,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "text": self.text,
            "entity_type": self.entity_type,
            "policy_version": self.policy_version,
            "review_required": self.review_required,
            "action": self.action,
            "status": self.status,
            "created_at": self.created_at,
        }


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

MAX_UTTERANCE_CHUNK_DURATION_MS = 30_000
MAX_UTTERANCE_CHUNK_CHARACTERS = 500
_SENTENCE_END = re.compile(r"[。！？!?][」』”’）〕〉》】]*")  # noqa: RUF001
_WHITESPACE = re.compile(r"\s+")


ChunkCompletionReason = Literal[
    "sentence_terminator",
    "speaker_change",
    "transcript_end",
    "maximum_duration",
    "maximum_characters",
]


@dataclass(frozen=True)
class UtteranceChunk:
    """話者・時刻・構成元を持つ Jev 監査用の発話チャンク."""

    chunk_id: str
    speaker: str
    start_ms: int
    end_ms: int
    text: str
    speaker_id: str | None = None
    segment_ids: tuple[str, ...] = field(default=(), compare=False)
    is_complete_sentence: bool = field(default=True, compare=False)
    completion_reason: ChunkCompletionReason = field(default="sentence_terminator", compare=False)

    @classmethod
    def from_segment(cls, segment: TranscriptSegment, index: int) -> UtteranceChunk:
        """後方互換のため、単一の TranscriptSegment を監査チャンクへ変換する."""
        text = _WHITESPACE.sub(" ", segment.text).strip()
        sentence_end = _SENTENCE_END.search(text)
        is_complete_sentence = sentence_end is not None and sentence_end.end() == len(text)
        return cls(
            chunk_id=f"seg_{index:05d}",
            speaker=segment.speaker,
            speaker_id=segment.speaker_id,
            start_ms=round(segment.start * 1000),
            end_ms=round(segment.end * 1000),
            text=text,
            segment_ids=(f"seg_{index:05d}",),
            is_complete_sentence=is_complete_sentence,
            completion_reason="sentence_terminator" if is_complete_sentence else "transcript_end",
        )

    @classmethod
    def from_segments(cls, segments: Sequence[TranscriptSegment]) -> list[UtteranceChunk]:
        """同一話者の連続セグメントを完結文優先の監査チャンクに再構成する."""
        chunks: list[UtteranceChunk] = []
        buffer: list[tuple[int, TranscriptSegment, str]] = []

        def normalize(text: str) -> str:
            return _WHITESPACE.sub(" ", text).strip()

        def buffer_text() -> str:
            return " ".join(text for _, _, text in buffer)

        def append_chunk(
            source: list[tuple[int, TranscriptSegment, str]],
            text: str,
            reason: ChunkCompletionReason,
            *,
            complete: bool,
        ) -> None:
            if not source:
                return
            first_index, first_segment, _ = source[0]
            last_index, last_segment, _ = source[-1]
            chunk_id = (
                f"seg_{first_index:05d}" if first_index == last_index else f"seg_{first_index:05d}_{last_index:05d}"
            )
            if any(chunk.chunk_id == chunk_id for chunk in chunks):
                chunk_id = f"{chunk_id}_{len(chunks) + 1:05d}"
            chunks.append(
                cls(
                    chunk_id=chunk_id,
                    speaker=first_segment.speaker,
                    speaker_id=first_segment.speaker_id,
                    start_ms=round(first_segment.start * 1000),
                    end_ms=round(last_segment.end * 1000),
                    text=text,
                    segment_ids=tuple(f"seg_{index:05d}" for index, _, _ in source),
                    is_complete_sentence=complete,
                    completion_reason=reason,
                )
            )

        def flush(reason: ChunkCompletionReason, *, complete: bool) -> None:
            if not buffer:
                return
            append_chunk(buffer, buffer_text(), reason, complete=complete)
            buffer.clear()

        def flush_complete_sentences() -> None:
            while buffer:
                text = buffer_text()
                match = _SENTENCE_END.search(text)
                if match is None:
                    return

                consumed: list[tuple[int, TranscriptSegment, str]] = []
                remaining: list[tuple[int, TranscriptSegment, str]] = []
                prefix_end = match.end()
                cursor = 0
                for index, segment, segment_text in buffer:
                    segment_start = cursor
                    segment_end = segment_start + len(segment_text)
                    if segment_start < prefix_end:
                        consumed_length = min(len(segment_text), prefix_end - segment_start)
                        consumed_text = segment_text[:consumed_length].rstrip()
                        if consumed_text:
                            consumed.append((index, segment, consumed_text))
                        remaining_text = segment_text[consumed_length:].lstrip()
                        if remaining_text:
                            remaining.append((index, segment, remaining_text))
                    else:
                        remaining.append((index, segment, segment_text))
                    cursor = segment_end + 1

                append_chunk(consumed, text[:prefix_end].strip(), "sentence_terminator", complete=True)
                buffer[:] = remaining

        for index, segment in enumerate(segments, start=1):
            text = normalize(segment.text)
            if not text:
                continue

            if buffer:
                _, current_speaker, _ = buffer[0]
                same_speaker = (
                    current_speaker.speaker_id == segment.speaker_id
                    if current_speaker.speaker_id is not None and segment.speaker_id is not None
                    else current_speaker.speaker == segment.speaker
                )
                if not same_speaker:
                    flush("speaker_change", complete=False)
                elif round(segment.end * 1000) - round(buffer[0][1].start * 1000) > MAX_UTTERANCE_CHUNK_DURATION_MS:
                    flush("maximum_duration", complete=False)
                elif len(buffer_text()) + 1 + len(text) > MAX_UTTERANCE_CHUNK_CHARACTERS:
                    flush("maximum_characters", complete=False)

            buffer.append((index, segment, text))
            flush_complete_sentences()

        flush("transcript_end", complete=False)
        return chunks


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
class AuditBundle:
    """ファクトチェックと音声校正ポリシーを完全な一組として返す監査結果。."""

    fact_check_results: list[tuple[UtteranceChunk, FactCheckAuditMetric]]
    policy_findings: list[PolicyFinding]


@dataclass(frozen=True)
class EvidenceSource:
    """Web裏取りで取得した一次ソース情報."""

    title: str
    url: str
    snippet: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize evidence source for Firestore."""
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
        }


@dataclass(frozen=True)
class FactVerificationResult:
    """Verification Agent によるファクトチェック裏取り結果."""

    claim: str
    ground_truth: str
    sources: tuple[EvidenceSource, ...] = ()
    is_false: bool = True
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize fact verification result for Firestore."""
        return {
            "claim": self.claim,
            "ground_truth": self.ground_truth,
            "sources": [s.to_dict() for s in self.sources],
            "is_false": self.is_false,
            "reason": self.reason,
        }


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
    reference_url: str | None = None
    reference_links: tuple[dict[str, str], ...] = ()
    verification: FactVerificationResult | None = None
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
        reference_url: str | None = None,
        reference_links: tuple[dict[str, str], ...] | list[dict[str, str]] = (),
        verification: FactVerificationResult | None = None,
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
            reference_url=reference_url,
            reference_links=tuple(reference_links),
            verification=verification,
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
            "reference_url": self.reference_url,
            "reference_links": list(self.reference_links),
            "verification": self.verification.to_dict() if self.verification else None,
            "status": self.status,
            "audit_metrics": {
                "noul": self.audit_metrics.noul,
                "score": self.audit_metrics.score,
                "choice": self.audit_metrics.choice,
                "confidence": self.audit_metrics.confidence,
            },
            "created_at": self.created_at,
        }
