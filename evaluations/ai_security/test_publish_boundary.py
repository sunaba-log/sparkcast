"""公開境界（RSS/X自動投稿）の評価テスト.

実際の公開は行わない。R2/RSS/X はすべて記録用の代替に置き換え、
Firestore はローカルエミュレータ（FIRESTORE_EMULATOR_HOST）だけを使う。
実行：evaluations/ai_security/run-publish.sh
"""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from domain.interfaces import ChannelCredentials
from tests.test_process_podcast_workflow import (
    _BlobSource,
    _EpisodeRepository,
    _FirestoreManager,
    _Notifier,
    _ObjectStorage,
    _RssManager,
    _TranscriptProvider,
)
from usecases.auto_post_sns import AutoPostSnsUsecase
from usecases.process_podcast_workflow import ProcessPodcastWorkflow, ProcessPodcastWorkflowInput

# 修正前後で切り替える期待値。修正前の観測：
#   他チャンネルのアップロードも既定番組のRSSへ公開される／認証情報の無いチャンネルは既定Xアカウントで投稿される
PUBLISH_FIXED = os.environ.get("EVAL_EXPECT_FIXED") == "1"


class _PublicStorage(_ObjectStorage):
    def __init__(self) -> None:
        super().__init__()
        self.public: list[str] = []

    def upload_file(self, file_content: bytes, remote_key: str, content_type: str, *, public: bool = True) -> None:
        super().upload_file(file_content, remote_key, content_type, public=public)
        if public:
            self.public.append(remote_key)


class _FailingSns(_TranscriptProvider):
    def generate_sns_promotions(self, *args, **kwargs):  # noqa: ANN002, ANN003, ANN201
        raise RuntimeError("synthetic SNS generation failure")


def _run_workflow(object_path: str, provider: _TranscriptProvider | None = None, publish_podcast_id: str | None = "1"):  # noqa: ANN202
    storage, repo = _PublicStorage(), _EpisodeRepository()
    kwargs = {"publish_podcast_id": publish_podcast_id} if PUBLISH_FIXED else {}
    wf = ProcessPodcastWorkflow(
        transcript_provider=provider or _TranscriptProvider(),
        object_storage=storage,
        blob_source=_BlobSource(),
        notifier=_Notifier(),
        rss_manager_factory=_RssManager,
        audio_converter=lambda audio, suffix: b"mp3",  # noqa: ARG005
        audio_info_reader=lambda file_buffer, audio_format: [3, "00:01:00"],  # noqa: ARG005
        firestore_manager=_FirestoreManager(),
        episode_repository=repo,
        logger=logging.getLogger("eval"),
    )
    request = ProcessPodcastWorkflowInput(
        project_id="demo",
        sns_schedule_offset_hours=1,
        gcs_bucket="bucket",
        gcs_trigger_object_name=object_path,
        r2_bucket="r2",
        r2_key_prefix="sunabalog",
        ai_model_id="model",
        r2_custom_domain="dev.podcast.example.invalid",
        **kwargs,
    )
    error = None
    try:
        wf.run(request)
    except Exception as err:  # noqa: BLE001
        error = err
    return storage, repo, error


def test_pub_rss_01_other_channel_upload_target() -> None:
    """PUB-RSS-01: podcast 2 のアップロードが、既定番組(sunabalog)のRSS/音声として公開されるか."""
    storage, repo, error = _run_workflow("podcasts/2/episodes/7/source/b.mp3")
    print({"case": "PUB-RSS-01", "public_uploads": storage.public, "error": str(error) if error else None})
    if PUBLISH_FIXED:
        assert storage.public == []
        assert error is not None
        assert repo.failed is not None
    else:
        assert "sunabalog/feed.xml" in storage.public
        assert "sunabalog/ep/4/audio.mp3" in storage.public


def test_pub_rss_02_default_channel_still_published() -> None:
    """PUB-RSS-02: 既定番組(podcast 1)の自動公開は維持される（承認を必須化しない）."""
    storage, repo, error = _run_workflow("podcasts/1/episodes/8/source/a.mp3")
    assert error is None
    assert "sunabalog/feed.xml" in storage.public
    assert repo.completed is not None


