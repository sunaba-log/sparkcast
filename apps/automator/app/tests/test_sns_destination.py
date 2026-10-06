"""Automatic posting must preserve the channel destination without requiring approval."""

from __future__ import annotations

import socket
from unittest.mock import MagicMock

import pytest

from domain.interfaces import ChannelCredentials
from entrypoints import promoter_main
from usecases.auto_post_sns import AutoPostSnsUsecase


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError("Live network is forbidden in destination tests")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)


def promotion(podcast_id="p1"):
    return {
        "doc_id": "post1",
        "reference_path": f"podcasts/{podcast_id}/episodes_contents/e1/sns_promotions/post1",
        "status": "pending",
        "scheduled_time": "2000-01-01T00:00:00+00:00",
        "message": "Synthetic automatically published message",
    }


def credentials():
    return {
        "x_api_key": "key",
        "x_api_secret": "secret",
        "x_access_token": "token",
        "x_access_token_secret": "token-secret",
    }


@pytest.mark.parametrize("missing", list(credentials()))
def test_incomplete_credentials_never_select_default_client(missing, monkeypatch):
    firestore = MagicMock()
    firestore.get_pending_sns_promotions.return_value = [promotion()]
    values = credentials()
    values[missing] = ""
    secrets = MagicMock()
    secrets.get_channel_credentials.return_value = ChannelCredentials(**values)
    default = MagicMock()
    factory = MagicMock()
    monkeypatch.setattr("usecases.auto_post_sns.XClient", factory)
    AutoPostSnsUsecase(firestore_manager=firestore, secret_provider=secrets, x_client=default).run()
    factory.assert_not_called()
    default.post_thread.assert_not_called()
    firestore.update_sns_promotion_status.assert_called_once_with(promotion()["reference_path"], "failed")


@pytest.mark.parametrize("failure", [False, RuntimeError("synthetic auth failure")])
def test_failed_authentication_never_switches_accounts(failure, monkeypatch):
    firestore = MagicMock()
    firestore.get_pending_sns_promotions.return_value = [promotion()]
    secrets = MagicMock()
    secrets.get_channel_credentials.return_value = ChannelCredentials(**credentials())
    channel = MagicMock()
    if isinstance(failure, Exception):
        channel.verify_auth.side_effect = failure
    else:
        channel.verify_auth.return_value = failure
    monkeypatch.setattr("usecases.auto_post_sns.XClient", MagicMock(return_value=channel))
    default = MagicMock()
    AutoPostSnsUsecase(firestore_manager=firestore, secret_provider=secrets, x_client=default).run()
    channel.post_thread.assert_not_called()
    default.post_thread.assert_not_called()
    firestore.update_sns_promotion_status.assert_called_once_with(promotion()["reference_path"], "failed")


@pytest.mark.parametrize(
    "reference",
    [
        "podcasts/p1",
        "podcasts//episodes_contents/e1/sns_promotions/post1",
        "other/p1/episodes_contents/e1/sns_promotions/post1",
        "podcasts/p1/episodes_contents/e1/other/post1",
        "podcasts/p1/episodes_contents/e1/sns_promotions/different",
    ],
)
def test_invalid_reference_cannot_select_an_account_or_update_an_unrelated_document(reference):
    firestore = MagicMock()
    item = promotion()
    item["reference_path"] = reference
    firestore.get_pending_sns_promotions.return_value = [item]
    secrets = MagicMock()
    default = MagicMock()
    AutoPostSnsUsecase(firestore_manager=firestore, secret_provider=secrets, x_client=default).run()
    secrets.get_channel_credentials.assert_not_called()
    default.post_thread.assert_not_called()
    firestore.update_sns_promotion_status.assert_not_called()


def test_pending_posts_automatically_use_their_own_channel_client(monkeypatch):
    firestore = MagicMock()
    secrets = MagicMock()
    channel_creds = {
        podcast: ChannelCredentials(**{k: f"{podcast}-{v}" for k, v in credentials().items()})
        for podcast in ("p1", "p2")
    }
    secrets.get_channel_credentials.side_effect = channel_creds.__getitem__
    clients = {podcast: MagicMock() for podcast in channel_creds}
    for client in clients.values():
        client.verify_auth.return_value = True
        client.post_thread.return_value = True

    def client_factory(**kwargs):
        podcast = kwargs["api_key"].split("-")[0]
        assert kwargs["access_token"] == f"{podcast}-token"
        return clients[podcast]

    monkeypatch.setattr("usecases.auto_post_sns.XClient", client_factory)
    default = MagicMock()
    usecase = AutoPostSnsUsecase(firestore_manager=firestore, secret_provider=secrets, x_client=default)
    for podcast, client in clients.items():
        firestore.get_pending_sns_promotions.return_value = [promotion(podcast)]
        usecase.run()
        client.post_thread.assert_called_once()
        firestore.update_sns_promotion_status.assert_called_with(promotion(podcast)["reference_path"], "posted")
    assert secrets.get_channel_credentials.call_args_list[0].args == ("p1",)
    assert secrets.get_channel_credentials.call_args_list[1].args == ("p2",)
    default.post_thread.assert_not_called()


@pytest.mark.parametrize("legacy_env_present", [True, False])
def test_promoter_entrypoint_uses_only_channel_credentials(legacy_env_present, monkeypatch):
    monkeypatch.setenv("PROJECT_ID", "synthetic")
    for name in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"):
        if legacy_env_present:
            monkeypatch.setenv(name, "synthetic-legacy-value")
        else:
            monkeypatch.delenv(name, raising=False)
    secrets_factory = MagicMock()
    firestore_factory = MagicMock()
    usecase_factory = MagicMock()
    monkeypatch.setattr(promoter_main, "SecretManagerClient", secrets_factory)
    monkeypatch.setattr(promoter_main, "FirestoreManager", firestore_factory)
    monkeypatch.setattr(promoter_main, "AutoPostSnsUsecase", usecase_factory)
    # If the entrypoint ever tries to construct the legacy client, fail immediately.
    monkeypatch.setattr(
        "infrastructure.x_api.XClient", MagicMock(side_effect=AssertionError("Legacy client constructed"))
    )
    promoter_main.auto_post_sns()
    assert usecase_factory.call_args.kwargs["secret_provider"] is secrets_factory.return_value
    assert "x_client" not in usecase_factory.call_args.kwargs
    usecase_factory.return_value.run.assert_called_once()
