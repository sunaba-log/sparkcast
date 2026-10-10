"""TypeSafe AI (Jev) 高速監査ゲートキーパー (#170).

発話チャンク配列を受け取り、TypeSafe AI「Jev」の3つの型付き判定
(Noul, Score, Choice) を非同期バッチで高速並行実行する。
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import math
import os
import time
from typing import TYPE_CHECKING, Any, cast

from typesafe_sdk import AsyncTypeSafeClient, Choice, Noul, Score

from domain.errors import ReviewIncompleteError
from domain.models.director import (
    AudioAuditPolicy,
    AuditBundle,
    AuditChunkTrace,
    ChoiceCategory,
    FactCheckAuditMetric,
    PolicyFinding,
    PolicyFindingCategory,
    UtteranceChunk,
)
from services.pii_detector import PresidioPiiDetector

if TYPE_CHECKING:
    from typesafe_sdk._core.response_types import SystemOneResponse

logger = logging.getLogger(__name__)

# Jev 判定用の命令と選択基準の定義 (英語最適化・トークン削減版 / ポリシーキー維持)

# 1. ファクトチェック対象のフィルタリング
NOUL_INSTRUCTIONS = (
    "Does the statement contain verifiable facts (e.g., tech specs, proper nouns, metrics)? "
    "Return False if it only contains subjective opinions, greetings, or impressions."
)

# 2. 深刻度評価
SCORE_INSTRUCTIONS = (
    "Fact-check the statement and rate the necessity of a correction from 1 to 5 based on potential listener harm or misunderstanding. "
    "If the statement is accurate or contains only negligible slips of the tongue, you MUST rate it 1."
)

SCORE_CRITERIA = [
    "1: Accurate, or negligible slip of the tongue (ignore)",
    "2: Minor error, easily deduced from context",
    "3: Clear factual error causing misunderstanding (requires correction)",
    "4: Major error damaging credibility (requires correction)",
    "5: Fatal misrepresentation causing harm/loss (immediate correction)",
]

# 3. カテゴリ選択
CHOICE_INSTRUCTIONS = "Select the category of the factual claim or error in the statement."

CHOICE_CRITERIA: dict[str, str] = {
    "technology": "Tech specs, architecture, programming",
    "proper_noun": "Product, company, or person names",
    "numerical_data": "Numbers, statistics, prices, dates",
    "other": "Other general facts",
    "none": "No errors / Not applicable",
}

VALID_CHOICES: set[str] = {"technology", "proper_noun", "numerical_data", "other", "none"}
POLICY_FINDING_NOUL_THRESHOLD = 0.5

# 4. ポリシーチェック(キーを維持しつつ英語化でトークン圧縮)
POLICY_QUESTIONS = {
    "confidential_information": (
        "Does the statement contain confidential info like undisclosed credentials, "
        "trade secrets, contract terms, or private personal data?"
    ),
    "third_party_risk": (
        "Does the statement contain identifiable slander, unverified accusations, "
        "or content harming a third party's reputation/privacy that requires manual review?"
    ),
}


def _bounded_number(
    value: object,
    minimum: float,
    maximum: float,
    *,
    tolerance: float = 1e-4,
) -> float:
    """Reject missing, non-finite, or out-of-range model values with a small margin for numerical jitter."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("Invalid audit number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Audit number is not finite")
    if number < minimum - tolerance or number > maximum + tolerance:
        msg = f"Audit number outside expected range [{minimum}, {maximum}]: {number}"
        raise ValueError(msg)
    return max(minimum, min(maximum, number))


