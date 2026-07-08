#!/usr/bin/env bash
# Cloud Run へ api → web の順にデプロイする (cares 07 と同方式)。
#   使い方: bash 07-deploy-cloud-run.sh [--only=api|web] [--api-url=URL] [--web-url=URL]
# AI キーは cares と共有の Secret (ANTHROPIC_API_KEY) を参照する。
source "$(dirname "$0")/_env.sh"

TAG="${TAG:-$(git rev-parse --short HEAD)}"
ONLY=""; API_URL=""; WEB_URL=""
for arg in "$@"; do case "$arg" in
  --only=*) ONLY="${arg#*=}";;
  --api-url=*) API_URL="${arg#*=}";;
  --web-url=*) WEB_URL="${arg#*=}";;
esac; done

if [ "$ONLY" != "web" ]; then
  gcloud run deploy "$RUN_API" --project="$PROJECT" --region="$REGION" \
    --image="${IMAGE_REGISTRY}/bonds-api:${TAG}" \
    --add-cloudsql-instances="$SQL_CONN" \
    --set-secrets="ANTHROPIC_API_KEY=${SECRET_ANTHROPIC}:latest,DATA_ENCRYPTION_KEY=${SECRET_ENCRYPTION}:latest,ADMIN_BREAKGLASS_TOKEN=${SECRET_BREAKGLASS}:latest,DB_PASSWORD=${SECRET_DB_PASSWORD}:latest,SENDGRID_API_KEY=${SECRET_SENDGRID}:latest,GOOGLE_OAUTH_CLIENT_SECRET=${SECRET_GOOGLE_CLIENT}:latest" \
    --set-env-vars="ALLOWED_ORIGINS=${WEB_URL:-$PROD_WEB_URL},SQL_CONN=${SQL_CONN},SQL_DB=${SQL_DB},SQL_USER=${SQL_USER},FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-$PROJECT},OUTREACH_FROM_EMAIL=${OUTREACH_FROM_EMAIL:-},PARTNER_AUTO_SEND=${PARTNER_AUTO_SEND:-0},PARTNER_DAILY_LIMIT=${PARTNER_DAILY_LIMIT:-20},OUTREACH_SENDER_IDENTITY=${OUTREACH_SENDER_IDENTITY:-},GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID},GOOGLE_OAUTH_REDIRECT_URL=${GOOGLE_OAUTH_REDIRECT_URL}" \
    --service-account="bonds-run@${PROJECT}.iam.gserviceaccount.com" \
    --allow-unauthenticated --port=8080
  API_URL="$(gcloud run services describe "$RUN_API" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
  echo "api: $API_URL"
fi

if [ "$ONLY" != "api" ]; then
  # --service-account を明示する (未指定だと既定の compute SA を使おうとし、
  # デプロイ SA が actAs 権限を持たず失敗する。実障害 2026-07-08)
  gcloud run deploy "$RUN_WEB" --project="$PROJECT" --region="$REGION" \
    --image="${IMAGE_REGISTRY}/bonds-web:${TAG}" \
    --set-secrets="ADMIN_TOKEN=${SECRET_BREAKGLASS}:latest" \
    --set-env-vars="INTERNAL_API_URL=${API_URL},NEXT_PUBLIC_API_URL=${API_URL}" \
    --service-account="bonds-run@${PROJECT}.iam.gserviceaccount.com" \
    --allow-unauthenticated --port=3000
  WEB_URL="$(gcloud run services describe "$RUN_WEB" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
  echo "web: $WEB_URL"
  echo "CORS 再設定が必要なら: bash 07-deploy-cloud-run.sh --only=api --web-url=$WEB_URL --api-url=$API_URL"
fi

echo "デプロイ後は必ず: curl \${API_URL}/api/healthz と CORS の実測 (cares CLAUDE.md の鉄則)"
