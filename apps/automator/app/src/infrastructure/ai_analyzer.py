"""Gemini-based audio analysis and summary generation."""

import logging
import os
from pathlib import Path

from google import genai
from google.genai.types import GenerateContentConfig, Part

from domain.interfaces import TranscriptProvider
from domain.models import SnsPromotionsResponse, SpeakerAssignments, Summary
from domain.models.transcript import TranscriptSegment, drop_empty_sections, format_timestamp

logger = logging.getLogger(__name__)

AUDIO_FORMAT_MAPPING = {
    "aac": "audio/aac",
    "aiff": "audio/aiff",
    "flac": "audio/flac",
    "m4a": "audio/m4a",
    "mp3": "audio/mp3",
    "mp4": "audio/mp4",
    "mpeg": "audio/mpeg",
    "mpga": "audio/mpga",
    "ogg": "audio/ogg",
    "opus": "audio/opus",
    "pcm": "audio/pcm",
    "wav": "audio/wav",
    "webm": "audio/webm",
}


# 議事録(要点録)の形式(#166)。AI 議事録ツールとポッドキャストのショーノートの一般的な形にそろえる:
# 冒頭の要約 → 目次 → 話題ごとの要点 → 決定事項・ToDo → 次回に向けて。発言を時系列に並べ直した発言録は作らない。
# 【目次】は extract_topics が読んでショーノートのチャプターにするので、形を変えるときは合わせて直す。
MINUTES_INSTRUCTIONS = """
聞いていない人が 1 分で中身をつかめる「話題ごとの要点録」を Markdown で作って下さい。発言を時系列に並べ直した発言録は作らないで下さい。
この要点録は、エピソードの画面で人が読むほか、チャットの検索、エピソードのタイトルと概要文の作成、次回の議題の提案にも使います。

# 出力の構成(この順で。該当が無い節は見出しごと書かない。「なし」「特になし」とも書かない)
## 要約 … 2〜3 文。何を話し、何が決まり、何が残ったか。
## 【目次】 … 話題の始まりを「m:ss 題」の 1 行ずつで書く。時刻に角括弧や記号は付けない。題は 20 字程度まで。3〜5 分で 1 つを目安にし、細かく割りすぎない。目次の直後には必ず次の見出しを置く。
## 話題ごとのまとめ … 話題ごとに「### 開始時刻〜終了時刻 題」の見出しを付け、その下に箇条書きで要点を 3〜6 個書く。
  - 意見が分かれたときや誰かが提案したときだけ、「- 立場:」の下に「  - 名前:主張」を 1 行ずつ書く。全員の発言を並べる欄にはしない。
  - 結論があれば「- 結論:」に、合意/保留/意見が分かれた のどれかと中身を書く。
  - 印象に残る言い回しがあれば「- 引用:「…」(名前)」を 30 字程度まで、1 話題に 1 個まで、全体で 3 個まで書いてよい。
## 決定事項 … 決まったことと、その話題の時刻。
## ToDo … 「- [ ] 名前:やること」。期限は文字起こしにあるときだけ書く。
## 次回に向けて … 未解決の論点、持ち越し、次に話したいと出た話題。

# 書き方
- 常体(だ・である調)で書く。箇条書きは体言止めでもよい。敬体は使わない。
- 「〇〇氏より『…』との発言がありました」「〜が行われました」の形は使わない。主語は話題か名前にし、要点を言い切る。
- 1 項目は 1 文・1 情報で、60 字程度まで。言いよどみは消し、話し言葉は書き言葉に直す。
- 話者名は文字起こしの表記のまま使い、敬称は付けない。
- 製品・技術・サービスなどの固有名詞は文字起こしの表記のまま書く。「それ」「前述の」で済ませず、節の中でも正式な名前を書く(節だけが検索で引かれても意味が通るように)。
- 文字起こしに無いこと(開催日・開始時刻・場所・肩書き・期限・参加者の意図)は推測で書かない。分からないことは書かずに省く。収録日はシステムが別に記録しているので、日付の欄は作らない。

# 短い収録
発言が 1 分未満か、中身がマイクの試しや挨拶だけのときは、「## 要約」に 1〜2 行(動作確認などで話題が無いことをはっきり書く)と「## 【目次】」に 1 行だけを書き、ほかの節は作らない。

# 出力
Markdown の本文だけを出力する(前置き・後書き・コードブロックの囲みは付けない)。
"""


