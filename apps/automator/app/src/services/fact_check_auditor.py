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
from typing import TYPE_CHECKING, cast

from typesafe_sdk import AsyncTypeSafeClient, Choice, Noul, Score

from domain.errors import ReviewIncompleteError
from domain.models.director import ChoiceCategory, FactCheckAuditMetric, UtteranceChunk

if TYPE_CHECKING:
    from typesafe_sdk._core.response_types import SystemOneResponse

logger = logging.getLogger(__name__)

# Jev 判定用の命令と選択基準の定義
NOUL_INSTRUCTIONS = (
    "この発言には客観的な事実に関する主張(検証可能な技術情報、仕様、数値、固有名詞、"
    "歴史的出来事など)が含まれていますか?単なる主観的な感想、挨拶、感情表現の場合はFalseです。"
)

SCORE_INSTRUCTIONS = (
    "発言内容に事実誤認や言い間違いが含まれていた場合、ポッドキャストのリスナーに与える誤解や混乱の深刻度を1〜5で評価してください。"
    "1: 軽微な言い間違いでスルー可能、3: リスナーに誤解を与えるため要訂正、5: 致命的な誤認で損害や混乱を招くため要訂正。"
    "事実に基づいている場合や、文脈上スルー可能な軽微な言いよどみは1と評価してください。"
)

SCORE_CRITERIA = [
    "1: 軽微な言い間違い/スルー可",
    "2: 軽微な誤り/文脈上問題なし",
    "3: 明確な事実誤認/要訂正",
    "4: 重大な誤認/信頼性に関わる",
    "5: 致命的な誤認/要訂正",
]

CHOICE_INSTRUCTIONS = "発言に含まれる事実の主張または誤認のカテゴリを選択してください。"

CHOICE_CRITERIA: dict[str, str] = {
    "technology": "技術仕様、プログラミング、アーキテクチャなどの誤り",
    "proper_noun": "製品名、企業名、人名などの固有名詞の誤り",
    "numerical_data": "数値、統計、価格、日付などのデータ誤り",
    "historical_fact": "歴史的事実、過去の経緯、時系列などの誤り",
    "other": "その他、一般的な事実関係の誤り",
}

VALID_CHOICES: set[str] = {"technology", "proper_noun", "numerical_data", "historical_fact", "other"}


def _bounded_number(value: object, minimum: float, maximum: float) -> float:
    """Reject missing, non-finite, or out-of-range model values."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("Invalid audit number")
    number = float(value)
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise ValueError("Audit number outside expected range")
    return number


class FactCheckAuditor:
    """TypeSafe AI (Jev) による高速ファクトチェック監査."""

    def __init__(
        self,
        *,
        client: AsyncTypeSafeClient | None = None,
        api_key: str | None = None,
        model: str | None = None,
        logger_instance: logging.Logger | None = None,
    ) -> None:
        """Initialize Jev client and configurations."""
        self._api_key = api_key or os.environ.get("TYPESAFE_API_KEY") or os.environ.get("JEV_API_KEY")
        self._model = model
        self._logger = logger_instance or logger
        self._client = client

    def _get_client(self) -> AsyncTypeSafeClient:
        if self._client is not None:
            return self._client
        if not self._api_key or not self._api_key.strip():
            raise ReviewIncompleteError(
                "TypeSafe (Jev) API key is missing. TYPESAFE_API_KEY または JEV_API_KEY を設定してください。"
            )
        return AsyncTypeSafeClient(api_key=self._api_key.strip(), model=self._model)

    async def audit_single_chunk_async(
        self,
        client: AsyncTypeSafeClient,
        chunk: UtteranceChunk,
    ) -> tuple[UtteranceChunk, FactCheckAuditMetric]:
        """1つの発話チャンクに対して Noul, Score, Choice を同時に並行評価する."""
        state = f"話者: {chunk.speaker}\n発話: {chunk.text}"
        questions = {
            "noul": Noul(instructions=NOUL_INSTRUCTIONS),
            "score": Score(instructions=SCORE_INSTRUCTIONS, criteria=SCORE_CRITERIA),
            "choice": Choice(instructions=CHOICE_INSTRUCTIONS, criteria=CHOICE_CRITERIA),
        }

        try:
            response: SystemOneResponse = await client.system_one(
                state=state,
                questions=questions,
                model=self._model,
            )
            metric = self._parse_response(response)
            return chunk, metric
        except Exception as error:  # noqa: BLE001 - all API/parse failures stop publication
            error_type = type(error).__name__
            self._logger.error(  # noqa: TRY400 - upstream payloads must not reach logs or notifications
                "Audit incomplete for chunk %s (%s)",
                chunk.chunk_id,
                error_type,
            )
            error_message = (
                f"公開前監査を完了できませんでした ({error_type})。設定・接続を確認して再実行してください。"
            )
            raise ReviewIncompleteError(error_message) from None

    def _parse_response(self, response: SystemOneResponse) -> FactCheckAuditMetric:
        """Validate the complete Jev response rather than assuming a low score."""
        answers = response.answers
        noul_val = _bounded_number(answers["noul"].noul, 0, 1)
        raw_score = _bounded_number(answers["score"].score, 1, 5)
        raw_choice = answers["choice"].choice
        if not isinstance(raw_choice, str) or raw_choice not in VALID_CHOICES:
            raise ValueError("Unknown audit category")
        confidence = getattr(answers["score"], "confidence", None)
        if confidence is not None:
            confidence = _bounded_number(confidence, 0, 1)

        return FactCheckAuditMetric(
            noul=noul_val,
            score=round(raw_score),
            choice=cast("ChoiceCategory", raw_choice),
            confidence=confidence,
        )

    async def audit_chunks_async(
        self,
        chunks: list[UtteranceChunk],
        *,
        concurrency_limit: int = 10,
    ) -> list[tuple[UtteranceChunk, FactCheckAuditMetric]]:
        """非同期バッチ処理でチャンク配列を並行監査する."""
        if not chunks:
            return []

        client = self._get_client()
        semaphore = asyncio.Semaphore(concurrency_limit)

        async def _bounded_audit(chunk: UtteranceChunk) -> tuple[UtteranceChunk, FactCheckAuditMetric]:
            async with semaphore:
                return await self.audit_single_chunk_async(client, chunk)

        tasks = [_bounded_audit(c) for c in chunks]
        results = await asyncio.gather(*tasks)
        return list(results)

    def audit_chunks(
        self,
        chunks: list[UtteranceChunk],
        *,
        concurrency_limit: int = 10,
    ) -> list[tuple[UtteranceChunk, FactCheckAuditMetric]]:
        """同期インターフェース: イベントループを利用して非同期バッチ監査を実行する."""
        if not chunks:
            return []

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # すでに実行中のイベントループがある環境(Jupyter等)の場合、新しいループを別スレッドで走らせる
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                return executor.submit(
                    asyncio.run,
                    self.audit_chunks_async(chunks, concurrency_limit=concurrency_limit),
                ).result()

        return asyncio.run(self.audit_chunks_async(chunks, concurrency_limit=concurrency_limit))
