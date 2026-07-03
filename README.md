# bonds

人と人のつながりを扱うプロダクトの器。現在は最初のプロトタイプとして、
**人物評価**（公人の名前を入力すると「意識の七次元評価」と「社会価値創造評価」を
一度に表示する公開ページ）を提供する。

- 公開ページ: `index.html`（GitHub Pages で配信。`pages.yml` が main への push で自動デプロイ）
- AI 基盤: [agewaller/cares](https://github.com/agewaller/cares) の公開エンドポイント
  `POST /api/trial/person-eval` を使う（AI 鍵はサーバ側のみ・IP 別レート制限・専用月次コスト上限つき）。
  評価プロンプトは cares の DB 駆動プロンプト `person_eval_7d` / `person_eval_svc`（管理画面で編集可）。
- 使用モデル: cares の管理設定 `person_eval_model` で変更可（既定 Sonnet）。

### プロトタイプのローカル確認

```bash
python3 -m http.server 8000
# → http://localhost:8000 を開く（API は本番 cares を呼ぶ。?api=... で差し替え可能）
```

## 本体（TypeScript モノレポ・フェーズ1 人物DD MVP）

技術スタックは **案B（cares 踏襲: TypeScript）** で確定。pnpm workspace モノレポで
本体を育てる。計画は [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)、
設計は [`docs/DESIGN-HANDOVER.md`](docs/DESIGN-HANDOVER.md)。

```
apps/api      Hono API（人物DD: subjects CRUD / 両評価並列実行 / DdResultSpec 厳格検証 /
              DB 駆動プロンプト seed / 月次コストキャップ / 管理トークンガード）
apps/web      Next.js（/subjects 一覧・人物詳細・二つの視点での評価実行。BFF プロキシで
              管理トークンをブラウザに出さない）
packages/db   Prisma + アプリ層 AES-256-GCM 暗号化（cares 封筒形式 enc:v1: を踏襲）
e2e           Playwright（フェーズ0 スモーク → ログイン後監査 + AI 実機スモーク）
```

### 本体のローカル確認

```bash
nvm use 22 && corepack enable
pnpm install
pnpm test                      # ユニット + 結合（実 Postgres bonds_test）
docker compose up -d --build   # bonds-db:5432 / api:8080 / web:3000
curl http://localhost:8080/api/healthz   # {"status":"ok"}
pnpm test:e2e                  # フルスタック起動後のユーザー目線スモーク
```

テストは cares の `CLAUDE.md` 規約を踏襲し、フェーズが進むごとに
「ユニット → 結合 → **ログイン後ユーザー監査** → **AI 実機スモーク**」を 1 セットで回す。

## 今後

このリポジトリは「人物デューデリジェンス + 関係性マネジメント」システムの
本体リポジトリとして育てる（[`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md) の
フェーズ1 以降）。
