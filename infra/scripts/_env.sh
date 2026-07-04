#!/usr/bin/env bash
# infra/scripts/ の共通定数。各スクリプトの先頭で source する。
# bonds は cares と同じ GCP プロジェクトに bonds-* リソースで共存する
# (AI キーは cares と同じ Secret Manager の ANTHROPIC_API_KEY を参照 = 鍵の値を共有)。
set -euo pipefail

export BONDS_ENV="${BONDS_ENV:-prod}"

export PROJECT="${PROJECT:-arctic-anvil-497002-q2}"   # cares と同一プロジェクト
export REGION="${REGION:-asia-northeast1}"
export SQL_INSTANCE="${SQL_INSTANCE:-bonds-db-prod}"
export SQL_CONN="${SQL_CONN:-${PROJECT}:${REGION}:${SQL_INSTANCE}}"
export SQL_DB="${SQL_DB:-bonds}"
export SQL_USER="${SQL_USER:-bonds}"
export AR_REPO="${AR_REPO:-bonds-images}"
export AR_HOST="${AR_HOST:-${REGION}-docker.pkg.dev}"
export IMAGE_REGISTRY="${IMAGE_REGISTRY:-${AR_HOST}/${PROJECT}/${AR_REPO}}"

export RUN_API="${RUN_API:-bonds-api}"
export RUN_WEB="${RUN_WEB:-bonds-web}"

# Secret Manager のシークレット名。
#   ANTHROPIC_API_KEY   … cares と共有 (同じシークレットを参照。値の複製はしない)
#   BONDS_DATA_ENCRYPTION_KEY / BONDS_ADMIN_BREAKGLASS_TOKEN … bonds 専用 (cares と別鍵)
export SECRET_ANTHROPIC="${SECRET_ANTHROPIC:-ANTHROPIC_API_KEY}"
export SECRET_ENCRYPTION="${SECRET_ENCRYPTION:-BONDS_DATA_ENCRYPTION_KEY}"
export SECRET_BREAKGLASS="${SECRET_BREAKGLASS:-BONDS_ADMIN_BREAKGLASS_TOKEN}"
export SECRET_DB_PASSWORD="${SECRET_DB_PASSWORD:-BONDS_DB_PASSWORD}"
export SECRET_SENDGRID="${SECRET_SENDGRID:-BONDS_SENDGRID_API_KEY}"

if [ "${BONDS_ENV}" = "staging" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/_env.staging.sh" ]; then
  # shellcheck disable=SC1091
  source "$(dirname "${BASH_SOURCE[0]}")/_env.staging.sh"
fi
