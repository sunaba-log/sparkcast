from __future__ import annotations

import pytest

from entrypoints.agenda_main import AgendaEnvConfig, _fetch_and_reconstruct
from entrypoints.main import _load_podcast_env
from services.fact_check_auditor import FactCheckAuditor


def _base_env() -> dict[str, str]:
    return {
        "PROJECT_ID": "project",
        "DATABASE_URL": "postgresql://user:password@localhost/database",
        "GCS_BUCKET": "bucket",
        "GCS_TRIGGER_OBJECT_NAME": "podcasts/1/episodes/42/source/recording.mp3",
        "R2_BUCKET": "r2",
        "CLOUDFLARE_ACCESS_KEY_ID": "access",
        "CLOUDFLARE_SECRET_ACCESS_KEY": "secret",
    }


def test_load_podcast_env_requires_database_url() -> None:
    env = _base_env()
    del env["DATABASE_URL"]

    with pytest.raises(ValueError, match="DATABASE_URL"):
        _load_podcast_env(env)


def test_load_podcast_env_does_not_require_fixed_podcast_id() -> None:
    config = _load_podcast_env(_base_env())

    assert config.database_url.startswith("postgresql://")


class _FakeFirestoreManager:
    def list_recent_transcript_episodes(self, *, podcast_id: str, limit: int) -> list[dict[str, object]]:
        assert podcast_id == "1"
        assert limit == 5
        return [
            {
                "episode_id": "episode-42",
                "episode_number": 42,
                "content": "AI / LLM を活用したポッドキャスト収録フローを自動化する。どう設計すべきか?",
                "updated_at": "2026-06-30T00:00:00Z",
            }
        ]


def test_agenda_fetch_prefers_firestore_transcripts(monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = AgendaEnvConfig(
        project_id="project",
        podcast_id="1",
        discord_webhook_agenda_url="https://example.com/webhook",
        discord_bot_token=None,
        discord_transcript_channel_id=None,
        transcript_fetch_limit=5,
        debug_json_path=None,
        gcp_project_id=None,
    )

    class EmptyNewsFetcher:
        def fetch_all(self, _sources: object) -> list[object]:
            return []

    monkeypatch.setattr("entrypoints.agenda_main.NewsFetcher", EmptyNewsFetcher)

    result, warnings, news_candidates = _fetch_and_reconstruct(cfg, _FakeFirestoreManager())  # type: ignore[arg-type]

    assert warnings == []
    assert news_candidates == []
    assert result is not None
    assert result.analyzed_episodes == 1
    assert result.metadata.source_episode_numbers == [42]


def test_load_podcast_env_supports_typesafe_and_jev_api_key() -> None:
    # 1. Neither key set
    env = _base_env()
    config = _load_podcast_env(env)
    assert config.typesafe_api_key is None

    # 2. TYPESAFE_API_KEY set
    env["TYPESAFE_API_KEY"] = "typesafe-key-123"
    config = _load_podcast_env(env)
    assert config.typesafe_api_key == "typesafe-key-123"

    # 3. JEV_API_KEY set as fallback
    del env["TYPESAFE_API_KEY"]
    env["JEV_API_KEY"] = "jev-key-456"
    config = _load_podcast_env(env)
    assert config.typesafe_api_key == "jev-key-456"

    # 4. Both set, TYPESAFE_API_KEY takes precedence
    env["TYPESAFE_API_KEY"] = "typesafe-primary"
    config = _load_podcast_env(env)
    assert config.typesafe_api_key == "typesafe-primary"


def test_fact_check_auditor_supports_jev_api_key_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.setenv("JEV_API_KEY", "jev-env-key")

    auditor = FactCheckAuditor()
    assert auditor._api_key == "jev-env-key"


def test_load_podcast_env_supports_resume_from_audit() -> None:
    env = _base_env()
    assert _load_podcast_env(env).resume_from_audit is False

    env["RESUME_FROM_AUDIT"] = "true"
    assert _load_podcast_env(env).resume_from_audit is True

    env["RESUME_FROM_AUDIT"] = "1"
    assert _load_podcast_env(env).resume_from_audit is True

    env["RESUME_FROM_AUDIT"] = "false"
    assert _load_podcast_env(env).resume_from_audit is False

