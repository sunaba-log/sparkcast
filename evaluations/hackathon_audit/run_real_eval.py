"""検証3・5（実API）：合成データで Jev・Gemini・STT・TTS を実行し、監査と編集の結果・時間・呼び出し量を記録する。

段階：
  text   … cases.json の全ケースをテキストのまま監査（ローカル検出＋Jev 2種＋必要時 Gemini 裏取り・訂正案）
  audio  … audio=true のケースを TTS で音声化 → 非公開GCSへ一時アップロード → STT → 監査。
           UI の範囲提案（TS 側）へ渡す handoff.json を出力
  edit   … 範囲提案（proposals.json、無ければ機密語の単語一致）で カット／無音化／置換 を作成し、
           編集後の音声を STT にかけ直して機密語が残らないかを確認。音声はローカルに保存（人が試聴する）

安全条件：EVAL_ALLOW_REAL_API=1 かつ GOOGLE_CLOUD_PROJECT=sunabalog-dev 以外では実APIを呼ばない。
GCS は --bucket に指定した非公開バケットのみ（allUsers/allAuthenticatedUsers が付いていれば中止）。
アップロードした一時オブジェクトは終了時に削除する。API キー・署名付きURLは出力しない。
呼び出し回数の上限（--max-jev / --max-gemini / --max-stt-seconds）を超える前に停止する。

実行例（apps/automator/app で）：
  EVAL_ALLOW_REAL_API=1 GOOGLE_CLOUD_PROJECT=sunabalog-dev TYPESAFE_API_KEY=... \
    uv run --frozen python ../../../evaluations/hackathon_audit/run_real_eval.py text
  ...                          run_real_eval.py audio --bucket <非公開バケット>
  ...                          run_real_eval.py edit  --bucket <非公開バケット> --run <audio段階の出力ディレクトリ>
配線確認（外部呼び出しなし）：… run_real_eval.py text --dry-run（audio / edit も同様）
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parents[1] / "apps/automator/app/src")]

from pydub import AudioSegment  # noqa: E402
from pydub.generators import Sine  # noqa: E402

from domain.models.director import AudioAuditPolicy, UtteranceChunk  # noqa: E402
from domain.models.transcript import TranscriptSegment, TranscriptWord  # noqa: E402
from services.audio_policy_editor import PolicyAudioEdit, export_audio, render_policy_audio  # noqa: E402
from services.fact_check_auditor import FactCheckAuditor  # noqa: E402

ALLOWED_PROJECT = "sunabalog-dev"
CASES = json.loads((HERE / "cases.json").read_text())
POLICY = AudioAuditPolicy(
    version=CASES["policy"]["version"],
    confidential_terms=tuple(CASES["policy"]["confidential_terms"]),
    allowed_terms=tuple(CASES["policy"]["allowed_terms"]),
)
SECRET = CASES["policy"]["confidential_terms"][0]


class Budget:
    def __init__(self, args: argparse.Namespace) -> None:
        self.max = {"jev": args.max_jev, "gemini": args.max_gemini, "stt_seconds": args.max_stt_seconds}
        self.used = {"jev": 0, "gemini": 0, "stt_seconds": 0.0, "tts_chars": 0}

    def take(self, key: str, amount: float = 1) -> None:
        if key in self.max and self.used[key] + amount > self.max[key]:
            msg = f"上限に達したため停止しました: {key} {self.used[key]}+{amount} > {self.max[key]}"
            raise SystemExit(msg)
        self.used[key] += amount


class JevProxy:
    """AsyncTypeSafeClient.system_one を中継し、回数・時間・応答モデルを記録する."""

    def __init__(self, inner: Any, budget: Budget, log: list) -> None:
        self.inner, self.budget, self.log = inner, budget, log

    async def system_one(self, **kwargs: Any) -> Any:
        self.budget.take("jev")
        started = time.perf_counter()
        response = await self.inner.system_one(**kwargs)
        self.log.append(
            {
                "api": "jev.system_one",
                "questions": sorted(kwargs.get("questions", {})),
                "ms": round((time.perf_counter() - started) * 1000),
                "model": getattr(response, "model", None),
                "usage": _plain(getattr(response, "usage", None)),
            }
        )
        return response


class GeminiModelsProxy:
    def __init__(self, inner: Any, budget: Budget, log: list) -> None:
        self.inner, self.budget, self.log = inner, budget, log

    def generate_content(self, **kwargs: Any) -> Any:
        self.budget.take("gemini")
        started = time.perf_counter()
        response = self.inner.generate_content(**kwargs)
        cfg = kwargs.get("config")
        usage = getattr(response, "usage_metadata", None)
        self.log.append(
            {
                "api": "gemini.generate_content",
                "model": kwargs.get("model"),
                "grounding_tool": bool(getattr(cfg, "tools", None)),
                "ms": round((time.perf_counter() - started) * 1000),
                "usage": {
                    k: getattr(usage, k, None)
                    for k in ("prompt_token_count", "candidates_token_count", "thoughts_token_count", "tool_use_prompt_token_count", "total_token_count")
                }
                if usage
                else None,
            }
        )
        return response


def _plain(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "__dict__"):
        return {k: _plain(v) for k, v in vars(value).items()}
    return str(value)


# ---------- 配線確認用の代替（外部呼び出しなし） ----------
class _FakeJev:
    async def system_one(self, *, state: str, questions: dict, model: Any = None) -> Any:
        text = state.split("発話: ", 1)[-1]
        a: dict[str, Any] = {}
        for key in questions:
            if key == "noul":
                a[key] = SimpleNamespace(noul=0.9 if "Python" in text else 0.1)
            elif key == "score":
                a[key] = SimpleNamespace(score=3.0 if "2005" in text else 0.0, confidence=0.8)
            elif key == "choice":
                a[key] = SimpleNamespace(choice="numerical_data" if "2005" in text else "none")
            else:
                a[key] = SimpleNamespace(noul=0.9 if SECRET in text and key == "confidential_information" else 0.05)
        return SimpleNamespace(answers=a, model="dry-run")


class _FakeGeminiModels:
    def generate_content(self, *, model: str, contents: Any, config: Any = None) -> Any:
        text = "【命題】Pythonの初公開年\n【判定】誤り\n【正しい事実】1991年\n【理由】年が違う" if getattr(config, "tools", None) else json.dumps(
            {"correction_script": "補足です。Pythonの最初の公開は1991年です。", "target_speaker": "話者A", "insert_timestamp_ms": 5000, "reason": "dry-run"}, ensure_ascii=False
        )
        return SimpleNamespace(text=text, candidates=[], usage_metadata=None)


def _guard(args: argparse.Namespace) -> None:
    if args.dry_run:
        return
    if os.environ.get("EVAL_ALLOW_REAL_API") != "1" or os.environ.get("GOOGLE_CLOUD_PROJECT") != ALLOWED_PROJECT:
        raise SystemExit(f"refused: 実APIには EVAL_ALLOW_REAL_API=1 と GOOGLE_CLOUD_PROJECT={ALLOWED_PROJECT} が必要です")
    if not (os.environ.get("TYPESAFE_API_KEY") or os.environ.get("JEV_API_KEY")):
        raise SystemExit("refused: TYPESAFE_API_KEY（Jev）が設定されていません")


def _clients(args: argparse.Namespace, budget: Budget, calls: list):
    from services.director_script_generator import DirectorScriptGenerator
    from services.fact_verification_agent import FactVerificationAgent

    if args.dry_run:
        jev, models = _FakeJev(), _FakeGeminiModels()
    else:
        from google import genai
        from typesafe_sdk import AsyncTypeSafeClient

        key = (os.environ.get("TYPESAFE_API_KEY") or os.environ.get("JEV_API_KEY") or "").strip()
        jev = AsyncTypeSafeClient(api_key=key)
        models = genai.Client(vertexai=True, project=ALLOWED_PROJECT, location=os.environ.get("GOOGLE_CLOUD_REGION", "us-central1")).models
    gemini = SimpleNamespace(models=GeminiModelsProxy(models, budget, calls))
    auditor = FactCheckAuditor(client=JevProxy(jev, budget, calls))  # type: ignore[arg-type]
    verifier = FactVerificationAgent(client=gemini, model_id=args.model)  # type: ignore[arg-type]
    director = DirectorScriptGenerator(client=gemini, model_id=args.model)  # type: ignore[arg-type]
    return auditor, verifier, director


def _audit(chunks: list[UtteranceChunk], args, budget, calls) -> dict[str, Any]:
    """本番ワークフロー Step 2.5 と同じ順序で監査し、段階ごとの時間を測る."""
    auditor, verifier, director = _clients(args, budget, calls)
    t0 = time.perf_counter()
    bundle = auditor.audit_bundle(chunks, policy=POLICY)
    audit_ms = round((time.perf_counter() - t0) * 1000)
    rows: dict[str, Any] = {}
    for chunk, metric in bundle.fact_check_results:
        row: dict[str, Any] = {
            "chunk_id": chunk.chunk_id,
            "text": chunk.text,
            "jev_fact": {"noul": metric.noul, "score": metric.score, "choice": metric.choice, "confidence": metric.confidence},
            "should_intervene": metric.should_intervene(),
            "policy_findings": [
                {k: f.to_dict()[k] for k in ("category", "source", "entity_type", "evidence_text", "range_precision", "probability", "start_ms", "end_ms", "word_ids")}
                for f in bundle.policy_findings
                if f.chunk_id == chunk.chunk_id
            ],
        }
        if metric.should_intervene():
            t1 = time.perf_counter()
            v = verifier.verify_chunk(chunk=chunk, metric=metric, all_chunks=chunks, model_id=args.model)
            row["verification"] = None if v is None else {"claim": v.claim, "is_false": v.is_false, "ground_truth": v.ground_truth, "reason": v.reason, "sources": [s.url for s in v.sources]}
            row["verification_ms"] = round((time.perf_counter() - t1) * 1000)
            if v is None or v.is_false:
                t2 = time.perf_counter()
                it = director.generate_intervention(chunk=chunk, metric=metric, all_chunks=chunks, cast_names=["話者A", "話者B"], model_id=args.model, verification=v)
                row["correction"] = None if it is None else {"script": it.correction_script, "reason": it.reason, "reference_url": it.reference_url}
                row["correction_ms"] = round((time.perf_counter() - t2) * 1000)
        rows[chunk.chunk_id] = row
    return {"audit_bundle_ms": audit_ms, "rows": rows, "findings": bundle.policy_findings}


def _auto_judge(case: dict, row: dict) -> dict:
    exp = case["expected"]
    has_policy = bool(row["policy_findings"])
    has_correction = bool(row.get("correction"))
    targets = exp.get("targets", [])
    found = " ".join(f["evidence_text"] or "" for f in row["policy_findings"])
    return {
        "policy_finding": {"expected": exp["policy_finding"], "actual": has_policy},
        "fact_correction": {"expected": exp["fact_correction"], "actual": has_correction},
        "targets_in_evidence": {t: (t in found) for t in targets},
        "auto_match": has_policy == exp["policy_finding"] and has_correction == exp["fact_correction"],
        "review": None,
    }


def _out_dir(args, phase: str) -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    d = Path(args.run) if args.run else HERE / "real_runs" / f"{stamp}-{'dryrun' if args.dry_run else 'real'}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _meta(args, budget) -> dict:
    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False).stdout.strip()
    return {"commit": commit, "dry_run": args.dry_run, "model": args.model, "policy_version": POLICY.version, "budget_used": budget.used, "budget_max": budget.max}


def phase_text(args) -> None:
    budget, calls = Budget(args), []
    chunks = [UtteranceChunk(c["id"], c["speaker"], i * 10_000, i * 10_000 + 5_000, c["text"]) for i, c in enumerate(CASES["cases"])]
    t0 = time.perf_counter()
    result = _audit(chunks, args, budget, calls)
    rows = []
    for case in CASES["cases"]:
        row = result["rows"][case["id"]]
        rows.append({"case": case["id"], "kind": case["kind"], **row, "judge": _auto_judge(case, row)})
    out = _out_dir(args, "text")
    (out / "text_results.json").write_text(json.dumps({"meta": _meta(args, budget), "total_ms": round((time.perf_counter() - t0) * 1000), "audit_bundle_ms": result["audit_bundle_ms"], "calls": calls, "rows": rows}, ensure_ascii=False, indent=1))
    print(json.dumps({"out": str(out / "text_results.json"), **budget.used, "auto_match": sum(r["judge"]["auto_match"] for r in rows), "cases": len(rows)}, ensure_ascii=False))


def _bucket(args):
    if args.dry_run:
        return None
    if not args.bucket:
        raise SystemExit("--bucket（非公開の GCS バケット）を指定してください")
    from google.cloud import storage

    bucket = storage.Client(project=ALLOWED_PROJECT).bucket(args.bucket)
    policy = bucket.get_iam_policy(requested_policy_version=3)
    members = {m for b in policy.bindings for m in b.get("members", [])}
    if {"allUsers", "allAuthenticatedUsers"} & members:
        raise SystemExit(f"中止：バケット {args.bucket} は公開されています")
    return bucket


def _tts(text: str, voice: str, args, budget) -> AudioSegment:
    budget.take("tts_chars", len(text))
    if args.dry_run:
        return Sine(440 if voice.endswith("B") else 660).to_audio_segment(duration=120 * len(text), volume=-15)
    from infrastructure.director_voice_synthesizer import DirectorVoicePersona, DirectorVoiceSynthesizer

    mp3 = DirectorVoiceSynthesizer().synthesize(text, persona=DirectorVoicePersona(voice_name=voice))
    return AudioSegment.from_file(io.BytesIO(mp3), format="mp3")


def _stt(audio: AudioSegment, name: str, args, budget, bucket, run_id: str, expected_text: str | None = None) -> tuple[list[TranscriptSegment], int]:
    seconds = len(audio) / 1000
    budget.take("stt_seconds", seconds)
    if args.dry_run:
        import re

        text = expected_text or ""
        tokens = [t for t in re.split(f"({re.escape(SECRET)}|[、。：])", text) if t]
        step = seconds / max(1, len(tokens))
        words = tuple(TranscriptWord(t, i * step, (i + 1) * step) for i, t in enumerate(tokens))
        return [TranscriptSegment(0, seconds, text, speaker="話者A", words=words)], 0
    from infrastructure.speech_transcriber import ChirpTranscriber

    blob = bucket.blob(f"eval-hackathon/{run_id}/{name}.wav")
    blob.upload_from_string(export_audio(audio.set_channels(1), "wav"), content_type="audio/wav")
    try:
        started = time.perf_counter()
        uri = f"gs://{bucket.name}/{blob.name}"
        segs = ChirpTranscriber(project_id=ALLOWED_PROJECT, location="asia-northeast1", model="long").transcribe({uri: seconds})[uri]
        return segs, round((time.perf_counter() - started) * 1000)
    finally:
        blob.delete()


def phase_audio(args) -> None:
    _guard(args)
    budget, calls = Budget(args), []
    bucket = _bucket(args)
    out = _out_dir(args, "audio")
    run_id = out.name
    audio = AudioSegment.silent(500)
    truth = []
    t0 = time.perf_counter()
    for i, case in enumerate(c for c in CASES["cases"] if c["audio"]):
        voice = "ja-JP-Neural2-B" if i % 2 == 0 else "ja-JP-Neural2-C"
        clip = _tts(case["text"], voice, args, budget)
        truth.append({"case": case["id"], "start_ms": len(audio), "end_ms": len(audio) + len(clip), "text": case["text"], "voice": voice})
        audio += clip.set_frame_rate(48000).set_channels(1) + AudioSegment.silent(700)
    tts_ms = round((time.perf_counter() - t0) * 1000)
    audio.export(out / "source.wav", format="wav")
    expected = "".join(t["text"] for t in truth)
    segments, stt_ms = _stt(audio, "source", args, budget, bucket, run_id, expected)
    chunks = UtteranceChunk.from_segments(segments)
    result = _audit(chunks, args, budget, calls)
    stt_text = "".join(s.text for s in segments)
    words = [
        {"wordId": w.word_id, "text": w.text, "start": w.start, "end": w.end, "timingConfident": w.timing_confident}
        for c in chunks
        for w in c.words
    ]
    findings_ui = [
        {
            "id": f.finding_id, "chunkId": f.chunk_id, "category": f.category, "source": f.source, "start": f.start_ms / 1000, "end": f.end_ms / 1000,
            "text": f.text, "entityType": f.entity_type, "action": "silence", "segmentIds": list(f.segment_ids), "evidenceText": f.evidence_text,
            "evidenceStart": f.evidence_start, "evidenceEnd": f.evidence_end, "wordIds": list(f.word_ids), "contextWordIds": list(f.context_word_ids),
            "rangePrecision": f.range_precision, "probability": f.probability, "status": "pending",
        }
        for f in result["findings"]
    ]
    (out / "handoff.json").write_text(json.dumps({"findings": findings_ui, "words": words}, ensure_ascii=False, indent=1))
    (out / "audio_results.json").write_text(
        json.dumps(
            {
                "meta": _meta(args, budget),
                "audio_ms": len(audio), "segments": len(segments), "chunks": len(chunks), "truth": truth,
                "stt": {"expected_text": expected, "text": stt_text, "secret_heard_as": [w["text"] for w in words if "742" in w["text"] or "スイレン" in w["text"] or "睡蓮" in w["text"]]},
                "timing_ms": {"tts": tts_ms, "stt": stt_ms, "audit_bundle": result["audit_bundle_ms"]},
                "calls": calls, "rows": list(result["rows"].values()),
            },
            ensure_ascii=False, indent=1,
        )
    )
    print(json.dumps({"out": str(out), **budget.used, "chunks": len(chunks), "findings": len(findings_ui)}, ensure_ascii=False))


def _ranges(out: Path) -> list[dict]:
    handoff = json.loads((out / "handoff.json").read_text())
    proposals_file = out / "proposals.json"
    proposed = json.loads(proposals_file.read_text()) if proposals_file.exists() else {}
    if proposed.get("proposals"):  # UI と同じ範囲提案（Gemini）の結果
        return [{"source": "suggestPolicyEdits", "start_ms": round(p["start"] * 1000), "end_ms": round(p["end"] * 1000), "action": p["action"], "script": p.get("script", "")} for p in proposed["proposals"]]
    hits = [w for w in handoff["words"] if any(k in w["text"] for k in ("スイレン", "睡蓮", "742"))]
    if not hits:
        return []
    return [{"source": "word-match", "start_ms": round(min(w["start"] for w in hits) * 1000), "end_ms": round(max(w["end"] for w in hits) * 1000), "action": "silence", "script": ""}]


def phase_edit(args) -> None:
    _guard(args)
    if not args.run:
        raise SystemExit("--run に audio 段階の出力ディレクトリを指定してください")
    budget, calls = Budget(args), []
    bucket = _bucket(args)
    out = Path(args.run)
    source = AudioSegment.from_file(out / "source.wav")
    ranges = _ranges(out)
    results = []
    for r in ranges:
        for action in ("cut", "silence", "replace"):
            replacement = None
            if action == "replace":
                script = r["script"] or "案件コードは非公開です。"
                replacement = export_audio(_tts(script, "ja-JP-Neural2-B", args, budget), "wav")
            edited, timeline = render_policy_audio(source, [PolicyAudioEdit(r["start_ms"], r["end_ms"], action, replacement)])
            name = f"edited-{action}-{r['start_ms']}"
            edited.export(out / f"{name}.wav", format="wav")
            segs, ms = _stt(edited, name, args, budget, bucket, out.name, expected_text="")
            text = "".join(s.text for s in segs)
            results.append({"range": r, "action": action, "file": f"{name}.wav", "length_ms": len(edited), "stt_text": text, "stt_ms": ms, "secret_in_stt": any(k in text for k in ("スイレン", "睡蓮", "742")), "review": None})
    (out / "edit_results.json").write_text(json.dumps({"meta": _meta(args, budget), "ranges": ranges, "results": results, "calls": calls}, ensure_ascii=False, indent=1))
    print(json.dumps({"out": str(out / "edit_results.json"), **budget.used, "edits": len(results)}, ensure_ascii=False))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("phase", choices=["text", "audio", "edit"])
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--bucket")
    p.add_argument("--run")
    p.add_argument("--model", default=os.environ.get("AI_MODEL_ID", "gemini-2.5-flash"))
    p.add_argument("--max-jev", type=int, default=60)
    p.add_argument("--max-gemini", type=int, default=30)
    p.add_argument("--max-stt-seconds", type=float, default=300)
    args = p.parse_args()
    if args.phase == "text":
        _guard(args)
    {"text": phase_text, "audio": phase_audio, "edit": phase_edit}[args.phase](args)


if __name__ == "__main__":
    main()
