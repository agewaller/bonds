#!/usr/bin/env bash
# 結合テスト用の Postgres テスト DB (bonds_test) を用意する。
# 接続先は docker compose の bonds-db または既に起動しているローカル Postgres
# (どちらも postgresql://bonds:bonds@localhost:5432)。冪等。
set -euo pipefail

cd "$(dirname "$0")/.."

TEST_DB="${TEST_DB_NAME:-bonds_test}"
DB_URL="${TEST_DATABASE_URL:-postgresql://bonds:bonds@localhost:5432/${TEST_DB}}"

# psql 実行のラッパ: docker compose 経由 → 直接 psql の順で試す
run_psql() {
  local db="$1"; shift
  if docker compose exec -T bonds-db pg_isready -U bonds >/dev/null 2>&1; then
    docker compose exec -T bonds-db psql -U bonds -d "$db" "$@"
  elif PGPASSWORD=bonds psql -h 127.0.0.1 -p 5432 -U bonds -d "$db" -c "SELECT 1" >/dev/null 2>&1; then
    PGPASSWORD=bonds psql -h 127.0.0.1 -p 5432 -U bonds -d "$db" "$@"
  else
    echo "ERROR: Postgres に接続できません。'docker compose up -d bonds-db' するか、localhost:5432 で bonds ユーザの Postgres を起動してください。" >&2
    exit 1
  fi
}

exists="$(run_psql bonds -tAc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" 2>/dev/null || true)"
if [ "${exists//[[:space:]]/}" != "1" ]; then
  echo "creating database ${TEST_DB} ..."
  run_psql bonds -c "CREATE DATABASE ${TEST_DB}" >/dev/null
fi

echo "applying migrations to ${TEST_DB} ..."
DATABASE_URL="$DB_URL" pnpm --filter @bonds/db exec prisma migrate deploy >/dev/null

echo "test DB ready: ${TEST_DB}"
