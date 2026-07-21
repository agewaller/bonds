import { test, expect } from "@playwright/test";

// 新画面のユーザー目線監査 — メッセージ (往復)・シェア (時間/知恵/モノ)・
// 相手向け公開ページ (/share/:token)・差し出せるもの (/resources)。

function collectErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("response", (res) => {
    if (res.status() >= 500) errors.push(`5xx: ${res.status()} ${res.url()}`);
  });
  return errors;
}

test("差し出せるもの: 登録して一覧に出る", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/resources");
  await expect(page.getByRole("heading", { name: "差し出せるもの" })).toBeVisible();
  const title = `監査用 壁打ちに乗れます ${Date.now()}`;
  await page.getByLabel("内容").fill(title);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText(title)).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡先詳細: メッセージ下書きとシェアの発行 → 相手ページで受諾まで通る", async ({ page }) => {
  const errors = collectErrors(page);

  // 連絡先を作る
  await page.goto("/contacts");
  const name = `監査用 山田花子 ${Date.now()}`;
  await page.getByLabel("お名前").fill(name);
  await page.getByRole("button", { name: "追加" }).click();
  const link = page.getByRole("link", { name: new RegExp(name) });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // メッセージ: 下書きとして残す (送信はメール未設定でも通る経路)
  await expect(page.getByRole("heading", { name: "やりとり (メッセージ)" })).toBeVisible();
  await page.getByLabel("メッセージ", { exact: true }).fill("お元気ですか。近くまで行くのでお茶でもいかがですか。");
  await page.getByRole("button", { name: "下書きとして残す" }).click();
  await expect(page.getByText("下書きとして残しました")).toBeVisible();
  await expect(page.getByText("お茶でもいかがですか")).toBeVisible();

  // シェア: 差し出す → お知らせする → 相手用リンクが出る
  await expect(page.getByRole("heading", { name: "時間・知恵・モノのシェア" })).toBeVisible();
  await page.getByLabel("内容", { exact: true }).fill("引っ越しを手伝えます");
  await page.getByRole("button", { name: "準備する" }).click();
  await expect(page.getByText("引っ越しを手伝えます").first()).toBeVisible();
  await page.getByRole("button", { name: "お知らせする (リンク発行)" }).click();
  const urlEl = page.locator("text=相手用リンク:");
  await expect(urlEl).toBeVisible();
  const shareHref = await page.locator("p", { hasText: "相手用リンク:" }).locator("a").getAttribute("href");
  expect(shareHref).toBeTruthy();

  // 相手 (第三者) として公開ページを開き、受諾する — ログイン不要の双方向
  const token = shareHref!.split("/share/")[1];
  await page.goto(`/share/${token}`);
  await expect(page.getByRole("heading", { name: "引っ越しを手伝えます" })).toBeVisible();
  await page.getByLabel(/ひとこと/).fill("ありがとうございます。ぜひお願いします。");
  await page.getByRole("button", { name: "受け取る" }).click();
  await expect(page.getByRole("heading", { name: "お返事を伝えました" })).toBeVisible();

  expect(errors, errors.join("\n")).toHaveLength(0);
});
