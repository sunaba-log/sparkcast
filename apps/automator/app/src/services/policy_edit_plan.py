"""Consume a frozen policy edit plan with immutable source and asset validation."""

from __future__ import annotations

import hashlib
import io
import os
from dataclasses import replace

from google.cloud import firestore, storage
from pydub import AudioSegment

from domain.models.transcript import TranscriptSegment
from infrastructure.director_voice_synthesizer import DirectorVoiceSynthesizer
from services.audio_policy_editor import PolicyAudioEdit, export_audio, render_policy_audio


class DuplicatePolicyEditError(Exception):
    """Another execution already claimed this edit plan."""


def apply_saved_policy_plan(
    project_id: str, podcast_id: str, episode_id: str, plan_id: str, source_path: str
) -> tuple[bytes, list[dict], dict]:
    """Claim and render an approved plan, rejecting changed source generations."""
    db = firestore.Client(project=project_id)
    root = db.collection("podcasts").document(podcast_id).collection("episodes_contents").document(episode_id)
    ref = root.collection("audio_edit_plans").document(plan_id)

    @firestore.transactional
    def claim(transaction: firestore.Transaction) -> dict:
        plan = ref.get(transaction=transaction).to_dict()
        if not plan or plan.get("sourcePath") != source_path:
            raise ValueError("The edit plan does not match the source audio.")
        if plan.get("status") != "queued":
            raise DuplicatePolicyEditError
        transaction.update(ref, {"status": "running"})
        return plan

    plan = claim(db.transaction())
    try:
        client = storage.Client(project=project_id)
        blob = client.bucket(os.environ["GCS_BUCKET"]).blob(source_path)
        blob.reload()
        if str(blob.generation) != plan["sourceGeneration"]:
            raise ValueError("The source audio was replaced after review.")
        raw = blob.download_as_bytes(if_generation_match=int(plan["sourceGeneration"]))
        source = AudioSegment.from_file(io.BytesIO(raw))
        edits = []
        for operation in plan["operations"]:
            asset_path = operation.get("assetPath")
            replacement = None
            if operation["action"] == "replace":
                if not asset_path or not asset_path.startswith(f"policy/{podcast_id}/{episode_id}/assets/"):
                    raise ValueError("The replacement asset does not belong to this episode.")
                replacement = client.bucket(os.environ["POLICY_AUDIO_BUCKET"]).blob(asset_path).download_as_bytes()
                if hashlib.sha256(replacement).hexdigest() != operation["assetHash"]:
                    raise ValueError("The replacement asset changed after approval.")
            edits.append(PolicyAudioEdit(operation["startMs"], operation["endMs"], operation["action"], replacement))
        for correction in plan.get("corrections", []):
            synthesized = DirectorVoiceSynthesizer().synthesize(correction["script"])
            wav = export_audio(AudioSegment.from_file(io.BytesIO(synthesized), format="mp3"), "wav")
            edits.append(PolicyAudioEdit(correction["startMs"], correction["startMs"], "insert", wav))
        audio, timeline = render_policy_audio(source, edits)
        ref.update({"timeline": timeline, "renderedDurationMs": len(audio)})
        return export_audio(audio), timeline, plan
    except Exception:
        ref.update({"status": "failed"})
        raise


def remap_policy_segments(
    segments: list[TranscriptSegment], timeline: list[dict], plan: dict
) -> list[TranscriptSegment]:
    """Remove edited evidence and place replacement text on the output timeline."""
    output = []
    for piece in timeline:
        start, end = piece["sourceStartMs"] / 1000, piece["sourceEndMs"] / 1000
        delta = (piece["outputStartMs"] - piece["sourceStartMs"]) / 1000
        if piece["kind"] == "original":
            for segment in segments:
                if segment.end <= start or segment.start >= end:
                    continue
                words = tuple(
                    replace(w, start=w.start + delta, end=w.end + delta)
                    for w in segment.words
                    if w.start >= start and w.end <= end
                )
                if segment.words:
                    if words:
                        output.append(
                            replace(
                                segment,
                                start=words[0].start,
                                end=words[-1].end,
                                text="".join(w.text for w in words),
                                words=words,
                            )
                        )
                elif segment.start >= start and segment.end <= end:
                    output.append(replace(segment, start=segment.start + delta, end=segment.end + delta))
        elif piece["kind"] == "insert":
            correction = next(c for c in plan["corrections"] if c["startMs"] == piece["sourceStartMs"])
            output.append(
                TranscriptSegment(
                    piece["outputStartMs"] / 1000, piece["outputEndMs"] / 1000, correction["script"], "AIディレクター"
                )
            )
        elif piece["kind"] == "replace":
            operation = next(op for op in plan["operations"] if op["startMs"] == piece["sourceStartMs"])
            output.append(
                TranscriptSegment(
                    piece["outputStartMs"] / 1000,
                    piece["outputEndMs"] / 1000,
                    operation["replacementTranscript"],
                    "代替音声",
                )
            )
    return sorted(output, key=lambda item: item.start)


def finish_policy_plan(project_id: str, podcast_id: str, episode_id: str, plan_id: str, timeline: list[dict]) -> None:
    """Record the active source-to-rendition map after publishing succeeds."""
    db = firestore.Client(project=project_id)
    root = db.collection("podcasts").document(podcast_id).collection("episodes_contents").document(episode_id)
    root.collection("audio_edit_plans").document(plan_id).update({"status": "applied"})
    root.set({"active_edit_plan_id": plan_id, "audio_timeline": timeline}, merge=True)


def fail_policy_plan(project_id: str, podcast_id: str, episode_id: str, plan_id: str) -> None:
    """Mark a claimed plan failed when a later publication step fails."""
    db = firestore.Client(project=project_id)
    ref = (
        db.collection("podcasts")
        .document(podcast_id)
        .collection("episodes_contents")
        .document(episode_id)
        .collection("audio_edit_plans")
        .document(plan_id)
    )
    if ref.get().exists:
        ref.update({"status": "failed"})
