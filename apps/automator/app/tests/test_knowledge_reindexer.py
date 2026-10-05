from __future__ import annotations

import urllib.request

import pytest

from infrastructure.knowledge_reindexer import HttpKnowledgeReindexer


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return b"{}"


def test_calls_reindex_for_the_podcast_with_the_cron_secret(monkeypatch) -> None:
    seen = {}

    def fake_urlopen(request: urllib.request.Request, timeout: float):
        seen["url"] = request.full_url
        seen["auth"] = request.get_header("Authorization")
        seen["timeout"] = timeout
        return _Response()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    HttpKnowledgeReindexer(base_url="https://ui.example.com/", secret="s3cret", timeout=5).reindex("7")

    assert seen == {
        "url": "https://ui.example.com/api/cron/reindex-minutes?podcastId=7",
        "auth": "Bearer s3cret",
        "timeout": 5,
    }


def test_rejects_non_http_urls() -> None:
    with pytest.raises(ValueError, match="scheme"):
        HttpKnowledgeReindexer(base_url="file:///etc/passwd", secret="s")
