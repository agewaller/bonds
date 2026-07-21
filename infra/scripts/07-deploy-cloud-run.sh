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
  # Google OAuth のシークレットは任意 (未設定なら Google 連携は「準備中」に縮退する)。
  # 存在するときだけ配線する — 無いのに参照するとデプロイ全体が落ちるため
  # (実障害 2026-07-08: BONDS_GOOGLE_OAUTH_CLIENT_SECRET 未作成でリビジョン作成失敗)。
  SECRETS="ANTHROPIC_API_KEY=${SECRET_ANTHROPIC}:latest,DATA_ENCRYPTION_KEY=${SECRET_ENCRYPTION}:latest,ADMIN_BREAKGLASS_TOKEN=${SECRET_BREAKGLASS}:latest,DB_PASSWORD=${SECRET_DB_PASSWORD}:latest,SENDGRID_API_KEY=${SECRET_SENDGRID}:latest"
  # 任意シークレットの検出は describe でなく「値を実際に読めるか」で行う。
  # describe は secrets.get (viewer) が要るが、デプロイ SA は versions.access (accessor) しか
  # 持たないことがあり、存在するのに「未作成」と誤判定していた (実障害 2026-07-15: オーナーが
  # BONDS_TAVILY_API_KEY を作成済みなのに知識ベースモードで入り続けた)。versions access なら
  # 権限が足り、さらに「作成したが値が未投入」(latest が無く --set-secrets が落ちる) も弾ける。
  secret_readable() {
    gcloud secrets versions access latest --secret="$1" --project="$PROJECT" >/dev/null 2>&1
  }
  if secret_readable "$SECRET_GOOGLE_CLIENT"; then
    SECRETS="${SECRETS},GOOGLE_OAUTH_CLIENT_SECRET=${SECRET_GOOGLE_CLIENT}:latest"
  else
    echo "注: Secret ${SECRET_GOOGLE_CLIENT} が読めない (未作成/値が未投入) ため Google 連携は準備中で入ります"
  fi
  # ZenTrack 受け口の共有シークレットも読めるときだけ配線 (無ければ受け口は 503 に縮退)。
  if secret_readable "$SECRET_ZENTRACK"; then
    SECRETS="${SECRETS},ZENTRACK_INGEST_SECRET=${SECRET_ZENTRACK}:latest"
  else
    echo "注: Secret ${SECRET_ZENTRACK} が読めない (未作成/値が未投入) ため ZenTrack 連携は準備中で入ります"
  fi
  # Tavily (公開情報の実検索) も任意。無ければ人物DD/相手ノートは知識ベースモードに縮退。
  if secret_readable "$SECRET_TAVILY"; then
    SECRETS="${SECRETS},TAVILY_API_KEY=${SECRET_TAVILY}:latest"
  else
    echo "注: Secret ${SECRET_TAVILY} が読めない (未作成/値が未投入) ため公開情報の実検索は知識ベースモードで入ります"
  fi
  # Stripe (時間の出品の決済) も任意。無ければ有料の出品だけ「準備中」に縮退 (無料の出品と日程調整は動く)。
  if secret_readable "$SECRET_STRIPE"; then
    SECRETS="${SECRETS},STRIPE_SECRET_KEY=${SECRET_STRIPE}:latest"
  else
    echo "注: Secret ${SECRET_STRIPE} が読めない (未作成/値が未投入) ため有料の出品は準備中で入ります"
  fi
  # デバイス連携 (Oura/Withings) も任意。無ければ該当プロバイダだけ「準備中」に縮退。
  if secret_readable "$SECRET_OURA_CLIENT"; then
    SECRETS="${SECRETS},OURA_CLIENT_SECRET=${SECRET_OURA_CLIENT}:latest"
  else
    echo "注: Secret ${SECRET_OURA_CLIENT} が読めない (未作成/値が未投入) ため Oura 連携は準備中で入ります"
  fi
  if secret_readable "$SECRET_WITHINGS_CLIENT"; then
    SECRETS="${SECRETS},WITHINGS_CLIENT_SECRET=${SECRET_WITHINGS_CLIENT}:latest"
  else
    echo "注: Secret ${SECRET_WITHINGS_CLIENT} が読めない (未作成/値が未投入) ため Withings 連携は準備中で入ります"
  fi
  gcloud run deploy "$RUN_API" --project="$PROJECT" --region="$REGION" \
    --image="${IMAGE_REGISTRY}/bonds-api:${TAG}" \
    --add-cloudsql-instances="$SQL_CONN" \
    --set-secrets="$SECRETS" \
    --set-env-vars="TZ=${APP_TZ:-Asia/Tokyo},ALLOWED_ORIGINS=${WEB_URL:-$PROD_WEB_URL},SQL_CONN=${SQL_CONN},SQL_DB=${SQL_DB},SQL_USER=${SQL_USER},FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-$PROJECT},OWNER_EMAIL=${OWNER_EMAIL},OWNER_UID=${OWNER_UID},OUTREACH_FROM_EMAIL=${OUTREACH_FROM_EMAIL:-},PARTNER_AUTO_SEND=${PARTNER_AUTO_SEND:-0},PARTNER_DAILY_LIMIT=${PARTNER_DAILY_LIMIT:-20},OUTREACH_SENDER_IDENTITY=${OUTREACH_SENDER_IDENTITY:-},GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID},GOOGLE_OAUTH_REDIRECT_URL=${GOOGLE_OAUTH_REDIRECT_URL},OURA_CLIENT_ID=${OURA_CLIENT_ID:-},WITHINGS_CLIENT_ID=${WITHINGS_CLIENT_ID:-},DEVICE_OAUTH_REDIRECT_URL=${DEVICE_OAUTH_REDIRECT_URL:-},PERSON_DD_MONTHLY_CAP_JPY=${PERSON_DD_MONTHLY_CAP_JPY:-0}" \
    --service-account="bonds-run@${PROJECT}.iam.gserviceaccount.com" \
    --allow-unauthenticated --port=8080 --timeout=600
  API_URL="$(gcloud run services describe "$RUN_API" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
  echo "api: $API_URL"
fi

if [ "$ONLY" != "api" ]; then
  # --service-account を明示する (未指定だと既定の compute SA を使おうとし、
  # デプロイ SA が actAs 権限を持たず失敗する。実障害 2026-07-08)
  gcloud run deploy "$RUN_WEB" --project="$PROJECT" --region="$REGION" \
    --image="${IMAGE_REGISTRY}/bonds-web:${TAG}" \
    --set-secrets="ADMIN_TOKEN=${SECRET_BREAKGLASS}:latest" \
    --set-env-vars="TZ=${APP_TZ:-Asia/Tokyo},INTERNAL_API_URL=${API_URL},NEXT_PUBLIC_API_URL=${API_URL}" \
    --service-account="bonds-run@${PROJECT}.iam.gserviceaccount.com" \
    --allow-unauthenticated --port=3000
  WEB_URL="$(gcloud run services describe "$RUN_WEB" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
  echo "web: $WEB_URL"
  echo "CORS 再設定が必要なら: bash 07-deploy-cloud-run.sh --only=api --web-url=$WEB_URL --api-url=$API_URL"
fi

echo "デプロイ後は必ず: curl \${API_URL}/api/healthz と CORS の実測 (cares CLAUDE.md の鉄則)"