class FactCheckAuditor:
    """TypeSafe AI (Jev) による高速ファクトチェック監査."""

    def __init__(
        self,
        *,
        client: AsyncTypeSafeClient | None = None,
        api_key: str | None = None,
        model: str | None = None,
        pii_detector: PresidioPiiDetector | None = None,
        logger_instance: logging.Logger | None = None,
    ) -> None:
        """Initialize Jev client and configurations."""
        self._api_key = api_key or os.environ.get("TYPESAFE_API_KEY") or os.environ.get("JEV_API_KEY")
        self._model = model
        self._logger = logger_instance or logger
        self._client = client
        self._pii_detector = pii_detector
        self._last_traces: list[AuditChunkTrace] = []

    @property
    def last_traces(self) -> list[AuditChunkTrace]:
        """直近の監査実行で収集されたトレース記録一覧."""
        return list(self._last_traces)

    def _get_client(self) -> AsyncTypeSafeClient:
        if self._client is not None:
            return self._client
        if not self._api_key or not self._api_key.strip():
            raise ReviewIncompleteError(
                "TypeSafe (Jev) API key is missing. TYPESAFE_API_KEY または JEV_API_KEY を設定してください。"
            )
        return AsyncTypeSafeClient(api_key=self._api_key.strip(), model=self._model)

    async def _audit_single_chunk_with_trace(
        self,
        client: AsyncTypeSafeClient,
        chunk: UtteranceChunk,
    ) -> tuple[UtteranceChunk, FactCheckAuditMetric, AuditChunkTrace]:
        """1つの発話チャンクを評価し、メトリクスとトレース記録を生成する."""
        completion_note = (
            "この発話は文末まで確認できた完結文です。"
            if chunk.is_complete_sentence
            else "この発話は話者交替・文字起こし末尾・上限で切れている可能性があります。"
        )
        state = f"話者: {chunk.speaker}\n発話: {chunk.text}\n注記: {completion_note}"
        questions = {
            "noul": Noul(instructions=NOUL_INSTRUCTIONS),
            "score": Score(instructions=SCORE_INSTRUCTIONS, criteria=SCORE_CRITERIA),
            "choice": Choice(instructions=CHOICE_INSTRUCTIONS, criteria=CHOICE_CRITERIA),
        }

        try:
            start_time = time.perf_counter()
            response: SystemOneResponse = await client.system_one(
                state=state,
                questions=questions,
                model=self._model,
            )
            latency_ms = round((time.perf_counter() - start_time) * 1000)
            metric = self._parse_response(response)
            resp_model = getattr(response, "model", None)
            model_name = resp_model if isinstance(resp_model, str) and resp_model else (self._model or "jev-default")
            trace = AuditChunkTrace.create(
                chunk=chunk,
                metric=metric,
                input_state=state,
                questions={
                    "noul": NOUL_INSTRUCTIONS,
                    "score": SCORE_INSTRUCTIONS,
                    "choice": CHOICE_INSTRUCTIONS,
                },
                latency_ms=latency_ms,
                model=model_name,
            )
            return chunk, metric, trace
        except Exception as error:  # noqa: BLE001 - all API/parse failures stop publication
            error_type = type(error).__name__
            detail = str(error) if isinstance(error, (ValueError, TypeError)) else "upstream failure"
            self._logger.error(  # noqa: TRY400 - upstream payloads must not reach logs or notifications
                "Audit incomplete for chunk %s (%s: %s)",
                chunk.chunk_id,
                error_type,
                detail,
            )
            error_message = f"公開前監査を完了できませんでした ({error_type})。設定・接続を確認して再実行してください。"
            raise ReviewIncompleteError(error_message) from None

    async def audit_single_chunk_async(
        self,
        client: AsyncTypeSafeClient,
        chunk: UtteranceChunk,
    ) -> tuple[UtteranceChunk, FactCheckAuditMetric]:
        """1つの発話チャンクに対して Noul, Score, Choice を同時に並行評価する."""
        chunk, metric, trace = await self._audit_single_chunk_with_trace(client, chunk)
        self._last_traces = [trace]
        return chunk, metric

    def _parse_response(self, response: SystemOneResponse) -> FactCheckAuditMetric:
        """Validate the complete Jev response rather than assuming a low score."""
        answers = response.answers
        if "noul" not in answers or "score" not in answers or "choice" not in answers:
            raise ValueError("Incomplete audit response: missing required answer")

        noul_raw = getattr(answers["noul"], "noul", None)
        noul_val = _bounded_number(noul_raw, 0.0, 1.0)

        # TypeSafe AI (Jev) Score primitive:
        # criteria is an ordered list indexed 0 to (len - 1), and score is the probability-weighted average
        # along these rubric levels (0.0 to len(SCORE_CRITERIA) - 1).
        # We validate against [0.0, max_index], then map to 1-based severity score:
        # Expected value on 1..5 scale is: raw_score (0-based) + 1.0.
        max_score_idx = float(len(SCORE_CRITERIA) - 1)
        score_raw = getattr(answers["score"], "score", None)
        raw_score = _bounded_number(score_raw, 0.0, max_score_idx)
        domain_score = round(raw_score + 1.0)
        domain_score = max(1, min(len(SCORE_CRITERIA), domain_score))

        raw_choice = getattr(answers["choice"], "choice", None)
        if not isinstance(raw_choice, str) or raw_choice not in VALID_CHOICES:
            msg = f"Unknown audit category: {raw_choice}"
            raise ValueError(msg)

        confidence = getattr(answers["score"], "confidence", None)
        if confidence is not None:
            confidence = _bounded_number(confidence, 0.0, 1.0)

        raw_answers: dict[str, Any] = {
            "noul": noul_val,
            "score": raw_score,
            "choice": raw_choice,
        }
        if confidence is not None:
            raw_answers["confidence"] = confidence

        return FactCheckAuditMetric(
            noul=noul_val,
            score=domain_score,
            choice=cast("ChoiceCategory", raw_choice),
            confidence=confidence,
            raw_response=raw_answers,
        )

    async def audit_chunks_with_traces_async(
        self,
        chunks: list[UtteranceChunk],
        *,
        concurrency_limit: int = 10,
    ) -> tuple[list[tuple[UtteranceChunk, FactCheckAuditMetric]], list[AuditChunkTrace]]:
        """非同期バッチ処理でチャンク配列を並行監査し、評価メトリクスとトレース記録を返す."""
        if not chunks:
            self._last_traces = []
            return [], []

        client = self._get_client()
        semaphore = asyncio.Semaphore(concurrency_limit)

        async def _bounded_audit(
            chunk: UtteranceChunk,
        ) -> tuple[UtteranceChunk, FactCheckAuditMetric, AuditChunkTrace]:
            async with semaphore:
                return await self._audit_single_chunk_with_trace(client, chunk)

        tasks = [_bounded_audit(c) for c in chunks]
        triplets = await asyncio.gather(*tasks)
        results = [(c, m) for c, m, _ in triplets]
        traces = [t for _, _, t in triplets]
        self._last_traces = traces
        return results, traces

    async def audit_chunks_async(
        self,
        chunks: list[UtteranceChunk],
        *,
        concurrency_limit: int = 10,
    ) -> list[tuple[UtteranceChunk, FactCheckAuditMetric]]:
        """非同期バッチ処理でチャンク配列を並行監査する."""
        results, _ = await self.audit_chunks_with_traces_async(chunks, concurrency_limit=concurrency_limit)
        return results

    def audit_chunks_with_traces(
        self,
        chunks: list[UtteranceChunk],
        *,
        concurrency_limit: int = 10,
    ) -> tuple[list[tuple[UtteranceChunk, FactCheckAuditMetric]], list[AuditChunkTrace]]:
        """同期インターフェース: イベントループを利用して非同期バッチ監査とトレース収集を実行する."""
        if not chunks:
            self._last_traces = []
            return [], []

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                return executor.submit(
                    asyncio.run,
                    self.audit_chunks_with_traces_async(chunks, concurrency_limit=concurrency_limit),
                ).result()

        return asyncio.run(self.audit_chunks_with_traces_async(chunks, concurrency_limit=concurrency_limit))

    def audit_chunks(
        self,
        chunks: list[UtteranceChunk],
        *,
        concurrency_limit: int = 10,
    ) -> list[tuple[UtteranceChunk, FactCheckAuditMetric]]:
        """同期インターフェース: イベントループを利用して非同期バッチ監査を実行する."""
        results, _ = self.audit_chunks_with_traces(chunks, concurrency_limit=concurrency_limit)
        return results

    def audit_bundle(
        self,
        chunks: list[UtteranceChunk],
        *,
        policy: AudioAuditPolicy,
        concurrency_limit: int = 10,
    ) -> AuditBundle:
        """Run the compatible fact check plus the fail-closed audio policy audit."""
        fact_check_results, traces = self.audit_chunks_with_traces(chunks, concurrency_limit=concurrency_limit)
        detector = self._pii_detector or PresidioPiiDetector()
        policy_findings: list[PolicyFinding] = []
        for chunk in chunks:
            policy_findings.extend(
                PolicyFinding.create(
                    chunk=chunk,
                    category="pii",
                    source="presidio",
                    policy_version=policy.version,
                    entity_type=entity.entity_type,
                )
                for entity in detector.detect(chunk, policy)
            )
            allowed = {term.casefold() for term in policy.allowed_terms}
            if any(
                term and term.casefold() not in allowed and term.casefold() in chunk.text.casefold()
                for term in policy.confidential_terms
            ):
                policy_findings.append(
                    PolicyFinding.create(
                        chunk=chunk,
                        category="confidential_information",
                        source="presidio",
                        policy_version=policy.version,
                        entity_type="CUSTOM_TERM",
                    )
                )
        policy_findings.extend(self._audit_jev_policy_questions(chunks, policy))

        findings_by_chunk: dict[str, list[PolicyFinding]] = {}
        for finding in policy_findings:
            findings_by_chunk.setdefault(finding.chunk_id, []).append(finding)

        updated_traces = [
            trace.with_policy_findings(
                findings_by_chunk.get(trace.chunk_id, []),
                policy_version=policy.version,
            )
            for trace in traces
        ]
        self._last_traces = updated_traces

        return AuditBundle(
            fact_check_results=fact_check_results,
            policy_findings=policy_findings,
            traces=updated_traces,
        )

    def _audit_jev_policy_questions(
        self,
        chunks: list[UtteranceChunk],
        policy: AudioAuditPolicy,
    ) -> list[PolicyFinding]:
        """Run both required typed Noul policy questions and reject partial responses."""
        if not chunks:
            return []

        async def audit() -> list[PolicyFinding]:
            client = self._get_client()

            async def one(chunk: UtteranceChunk) -> list[PolicyFinding]:
                try:
                    response: SystemOneResponse = await client.system_one(
                        state=f"話者: {chunk.speaker}\n発話: {chunk.text}",
                        questions={
                            category: Noul(instructions=instructions)
                            for category, instructions in POLICY_QUESTIONS.items()
                        },
                        model=self._model,
                    )
                    answers = response.answers
                    if set(answers) != set(POLICY_QUESTIONS):
                        raise ValueError("Incomplete policy audit response")
                    findings: list[PolicyFinding] = []
                    for category in POLICY_QUESTIONS:
                        value = _bounded_number(getattr(answers[category], "noul", None), 0.0, 1.0)
                        if value >= POLICY_FINDING_NOUL_THRESHOLD:
                            findings.append(
                                PolicyFinding.create(
                                    chunk=chunk,
                                    category=cast("PolicyFindingCategory", category),
                                    source="jev",
                                    policy_version=policy.version,
                                )
                            )
                    return findings
                except Exception as error:  # noqa: BLE001 - policy audit must fail closed
                    self._logger.exception(
                        "Policy audit incomplete for chunk %s (%s)",
                        chunk.chunk_id,
                        type(error).__name__,
                    )
                    raise ReviewIncompleteError("音声校正ポリシー監査を完了できませんでした。") from None

            results = await asyncio.gather(*(one(chunk) for chunk in chunks))
            return [finding for result in results for finding in result]

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                return executor.submit(asyncio.run, audit()).result()
        return asyncio.run(audit())
