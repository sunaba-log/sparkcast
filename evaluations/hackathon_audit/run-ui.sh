#!/usr/bin/env bash
# UI 側の検証（ローカル PostgreSQL 16 ＋ Firestore エミュレータ。外部送信なし）。
# 使い方：evaluations/hackathon_audit/run-ui.sh [出力JSON]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/evaluations/hackathon_audit/evidence/after/ui-results.json}"
WORK="${EVAL_WORK_DIR:-$(mktemp -d)}"
# PostgreSQL は root で起動できないため、root 実行時は専用ユーザーのホームにデータを置く
PGDATA_DIR="$WORK/pg"
if [ "$(id -u)" = 0 ]; then id pgtest >/dev/null 2>&1 || useradd -m pgtest; PGDATA_DIR="$(getent passwd pgtest | cut -d: -f6)/sparkcast-audit-eval-pg"; fi
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"; PGPORT="${EVAL_PG_PORT:-55432}"; FSPORT="${EVAL_FS_PORT:-58080}"
if ! pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
  CMD="rm -rf $PGDATA_DIR && $PGBIN/initdb -D $PGDATA_DIR -U postgres --auth=trust >/dev/null && $PGBIN/pg_ctl -D $PGDATA_DIR -o '-p $PGPORT -k /tmp' -l $PGDATA_DIR.log start >/dev/null"
  if [ "$(id -u)" = 0 ]; then su pgtest -c "$CMD"; else bash -c "$CMD"; fi
  for _ in $(seq 1 20); do pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1 && break; sleep 1; done
fi
DB=sparkcast_audit_eval
psql -q -h 127.0.0.1 -p "$PGPORT" -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
for f in $(ls "$ROOT"/apps/ui/migrations/*.sql | sort); do psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d $DB -f "$f" >/dev/null 2>&1; done
if ! curl -s --noproxy '*' "http://127.0.0.1:$FSPORT/" >/dev/null; then
  JAR=$(ls ~/.cache/firebase/emulators/cloud-firestore-emulator-*.jar 2>/dev/null | tail -1 || true)
  [ -n "$JAR" ] || { npx -y firebase-tools@13 setup:emulators:firestore >/dev/null; JAR=$(ls ~/.cache/firebase/emulators/cloud-firestore-emulator-*.jar | tail -1); }
  nohup java -jar "$JAR" --host 127.0.0.1 --port "$FSPORT" >"$WORK/fs.log" 2>&1 &
  for _ in $(seq 1 30); do curl -s --noproxy '*' "http://127.0.0.1:$FSPORT/" >/dev/null && break; sleep 1; done
fi
mkdir -p "$(dirname "$OUT")"
cd "$ROOT"
EVAL_DATABASE_URL="postgresql://postgres@127.0.0.1:$PGPORT/$DB" FIRESTORE_EMULATOR_HOST="127.0.0.1:$FSPORT" \
NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}" no_proxy="127.0.0.1,localhost,${no_proxy:-}" \
  ./apps/ui/node_modules/.bin/vitest run --config evaluations/hackathon_audit/vitest.config.mts --reporter=default --reporter=json --outputFile="$OUT"
