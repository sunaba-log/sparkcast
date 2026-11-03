"""Google Cloud Text-to-Speech adapter for director correction cut-ins."""

from __future__ import annotations

from dataclasses import dataclass

from google.cloud import texttospeech

MIN_SPEAKING_RATE = 0.25
MAX_SPEAKING_RATE = 4.0
MIN_PITCH = -20.0
MAX_PITCH = 20.0
MIN_VOLUME_GAIN_DB = -96.0
MAX_VOLUME_GAIN_DB = 16.0


@dataclass(frozen=True)
class DirectorVoicePersona:
    """Voice parameters that express the podcast director's delivery."""

    voice_name: str = "ja-JP-Neural2-B"
    language_code: str = "ja-JP"
    speaking_rate: float = 1.0
    pitch: float = 0.0
    volume_gain_db: float = 0.0


class DirectorVoiceSynthesizer:
    """Synthesize Japanese director audio using Google Cloud Text-to-Speech."""

    def __init__(self, client: texttospeech.TextToSpeechClient | None = None) -> None:
        """Create an adapter using application-default credentials when needed."""
        self._client = client or texttospeech.TextToSpeechClient()

    def synthesize(self, script: str, *, persona: DirectorVoicePersona | None = None) -> bytes:
        """Return MP3 audio for a non-empty correction script."""
        if not script.strip():
            msg = "Correction script must not be empty."
            raise ValueError(msg)
        persona = persona or DirectorVoicePersona()
        _validate_persona(persona)
        response = self._client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=script),
            voice=texttospeech.VoiceSelectionParams(
                language_code=persona.language_code,
                name=persona.voice_name,
            ),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                speaking_rate=persona.speaking_rate,
                pitch=persona.pitch,
                volume_gain_db=persona.volume_gain_db,
            ),
        )
        if not response.audio_content:
            msg = "Google Cloud Text-to-Speech returned an empty audio response."
            raise RuntimeError(msg)
        return bytes(response.audio_content)


def _validate_persona(persona: DirectorVoicePersona) -> None:
    """Reject values outside Google Cloud Text-to-Speech's accepted ranges."""
    if not persona.voice_name:
        msg = "voice_name must not be empty."
        raise ValueError(msg)
    if not persona.language_code:
        msg = "language_code must not be empty."
        raise ValueError(msg)
    if not MIN_SPEAKING_RATE <= persona.speaking_rate <= MAX_SPEAKING_RATE:
        msg = "speaking_rate must be between 0.25 and 4.0."
        raise ValueError(msg)
    if not MIN_PITCH <= persona.pitch <= MAX_PITCH:
        msg = "pitch must be between -20.0 and 20.0."
        raise ValueError(msg)
    if not MIN_VOLUME_GAIN_DB <= persona.volume_gain_db <= MAX_VOLUME_GAIN_DB:
        msg = "volume_gain_db must be between -96.0 and 16.0."
        raise ValueError(msg)
