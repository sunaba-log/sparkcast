"""Local Presidio-based PII detector for Japanese podcast transcripts."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider

from domain.errors import ReviewIncompleteError

if TYPE_CHECKING:
    from domain.models.director import AudioAuditPolicy, UtteranceChunk


@dataclass(frozen=True)
class DetectedEntity:
    """A local PII match; text is intentionally retained only until the finding is persisted."""

    entity_type: str


class PresidioPiiDetector:
    """Run Presidio with spaCy/GiNZA and Japanese custom recognizers entirely locally."""

    _PHONE = re.compile(r"(?:0\d{1,4}[-ー]?\d{1,4}[-ー]?\d{4}|090[-ー]?\d{4}[-ー]?\d{4})")
    _POSTAL_CODE = re.compile(r"〒?\d{3}[-ー]?\d{4}")
    _URL = re.compile(r"https?://[^\s]+", re.IGNORECASE)
    _ADDRESS = re.compile(
        r"(?:北海道|東京都|京都府|大阪府|(?:[一-龠々]{2,4})県)"
        r"(?:[一-龠々]{1,8}(?:市|区|郡|町|村)){1,3}"
        r"(?:[一-龠々0-9\uFF10-\uFF19-]{1,20})?"
    )

    def __init__(self) -> None:
        """Initialize local Presidio recognizers and the Japanese GiNZA NLP engine."""
        try:
            nlp_engine = NlpEngineProvider(
                nlp_configuration={
                    "nlp_engine_name": "spacy",
                    "models": [{"lang_code": "ja", "model_name": "ja_ginza"}],
                }
            ).create_engine()
            self._analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["ja"])
            self._analyzer.registry.add_recognizer(
                PatternRecognizer(
                    supported_entity="JP_PHONE_NUMBER",
                    patterns=[Pattern("jp_phone", self._PHONE.pattern, 0.9)],
                    supported_language="ja",
                )
            )
            self._analyzer.registry.add_recognizer(
                PatternRecognizer(
                    supported_entity="JP_POSTAL_CODE",
                    patterns=[Pattern("jp_postal_code", self._POSTAL_CODE.pattern, 0.9)],
                    supported_language="ja",
                )
            )
            self._analyzer.registry.add_recognizer(
                PatternRecognizer(
                    supported_entity="URL",
                    patterns=[Pattern("url", self._URL.pattern, 0.9)],
                    supported_language="ja",
                )
            )
            self._analyzer.registry.add_recognizer(
                PatternRecognizer(
                    supported_entity="JP_ADDRESS",
                    patterns=[Pattern("jp_address", self._ADDRESS.pattern, 0.75)],
                    supported_language="ja",
                )
            )
        except Exception as error:  # noqa: BLE001 - detection must fail closed
            raise ReviewIncompleteError("ローカル PII 検出器を初期化できませんでした。") from error

    def detect(self, chunk: UtteranceChunk, policy: AudioAuditPolicy) -> list[DetectedEntity]:
        """Return non-allowlisted PII/custom-term matches for one timestamped chunk."""
        try:
            results = self._analyzer.analyze(text=chunk.text, language="ja")
        except Exception as error:  # noqa: BLE001 - detection must fail closed
            raise ReviewIncompleteError("ローカル PII 検出を完了できませんでした。") from error

        allowed = {term.casefold() for term in policy.allowed_terms}
        return [
            DetectedEntity(result.entity_type)
            for result in results
            if chunk.text[result.start : result.end].casefold() not in allowed
        ]
