#!/usr/bin/env bash
# 検証のローカル実行（外部送信なし）。automator 側は依存差し替え、UI 側はローカル PostgreSQL＋Firestore エミュレータ。
# 使い方：evaluations/hackathon_audit/run-local.sh [出力ディレクトリ]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/evaluations/hackathon_audit/evidence}"
mkdir -p "$OUT"
export EVIDENCE_DIR="$OUT"
cd "$ROOT/apps/automator/app"
uv run --frozen pytest -c pyproject.toml --rootdir . -p no:cacheprovider -o addopts="" -q \
  "$ROOT/evaluations/hackathon_audit/test_audit_publication.py" \
  "$ROOT/evaluations/hackathon_audit/test_audio_edit_signal.py" \
  "$ROOT/evaluations/hackathon_audit/test_local_detection.py" \
  --junitxml="$OUT/automator-junit.xml" "$@" 2>&1 | tee "$OUT/automator.log" | tail -5
