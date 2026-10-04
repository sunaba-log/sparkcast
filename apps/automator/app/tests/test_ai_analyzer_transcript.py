from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from domain.models.transcript import TranscriptSegment
from infrastructure.ai_analyzer import AudioAnalyzer


@pytest.fixture
def analyzer() -> AudioAnalyzer:
    with patch("infrastructure.ai_analyzer.genai.Client") as client:
        client.return_value.models.generate_content = MagicMock()
        return AudioAnalyzer(project_id="p")


def _respond(analyzer: AudioAnalyzer, text: str) -> MagicMock:
    generate = analyzer.client.models.generate_content
    generate.return_value = SimpleNamespace(text=text)
    return generate


def test_generate_minutes_uses_the_transcript_times_and_forbids_invented_dates(analyzer: AudioAnalyzer) -> None:
    generate = _respond(analyzer, "minutes")
    assert analyzer.generate_minutes("[0:05] 小野: こんにちは", ["小野", "数森"], model_id="m") == "minutes"
    prompt = generate.call_args.kwargs["contents"][0]
    assert "[0:05] 小野: こんにちは" in prompt
    assert "登場人物: 小野、数森" in prompt
    assert "推測で時刻を作らないで下さい" in prompt
    assert "日付の欄を作らないで下さい" in prompt
    assert generate.call_args.kwargs["model"] == "m"


def test_generate_minutes_raises_on_empty_response(analyzer: AudioAnalyzer) -> None:
    _respond(analyzer, "")
    with pytest.raises(ValueError, match="No minutes"):
        analyzer.generate_minutes("[0:00] a: b")


def test_assign_speakers_applies_labels_by_index_and_keeps_missing_ones(analyzer: AudioAnalyzer) -> None:
    generate = _respond(
        analyzer,
        json.dumps(
            {"assignments": [{"id": 0, "speaker": "小野"}, {"id": 2, "speaker": " 話者A "}, {"id": 1, "speaker": ""}]}
        ),
    )
    segments = [TranscriptSegment(0, 1, "a"), TranscriptSegment(1, 2, "b"), TranscriptSegment(65, 70, "c")]
    labelled = analyzer.assign_speakers("gs://b/x.m4a", segments, ["小野"], model_id="m")

    assert [s.speaker for s in labelled] == ["小野", "不明", "話者A"]
    contents = generate.call_args.kwargs["contents"]
    assert contents[0].file_data.file_uri == "gs://b/x.m4a"
    assert "2\t1:05-1:10\tc" in contents[1]
    assert "登場人物は 小野 です" in contents[1]


def test_assign_speakers_without_segments_does_not_call_the_model(analyzer: AudioAnalyzer) -> None:
    generate = _respond(analyzer, "{}")
    assert analyzer.assign_speakers("gs://b/x.m4a", []) == []
    generate.assert_not_called()


def test_legacy_transcript_prompt_uses_cast_names_instead_of_hardcoded_ones(analyzer: AudioAnalyzer) -> None:
    generate = _respond(analyzer, "minutes")
    analyzer.generate_transcript("gs://b/x.flac", cast_names=["佐藤"])
    prompt = generate.call_args.kwargs["contents"][1]
    assert "登場人物は佐藤です" in prompt
    analyzer.generate_transcript("gs://b/x.flac")
    assert "登場人物" not in generate.call_args.kwargs["contents"][1]
