#!/usr/bin/env bash
# 結合テスト用の Postgres テスト DB (bonds_test) を用意する。
# docker compose の bonds-db 上に DB を作成し、Prisma マイグレーションを適用する。
# 冪等: 既に存在/適用済みなら何もしない。
set -euo pipefail

cd "$(dirname "$0")/.."

TEST_DB="${TEST_DB_NAME:-bonds_test}"
DB_URL="${TEST_DATABASE_URL:-postgresql://bonds:bonds@localhost:5432/${TEST_DB}}"

if ! docker compose exec -T bonds-db pg_isready -U bonds >/dev/null 2>&1; then
  echo "ERROR: bonds-db に接続できません。先に 'docker compose up -d bonds-db' を実行してください。" >&2
  exit 1
fi

exists="$(docker compose exec -T bonds-db psql -U bonds -d bonds -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" 2>/dev/null || true)"
if [ "${exists//[[:space:]]/}" != "1" ]; then
  echo "creating database ${TEST_DB} ..."
  docker compose exec -T bonds-db psql -U bonds -d bonds -c "CREATE DATABASE ${TEST_DB}" >/dev/null
fi

echo "applying migrations to ${TEST_DB} ..."
DATABASE_URL="$DB_URL" pnpm --filter @bonds/db exec prisma migrate deploy >/dev/null

echo "test DB ready: ${TEST_DB}"
