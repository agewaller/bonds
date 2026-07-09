# bonds デプロイスクリプト

cares の infra/scripts 方式を bonds-* リソース名で複製。**cares と同じ GCP プロジェクト**
(`arctic-anvil-497002-q2` / `asia-northeast1`) に共存する。

## AI キーの方針 (オーナー確認済み: cares の鍵を使う)

- Cloud Run の bonds-api は **cares と同じ Secret Manager シークレット `ANTHROPIC_API_KEY` を参照**する
  (07 の `--set-secrets`)。鍵の値の複製・転記は不要で、cares 側でローテーションすれば bonds も追従する。
- 利用額は Anthropic 側で合算されるが、bonds は独自の月次キャップ (`PERSON_DD_MONTHLY_CAP_JPY`、
  既定 ¥3,000、`ai_usage_logs` で集計) で自律的に止まる。cares のキャップとは独立。
- 将来コストを分けたくなったら Anthropic Console で bonds 用キーを発行し、
  `_env.sh` の `SECRET_ANTHROPIC` を差し替えるだけでよい。
- **ローカル開発**は Secret Manager を参照できないため、`.env` の `ANTHROPIC_API_KEY=` に
  同じ鍵の値を貼る (`gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY` で取得可)。

## メール送信 (発信機能) を使うとき

SendGrid のキーを `BONDS_SENDGRID_API_KEY` シークレットに投入し、送信元アドレスを
`OUTREACH_FROM_EMAIL` 環境変数で 07 に渡す (例: `OUTREACH_FROM_EMAIL=bonds@example.com bash 07-...`)。
両方そろうまで送信系は 503 に縮退する (それ以外の機能は動く)。

提携先アウトリーチ (管理画面「提携先への連絡」) の任意設定 (07 に環境変数で渡す):

- `PARTNER_AUTO_SEND=1` — 下書き直後の自動送信を有効化 (既定 0 = 承認制。
  有効時も送信除外・日次上限・法的フッタは必ず効く)
- `PARTNER_DAILY_LIMIT` — 提携先メールの 1 日あたり送信上限 (既定 20、最大 500)
- `OUTREACH_SENDER_IDENTITY` — 送信メールのフッタに入る運営者名
  (未設定は「bonds 運営チーム（人間関係エージェント bonds）」)

## staging 環境 (cares ADR-0015 踏襲・本番前の検証)

staging は本番と同じ GCP プロジェクトに `-staging` 接尾辞リソースで共存する
(`bonds-db-staging` / `bonds-api-staging` / `bonds-web-staging` / `bonds-images-staging`)。
DB を分けるので本番データに触れない。差分は `_env.staging.sh`、`BONDS_ENV=staging` で有効化。

一度だけの準備 (オーナーが gcloud ログイン済みで実行):

1. `BONDS_ENV=staging bash 10-create-staging.sh` — Secret `bonds-db-password-staging` /
   Cloud SQL `bonds-db-staging` (作成後は停止) / Artifact Registry `bonds-images-staging` を作成
   (暗号鍵・break-glass・AI キー・SendGrid は prod と共有 = 新規作成しない)
2. GitHub → Settings → Environments で `staging` を作成 (必須レビュア=自分 で承認ゲート化)

本番前の検証フロー (毎回):

1. Actions で **deploy-staging** を実行 (SQL 起動 → migrate → build → deploy → healthz)
2. Actions で **e2e-audit** を `base_url=<staging web URL>` で実行
   → **ユーザー目線監査 (post-login-audit)** + **リンク切れ監査 (内部/外部の全リンク先 = link-audit)**
     + AI 実機スモーク が緑になることを確認
3. 緑を確認できたら本番 (**deploy-gcp**) を実行
4. 検証が済んだら **stop-staging-sql** で `bonds-db-staging` を停止 (コスト抑制。普段は停止運用)

## 手順 (初回・本番)

1. `bash 01-create-secrets.sh` — bonds 専用シークレット作成 (暗号鍵・break-glass・DB パスワード)
2. Cloud SQL `bonds-db-prod` / Artifact Registry `bonds-images` を作成 (cares 02〜04 相当は必要時に複製)
3. `bash 05-migrate-prod.sh` → `bash 06-build-push-images.sh` → `bash 07-deploy-cloud-run.sh`
4. デプロイ後: `/api/healthz` と CORS を必ず実測 (cares の 2026-05-29 事故の教訓)

## ゲート (CLAUDE.md)

デプロイ前に `pnpm test` + `pnpm test:e2e` + **AI 実機スモーク** 全緑と、ユーザーの明示承認が必須。
**本番前に staging で e2e-audit (ユーザー目線監査 + リンク切れ監査 [内部/外部]) を通すこと** (上記フロー)。

注: これらのスクリプトは開発サンドボックス (gcloud 無し) では未実行。初回実行時は
1 コマンドずつ確認しながら進めること。
