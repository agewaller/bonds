import { defineConfig, devices } from "@playwright/test";

// bonds の E2E。実行中のフルスタック (docker compose: web:3000 / api:8080 / db) に対して走る。
// フェーズ0 は骨格スモークのみ。ログイン後ユーザー監査 (post-login-audit) と
// AI 実機スモーク (ai-answers) はフェーズ1 以降で追加する (DESIGN-HANDOVER.md §7 / cares 流)。
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // クリック等の待ちに上限を置く (既定は無制限のため、対象が現れないとテスト時間
    // いっぱいまで黙って待ち続け、原因の分からないタイムアウトになる)
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // 実行環境にプリインストールされた Chromium を優先する
        // (PW_CHROMIUM_PATH で上書き可。無ければ Playwright 既定のブラウザ解決)。
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
});
