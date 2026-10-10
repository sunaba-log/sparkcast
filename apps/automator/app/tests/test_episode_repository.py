from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from infrastructure.episode_repository import PostgresEpisodeRepository


def _connection_with_rowcount(rowcount: int = 1) -> tuple[MagicMock, MagicMock]:
    cursor = MagicMock()
    cursor.rowcount = rowcount
    cursor_context = MagicMock()
    cursor_context.__enter__.return_value = cursor
    connection = MagicMock()
    connection.cursor.return_value = cursor_context
    connection_context = MagicMock()
    connection_context.__enter__.return_value = connection
    return connection_context, cursor


def test_mark_processing_updates_expected_episode() -> None:
    connection, cursor = _connection_with_rowcount()

    with patch("infrastructure.episode_repository.psycopg.connect", return_value=connection) as connect:
        PostgresEpisodeRepository(database_url="postgresql://example").mark_processing(
            podcast_id=1,
            episode_id=42,
            source_audio_path="podcasts/1/episodes/42/source/audio.mp3",
        )

    connect.assert_called_once_with("postgresql://example")
    parameters = cursor.execute.call_args.args[1]
    assert parameters == ("podcasts/1/episodes/42/source/audio.mp3", 1, 42)


def test_repository_raises_when_episode_does_not_exist() -> None:
    connection, _cursor = _connection_with_rowcount(0)

    with (
        patch("infrastructure.episode_repository.psycopg.connect", return_value=connection),
        pytest.raises(LookupError, match="podcast_id=1, episode_id=42"),
    ):
        PostgresEpisodeRepository(database_url="postgresql://example").mark_failed(
            podcast_id=1,
            episode_id=42,
            error_message="failed",
        )


def test_get_audio_audit_policy_returns_policy_with_enabled() -> None:
    connection, cursor = _connection_with_rowcount()
    cursor.fetchone.return_value = (
        {"version": "v2", "enabled": False, "confidential_terms": ["secret"], "allowed_terms": ["public"]},
    )

    with patch("infrastructure.episode_repository.psycopg.connect", return_value=connection):
        policy = PostgresEpisodeRepository(database_url="postgresql://example").get_audio_audit_policy(podcast_id="1")

    assert policy.version == "v2"
    assert policy.enabled is False
    assert policy.confidential_terms == ("secret",)
    assert policy.allowed_terms == ("public",)


def test_get_audio_audit_policy_defaults_enabled_to_true_when_missing() -> None:
    connection, cursor = _connection_with_rowcount()
    cursor.fetchone.return_value = ({"version": "v1", "confidential_terms": [], "allowed_terms": []},)

    with patch("infrastructure.episode_repository.psycopg.connect", return_value=connection):
        policy = PostgresEpisodeRepository(database_url="postgresql://example").get_audio_audit_policy(podcast_id="1")

    assert policy.version == "v1"
    assert policy.enabled is True
    assert policy.confidential_terms == ()
    assert policy.allowed_terms == ()


def test_get_audio_audit_policy_raises_on_invalid_enabled_type() -> None:
    connection, cursor = _connection_with_rowcount()
    cursor.fetchone.return_value = (
        {"version": "v1", "enabled": "not_a_bool", "confidential_terms": [], "allowed_terms": []},
    )

    with (
        patch("infrastructure.episode_repository.psycopg.connect", return_value=connection),
        pytest.raises(ValueError, match="Invalid audio audit policy configuration"),
    ):
        PostgresEpisodeRepository(database_url="postgresql://example").get_audio_audit_policy(podcast_id="1")
