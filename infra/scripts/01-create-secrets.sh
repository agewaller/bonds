#!/usr/bin/env bash
# bonds 専用シークレットを Secret Manager に作成する (冪等)。
# ANTHROPIC_API_KEY は作らない — cares の既存シークレットをそのまま参照する。
source "$(dirname "$0")/_env.sh"

create_if_missing() {
  local name="$1"
  if ! gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    echo "creating secret: $name (値は後から versions add で投入)"
    gcloud secrets create "$name" --project="$PROJECT" --replication-policy=automatic
  else
    echo "exists: $name"
  fi
}
create_if_missing "$SECRET_ENCRYPTION"    # openssl rand -hex 32
create_if_missing "$SECRET_BREAKGLASS"    # openssl rand -hex 32
create_if_missing "$SECRET_DB_PASSWORD"
create_if_missing "$SECRET_RESEND"        # 任意 (Resend 優先。未設定なら送信は 503 縮退)
create_if_missing "$SECRET_SENDGRID"      # 任意 (Resend が無いときの代替)
create_if_missing "$SECRET_INBOUND"       # openssl rand -hex 24 (返信受信 webhook。未設定なら受信は 503 縮退)
create_if_missing "$SECRET_FIREBASE_SA"   # Firebase サービスアカウント JSON 1行 (セッション Cookie 発行に必要)
create_if_missing "$SECRET_OURA_CLIENT"     # 任意 (Oura リング連携。未設定なら準備中)
create_if_missing "$SECRET_WITHINGS_CLIENT" # 任意 (Withings マット連携。未設定なら準備中)

echo "値の投入例: printf '%s' \"\$(openssl rand -hex 32)\" | gcloud secrets versions add $SECRET_ENCRYPTION --data-file=- --project=$PROJECT"
echo "ANTHROPIC_API_KEY は cares の既存シークレットを参照するため作成しません"
