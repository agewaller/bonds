import { test, expect, request } from "@playwright/test";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8080";

// フェーズ0 骨格スモーク。フェーズ1 以降でログイン後ユーザー監査
// (全画面が 5xx/エラーバナー/JS エラー無しで開くか・リンク切れ・主要ボタン) と
// AI 実機スモーク (渋沢栄一→2評価) を cares e2e/tests を移植して追加する。
test("ランディングが開き JS エラーが無い", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const res = await page.goto("/");
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: "bonds" })).toBeVisible();
  expect(errors, `JS errors: ${errors.join("\n")}`).toHaveLength(0);
});

test("api /api/healthz が 200 {status:ok}", async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${API_URL}/api/healthz`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
  await ctx.dispose();
});
