"""Tests for the Google Cloud Text-to-Speech director adapter."""

from types import SimpleNamespace

import pytest
from google.cloud import texttospeech

from infrastructure.director_voice_synthesizer import DirectorVoicePersona, DirectorVoiceSynthesizer


class _TtsClient:
    def __init__(self, audio_content: bytes = b"mp3") -> None:
        self.audio_content = audio_content
        self.request: dict[str, object] | None = None

    def synthesize_speech(self, **kwargs: object) -> SimpleNamespace:
        self.request = kwargs
        return SimpleNamespace(audio_content=self.audio_content)


def test_synthesizer_uses_persona_parameters_and_mp3_encoding() -> None:
    client = _TtsClient()
    persona = DirectorVoicePersona(
        voice_name="ja-JP-Journey-D",
        speaking_rate=1.1,
        pitch=2.5,
        volume_gain_db=-1.5,
    )

    output = DirectorVoiceSynthesizer(client=client).synthesize("訂正です。", persona=persona)

    assert output == b"mp3"
    assert client.request is not None
    assert client.request["input"].text == "訂正です。"  # type: ignore[union-attr]
    assert client.request["voice"].name == "ja-JP-Journey-D"  # type: ignore[union-attr]
    audio_config = client.request["audio_config"]  # type: ignore[assignment]
    assert audio_config.audio_encoding == texttospeech.AudioEncoding.MP3  # type: ignore[union-attr]
    assert audio_config.speaking_rate == pytest.approx(1.1)  # type: ignore[union-attr]
    assert audio_config.pitch == pytest.approx(2.5)  # type: ignore[union-attr]
    assert audio_config.volume_gain_db == pytest.approx(-1.5)  # type: ignore[union-attr]


@pytest.mark.parametrize(
    ("script", "persona", "message"),
    [
        (" ", DirectorVoicePersona(), "must not be empty"),
        ("訂正", DirectorVoicePersona(speaking_rate=4.1), "speaking_rate"),
        ("訂正", DirectorVoicePersona(pitch=20.1), "pitch"),
    ],
)
def test_synthesizer_rejects_invalid_requests(script: str, persona: DirectorVoicePersona, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        DirectorVoiceSynthesizer(client=_TtsClient()).synthesize(script, persona=persona)


def test_synthesizer_rejects_empty_tts_response() -> None:
    with pytest.raises(RuntimeError, match="empty audio"):
        DirectorVoiceSynthesizer(client=_TtsClient(audio_content=b"")).synthesize("訂正です。")
