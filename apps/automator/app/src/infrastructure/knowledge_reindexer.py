"""チャット用の索引(議事録・文字起こしの埋め込み)を作り直してもらう.

索引は UI(Next.js)が持っていて、毎朝 4 時の定期実行(Cloud Scheduler)で作り直している。
それだけだと、できたばかりのエピソードについてチャットで聞いても翌朝まで答えられないので、
エピソードが完成した時点で、その番組の分だけ作り直してもらう。認証は定期実行と同じ CRON_SECRET。
"""

from __future__ import annotations

import urllib.parse
import urllib.request

# 番組 1 つ分の作り直し(新しいエピソードの埋め込み)が終わるまで待つ
REINDEX_TIMEOUT_SECONDS = 120


class HttpKnowledgeReindexer:
    """UI の /api/cron/reindex-minutes を、番組を指定して呼ぶ."""

    def __init__(self, *, base_url: str, secret: str, timeout: float = REINDEX_TIMEOUT_SECONDS) -> None:
        """Keep the endpoint and the shared secret."""
        parsed = urllib.parse.urlparse(base_url)
        if parsed.scheme not in {"http", "https"}:
            msg = f"Unsupported APP_BASE_URL scheme: {parsed.scheme}"
            raise ValueError(msg)
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout

    def url(self, podcast_id: str) -> str:
        """呼び出す URL."""
        query = urllib.parse.urlencode({"podcastId": podcast_id})
        return f"{self._base_url}/api/cron/reindex-minutes?{query}"

    def reindex(self, podcast_id: str) -> None:
        """作り直してもらう(失敗したら例外)."""
        request = urllib.request.Request(  # noqa: S310 - スキームは http(s) に限定済み
            self.url(podcast_id),
            headers={"Authorization": f"Bearer {self._secret}", "User-Agent": "podcast-automator/1.0"},
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=self._timeout) as response:  # noqa: S310
            response.read()
