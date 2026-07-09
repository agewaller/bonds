#!/usr/bin/env bash
# staging 環境の差分オーバーレイ。_env.sh が BONDS_ENV=staging のとき末尾で source する。
# 直接 source しないこと (_env.sh の prod 既定値を前提に、差分だけを上書きする)。
#
# 設計 (cares ADR-0015 踏襲): staging は本番と同じ GCP プロジェクト内に -staging 接尾辞
# リソースで共存する。DB (bonds-db-staging) と Cloud Run サービスを名前で分離し、
# 本番データに触れない。秘密値はこのファイルに一切置かない (公開リポジトリ)。
#
# 一度だけの準備 (オーナーが gcloud で実施): infra/scripts/10-create-staging.sh を参照。
#   - Cloud SQL bonds-db-staging (普段は activation-policy=NEVER で停止)
#   - Artifact Registry bonds-images-staging (staging ビルドが prod の :latest を上書きしないため)
#   - Secret bonds-db-url-staging / bonds-db-password-staging

# PROJECT / REGION / AR_HOST は prod と同一 (同一プロジェクト共存方式) — 上書き不要

# Cloud SQL (普段は停止。デプロイ/検証時のみ起動する)
export SQL_INSTANCE="bonds-db-staging"
export SQL_CONN="${PROJECT}:${REGION}:${SQL_INSTANCE}"

# Artifact Registry は repo ごと分離 (staging ビルドが prod の :latest を上書きしない)
export AR_REPO="bonds-images-staging"
export IMAGE_REGISTRY="${AR_HOST}/${PROJECT}/${AR_REPO}"

# Cloud Run サービス名
export RUN_API="bonds-api-staging"
export RUN_WEB="bonds-web-staging"

# Cloud Run の固定サービス URL。プロジェクト×リージョンのハッシュ (xj6szhutkq) は
# サービス名に依らず共通なので、prod と同じハッシュで staging サービス URL も定まる。
# prod と同じ CORS 事故防止パターン: 片側だけ再デプロイしても ALLOWED_ORIGINS /
# OAuth 戻り先が placeholder に戻らないための既定値。
export PROD_WEB_URL="https://bonds-web-staging-xj6szhutkq-an.a.run.app"
export GOOGLE_OAUTH_REDIRECT_URL="https://bonds-api-staging-xj6szhutkq-an.a.run.app/api/google/callback"

# DB 接続系の Secret Manager 名は staging 専用 (prod と分離)。
# 暗号鍵・breakglass・AI キー・SendGrid・Google クライアントは prod と共有でよい
# (staging は単一オーナー検証用途。DB を分けることで本番データには触れない)。
export SECRET_DB_PASSWORD="bonds-db-password-staging"
