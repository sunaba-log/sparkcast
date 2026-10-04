"""Speech-to-Text v2(Chirp 2)で時刻つきの発話を作る(#166).

- Chirp 2 は日本語の単語ごとの時刻を返す(話者分離は無い)。
- 60 秒を超える音声は BatchRecognize、短い音声は Recognize(どちらも GCS の URI を渡す)。
- 単語の時刻から、句点やポーズで区切った発話(TranscriptSegment)にまとめる。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from google.api_core.client_options import ClientOptions
from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech

from domain.models.transcript import TranscriptSegment

logger = logging.getLogger(__name__)

# BatchRecognize は 60 秒より長い音声が対象
BATCH_MIN_SECONDS = 60
# 発話を区切るポーズ(秒)と、1 発話の最大の長さ(秒)
PAUSE_SECONDS = 0.8
MAX_SEGMENT_SECONDS = 30.0
SENTENCE_END = ("。", "?", "!", "?", "!")


@dataclass(frozen=True)
class Word:
    """単語(日本語では数文字のまとまり)."""

    text: str
    start: float
    end: float


def _seconds(duration: object) -> float:
    if duration is None:
        return 0.0
    if hasattr(duration, "total_seconds"):
        return float(duration.total_seconds())
    return float(getattr(duration, "seconds", 0)) + float(getattr(duration, "nanos", 0)) / 1e9


def _join(words: list[Word]) -> str:
    # 日本語は空白なしで連結する(英単語の間だけ空白を入れる)
    text = ""
    for word in words:
        token = word.text.strip()
        if not token:
            continue
        if text and text[-1].isascii() and text[-1].isalnum() and token[0].isascii() and token[0].isalnum():
            text += " "
        text += token
    return text


def words_to_segments(words: list[Word]) -> list[TranscriptSegment]:
    """単語の並びを、句点・ポーズ・長さで区切って発話にする."""
    segments: list[TranscriptSegment] = []
    current: list[Word] = []

    def flush() -> None:
        if current:
            text = _join(current)
            if text:
                segments.append(TranscriptSegment(start=current[0].start, end=current[-1].end, text=text))
            current.clear()

    for word in words:
        if current and (
            word.start - current[-1].end >= PAUSE_SECONDS or word.end - current[0].start > MAX_SEGMENT_SECONDS
        ):
            flush()
        current.append(word)
        if word.text.strip().endswith(SENTENCE_END):
            flush()
    flush()
    return segments


def result_words(results: list[cloud_speech.SpeechRecognitionResult]) -> list[Word]:
    """認識結果から単語の並びを取り出す。単語の時刻が無い結果は、結果全体を 1 語として扱う."""
    words: list[Word] = []
    previous_end = 0.0
    for result in results:
        if not result.alternatives:
            continue
        alternative = result.alternatives[0]
        result_end = _seconds(result.result_end_offset) or previous_end
        if alternative.words:
            words.extend(
                Word(text=w.word, start=_seconds(w.start_offset), end=_seconds(w.end_offset) or result_end)
                for w in alternative.words
            )
        elif alternative.transcript.strip():
            words.append(Word(text=alternative.transcript, start=previous_end, end=result_end))
        previous_end = result_end
    return words


class ChirpTranscriber:
    """Speech-to-Text v2 の Chirp 2 で日本語を認識する."""

    def __init__(
        self,
        project_id: str,
        location: str = "us-central1",
        model: str = "chirp_2",
        language_code: str = "ja-JP",
        client: SpeechClient | None = None,
    ) -> None:
        """Create the client for the regional endpoint."""
        self.recognizer = f"projects/{project_id}/locations/{location}/recognizers/_"
        self.client = client or SpeechClient(
            client_options=ClientOptions(api_endpoint=f"{location}-speech.googleapis.com")
        )
        self.config = cloud_speech.RecognitionConfig(
            auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
            language_codes=[language_code],
            model=model,
            features=cloud_speech.RecognitionFeatures(
                enable_word_time_offsets=True,
                enable_automatic_punctuation=True,
            ),
        )

    def transcribe(self, files: dict[str, float], timeout: float = 3600) -> dict[str, list[TranscriptSegment]]:
        """GCS の音声(URI → 長さ秒)をまとめて認識し、URI ごとの発話を返す."""
        output: dict[str, list[TranscriptSegment]] = {}
        long_files = [uri for uri, seconds in files.items() if seconds > BATCH_MIN_SECONDS]
        short_files = [uri for uri in files if uri not in long_files]

        if long_files:
            request = cloud_speech.BatchRecognizeRequest(
                recognizer=self.recognizer,
                config=self.config,
                files=[cloud_speech.BatchRecognizeFileMetadata(uri=uri) for uri in long_files],
                recognition_output_config=cloud_speech.RecognitionOutputConfig(
                    inline_response_config=cloud_speech.InlineOutputConfig(),
                ),
            )
            logger.info("BatchRecognize %d file(s)", len(long_files))
            response = self.client.batch_recognize(request=request).result(timeout=timeout)
            for uri in long_files:
                file_result = response.results.get(uri)
                if file_result is None:
                    message = f"Speech-to-Text returned no result for {uri}"
                    raise RuntimeError(message)
                if file_result.error and file_result.error.message:
                    message = f"Speech-to-Text failed for {uri}: {file_result.error.message}"
                    raise RuntimeError(message)
                output[uri] = words_to_segments(result_words(list(file_result.transcript.results)))

        for uri in short_files:
            response = self.client.recognize(
                request=cloud_speech.RecognizeRequest(recognizer=self.recognizer, config=self.config, uri=uri)
            )
            output[uri] = words_to_segments(result_words(list(response.results)))
        return output
