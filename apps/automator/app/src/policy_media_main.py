"""Private Cloud Run media endpoint for policy assets and contextual previews."""

from __future__ import annotations

import base64
import io
import logging
import os
from typing import Any

import functions_framework
from google.cloud import storage
from pydub import AudioSegment

from domain.models.director import AudioAuditPolicy, UtteranceChunk
from infrastructure.director_voice_synthesizer import DirectorVoiceSynthesizer
from infrastructure.speech_transcriber import ChirpTranscriber
from services.audio_policy_editor import PolicyAudioEdit, export_audio, render_policy_audio
from services.fact_check_auditor import FactCheckAuditor
from services.pii_detector import PresidioPiiDetector

logger = logging.getLogger(__name__)
MAX_AUDIO_BYTES = 12 * 1024 * 1024
MAX_ASSET_MS = 120_000


def verify_text(text: str, policy: AudioAuditPolicy) -> None:
    """Re-run local PII and both Jev policy checks on the actual replacement text."""
    chunk = UtteranceChunk("replacement", "replacement", 0, 1, text)
    if not text.strip() or PresidioPiiDetector().detect(chunk, policy):
        raise ValueError("代替音声に個人情報が含まれるか、発話が空です。")
    if any(
        term.casefold() in text.casefold()
        for term in policy.confidential_terms
        if term and term.casefold() not in {allowed.casefold() for allowed in policy.allowed_terms}
    ):
        raise ValueError("代替音声に機密語句が含まれています。")
    if FactCheckAuditor()._audit_jev_policy_questions([chunk], policy):  # noqa: SLF001
        raise ValueError("代替音声にポリシー指摘が残っています。")


def process_media(data: dict) -> dict:
    """Prepare a validated PCM asset, or render one contextual preview."""
    operation = data.get("operation")
    policy = AudioAuditPolicy(
        confidential_terms=tuple(data.get("confidentialTerms", [])), allowed_terms=tuple(data.get("allowedTerms", []))
    )
    if operation == "synthesize":
        text = str(data.get("script", ""))
        verify_text(text, policy)
        audio = AudioSegment.from_file(io.BytesIO(DirectorVoiceSynthesizer().synthesize(text)), format="mp3")
    elif operation == "recording":
        raw = base64.b64decode(data["audioBase64"], validate=True)
        if not 0 < len(raw) <= MAX_AUDIO_BYTES:
            raise ValueError("録音サイズが不正です。")
        audio = AudioSegment.from_file(io.BytesIO(raw))
        if not 0 < len(audio) <= MAX_ASSET_MS or audio.rms == 0:
            raise ValueError("録音は発話を含む120秒以内の音声にしてください。")
        blob = storage.Client().bucket(os.environ["POLICY_AUDIO_BUCKET"]).blob(data["temporaryPath"])
        blob.upload_from_string(export_audio(audio, "wav"), content_type="audio/wav")
        try:
            transcriber = ChirpTranscriber(project_id=os.environ["PROJECT_ID"], location="asia-northeast1")
            segments = transcriber.transcribe({f"gs://{blob.bucket.name}/{blob.name}": len(audio) / 1000})
            text = "".join(s.text for group in segments.values() for s in group)
            verify_text(text, policy)
        finally:
            blob.delete()
    elif operation == "preview":
        bucket = storage.Client().bucket(os.environ["GCS_BUCKET"])
        blob = bucket.blob(data["sourcePath"], generation=int(data["sourceGeneration"]))
        raw = blob.download_as_bytes()
        source = AudioSegment.from_file(io.BytesIO(raw))
        start, end = int(data["startMs"]), int(data["endMs"])
        left, right = max(0, start - 2000), min(len(source), end + 2000)
        replacement = base64.b64decode(data["audioBase64"], validate=True) if data.get("audioBase64") else None
        audio, _ = render_policy_audio(
            source[left:right], [PolicyAudioEdit(start - left, end - left, data["action"], replacement)]
        )
        text = ""
    else:
        raise ValueError("Unknown media operation.")
    if operation != "preview":
        if not 0 < len(audio) <= MAX_ASSET_MS:
            raise ValueError("代替音声は120秒以内にしてください。")
        audio = audio.set_frame_rate(48000).set_channels(1).set_sample_width(2)
    return {
        "audioBase64": base64.b64encode(export_audio(audio, "wav")).decode(),
        "durationMs": len(audio),
        "transcript": text,
    }


@functions_framework.http
def policy_media(request: Any) -> tuple[dict, int]:
    """Serve authenticated-by-Cloud-Run media requests; do not log sensitive inputs."""
    if request.method != "POST":
        return {"error": "Method not allowed"}, 405
    if request.content_length and request.content_length > MAX_AUDIO_BYTES * 2:
        return {"error": "音声サイズが上限を超えています。"}, 413
    try:
        return process_media(request.get_json()), 200
    except ValueError as error:
        return {"error": str(error)}, 400
    except Exception:  # noqa: BLE001
        logger.exception("Policy media processing failed")
        return {"error": "音声の生成・検証に失敗しました。"}, 502
