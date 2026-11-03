"""Google Search Grounding を活用した自律ファクトチェック裏取りエージェント.

Jev (TypeSafe AI) で事実誤認の疑い (Score >= 3 等) が検出された発話に対し、
Google Search ツールを自律実行して一次ソースURLと客観的事実 (Ground Truth) を収集する。
"""

from __future__ import annotations

import logging
import os
import re

from google import genai
from google.genai import types

from domain.models.director import (
    EvidenceSource,
    FactCheckAuditMetric,
    FactVerificationResult,
    UtteranceChunk,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "gemini-2.0-flash-001"
DEFAULT_LOCATION = "us-central1"

VERIFICATION_PROMPT_TEMPLATE = """\
あなたはポッドキャストの技術ファクトチェックを専門に行う『Verification Agent (裏取り自律エージェント)』です。
パーソナリティの発言に事実誤認の疑い (カテゴリ: {choice}) が検出されました。
Google Search ツールを用いて最新の公式ドキュメント、リリースノート、信頼できる一次情報を自律検索し、
この発言が客観的事実と一致しているか徹底的に裏取り検証を行ってください。

--- 前後の会話文脈 ---
{context_text}

--- 検証対象の発話 ---
話者: {speaker}
発言内容: {text}
検出カテゴリ: {choice}
深刻度スコア: {score}/5

【検証の手順】
1. 発言の中から、検証対象となる客観的・反証可能な事実の命題 (Claim) を特定してください。
2. Google Search ツールを利用して、公式の一次情報 (GitHub、公式サイト、開発元ドキュメント、大手技術メディア等) を検索してください。
3. 検索された最新の事実と照合し、以下のフォーマットで必ず出力してください:

【命題】検証対象の具体的命題
【判定】誤り (または 正しい / 判断不能)
【正しい事実】客観的に裏付けられた正しい事実 (Ground Truth) を1〜2文で記述
【理由】発言の何が事実と異なっているかの端的な解説
"""

_CLAIM_PATTERN = re.compile(r"【命題】\s*(.*?)(?=\n【|\Z)", re.DOTALL)
_JUDGMENT_PATTERN = re.compile(r"【判定】\s*(.*?)(?=\n【|\Z)", re.DOTALL)
_GROUND_TRUTH_PATTERN = re.compile(r"【正しい事実】\s*(.*?)(?=\n【|\Z)", re.DOTALL)
_REASON_PATTERN = re.compile(r"【理由】\s*(.*?)(?=\n【|\Z)", re.DOTALL)


class FactVerificationAgent:
    """Google Search による自律ファクトチェック裏取りエージェント."""

    def __init__(
        self,
        *,
        project_id: str | None = None,
        location: str | None = None,
        client: genai.Client | None = None,
        model_id: str | None = None,
        logger_instance: logging.Logger | None = None,
    ) -> None:
        """Initialize verification agent."""
        self._project_id = project_id or os.environ.get("GOOGLE_CLOUD_PROJECT")
        self._location = location or os.environ.get("GOOGLE_CLOUD_REGION", DEFAULT_LOCATION)
        self._model_id = model_id or DEFAULT_MODEL_ID
        self._logger = logger_instance or logger

        if client is not None:
            self._client = client
        elif self._project_id:
            self._client = genai.Client(vertexai=True, project=self._project_id, location=self._location)
        else:
            self._client = None

    def _get_client(self) -> genai.Client:
        if self._client is not None:
            return self._client
        project_id = self._project_id or os.environ.get("GOOGLE_CLOUD_PROJECT")
        if not project_id:
            msg = "project_id must be provided or set in GOOGLE_CLOUD_PROJECT env var"
            raise ValueError(msg)
        return genai.Client(vertexai=True, project=project_id, location=self._location)

    def verify_chunk(
        self,
        *,
        chunk: UtteranceChunk,
        metric: FactCheckAuditMetric,
        all_chunks: list[UtteranceChunk],
        model_id: str | None = None,
    ) -> FactVerificationResult | None:
        """疑義のある発話チャンクに対して自律的にGoogle検索を実行し、裏取り検証を行う."""
        client = self._get_client()
        active_model_id = model_id or self._model_id

        # 前後3チャンクの会話文脈を抽出
        target_idx = -1
        for idx, c in enumerate(all_chunks):
            if c.chunk_id == chunk.chunk_id:
                target_idx = idx
                break

        if target_idx >= 0:
            start_idx = max(0, target_idx - 3)
            end_idx = min(len(all_chunks), target_idx + 4)
            context_chunks = all_chunks[start_idx:end_idx]
        else:
            context_chunks = [chunk]

        context_text = "\n".join(
            f"[{c.start_ms}ms] {c.speaker}: {c.text}" + (" (★検証対象)" if c.chunk_id == chunk.chunk_id else "")
            for c in context_chunks
        )

        prompt = VERIFICATION_PROMPT_TEMPLATE.format(
            speaker=chunk.speaker,
            text=chunk.text,
            choice=metric.choice,
            score=metric.score,
            context_text=context_text,
        )

        try:
            self._logger.info("FactVerificationAgent: Verifying chunk %s with Google Search...", chunk.chunk_id)
            response = client.models.generate_content(
                model=active_model_id,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=0.2,
                ),
            )

            text_output = response.text or ""

            # 一次ソースURL (Grounding Metadata) の抽出
            sources: list[EvidenceSource] = []
            seen_urls: set[str] = set()

            if response.candidates and response.candidates[0].grounding_metadata:
                grounding_chunks = response.candidates[0].grounding_metadata.grounding_chunks or []
                for g_chunk in grounding_chunks:
                    if g_chunk.web and g_chunk.web.uri:
                        uri = str(g_chunk.web.uri).strip()
                        if uri and uri not in seen_urls:
                            seen_urls.add(uri)
                            title = str(g_chunk.web.title or uri).strip()
                            sources.append(EvidenceSource(title=title, url=uri))

            self._logger.info(
                "FactVerificationAgent: Retrieved %d primary sources for chunk %s",
                len(sources),
                chunk.chunk_id,
            )

            # パース処理
            claim_match = _CLAIM_PATTERN.search(text_output)
            claim = claim_match.group(1).strip() if claim_match else chunk.text

            judgment_match = _JUDGMENT_PATTERN.search(text_output)
            judgment_text = judgment_match.group(1).strip() if judgment_match else "誤り"
            is_false = not ("正しい" in judgment_text and "誤り" not in judgment_text)

            ground_truth_match = _GROUND_TRUTH_PATTERN.search(text_output)
            ground_truth = (
                ground_truth_match.group(1).strip()
                if ground_truth_match
                else (text_output.strip() if not is_false else "")
            )

            reason_match = _REASON_PATTERN.search(text_output)
            reason = reason_match.group(1).strip() if reason_match else ""

            return FactVerificationResult(
                claim=claim,
                ground_truth=ground_truth,
                sources=tuple(sources),
                is_false=is_false,
                reason=reason,
            )
        except Exception as error:  # noqa: BLE001 - 裏取り失敗時は全体の処理を止めずにフォールバック
            self._logger.warning(
                "FactVerificationAgent failed for chunk %s: %s",
                chunk.chunk_id,
                error,
            )
            return None
