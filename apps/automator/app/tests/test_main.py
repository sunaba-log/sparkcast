from __future__ import annotations

import logging
from unittest import mock

from entrypoints.main import _load_podcast_env, _log_environment
from main import send_discord_notification


def test_send_discord_notification_posts_payload() -> None:
    env = {"DISCORD_WEBHOOK_INFO_URL": "https://discord.example/webhook"}
    handler = logging.NullHandler()
    logger = logging.getLogger("test_discord")
    logger.setLevel(logging.INFO)
    logger.handlers = [handler]
    logger.propagate = False

    with mock.patch("urllib.request.urlopen") as mocked:
        mocked.return_value.__enter__.return_value.read.return_value = b""
        send_discord_notification("hello", environ=env, logger=logger)

    assert mocked.called


def test_send_discord_notification_no_webhook_is_noop() -> None:
    with mock.patch("urllib.request.urlopen") as mocked:
        send_discord_notification("hello", environ={})

    assert not mocked.called


def test_load_env_config_resolves_audit_trace_settings() -> None:
    base_env = {
        "PROJECT_ID": "test-project",
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
        "GCS_BUCKET": "test-gcs-bucket",
        "GCS_TRIGGER_OBJECT_NAME": "test.mp3",
        "R2_BUCKET": "test-r2-bucket",
        "SECRET_NAME": "test-secret",
    }

    # Default: disabled
    config_default = _load_podcast_env(base_env)
    assert not config_default.audit_trace_enabled
    assert config_default.audit_trace_gcs_bucket is None
    assert config_default.audit_trace_local_dir is None
    assert config_default.audit_trace_prefix == "audit_traces"

    # Explicitly enabled with GCS bucket and custom prefix
    custom_env = {
        **base_env,
        "AUDIT_TRACE_ENABLED": "true",
        "AUDIT_TRACE_GCS_BUCKET": "sparkcast-automator-audit-traces-prod",
        "AUDIT_TRACE_PREFIX": "custom_audit_traces",
    }
    config_custom = _load_podcast_env(custom_env)
    assert config_custom.audit_trace_enabled
    assert config_custom.audit_trace_gcs_bucket == "sparkcast-automator-audit-traces-prod"
    assert config_custom.audit_trace_local_dir is None
    assert config_custom.audit_trace_prefix == "custom_audit_traces"

    # Ensure logging does not fail
    _log_environment(config_custom)
