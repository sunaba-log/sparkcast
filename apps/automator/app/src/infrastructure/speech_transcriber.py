"""Speech-to-Text v2 で時刻つきの発話を作る(#166).

- モデルは `long`(asia-northeast1)。日本語で発話ごとの結果と単語ごとの時刻が返る(話者分離は無い)。
  2026-10 時点で実際に試した結果、Chirp 2 の ja-JP は us-central1 で提供終了・asia-southeast1 で結果が空、
  Chirp 3 は全文が 1 件にまとまり時刻が付かなかったため使わない。
- 60 秒を超える音声は BatchRecognize、短い音声は Recognize(どちらも GCS の URI を渡す)。
- BatchRecognize は、急がない処理(ダイナミックバッチ。1 分 $0.003、通常の約 5 分の 1)にできる。
  結果が出るまでの時間に保証は無いので、結果は GCS に書かせて、長めに待つ(2026-10 の dev の計測では
  60 分の音声で通常と同じ約 16.5 分、結果も同じだった)。
- 単語の時刻から、句点やポーズで区切った発話(TranscriptSegment)にまとめる。
"""

from __future__ import annotations

import logging
import re
import unicodedata
import uuid
from dataclasses import dataclass

from google.api_core.client_options import ClientOptions
from google.cloud import storage
from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech

from domain.models.transcript import TranscriptSegment

logger = logging.getLogger(__name__)

# BatchRecognize は 60 秒より長い音声が対象
BATCH_MIN_SECONDS = 60
# 発話を区切るポーズ(秒)と、1 発話の最大の長さ(秒)
PAUSE_SECONDS = 0.8
MAX_SEGMENT_SECONDS = 30.0
SENTENCE_END = ("\u3002", "\uff1f", "\uff01", "?", "!")  # 句点・全角と半角の疑問符と感嘆符


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


_SENTENCE_SPLIT = re.compile("(?<=[\u3002\uff1f\uff01?!])")  # 句点・疑問符・感嘆符の後ろで区切る
# 日本語の文字の間に入る余計な空白(「目 次」のような認識結果)
_INNER_SPACE = re.compile(r"(?<=[^\x00-\x7f])\s+|\s+(?=[^\x00-\x7f])")


