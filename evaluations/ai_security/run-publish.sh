#!/usr/bin/env bash
# 公開境界（RSS/X）の評価。実際の公開は行わず、Firestoreはローカルエミュレータのみ使用する。
# 使い方：evaluations/ai_security/run-publish.sh [出力JUnit XML]  （EVAL_EXPECT_FIXED=1 で修正後の期待値）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FSPORT="${EVAL_FS_PORT:-58080}"
if ! curl -s --noproxy '*' "http://127.0.0.1:$FSPORT/" >/dev/null; then
  JAR=$(ls ~/.cache/firebase/emulators/cloud-firestore-emulator-*.jar 2>/dev/null | tail -1 || true)
  [ -n "$JAR" ] || { npx -y firebase-tools@13 setup:emulators:firestore >/dev/null; JAR=$(ls ~/.cache/firebase/emulators/cloud-firestore-emulator-*.jar | tail -1); }
  nohup java -jar "$JAR" --host 127.0.0.1 --port "$FSPORT" >/dev/null 2>&1 &
  for _ in $(seq 1 30); do curl -s --noproxy '*' "http://127.0.0.1:$FSPORT/" >/dev/null && break; sleep 1; done
fi
cd "$ROOT/apps/automator/app"
FIRESTORE_EMULATOR_HOST="127.0.0.1:$FSPORT" GOOGLE_CLOUD_PROJECT=demo-sparkcast-eval \
NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}" no_proxy="127.0.0.1,localhost,${no_proxy:-}" \
  uv run --frozen pytest -c pyproject.toml --rootdir . -p no:cacheprovider -o addopts="" -s -q \
  "$ROOT/evaluations/ai_security/test_publish_boundary.py" ${1:+--junitxml="$1"}
