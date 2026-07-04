#!/usr/bin/env bash
# Cloud SQL (bonds) に Prisma migrate deploy を流す。cares 05 と同方式 (cloud-sql-proxy 経由)。
source "$(dirname "$0")/_env.sh"
cd "$(dirname "$0")/../.."

command -v cloud-sql-proxy >/dev/null || { echo "cloud-sql-proxy が必要です"; exit 1; }
DB_PASSWORD="$(gcloud secrets versions access latest --secret="$SECRET_DB_PASSWORD" --project="$PROJECT")"

cloud-sql-proxy --port 5433 "$SQL_CONN" & PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null' EXIT
sleep 3

DATABASE_URL="postgresql://${SQL_USER}:${DB_PASSWORD}@127.0.0.1:5433/${SQL_DB}" \
  pnpm --filter @bonds/db exec prisma migrate deploy
echo "migrate deploy done (${BONDS_ENV})"