def test_pub_order_01_failure_after_rss_publish() -> None:
    """PUB-ORDER-01: SNS生成失敗時、RSS・音声は既に公開済みでエピソードは失敗扱い（未公開と同一視できない）."""
    storage, repo, error = _run_workflow("podcasts/1/episodes/9/source/a.mp3", provider=_FailingSns())
    print({"case": "PUB-ORDER-01", "public_uploads": storage.public, "failed": repo.failed is not None})
    assert error is not None
    assert "sunabalog/feed.xml" in storage.public
    assert repo.failed is not None


class _Secrets:
    def __init__(self, creds: dict[str, ChannelCredentials]) -> None:
        self.creds = creds

    def get_channel_credentials(self, podcast_id: str) -> ChannelCredentials:
        if podcast_id not in self.creds:
            raise KeyError(podcast_id)
        return self.creds[podcast_id]


class _X:
    def __init__(self, name: str, delay: float = 0.0) -> None:
        self.name, self.delay, self.posted = name, delay, []

    def post_thread(self, text: str) -> bool:
        time.sleep(self.delay)
        self.posted.append(text)
        return True


class _MemFirestore:
    def __init__(self, promos: list[dict]) -> None:
        self.promos, self.updates = promos, []

    def get_pending_sns_promotions(self) -> list[dict]:
        return [dict(p) for p in self.promos if p.get("status", "pending") == "pending"]

    def claim_sns_promotion(self, path: str) -> dict | None:
        for p in self.promos:
            if p["reference_path"] == path and p.get("status", "pending") == "pending":
                p["status"] = "posting"
                return dict(p)
        return None

    def update_sns_promotion_status(self, path: str, status: str) -> None:
        self.updates.append((path, status))


def _promo(podcast: str, msg: str) -> dict:
    return {
        "doc_id": f"d{podcast}",
        "reference_path": f"podcasts/{podcast}/episodes_contents/1/sns_promotions/d{podcast}",
        "status": "pending",
        "scheduled_time": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
        "message": msg,
    }


def test_pub_x_01_channel_without_credentials() -> None:
    """PUB-X-01: 認証情報の無いチャンネル(podcast 2)の投稿文が既定アカウントで投稿されるか."""
    default = _X("default")
    kwargs = {"fallback_podcast_id": "1"} if PUBLISH_FIXED else {}
    AutoPostSnsUsecase(
        firestore_manager=_MemFirestore([_promo("2", "B_CHANNEL_TEXT")]),  # type: ignore[arg-type]
        secret_provider=_Secrets({}),  # type: ignore[arg-type]
        x_client=default,  # type: ignore[arg-type]
        **kwargs,
    ).run()
    print({"case": "PUB-X-01", "posted_by_default_account": default.posted})
    assert (default.posted == []) if PUBLISH_FIXED else (default.posted and "B_CHANNEL_TEXT" in default.posted[0])


def test_pub_x_02_default_channel_keeps_auto_post() -> None:
    """PUB-X-02: 既定番組(podcast 1)は事前承認なしの自動投稿を維持する."""
    default = _X("default")
    kwargs = {"fallback_podcast_id": "1"} if PUBLISH_FIXED else {}
    AutoPostSnsUsecase(
        firestore_manager=_MemFirestore([_promo("1", "A_TEXT")]),  # type: ignore[arg-type]
        secret_provider=_Secrets({}),  # type: ignore[arg-type]
        x_client=default,  # type: ignore[arg-type]
        **kwargs,
    ).run()
    assert default.posted and "A_TEXT" in default.posted[0]


# ---- Firestore エミュレータ上の競合・取消 ----
emulator = pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="Firestore emulator required")


def _fs():  # noqa: ANN202
    from services.firestore_manager import FirestoreManager

    return FirestoreManager(project_id="demo-sparkcast-eval")


