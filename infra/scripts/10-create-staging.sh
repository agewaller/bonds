#!/usr/bin/env bash
# staging 環境の一度だけの準備 (オーナーが gcloud ログイン済みで実行)。
# cares ADR-0015 踏襲: 本番と同じプロジェクトに -staging 接尾辞リソースで staging を作る。
# 作るもの: Secret bonds-db-password-staging / Cloud SQL bonds-db-staging /
#           Artifact Registry bonds-images-staging。
# 暗号鍵・breakglass・AI キー・SendGrid は prod と共有 (新規作成しない)。
# 実行後は deploy-staging ワークフローで migrate→deploy できる。
set -euo pipefail

export BONDS_ENV=staging
source "$(dirname "$0")/_env.sh"   # BONDS_ENV=staging → _env.staging.sh の -staging 名を得る

echo "=== staging 準備 (project=${PROJECT} region=${REGION}) ==="

echo "--- 1) DB パスワード Secret (${SECRET_DB_PASSWORD}) ---"
if ! gcloud secrets describe "${SECRET_DB_PASSWORD}" --project="${PROJECT}" &>/dev/null; then
  gcloud secrets create "${SECRET_DB_PASSWORD}" --project="${PROJECT}" --replication-policy=automatic
  # ランダムな強パスワードを 1 度だけ投入する
  openssl rand -base64 30 | tr -d '\n/+=' | head -c 32 | \
    gcloud secrets versions add "${SECRET_DB_PASSWORD}" --project="${PROJECT}" --data-file=-
  echo "    生成して投入しました"
else
  echo "    既存 (再利用)"
fi
DB_PW="$(gcloud secrets versions access latest --secret="${SECRET_DB_PASSWORD}" --project="${PROJECT}")"

echo "--- 2) Cloud SQL (${SQL_INSTANCE}) ---"
if ! gcloud sql instances describe "${SQL_INSTANCE}" --project="${PROJECT}" &>/dev/null; then
  # prod と同じ注意: --edition=enterprise を明示 (db-f1-micro 拒否の実障害回避)
  gcloud sql instances create "${SQL_INSTANCE}" --project="${PROJECT}" \
    --database-version=POSTGRES_16 --edition=enterprise --tier=db-f1-micro \
    --region="${REGION}" --storage-size=10GB --storage-auto-increase
fi
gcloud sql databases describe "${SQL_DB}" --instance="${SQL_INSTANCE}" --project="${PROJECT}" &>/dev/null || \
  gcloud sql databases create "${SQL_DB}" --instance="${SQL_INSTANCE}" --project="${PROJECT}"
if gcloud sql users list --instance="${SQL_INSTANCE}" --project="${PROJECT}" --format='value(name)' | grep -qx "${SQL_USER}"; then
  gcloud sql users set-password "${SQL_USER}" --instance="${SQL_INSTANCE}" --project="${PROJECT}" --password="${DB_PW}"
else
  gcloud sql users create "${SQL_USER}" --instance="${SQL_INSTANCE}" --project="${PROJECT}" --password="${DB_PW}"
fi

echo "--- 3) Artifact Registry (${AR_REPO}) ---"
gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" --project="${PROJECT}" &>/dev/null || \
  gcloud artifacts repositories create "${AR_REPO}" --location="${REGION}" \
    --repository-format=docker --project="${PROJECT}"

echo "--- 4) デプロイ SA に staging DB パスワード Secret の閲覧権限 ---"
DEPLOY_SA_EMAIL="$(gcloud config get-value account 2>/dev/null || true)"
if [ -n "${DEPLOY_SA:-}" ]; then DEPLOY_SA_EMAIL="${DEPLOY_SA}"; fi
if [ -n "${DEPLOY_SA_EMAIL}" ]; then
  gcloud secrets add-iam-policy-binding "${SECRET_DB_PASSWORD}" --project="${PROJECT}" \
    --member="serviceAccount:${DEPLOY_SA_EMAIL}" --role="roles/secretmanager.secretAccessor" 2>/dev/null || \
    echo "    (SA バインドは deploy SA を DEPLOY_SA=... で渡すと自動化されます)"
fi

echo "--- 5) 普段は停止しておく (コスト抑制) ---"
gcloud sql instances patch "${SQL_INSTANCE}" --project="${PROJECT}" --activation-policy=NEVER --quiet

cat <<DONE

============================================================
staging の準備ができました。次にやること:
  1. GitHub → Settings → Environments で "staging" を作成 (必須レビュア=自分 を付けると承認ゲートになる)
  2. Actions で "deploy-staging" を実行 (SQL 起動 → migrate → build → deploy → healthz)
  3. Actions で "e2e-audit" を base_url=<staging web URL> で実行
     (ユーザー目線監査 + リンク切れ監査 [内部/外部] が緑になることを確認)
  4. 緑を確認できたら本番 (deploy-gcp) へ
  5. 検証が済んだら "stop-staging-sql" で bonds-db-staging を停止
============================================================
DONE
