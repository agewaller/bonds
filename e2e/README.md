# bonds E2E (Playwright)

フルスタック (bonds-db / api:8080 / web:3000) を起動してから実行する。

```bash
docker compose up -d --build
pnpm test:e2e
# プリインストール Chromium を使う環境では:
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e
```

## テスト構成 (cares CLAUDE.md のテスト規約を踏襲)

- `smoke.spec.ts` — ランディングが開く・JS エラー無し・`/api/healthz` 生存。
- `post-login-audit.spec.ts` — ユーザー目線監査。画面が 5xx/エラーバナー/JS エラー無しで開くか・
  導線 (一覧→詳細)・主要ボタン。フェーズ5 の認証導入後にログイン前提へ拡張する。
- `ai-answers.spec.ts` — **AI 実機スモーク**。「渋沢栄一 → 意識の七次元 + 社会価値創造の 2 評価が
  実際に返る」を実 LLM で確認する (モックは常に成功する偽 AI なので、この層を必ず実機で通す)。
  実行は既定 ON。API に ANTHROPIC_API_KEY が無い環境だけ `E2E_INCLUDE_AI=0` で明示的に止める
  (黙って skip して緑に見せない)。所要 1〜2 分。

## デプロイゲート

フェーズ5 で `deploy-staging` の最後にこの 3 スイートを自動実行し、赤ならデプロイを止める
(cares の e2e-audit と同じ硬いゲート)。
