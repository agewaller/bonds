#!/usr/bin/env bash
# bonds の GCP 初回セットアップ (一回限り・冪等)。Cloud Shell で実行するのが最も簡単:
#   git clone https://github.com/agewaller/bonds.git && cd bonds
#   bash infra/scripts/00-first-time-setup.sh
#
# cares の資産を最大限流用する:
#   - WIF プール/プロバイダ (github-pool/github) は agewaller 全リポジトリ許可のため再利用
#   - デプロイ SA も cares-github-deployer を再利用 (必要ロールは付与済み)
#   - ANTHROPIC_API_KEY は cares の既存シークレットを参照 (作成しない)
# bonds 専用に新設するのは: 実行 SA (bonds-run) / bonds-* シークレット / Cloud SQL / AR リポジトリ。
source "$(dirname "$0")/_env.sh"

REPO="agewaller/bonds"
DEPLOYER_SA="cares-github-deployer@${PROJECT}.iam.gserviceaccount.com"
RUN_SA_NAME="bonds-run"
RUN_SA="${RUN_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
POOL="github-pool"
PROVIDER="github"
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')
ACTIVE_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
echo "PROJECT=${PROJECT} (#${PROJECT_NUMBER}) / REPO=${REPO}"
echo "実行アカウント: ${ACTIVE_ACCOUNT}"

# 事前チェック: IAM を書き換えられるアカウントか (権限不足なら分かりやすく案内して止まる)
if ! gcloud projects get-iam-policy "${PROJECT}" --format='value(etag)' >/dev/null 2>&1; then
  cat >&2 <<'MSG'
! このアカウントにはプロジェクトの IAM を操作する権限がありません。
  cares の管理アカウント (yano@bresson.biz) でコンソールにログインし直して
  Cloud Shell から再実行するか、管理アカウントで次を一度だけ実行してから
  このアカウントで再実行してください:
    gcloud projects add-iam-policy-binding <PROJECT>       --member="user:<このアカウント>" --role="roles/owner"
MSG
  exit 1
fi

echo "=== 1) WIF: ${REPO} からのデプロイを許可 (cares のプール/SA を再利用) ==="
if ! gcloud iam service-accounts describe "${DEPLOYER_SA}" --project="${PROJECT}" &>/dev/null; then
  echo "! ${DEPLOYER_SA} が無い。先に cares 側の 11-setup-github-wif.sh を実行してください" >&2
  exit 1
fi
gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA}" \
  --project="${PROJECT}" --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" >/dev/null
echo "  + workloadIdentityUser: ${REPO}"

echo "=== 2) 実行 SA (bonds-run): Cloud Run のランタイム ==="
if ! gcloud iam service-accounts describe "${RUN_SA}" --project="${PROJECT}" &>/dev/null; then
  gcloud iam service-accounts create "${RUN_SA_NAME}" --project="${PROJECT}" \
    --display-name="bonds Cloud Run runtime"
fi
for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding "${PROJECT}" \
    --member="serviceAccount:${RUN_SA}" --role="${role}" --condition=None >/dev/null
  echo "  + ${role}"
done
gcloud iam service-accounts add-iam-policy-binding "${RUN_SA}" \
  --project="${PROJECT}" --member="serviceAccount:${DEPLOYER_SA}" \
  --role="roles/iam.serviceAccountUser" >/dev/null
echo "  + deployer actAs ${RUN_SA}"

