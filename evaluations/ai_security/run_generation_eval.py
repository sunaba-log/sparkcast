"""議事録→紹介文→SNS文の誤生成評価（実モデル用ハーネス）.

製品の AudioAnalyzer（プロンプト・設定そのまま）で生成し、各段階を原議事録と照合する。
DBやRSS/Xには触れない。モデル呼び出しだけが外部通信になる。

実モデル（devのVertex AIのみ許可）:
  cd apps/automator/app
  EVAL_ALLOW_REAL_MODEL=1 GOOGLE_CLOUD_PROJECT=sunabalog-dev \
    uv run --frozen python ../../../evaluations/ai_security/run_generation_eval.py --trials 5
配線確認（モデルを呼ばない）:
  uv run --frozen python ../../../evaluations/ai_security/run_generation_eval.py --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

HERE = Path(__file__).resolve().parent
ALLOWED_PROJECTS = {"sunabalog-dev"}
NUM = re.compile(r"\d+(?:\.\d+)?\s*(?:万円|円|人|回|秒|%|日|月)")


class RecordingModels:
    """models.generate_content を中継し、プロンプト・設定・利用量・所要時間を記録する."""

    def __init__(self, inner: Any) -> None:  # noqa: ANN401
        self.inner = inner
        self.calls: list[dict[str, Any]] = []

    def generate_content(self, *, model: str, contents: list[Any], config: Any = None) -> Any:  # noqa: ANN401
        prompt = "".join(c for c in contents if isinstance(c, str))
        started = time.monotonic()
        response = self.inner.generate_content(model=model, contents=contents, config=config)
        usage = getattr(response, "usage_metadata", None)
        self.calls.append(
            {
                "model": model,
                "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                "temperature": getattr(config, "temperature", None),
                "max_output_tokens": getattr(config, "max_output_tokens", None),
                "usage": {
                    k: getattr(usage, k, None)
                    for k in ("prompt_token_count", "candidates_token_count", "thoughts_token_count", "total_token_count")
                }
                if usage
                else None,
                "model_version": getattr(response, "model_version", None),
                "duration_s": round(time.monotonic() - started, 3),
            }
        )
        return response


CORRUPTIONS = [  # 判定器の自己確認用に、偶数回の試行で意図的に入れる誤り
    ("予算は3万円で、30万円ではない", "予算は30万円"),
    ("内容確認後なら公開できると述べた", "自動公開に賛成した"),
    ("これは今回の試験結果で、性能保証ではない", "必ず2秒以内に応答することを保証する"),
]


class DryRunModels:
    """モデルを呼ばない代替。奇数回は原文どおり、偶数回は条件・否定を落とした誤りを入れ、SNSへそのまま伝播させる."""

    def __init__(self) -> None:
        self.summary_calls = 0

    def generate_content(self, *, model: str, contents: list[Any], config: Any = None) -> Any:  # noqa: ANN401, ARG002
        prompt = "".join(c for c in contents if isinstance(c, str))
        if "SNS投稿文" in prompt:
            src = prompt.split("--- 以下がエピソード紹介文です ---", 1)[1]
            msg = re.sub(r"<[^>]+>", "", src).strip()[:120]
            body = {"promotions": [{"message": f"DRYRUN {msg}", "hashtags": ["#dry"]}]}
        else:
            src = prompt.split("--- 以下が議事録です ---", 1)[1].strip()
            self.summary_calls += 1
            if self.summary_calls % 2 == 0:
                for before, after in CORRUPTIONS:
                    src = src.replace(before, after)
            body = {"title": "DRYRUN", "description": f"<p>{src}</p>"}
        return SimpleNamespace(text=json.dumps(body, ensure_ascii=False), usage_metadata=None, model_version="dry-run")


def check(stage_text: str, case: dict[str, Any]) -> dict[str, Any]:
    text = re.sub(r"<[^>]+>", " ", stage_text)
    source_nums = {n.replace(" ", "") for n in NUM.findall(case["minutes"])}
    new_nums = sorted({n.replace(" ", "") for n in NUM.findall(text)} - source_nums)
    distortions = [name for name, pat in case.get("distortion_patterns", {}).items() if re.search(pat, text)]
    missing = [fact for fact, toks in case.get("required_tokens", {}).items() if not any(t in text for t in toks)]
    return {"unsupported_numbers": new_nums, "distortion_candidates": distortions, "missing_required": missing}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--model", default=os.environ.get("AI_MODEL_ID", "gemini-2.5-flash"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    sys.path[:0] = [str(HERE.parents[1] / "apps/automator/app/src")]
    from infrastructure.ai_analyzer import AudioAnalyzer  # noqa: PLC0415

    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    if args.dry_run:
        analyzer = AudioAnalyzer.__new__(AudioAnalyzer)
        analyzer.client = SimpleNamespace(models=RecordingModels(DryRunModels()))
    else:
        if os.environ.get("EVAL_ALLOW_REAL_MODEL") != "1" or project not in ALLOWED_PROJECTS:
            print(f"refused: real model calls need EVAL_ALLOW_REAL_MODEL=1 and project in {ALLOWED_PROJECTS}", file=sys.stderr)
            return 2
        analyzer = AudioAnalyzer(project_id=project)
        analyzer.client = SimpleNamespace(models=RecordingModels(analyzer.client.models))
    recorder: RecordingModels = analyzer.client.models

    cases = json.loads((HERE / "generation-cases.json").read_text())["cases"]
    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False).stdout.strip()
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out = Path(args.out or HERE / "runs" / f"generation-{'dryrun' if args.dry_run else 'real'}-{stamp}.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)

    totals = {"calls": 0, "prompt_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "errors": 0}
    with out.open("w") as fh:
        for case in cases:
            for trial in range(1, args.trials + 1):
                row: dict[str, Any] = {"case_id": case["id"], "trial": trial, "commit": commit, "model": args.model, "dry_run": args.dry_run, "input": case["minutes"]}
                started = time.monotonic()
                try:
                    summary = analyzer.summarize_transcript(case["minutes"], model_id=args.model)
                    sns = analyzer.generate_sns_promotions(summary.description, num_promotions=3, model_id=args.model)
                    sns_text = "\n".join(p.message for p in sns.promotions)
                    desc_check, sns_check = check(summary.description, case), check(sns_text, case)
                    row["output"] = {"title": summary.title, "description": summary.description, "sns": [p.model_dump() for p in sns.promotions]}
                    row["auto_checks"] = {"description": desc_check, "sns": sns_check}
                    # 紹介文で生じた候補がSNSにも残っていれば伝播候補
                    row["propagation_candidates"] = sorted(
                        set(desc_check["distortion_candidates"]) & set(sns_check["distortion_candidates"])
                    ) + sorted(set(desc_check["unsupported_numbers"]) & set(sns_check["unsupported_numbers"]))
                except Exception as err:  # noqa: BLE001
                    row["error"] = f"{type(err).__name__}: {err}"
                    totals["errors"] += 1
                row["model_calls"] = recorder.calls[:]
                recorder.calls.clear()
                for call in row["model_calls"]:
                    totals["calls"] += 1
                    totals["prompt_tokens"] += (call["usage"] or {}).get("prompt_token_count") or 0
                    totals["output_tokens"] += (call["usage"] or {}).get("candidates_token_count") or 0
                    # 思考トークンも出力として課金される
                    totals["thinking_tokens"] += (call["usage"] or {}).get("thoughts_token_count") or 0
                row["duration_s"] = round(time.monotonic() - started, 3)
                row["review_reason"] = None  # 人が確定する
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(json.dumps({"out": str(out), **totals}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
