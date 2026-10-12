#!/usr/bin/env bash
# 検証のローカル実行（外部送信なし）。automator 側は依存差し替え、UI 側はローカル PostgreSQL＋Firestore エミュレータ。
# 使い方：evaluations/hackathon_audit/run-local.sh [出力ディレクトリ]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/evaluations/hackathon_audit/evidence}"
mkdir -p "$OUT"
export EVIDENCE_DIR="$OUT"
# test_episode_numbering.py はローカル PostgreSQL（run-ui.sh が起動・作成）を使う。無ければスキップ
export EVAL_DATABASE_URL="${EVAL_DATABASE_URL:-postgresql://postgres@127.0.0.1:55432/sparkcast_audit_eval}" NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}" no_proxy="127.0.0.1,localhost,${no_proxy:-}"
cd "$ROOT/apps/automator/app"
uv run --frozen pytest -c pyproject.toml --rootdir . -p no:cacheprovider -o addopts="" -q \
  "$ROOT/evaluations/hackathon_audit/test_audit_publication.py" \
  "$ROOT/evaluations/hackathon_audit/test_audio_edit_signal.py" \
  "$ROOT/evaluations/hackathon_audit/test_local_detection.py" \
  "$ROOT/evaluations/hackathon_audit/test_episode_numbering.py" \
  --junitxml="$OUT/automator-junit.xml" "$@" 2>&1 | tee "$OUT/automator.log" | tail -5