def _seed(fm, podcast: str = "1", message: str = "RACE_TEXT") -> str:  # noqa: ANN001
    path = f"podcasts/{podcast}/episodes_contents/e{uuid.uuid4().hex[:8]}/sns_promotions/p1"
    fm._client.document(path).set(  # noqa: SLF001
        {"status": "pending", "message": message, "scheduled_time": (datetime.now(UTC) - timedelta(minutes=1)).isoformat()}
    )
    return path


def _clear(fm) -> None:  # noqa: ANN001
    for doc in fm._client.collection_group("sns_promotions").stream():  # noqa: SLF001
        doc.reference.delete()


@emulator
def test_pub_x_03_concurrent_runs_post_once() -> None:
    """PUB-X-03: 同時に2つの投稿ジョブが走ったとき、同じ投稿を何回送るか（Firestoreエミュレータ）."""
    fm = _fs()
    _clear(fm)
    path = _seed(fm)
    x = _X("default", delay=0.3)
    kwargs = {"fallback_podcast_id": "1"} if PUBLISH_FIXED else {}
    runs = [AutoPostSnsUsecase(firestore_manager=fm, x_client=x, **kwargs) for _ in range(2)]  # type: ignore[arg-type]
    threads = [threading.Thread(target=r.run) for r in runs]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    status = fm._client.document(path).get().to_dict()["status"]  # noqa: SLF001
    print({"case": "PUB-X-03", "post_count": len(x.posted), "final_status": status})
    assert len(x.posted) == (1 if PUBLISH_FIXED else 2)


@emulator
def test_pub_x_04_cancel_between_fetch_and_post() -> None:
    """PUB-X-04: 取得後・送信前に利用者が投稿を削除した場合に送信されるか."""
    fm = _fs()
    _clear(fm)
    path = _seed(fm, message="CANCELED_TEXT")
    original = fm.get_pending_sns_promotions

    def fetch_then_user_deletes():  # noqa: ANN202
        rows = original()
        fm._client.document(path).delete()  # noqa: SLF001 — 利用者のUIからの削除を模す
        return rows

    fm.get_pending_sns_promotions = fetch_then_user_deletes  # type: ignore[method-assign]
    x = _X("default")
    kwargs = {"fallback_podcast_id": "1"} if PUBLISH_FIXED else {}
    error = None
    try:
        AutoPostSnsUsecase(firestore_manager=fm, x_client=x, **kwargs).run()  # type: ignore[arg-type]
    except Exception as err:  # noqa: BLE001
        error = type(err).__name__
    print({"case": "PUB-X-04", "posted": x.posted, "error": error})
    assert (x.posted == []) if PUBLISH_FIXED else (len(x.posted) == 1)


@emulator
def test_pub_x_05_status_write_failure_after_successful_post() -> None:
    """PUB-X-05: 送信成功後に状態更新が失敗した場合の記録と再送."""
    fm = _fs()
    _clear(fm)
    path = _seed(fm, message="RETRY_TEXT")
    real_update = fm.update_sns_promotion_status
    calls = {"n": 0}

    def flaky(doc_path: str, status: str) -> None:
        calls["n"] += 1
        if calls["n"] == 1 and status == "posted":
            raise RuntimeError("synthetic Firestore write failure")
        real_update(doc_path, status)

    fm.update_sns_promotion_status = flaky  # type: ignore[method-assign]
    x = _X("default")
    kwargs = {"fallback_podcast_id": "1"} if PUBLISH_FIXED else {}
    for _ in range(2):
        try:
            AutoPostSnsUsecase(firestore_manager=fm, x_client=x, **kwargs).run()  # type: ignore[arg-type]
        except Exception:  # noqa: BLE001, S110
            pass
    status = fm._client.document(path).get().to_dict()["status"]  # noqa: SLF001
    print({"case": "PUB-X-05", "post_count": len(x.posted), "final_status": status})
    # 修正前：送信済みなのに "failed" と記録される。修正後：送信結果不明として "posting" のまま残し再送しない
    assert (len(x.posted), status) == ((1, "posting") if PUBLISH_FIXED else (1, "failed"))
