from __future__ import annotations

from pathlib import Path  # noqa: TC003
from types import SimpleNamespace

import pytest

import mixer_main
from services.recording_mixer.mixer import MixError, MixResult, SpeakerReport

ENV = {
    "RECORDING_SESSION_ID": "sid",
    "PODCAST_ID": "7",
    "EPISODE_ID": "42",
    "OUTPUT_OBJECT_PATH": "podcasts/7/episodes/42/source/recording-sid.flac",
    "DATABASE_URL": "postgresql://u:p@localhost/db",
    "RECORDINGS_BUCKET": "recordings",
    "CLOUDFLARE_ACCESS_KEY_ID": "k",
    "CLOUDFLARE_SECRET_ACCESS_KEY": "s",
    "GCS_BUCKET": "input",
}


class _Repository:
    def __init__(self, **_kwargs: object) -> None:
        self.calls: list[tuple[str, dict]] = []
        _Repository.instance = self

    def __getattr__(self, name: str):
        return lambda **kwargs: self.calls.append((name, kwargs))


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(mixer_main, "PostgresRecordingRepository", _Repository)
    monkeypatch.setattr(mixer_main, "R2RecordingObjects", lambda **_kwargs: SimpleNamespace())


def test_rejects_output_paths_outside_the_episode(env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OUTPUT_OBJECT_PATH", "podcasts/8/episodes/42/source/x.flac")
    with pytest.raises(SystemExit):
        mixer_main.main()


def test_uploads_the_mix_and_marks_the_session_done(env: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    output = tmp_path / "mix.flac"
    output.write_bytes(b"flac")
    report = SpeakerReport(participant_id="p1", name="ゲスト", aligned_key="sessions/sid/aligned/p1.flac")
    monkeypatch.setattr(
        mixer_main,
        "mix_session",
        lambda **_kwargs: MixResult(duration_seconds=10, speakers=[report], output_path=output),
    )
    uploads: list[tuple[str, str]] = []
    monkeypatch.setattr(mixer_main, "upload_to_gcs", lambda bucket, path, _file: uploads.append((bucket, path)))

    mixer_main.main()

    assert uploads == [("input", "podcasts/7/episodes/42/source/recording-sid.flac")]
    names = [name for name, _ in _Repository.instance.calls]
    assert names == ["set_aligned_track", "mark_episode_uploaded", "mark_session_done"]


def test_marks_failure_and_notifies(env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    def _fail(**_kwargs: object) -> MixResult:
        raise MixError("録音データがありません")

    monkeypatch.setattr(mixer_main, "mix_session", _fail)
    messages: list[str] = []
    monkeypatch.setattr(
        mixer_main.Notifier, "send_discord_message", lambda _self, message, **_kw: messages.append(message)
    )

    with pytest.raises(SystemExit):
        mixer_main.main()

    assert _Repository.instance.calls == [
        ("mark_failed", {"session_id": "sid", "episode_id": "42", "error": "録音データがありません"})
    ]
    assert "sid" in messages[0]
