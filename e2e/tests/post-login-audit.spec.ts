import { test, expect } from "@playwright/test";

// ユーザー目線監査 (cares post-login-audit を bonds 向けに)。
// フェーズ1 は認証が無いため「全画面が 5xx/エラーバナー/JS エラー無しで開くか・
// リンク・主要ボタン」を点検する。フェーズ5 で認証導入後にログイン前提へ拡張する。

function collectErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("response", (res) => {
    if (res.status() >= 500) errors.push(`5xx: ${res.status()} ${res.url()}`);
  });
  return errors;
}

test("ランディング → 人物評価一覧への導線が生きている", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "bonds" })).toBeVisible();
  await page.getByRole("link", { name: "人物評価をはじめる" }).click();
  await expect(page).toHaveURL(/\/subjects$/);
  await expect(page.getByRole("heading", { name: "評価対象の人物" })).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("人物を追加 → 詳細が開き、評価ボタンとフッタ注記がある", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/subjects");
  const name = `監査用 渋沢栄一 ${Date.now()}`;
  await page.getByLabel("人物名").fill(name);
  await page.getByRole("button", { name: "追加" }).click();
  const link = page.getByRole("link", { name: new RegExp(name.slice(0, 8)) });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "二つの視点で評価する" })).toBeEnabled();
  // 2 セクションの見出し
  await expect(page.getByRole("heading", { name: "意識の七次元" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "社会価値創造" })).toBeVisible();
  await expect(page.getByText("断定ではありません")).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("存在しない人物ページはアプリのエラー画面で落ちない", async ({ page }) => {
  await page.goto("/subjects/no-such-person");
  // クラッシュせず「読み込んでいます…」表示に留まる (404 ハンドリングはフェーズ2 で改善予定)
  await expect(page.getByText("読み込んでいます")).toBeVisible();
});