def _chars(text: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKC", text) if ch.isalnum())


def clean_transcript(text: str) -> str:
    """認識結果の文から、日本語の文字の間の余計な空白を取る."""
    return _INNER_SPACE.sub("", text).strip()


def sentences_to_segments(transcript: str, words: list[Word]) -> list[TranscriptSegment]:
    """句読点つきの文を本文に、単語の時刻を文の時刻にする.

    文の文字数(英数字と仮名漢字だけを数える)ぶん単語を順に割り当て、最初の単語の開始から
    最後の単語の終了までを、その文の時刻にする。
    """
    sentences = [clean_transcript(part) for part in _SENTENCE_SPLIT.split(transcript)]
    sentences = [sentence for sentence in sentences if _chars(sentence)]
    segments: list[TranscriptSegment] = []
    index = 0
    for number, sentence in enumerate(sentences):
        needed = len(_chars(sentence))
        taken: list[Word] = []
        count = 0
        last = number == len(sentences) - 1
        while index < len(words) and (count < needed or last):
            taken.append(words[index])
            count += len(_chars(words[index].text))
            index += 1
        if not taken:
            # 単語が足りないとき(認識結果の文と単語がずれた場合)は直前の発話の終わりに置く
            at = segments[-1].end if segments else (words[-1].end if words else 0.0)
            segments.append(TranscriptSegment(start=at, end=at, text=sentence))
            continue
        segments.append(TranscriptSegment(start=taken[0].start, end=taken[-1].end, text=sentence))
    return segments


def results_to_segments(results: list[cloud_speech.SpeechRecognitionResult]) -> list[TranscriptSegment]:
    """認識結果を発話にする。句読点のある結果は文ごと、無い結果は単語のポーズで区切る."""
    segments: list[TranscriptSegment] = []
    previous_end = 0.0
    for result in results:
        if not result.alternatives:
            continue
        alternative = result.alternatives[0]
        result_end = _seconds(result.result_end_offset) or previous_end
        words = [
            Word(text=w.word, start=_seconds(w.start_offset), end=_seconds(w.end_offset) or result_end)
            for w in alternative.words
        ]
        transcript = clean_transcript(alternative.transcript)
        if not transcript:
            previous_end = result_end
            continue
        if not words:
            segments.append(TranscriptSegment(start=previous_end, end=result_end, text=transcript))
        elif _SENTENCE_SPLIT.search(transcript[:-1]) or transcript.endswith(SENTENCE_END):
            segments.extend(sentences_to_segments(transcript, words))
        else:
            segments.extend(words_to_segments(words))
        previous_end = result_end
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
    """Speech-to-Text v2 で日本語を認識する."""

    def __init__(
        self,
        project_id: str,
        location: str = "asia-northeast1",
        model: str = "long",
        language_code: str = "ja-JP",
        client: SpeechClient | None = None,
        dynamic_batch_output: str | None = None,
        storage_client: storage.Client | None = None,
        timeout_seconds: float = 3600,
    ) -> None:
        """Create the client for the regional endpoint.

        dynamic_batch_output(gs://bucket/prefix)を渡すと、BatchRecognize をダイナミックバッチにし、
        結果をその下に書かせて読む。
        """
        self.dynamic_batch_output = dynamic_batch_output.rstrip("/") if dynamic_batch_output else None
        # BatchRecognize の結果を待つ上限(ダイナミックバッチは遅れることがあるので長めにする)
        self.timeout_seconds = timeout_seconds
        self._storage = storage_client
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

    def transcribe(self, files: dict[str, float], timeout: float | None = None) -> dict[str, list[TranscriptSegment]]:
        """GCS の音声(URI → 長さ秒)をまとめて認識し、URI ごとの発話を返す."""
        output: dict[str, list[TranscriptSegment]] = {}
        long_files = [uri for uri, seconds in files.items() if seconds > BATCH_MIN_SECONDS]
        short_files = [uri for uri in files if uri not in long_files]

        # 結果を応答で受け取る(inline)設定は 1 リクエスト 1 ファイルまでなので、
        # ファイルごとにリクエストを出してから、まとめて待つ(話者ごとの認識が並行に進む)
        operations = {uri: self.client.batch_recognize(request=self._batch_request(uri)) for uri in long_files}
        if operations:
            logger.info("BatchRecognize %d file(s)", len(operations))
            for uri, operation in operations.items():
                response = operation.result(timeout=timeout or self.timeout_seconds)
                file_result = response.results.get(uri)
                if file_result is None:
                    message = f"Speech-to-Text returned no result for {uri}"
                    raise RuntimeError(message)
                if file_result.error and file_result.error.message:
                    message = f"Speech-to-Text failed for {uri}: {file_result.error.message}"
                    raise RuntimeError(message)
                output[uri] = results_to_segments(self._file_results(file_result))

        for uri in short_files:
            response = self.client.recognize(
                request=cloud_speech.RecognizeRequest(recognizer=self.recognizer, config=self.config, uri=uri)
            )
            output[uri] = results_to_segments(list(response.results))
        return output

    def _batch_request(self, uri: str) -> cloud_speech.BatchRecognizeRequest:
        if self.dynamic_batch_output:
            # 結果はファイルごとに別の場所へ(同じ名前の音声が重なっても混ざらないように)
            output_uri = f"{self.dynamic_batch_output}/{uuid.uuid4().hex}/"
            return cloud_speech.BatchRecognizeRequest(
                recognizer=self.recognizer,
                config=self.config,
                files=[cloud_speech.BatchRecognizeFileMetadata(uri=uri)],
                processing_strategy=cloud_speech.BatchRecognizeRequest.ProcessingStrategy.DYNAMIC_BATCHING,
                recognition_output_config=cloud_speech.RecognitionOutputConfig(
                    gcs_output_config=cloud_speech.GcsOutputConfig(uri=output_uri),
                ),
            )
        # 結果を応答で受け取る(inline)設定は 1 リクエスト 1 ファイルまで
        return cloud_speech.BatchRecognizeRequest(
            recognizer=self.recognizer,
            config=self.config,
            files=[cloud_speech.BatchRecognizeFileMetadata(uri=uri)],
            recognition_output_config=cloud_speech.RecognitionOutputConfig(
                inline_response_config=cloud_speech.InlineOutputConfig(),
            ),
        )

    def _file_results(
        self, file_result: cloud_speech.BatchRecognizeFileResult
    ) -> list[cloud_speech.SpeechRecognitionResult]:
        """ファイルごとの認識結果。GCS に書かせたときはそこから読む."""
        storage_result = getattr(file_result, "cloud_storage_result", None)
        result_uri = storage_result.uri if storage_result else ""
        if not result_uri:
            return list(file_result.transcript.results)
        bucket_name, _, name = result_uri.removeprefix("gs://").partition("/")
        client = self._storage or storage.Client()
        text = client.bucket(bucket_name).blob(name).download_as_text()
        return list(cloud_speech.BatchRecognizeResults.from_json(text, ignore_unknown_fields=True).results)
