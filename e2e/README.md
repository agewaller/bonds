# bonds E2E (Playwright)

フルスタック (docker compose: `bonds-db` / `api:8080` / `web:3000`) を起動してから実行する。

```bash
docker compose up -d --build
pnpm test:e2e
```

## フェーズ0
- `smoke.spec.ts`: ランディングが開く・JS エラー無し・`/api/healthz` が生存。

## 今後 (DESIGN-HANDOVER.md §7 / cares 流)
- `post-login-audit.spec.ts`: ログイン後の全画面が 5xx/エラーバナー/JS エラー無しで開くか・
  リンク切れ・主要ボタン・AI アクション ("Premature close" 回帰) を点検。
- `ai-answers.spec.ts`: **AI 実機スモーク**。「渋沢栄一→意識の七次元 + 社会価値創造の 2 評価が
  返る」を実 LLM で確認 (モックは常に成功する偽 AI なので実機で必ず通す)。`E2E_API_URL` で対象 API 指定。