echo "=== 3) bonds 専用シークレット (無ければ作成し、値も自動生成して投入) ==="
ensure_secret() {
  local name="$1"; local value="$2"
  if ! gcloud secrets describe "$name" --project="$PROJECT" &>/dev/null; then
    gcloud secrets create "$name" --project="$PROJECT" --replication-policy=automatic
  fi
  if ! gcloud secrets versions list "$name" --project="$PROJECT" --format='value(name)' | grep -q .; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --project="$PROJECT" --data-file=-
    echo "  + ${name}: 値を投入"
  else
    echo "  = ${name}: 既存の値を保持"
  fi
}
DB_PW="$(openssl rand -hex 24)"
ensure_secret "$SECRET_ENCRYPTION"  "$(openssl rand -hex 32)"
ensure_secret "$SECRET_BREAKGLASS"  "$(openssl rand -hex 32)"
ensure_secret "$SECRET_DB_PASSWORD" "$DB_PW"
# 空文字は versions add が拒否する (Secret Payload cannot be empty)。Cloud Run の
# --set-secrets 参照はバージョンが 1 つも無いと失敗するため、番兵値 "unset" を入れる。
# 実キーに差し替えるまで送信は動かない (OUTREACH_FROM_EMAIL 未設定なら mailer 自体が無効 = 503 縮退)。
ensure_secret "$SECRET_SENDGRID"    "unset"
# Google 連携 (Calendar/Gmail/Drive 取込) の OAuth クライアントシークレット。
# 実値に差し替えるまで連携機能は「準備中」に縮退する。
ensure_secret "$SECRET_GOOGLE_CLIENT" "unset"
echo "  = ANTHROPIC_API_KEY: cares の既存シークレットを参照 (作成しない)"

echo "=== 4) Cloud SQL (${SQL_INSTANCE}) ==="
if ! gcloud sql instances describe "${SQL_INSTANCE}" --project="${PROJECT}" &>/dev/null; then
  # --edition=enterprise を明示する (近年の gcloud は Postgres を既定で Enterprise Plus
  # にし、共有コアの db-f1-micro を拒否する。実障害 2026-07-08: HTTPError 400
  # "Use a predefined Tier like db-perf-optimized-N-*")
  gcloud sql instances create "${SQL_INSTANCE}" --project="${PROJECT}" \
    --database-version=POSTGRES_16 --edition=enterprise --tier=db-f1-micro \
    --region="${REGION}" \
    --storage-size=10GB --storage-auto-increase
fi
gcloud sql databases describe "${SQL_DB}" --instance="${SQL_INSTANCE}" --project="${PROJECT}" &>/dev/null || \
  gcloud sql databases create "${SQL_DB}" --instance="${SQL_INSTANCE}" --project="${PROJECT}"
DB_PW_CURRENT="$(gcloud secrets versions access latest --secret="$SECRET_DB_PASSWORD" --project="$PROJECT")"
if gcloud sql users list --instance="${SQL_INSTANCE}" --project="${PROJECT}" --format='value(name)' | grep -qx "${SQL_USER}"; then
  gcloud sql users set-password "${SQL_USER}" --instance="${SQL_INSTANCE}" --project="${PROJECT}" --password="${DB_PW_CURRENT}"
else
  gcloud sql users create "${SQL_USER}" --instance="${SQL_INSTANCE}" --project="${PROJECT}" --password="${DB_PW_CURRENT}"
fi
echo "  = SQL user password を ${SECRET_DB_PASSWORD} と同期"

echo "=== 5) Artifact Registry (${AR_REPO}) ==="
gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" --project="${PROJECT}" &>/dev/null || \
  gcloud artifacts repositories create "${AR_REPO}" --location="${REGION}" \
    --repository-format=docker --project="${PROJECT}"

PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
cat <<DONE

============================================================
セットアップ完了。GitHub (agewaller/bonds) に以下を登録してください。
Settings → Secrets and variables → Actions

【Variables タブ】(機微情報ではないので Variable でよい)
  WIF_PROVIDER = ${PROVIDER_RESOURCE}
  DEPLOY_SA    = ${DEPLOYER_SA}
  NEXT_PUBLIC_FIREBASE_API_KEY     = <cares web と同じ値>
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = <cares web と同じ値>
  NEXT_PUBLIC_FIREBASE_PROJECT_ID  = <cares web と同じ値>

登録後、Actions タブ → deploy-gcp → Run workflow でデプロイできます。
デプロイ後にやること:
  1. 表示された bonds-web の URL を Firebase Console → Authentication →
     Settings → Authorized domains に追加 (Google ログイン有効化)
  2. Variables に BONDS_API_URL=<api URL>、Secrets に BONDS_ADMIN_TOKEN=
     (gcloud secrets versions access latest --secret=${SECRET_BREAKGLASS}) を登録
     (配信キューの毎時処理 outreach-sweep が有効化)
============================================================
DONE
