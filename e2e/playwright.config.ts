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
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