class AudioAnalyzer(TranscriptProvider):
    """Gemini API based audio analysis."""

    DEFAULT_MODEL_ID = "gemini-2.0-flash-001"
    DEFAULT_LOCATION = "us-central1"

    def __init__(self, project_id: str | None = None, location: str | None = None) -> None:
        """Initialize analyzer with project and location settings."""
        self.project_id = project_id or os.environ.get("GOOGLE_CLOUD_PROJECT")
        if not self.project_id:
            raise ValueError("project_id must be provided or set in GOOGLE_CLOUD_PROJECT env var")
        self.location = location or os.environ.get("GOOGLE_CLOUD_REGION", self.DEFAULT_LOCATION)
        self.client = genai.Client(vertexai=True, project=self.project_id, location=self.location)

    @staticmethod
    def _get_mime_type(gcs_uri: str) -> str:
        file_path = Path(gcs_uri)
        extension = file_path.suffix.lstrip(".").lower()

        if extension not in AUDIO_FORMAT_MAPPING:
            supported = ", ".join(sorted(AUDIO_FORMAT_MAPPING.keys()))
            msg = f"Unsupported audio format: .{extension}. Supported formats: {supported}"
            raise ValueError(msg)

        return AUDIO_FORMAT_MAPPING[extension]

    def generate_transcript(
        self,
        gcs_uri: str,
        model_id: str | None = None,
        cast_names: list[str] | None = None,
    ) -> str | None:
        """Generate minutes directly from an audio object in GCS.

        音声認識が使えなかったときの予備。目次の時刻はモデルの推測になる。
        """
        model_id = model_id or self.DEFAULT_MODEL_ID
        mime_type = self._get_mime_type(gcs_uri)

        audio_part = Part.from_uri(
            file_uri=gcs_uri,
            mime_type=mime_type,
        )
        prompt = f"""
提供されたポッドキャストの収録の音声から、要点録を作成して下さい。
{MINUTES_INSTRUCTIONS}
目次の時刻は、音声の中でその話題が始まる時刻を書いて下さい。

音声に会話が含まれていない(無音・雑音だけ)場合は、要点録を作らず、NO_SPEECH とだけ返して下さい。
"""
        if cast_names:
            prompt += f"登場人物は{'、'.join(cast_names)}です。\n"

        response = self.client.models.generate_content(
            model=model_id,
            contents=[audio_part, prompt],
        )

        return response.text

    def generate_minutes(
        self,
        transcript_text: str,
        cast_names: list[str] | None = None,
        model_id: str | None = None,
    ) -> str:
        """話者と時刻つきの文字起こし(`[m:ss] 話者: 本文` の行)から議事録を作る(#166).

        目次の時刻は文字起こしの時刻をそのまま使わせる(モデルに推測させない)。
        """
        model_id = model_id or self.DEFAULT_MODEL_ID
        cast = f"登場人物: {'、'.join(cast_names)}\n" if cast_names else ""
        prompt = f"""
以下はポッドキャストの収録の文字起こしです。各行は「[開始時刻] 話者: 発言」の形式で、時刻は音声の先頭からの経過時間です。
{cast}
{MINUTES_INSTRUCTIONS}
目次の時刻は、その話題が始まる行の時刻を文字起こしからそのまま写して下さい。推測で時刻を作らないで下さい。

--- 以下が文字起こしです ---
{transcript_text}
"""
        response = self.client.models.generate_content(
            model=model_id,
            contents=[prompt],
            config=GenerateContentConfig(temperature=0.2, max_output_tokens=16000),
        )
        if not response.text:
            raise ValueError("No minutes received from the model.")
        return drop_empty_sections(response.text)

    def assign_speakers(
        self,
        gcs_uri: str,
        segments: list[TranscriptSegment],
        cast_names: list[str] | None = None,
        model_id: str | None = None,
    ) -> list[TranscriptSegment]:
        """1 本に混ざった音声の各発話に、音声を聞かせて話者を割り当てる(#166).

        日本語の話者分離に対応した音声認識が無いための推定。分からない話者は「話者A」のように
        一貫したラベルにさせる。返り値は話者を付けた発話(数と順序は入力と同じ)。
        """
        if not segments:
            return segments
        model_id = model_id or self.DEFAULT_MODEL_ID
        listing = "\n".join(
            f"{index}\t{format_timestamp(segment.start)}-{format_timestamp(segment.end)}\t{segment.text}"
            for index, segment in enumerate(segments)
        )
        cast = (
            f"登場人物は {'、'.join(cast_names)} です。声と話の内容から、できるだけこの名前で答えて下さい。"
            if cast_names
            else "登場人物の名前は分かりません。"
        )
        prompt = f"""
音声はポッドキャストの収録です。下の一覧は、この音声を音声認識した発話の一覧です(番号、開始-終了の時刻、本文)。
音声を聞いて、各発話を話しているのが誰かを判定して下さい。
{cast}
名前が分からない話者は「話者A」「話者B」のように、同じ人には同じラベルを一貫して付けて下さい。
すべての番号について 1 件ずつ答えて下さい。

--- 発話一覧 ---
{listing}
"""
        audio_part = Part.from_uri(file_uri=gcs_uri, mime_type=self._get_mime_type(gcs_uri))
        response = self.client.models.generate_content(
            model=model_id,
            contents=[audio_part, prompt],
            config=GenerateContentConfig(
                temperature=0.0,
                max_output_tokens=65000,
                response_mime_type="application/json",
                response_json_schema=SpeakerAssignments.model_json_schema(),
            ),
        )
        if not response.text:
            raise ValueError("No speaker assignments received from the model.")
        assignments = SpeakerAssignments.model_validate_json(response.text.strip())
        speakers = {item.id: item.speaker.strip() for item in assignments.assignments if item.speaker.strip()}
        return [
            segment.with_speaker(speakers[index]) if index in speakers else segment
            for index, segment in enumerate(segments)
        ]

    def summarize_transcript(self, transcript: str, prompt: str | None = None, model_id: str | None = None) -> Summary:
        """Generate a structured summary from transcript text."""
        model_id = model_id or self.DEFAULT_MODEL_ID

        if not prompt:
            prompt = f"""
以下の議事録の内容をもとに、リスナーの興味を引く形で番組紹介文を作成してください。

出力は必ず **JSONのみ** とし、次のスキーマに厳密に従ってください。
{{
    "title": "キャッチーで分かりやすいエピソードタイトル(200文字以内)",
    "description": "RSSフィードに適した番組紹介文。HTMLタグは<p>と<br>のみを使用してください。段落は<p>...</p>で囲み、改行は<br>を使用してください。その他のHTMLタグは使用しないでください。"
}}

制約条件:
- descriptionには、以下の見出しを必ず含めること
  1. エピソード概要(400字程度の概要)
  2. 目次
  3. 関連情報
    技術スタックとキーワードは**箇条書き**で列挙すること
    キーワード: 議事録内で扱われたキーワードを**箇条書き**で列挙
  4. about us
- HTMLタグは<p>と<br>のみを使用すること
- 見出しは【】で囲んでテキストとして表現すること

descriptionの出力例:
<p>【エピソード概要】</p><p><br></p><p>【目次】</p><p>0:00 AAA</p><p>0:16 BBB</p><p><br></p><p>【関連情報】</p><p>- GitHub: https://github.com/sunaba-log</p><p>- 技術スタック: 議事録内で扱われた技術スタックを箇条書きで列挙</p><p>  - 例: GCS</p><p>- キーワード: 議事録内で扱われたキーワードを箇条書きで列挙</p><p>  - 例: ARグラス</p><p><br></p><p>【about us】</p><p>sunaba log: 友人同士で週次で雑談しながら「30 days to build」プロジェクトを進行する、雑談発想型プロトタイピング会議録。</p>

--- 以下が議事録です ---
{transcript}
"""

        response = self.client.models.generate_content(
            model=model_id,
            contents=[prompt],
            config=GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=12000,
                response_mime_type="application/json",
                response_json_schema=Summary.model_json_schema(),
            ),
        )
        if not response.text:
            raise ValueError("No response received from the model.")

        text = response.text.strip()
        if not text.endswith("}"):
            logger.error("Model output truncated or incomplete JSON. response.text=%s", text)
            raise ValueError(
                "Model output was truncated or incomplete JSON. Try increasing max_output_tokens or simplifying the prompt."
            )

        try:
            return Summary.model_validate_json(text)
        except Exception as err:
            logger.warning("Summary JSON validation failed. response.text=%s", text)
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1 and end > start:
                candidate = text[start : end + 1]
                if not candidate.endswith("}"):
                    logger.exception("Recovered JSON is still incomplete. candidate=%s", candidate)
                    raise ValueError(
                        "Recovered JSON is still incomplete. Try increasing max_output_tokens or simplifying the prompt."
                    ) from err
                return Summary.model_validate_json(candidate)
            raise

    def generate_sns_promotions(
        self,
        summary_description: str,
        num_promotions: int = 3,
        model_id: str | None = None,
    ) -> SnsPromotionsResponse:
        """Generate multiple SNS promotions from episode summary description using Gemini."""
        model_id = model_id or self.DEFAULT_MODEL_ID

        prompt = f"""
以下のポッドキャストのエピソード紹介文をもとに、SNS投稿文を {num_promotions} 種類作成してください。

各投稿は、切り口の異なるパターン(例: 告知重視、インサイト重視、パワーワード重視など)にしてください。

制約事項:
- 読み手が思わずクリックしたくなるような、簡潔で魅力的な言葉を選んでください。
- ハッシュタグは文脈に合わせて3個程度選定してください。
- ややフレンドリーな口調で。

出力は必ず **JSONのみ** とし、次のスキーマに厳密に従ってください。
スキーマ:
{{
    "promotions": [
        {{
            "message": "SNS投稿文の本文",
            "hashtags": ["#タグ1", "#タグ2", "#タグ3"]
        }},
        ...
    ]
}}

--- 以下がエピソード紹介文です ---
{summary_description}
"""

        response = self.client.models.generate_content(
            model=model_id,
            contents=[prompt],
            config=GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=4000,
                response_mime_type="application/json",
                response_json_schema=SnsPromotionsResponse.model_json_schema(),
            ),
        )
        if not response.text:
            raise ValueError("No response received from the model for SNS promotion.")

        text = response.text.strip()
        try:
            return SnsPromotionsResponse.model_validate_json(text)
        except Exception as err:
            logger.warning("SNS Promotion JSON validation failed. response.text=%s", text)
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1 and end > start:
                candidate = text[start : end + 1]
                return SnsPromotionsResponse.model_validate_json(candidate)
            raise


def generate_transcript_with_gemini(gcs_uri: str) -> str | None:
    """Deprecated helper wrapper."""
    analyzer = AudioAnalyzer()
    if not gcs_uri:
        raise ValueError("gcs_uri must be provided.")
    return analyzer.generate_transcript(gcs_uri)


def summarize_transcript_with_gemini(
    transcript: str, prompt: str | None = None, model_id: str = "gemini-2.0-flash-001"
) -> Summary:
    """Deprecated helper wrapper."""
    analyzer = AudioAnalyzer()
    return analyzer.summarize_transcript(transcript, prompt, model_id)
