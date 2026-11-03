"""FactVerificationAgent のユニットテスト."""

from unittest.mock import MagicMock

from domain.models.director import FactCheckAuditMetric, UtteranceChunk
from services.fact_verification_agent import FactVerificationAgent


def test_fact_verification_agent_retrieves_primary_sources_and_ground_truth():
    """Google Search Grounding の結果から一次ソースURLと正しい事実が取得されること."""
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = (
        "【命題】Python 3.12 で GIL が完全に削除された\n"
        "【判定】誤り\n"
        "【正しい事実】Python 3.13 で実験的な自由スレッド化 (PEP 703) として導入された。\n"
        "【理由】3.12 では削除されておらず、3.13 からのオプトイン機能であるため。"
    )

    # Grounding metadata のモック
    mock_candidate = MagicMock()
    mock_chunk_1 = MagicMock()
    mock_chunk_1.web.uri = "https://docs.python.org/3.13/whatsnew/3.13.html"
    mock_chunk_1.web.title = "What's New In Python 3.13"

    mock_chunk_2 = MagicMock()
    mock_chunk_2.web.uri = "https://peps.python.org/pep-0703/"
    mock_chunk_2.web.title = "PEP 703 - Making the Global Interpreter Lock Optional"

    mock_candidate.grounding_metadata.grounding_chunks = [mock_chunk_1, mock_chunk_2]
    mock_response.candidates = [mock_candidate]

    mock_client.models.generate_content.return_value = mock_response

    agent = FactVerificationAgent(client=mock_client)

    chunk = UtteranceChunk("seg_001", "小野", 1000, 4000, "Python 3.12 で GIL なくなったよね")
    metric = FactCheckAuditMetric(noul=0.9, score=4, choice="technology", confidence=0.9)

    result = agent.verify_chunk(
        chunk=chunk,
        metric=metric,
        all_chunks=[chunk],
    )

    assert result is not None
    assert result.is_false is True
    assert "Python 3.13 で実験的な自由スレッド化" in result.ground_truth
    assert len(result.sources) == 2
    assert result.sources[0].url == "https://docs.python.org/3.13/whatsnew/3.13.html"
    assert result.sources[0].title == "What's New In Python 3.13"
    assert result.sources[1].url == "https://peps.python.org/pep-0703/"

    # Google Search ツールが設定されたことを確認
    config = mock_client.models.generate_content.call_args.kwargs["config"]
    assert config.tools is not None
    assert len(config.tools) == 1


def test_fact_verification_agent_detects_actually_true():
    """発言が客観的に正しかった場合に is_false=False と判定されること."""
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = (
        "【命題】Next.js 15 は React 19 をサポートしている\n"
        "【判定】正しい\n"
        "【正しい事実】Next.js 15 は React 19 RC/正式版をサポートしています。\n"
        "【理由】発言通りの仕様です。"
    )
    mock_response.candidates = []
    mock_client.models.generate_content.return_value = mock_response

    agent = FactVerificationAgent(client=mock_client)

    chunk = UtteranceChunk("seg_002", "高島", 1000, 4000, "Next.js 15 は React 19 対応してるよ")
    metric = FactCheckAuditMetric(noul=0.8, score=3, choice="technology", confidence=0.7)

    result = agent.verify_chunk(
        chunk=chunk,
        metric=metric,
        all_chunks=[chunk],
    )

    assert result is not None
    assert result.is_false is False


def test_fact_verification_agent_handles_failure_gracefully():
    """API エラーが発生した場合は例外を送出せず None を返すこと."""
    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = RuntimeError("API Rate Limit")

    agent = FactVerificationAgent(client=mock_client)

    chunk = UtteranceChunk("seg_003", "数森", 1000, 4000, "テスト発言")
    metric = FactCheckAuditMetric(noul=0.9, score=3, choice="other")

    result = agent.verify_chunk(
        chunk=chunk,
        metric=metric,
        all_chunks=[chunk],
    )

    assert result is None
