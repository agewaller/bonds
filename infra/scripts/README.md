# bonds デプロイスクリプト (予定地)

フェーズ5 で cares の `infra/scripts/05〜08`（Prisma migrate → Cloud Run api → web →
Identity Platform / CORS）を `bonds-*` リソース名で複製する。GCP プロジェクト・
リージョン・サービス名は本体スタック確定後に確定する。

現状 (フェーズ0): 静的プロトタイプ `index.html` は `.github/workflows/pages.yml` が
main への push で GitHub Pages に自動デプロイする。
