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
#   cares-anthropic-api-key … cares と共有 (cares 本番が実際に使っている名前。
#     初回デプロイで ANTHROPIC_API_KEY という名前を仮定して失敗した実障害 2026-07-08)
#   BONDS_DATA_ENCRYPTION_KEY / BONDS_ADMIN_BREAKGLASS_TOKEN … bonds 専用 (cares と別鍵)
export SECRET_ANTHROPIC="${SECRET_ANTHROPIC:-cares-anthropic-api-key}"
export SECRET_ENCRYPTION="${SECRET_ENCRYPTION:-BONDS_DATA_ENCRYPTION_KEY}"
export SECRET_BREAKGLASS="${SECRET_BREAKGLASS:-BONDS_ADMIN_BREAKGLASS_TOKEN}"
export SECRET_DB_PASSWORD="${SECRET_DB_PASSWORD:-BONDS_DB_PASSWORD}"
export SECRET_SENDGRID="${SECRET_SENDGRID:-BONDS_SENDGRID_API_KEY}"
export SECRET_GOOGLE_CLIENT="${SECRET_GOOGLE_CLIENT:-BONDS_GOOGLE_OAUTH_CLIENT_SECRET}"
# ZenTrack (音声文字起こし) → bonds 取込の server-to-server 共有シークレット (任意)。
# 未作成なら ZenTrack 受け口は「準備中」= 503 に縮退する。
export SECRET_ZENTRACK="${SECRET_ZENTRACK:-BONDS_ZENTRACK_INGEST_SECRET}"
# Tavily (公開情報の実検索。人物DD の検索ステップ・相手ノート・提携先探しの精度が上がる)。
# 未作成なら知識ベースモードに縮退する (壊れない)。
export SECRET_TAVILY="${SECRET_TAVILY:-BONDS_TAVILY_API_KEY}"

# 本番 web の既定 URL (api 単独デプロイ時の ALLOWED_ORIGINS / OAuth 戻り先の既定)
export PROD_WEB_URL="${PROD_WEB_URL:-https://bonds-web-xj6szhutkq-an.a.run.app}"
# Google 連携 (OAuth)。CLIENT_ID は公開値なので env / GitHub Variables で渡す。
# 未設定 (unset) なら連携機能は「準備中」に縮退する。
export GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-unset}"
export GOOGLE_OAUTH_REDIRECT_URL="${GOOGLE_OAUTH_REDIRECT_URL:-https://bonds-api-xj6szhutkq-an.a.run.app/api/google/callback}"

if [ "${BONDS_ENV}" = "staging" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/_env.staging.sh" ]; then
  # shellcheck disable=SC1091
  source "$(dirname "${BASH_SOURCE[0]}")/_env.staging.sh"
fi
