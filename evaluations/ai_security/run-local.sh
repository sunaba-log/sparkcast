#!/usr/bin/env bash
# ローカルの使い捨てPostgreSQLとFirestoreエミュレータだけを使って評価テストを実行する。
# 本番・devのDB/Firestore/Vertex/X/R2には接続しない（接続先はlocalhostに固定）。
# 前提：PostgreSQL 16（/usr/lib/postgresql/16/bin）、Java、npx（firebase-tools）。
# 使い方：evaluations/ai_security/run-local.sh [出力JSON]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${EVAL_WORK_DIR:-$(mktemp -d)}"
OUT="${1:-$ROOT/evaluations/ai_security/results.json}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${EVAL_PG_PORT:-55432}"; FSPORT="${EVAL_FS_PORT:-58080}"

if ! pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
  RUNAS=(); if [ "$(id -u)" = 0 ]; then id pgtest >/dev/null 2>&1 || useradd -m pgtest; chown -R pgtest "$WORK"; chmod o+x "$WORK"; RUNAS=(su pgtest -c); fi
  CMD="$PGBIN/initdb -D $WORK/pg -U postgres --auth=trust >/dev/null && $PGBIN/pg_ctl -D $WORK/pg -o '-p $PGPORT -k /tmp' -l $WORK/pg.log start >/dev/null"
  if [ ${#RUNAS[@]} -gt 0 ]; then "${RUNAS[@]}" "$CMD"; else bash -c "$CMD"; fi
fi
DB=sparkcast_eval
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 || psql -q -h 127.0.0.1 -p "$PGPORT" -U postgres -c "CREATE DATABASE $DB"
for f in $(ls "$ROOT"/apps/ui/migrations/*.sql | sort); do psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d $DB -f "$f" >/dev/null 2>&1; done

if ! curl -s --noproxy '*' "http://127.0.0.1:$FSPORT/" >/dev/null; then
  JAR=$(ls ~/.cache/firebase/emulators/cloud-firestore-emulator-*.jar 2>/dev/null | tail -1 || true)
  [ -n "$JAR" ] || { npx -y firebase-tools@13 setup:emulators:firestore >/dev/null; JAR=$(ls ~/.cache/firebase/emulators/cloud-firestore-emulator-*.jar | tail -1); }
  nohup java -jar "$JAR" --host 127.0.0.1 --port "$FSPORT" >"$WORK/fs.log" 2>&1 &
  for _ in $(seq 1 30); do curl -s --noproxy '*' "http://127.0.0.1:$FSPORT/" >/dev/null && break; sleep 1; done
fi

cd "$ROOT"
EVAL_DATABASE_URL="postgresql://postgres@127.0.0.1:$PGPORT/$DB" FIRESTORE_EMULATOR_HOST="127.0.0.1:$FSPORT" \
NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}" no_proxy="127.0.0.1,localhost,${no_proxy:-}" \
  ./apps/ui/node_modules/.bin/vitest run --config evaluations/ai_security/vitest.config.mts --reporter=default --reporter=json --outputFile="$OUT"
