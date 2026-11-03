"""Gemini ディレクター訂正スクリプトジェネレーター (#170).

Jev判定で Score >= 3 と評価された発話チャンクを受け取り、
番組の文脈とパーソナリティ設定に合わせた愛嬌ある第4のパーソナリティとしての
カットイン訂正スクリプトを生成する。
"""

from __future__ import annotations

import logging
import os
import uuid

from google import genai
from google.genai.types import GenerateContentConfig
from pydantic import BaseModel, Field

from domain.models.director import (
    DirectorIntervention,
    FactCheckAuditMetric,
    FactVerificationResult,
    UtteranceChunk,
)

logger = logging.getLogger(__name__)

DEFAULT_CAST_NAMES = ["小野", "数森", "高島"]
DEFAULT_MODEL_ID = "gemini-2.0-flash-001"
DEFAULT_LOCATION = "us-central1"


class GeneratedInterventionSchema(BaseModel):
    """Gemini 構造化出力スキーマ."""

    correction_script: str = Field(
        description="愛嬌があり自然に会話の輪に入ってくるディレクターのカットイン訂正台詞(単なるアナウンスは厳禁)"
    )
    target_speaker: str = Field(description="訂正対象のパーソナリティ名(例: 小野、数森、高島など)")
    insert_timestamp_ms: int = Field(
        description="カットイン音声を挿入するミリ秒タイムスタンプ(通常は発話終了の end_ms)"
    )
    reason: str = Field(description="何が事実と異なっており正しくは何なのかの簡潔な理由(判断根拠)")
    reference_url: str | None = Field(
        default=None,
        description="判断根拠となる公式ドキュメント、リリースノート、技術記事などの信頼できる参照リンクURL(存在する場合)",
    )


DIRECTOR_PROMPT_TEMPLATE = """\
あなたはポッドキャスト番組「sparkcast」の専属『AIディレクター』です。
番組パーソナリティ({cast_display})の雑談の輪に、愛嬌を持って自然に割り込んでくる「第4のパーソナリティ」として振る舞います。

リスナーに誤解を与える事実誤認や言い間違いが検出されました。
前後の会話文脈を踏まえて、自然にカットイン(割り込み)して訂正・ツッコミ・補足を入れる台詞を生成してください。

【キャラクター設定と発言ルール】
1. 単なるアナウンサー的訂正(「訂正します。先ほど...」のような硬いアナウンス)は絶対に禁止です。
2. 愛嬌があり、パーソナリティと仲の良いディレクターとして、会話のテンポを崩さずにツッコミやフォローを入れてください。
   (例: 「あ、小野さん小野さん! ちょっとディレクターからツッコミ入りますけど、それ〇〇じゃなくて△△ですね!」)
   (例: 「横から失礼します〜! さっきの機能、有料プランじゃなくて無料でも使えますよ!」)
   (例: 「ディレクターカットイン! その発表は去年じゃなくて先月ですね!」)
3. 訂正対象の話者(target_speaker)に親しみやすく呼びかけてください。
4. 挿入位置(insert_timestamp_ms)は、基本的に対象発話の終了直後({chunk_end_ms}ms)としてください。
5. 判断根拠となる理由(reason)を簡潔かつ論理的に説明し、根拠となる公式ドキュメントや信頼できる参照URL(reference_url)が判明していれば記載してください。
6. 出力は必ず指定された JSON スキーマに従ってください。

--- 前後の会話文脈 ---
{context_text}

--- 訂正対象の発話 ---
話者: {speaker}
時刻: {start_ms}ms 〜 {end_ms}ms
発言内容: {text}
検出カテゴリ: {choice}
深刻度スコア: {score}/5 (客観的事実確率: {noul})
{verification_section}
"""


class DirectorScriptGenerator:
    """Gemini を用いたディレクター訂正スクリプト生成サービス."""

    def __init__(
        self,
        *,
        project_id: str | None = None,
        location: str | None = None,
        client: genai.Client | None = None,
        model_id: str | None = None,
        logger_instance: logging.Logger | None = None,
    ) -> None:
        """Initialize generator with Gemini client."""
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

    def generate_intervention(
        self,
        *,
        chunk: UtteranceChunk,
        metric: FactCheckAuditMetric,
        all_chunks: list[UtteranceChunk],
        cast_names: list[str] | None = None,
        model_id: str | None = None,
        verification: FactVerificationResult | None = None,
    ) -> DirectorIntervention:
        """Score >= 3 の発話チャンクに対し、前後の文脈を汲んだディレクター訂正介入を生成する."""
        client = self._get_client()
        active_model_id = model_id or self._model_id

        # 前後の文脈(前後最大3チャンク)を抽出
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
            f"[{c.start_ms}ms] {c.speaker}: {c.text}" + (" (★対象発話)" if c.chunk_id == chunk.chunk_id else "")
            for c in context_chunks
        )

        casts = cast_names or DEFAULT_CAST_NAMES
        cast_display = "、".join(casts)

        verification_section = ""
        if verification is not None:
            source_lines = [f"- {s.title}: {s.url}" for s in verification.sources]
            sources_text = "\n".join(source_lines) if source_lines else "なし"
            verification_section = (
                "\n--- Google Search による裏取り検証結果 ---\n"
                f"裏付けられた客観的事実: {verification.ground_truth}\n"
                f"食い違いの理由: {verification.reason}\n"
                f"参照一次ソース:\n{sources_text}\n"
                "★指示: 上記の客観的事実を必ず反映し、愛嬌あるカットイン訂正台詞を起草してください。"
            )

        prompt = DIRECTOR_PROMPT_TEMPLATE.format(
            cast_display=cast_display,
            chunk_end_ms=chunk.end_ms,
            context_text=context_text,
            speaker=chunk.speaker,
            start_ms=chunk.start_ms,
            end_ms=chunk.end_ms,
            text=chunk.text,
            choice=metric.choice,
            score=metric.score,
            noul=metric.noul,
            verification_section=verification_section,
        )

        response = client.models.generate_content(
            model=active_model_id,
            contents=[prompt],
            config=GenerateContentConfig(
                temperature=0.7,  # 愛嬌と自然なバリエーションを出すため適度に設定
                response_mime_type="application/json",
                response_json_schema=GeneratedInterventionSchema.model_json_schema(),
            ),
        )

        if not response.text:
            msg = f"Empty response from Gemini for intervention on chunk {chunk.chunk_id}"
            raise ValueError(msg)

        parsed = GeneratedInterventionSchema.model_validate_json(response.text.strip())

        # 参照リンクの決定:
        # Verification Agent の一次ソースURLがあれば最優先、なければ LLM のパース結果を採用
        resolved_ref_url = (
            verification.sources[0].url if verification and verification.sources else parsed.reference_url
        )

        resolved_ref_links = (
            tuple({"title": s.title, "url": s.url} for s in verification.sources)
            if verification and verification.sources
            else ()
        )

        return DirectorIntervention.create(
            intervention_id=str(uuid.uuid4()),
            chunk_id=chunk.chunk_id,
            target_speaker=parsed.target_speaker or chunk.speaker,
            insert_timestamp_ms=parsed.insert_timestamp_ms or chunk.end_ms,
            correction_script=parsed.correction_script,
            reason=verification.reason if (verification and verification.reason) else parsed.reason,
            audit_metrics=metric,
            reference_url=resolved_ref_url,
            reference_links=resolved_ref_links,
            verification=verification,
            status="pending",
        )
