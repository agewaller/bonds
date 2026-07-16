import { test, expect, request as pwRequest } from "@playwright/test";

// リンク切れ監査 (cares 流)。ユーザー目線監査 (post-login-audit) と対で、
// 「①内部リンク先がすべて生存 (404/5xx でない) ②外部リンク先 (SNS の取り出し方・
// データDL ページなど) がすべて到達可能」を点検する。本番実装前に staging で走らせ、
// 案内した先が切れていないことをユーザー到達前に確かめる。

// 監査対象の主要画面 (ここから内部リンクを巡回し、外部リンクを収集する)。
const ROUTES = ["/", "/subjects", "/contacts", "/partners", "/login", "/admin", "/admin/partners"];

// 画面に <a href> として出ない外部リンク (SNS 連携ボタンは window.open のため DOM に無い)。
// これらは案内の要なので静的に列挙して必ず生存確認する。
const STATIC_EXTERNAL = [
  "https://guide.line.me/ja/services/chat-history.html", // LINE 連携ボタン
  "https://x.com/settings/download_your_data", // X 連携ボタン
  "https://accountscenter.facebook.com/info_and_permissions/dyi", // Instagram / Facebook 連携ボタン (Meta 共通)
  "https://www.linkedin.com/mypreferences/d/download-my-data", // LinkedIn 連携ボタン
  "https://contacts.google.com", // 取り込み案内の Google 連絡先
  "https://agewaller.github.io/bonds/", // 評価シェアで案内する公開の入口
];

test.describe("リンク切れ監査", () => {
  test("主要画面の内部リンク先がすべて生存している (404/5xx でない)", async ({ page }) => {
    test.setTimeout(300_000); // 画面が増えるほど巡回数が増える (cares 2026-07-02 の教訓)
    // 本番は連絡先が数千件あり、同じ種類のページを全件巡回すると時間切れになる。
    // 狙いは「リンク先の種類が生きていること」なので、UUID や数値をならした
    // パターンごとに最大 3 件だけ巡回する (2026-07-16 実測: 7,500 名で 120s 超過)。
    const pattern = (path: string) =>
      path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\d{4,}/g, ":n");
    const perPattern = new Map<string, number>();
    const links = new Set<string>();
    for (const route of ROUTES) {
      const resp = await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => null);
      // ルート自体の生存も確認する
      expect(resp?.status() ?? 0, `HTTP status for ${route}`).toBeLessThan(400);
      // 取り込みの案内 (外部リンクを含む) を開いてからリンクを集める
      const importBtn = page.getByRole("button", { name: /まとめて取り込む/ });
      if (await importBtn.count()) {
        await importBtn.first().click().catch(() => {});
        await page.getByText("各サービスからの取り出し方").click().catch(() => {});
      }
      const hrefs = await page
        .locator('a[href^="/"]')
        .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
      for (const h of hrefs) {
        const path = h.split("#")[0];
        if (!path || path.startsWith("//")) continue;
        const key = pattern(path);
        const n = perPattern.get(key) ?? 0;
        if (n >= 3) continue;
        perPattern.set(key, n + 1);
        links.add(path);
      }
    }
    const broken: string[] = [];
    for (const href of links) {
      if (!href) continue;
      const r = await page.goto(href, { waitUntil: "domcontentloaded" }).catch(() => null);
      const status = r?.status() ?? 0;
      if (status >= 400) broken.push(`${href} -> ${status}`);
      // やさしい 404 画面 (「見つかりませんでした」) は 200 で返るので、内容も点検する
      const hasErrorBanner = await page.getByText(/500|Internal Server Error|Application error/i).count();
      if (hasErrorBanner > 0) broken.push(`${href} -> エラー表示`);
    }
    expect(broken, `リンク切れ/エラー: ${broken.join(", ")}`).toEqual([]);
  });

  test("外部リンク先 (SNS の取り出し方・データDL) がすべて到達可能", async ({ page, baseURL }) => {
    test.setTimeout(300_000);
    const baseHost = baseURL ? new URL(baseURL).host : "";
    const external = new Set<string>(STATIC_EXTERNAL);
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => {});
      const importBtn = page.getByRole("button", { name: /まとめて取り込む/ });
      if (await importBtn.count()) {
        await importBtn.first().click().catch(() => {});
        await page.getByText("各サービスからの取り出し方").click().catch(() => {});
      }
      const hrefs = await page
        .locator('a[href^="http"]')
        .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
      for (const h of hrefs) {
        try {
          if (new URL(h).host !== baseHost) external.add(h.split("#")[0]);
        } catch {
          /* 壊れた URL は下の到達確認で弾く */
        }
      }
    }

    // ブラウザ相当の UA で到達確認する。多くのサイトは HEAD や bot をはじく (403/405/429) が、
    // それは「リンクが生きている」ことの裏返しなので通す。真の死活 (DNS/接続不能・404/410・5xx) だけ落とす。
    const ctx = await pwRequest.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    });
    const dead: string[] = [];
    for (const url of external) {
      let status = 0;
      try {
        const res = await ctx.get(url, { timeout: 20_000, maxRedirects: 5 });
        status = res.status();
      } catch (e) {
        dead.push(`${url} -> 接続不能 (${e instanceof Error ? e.message.split("\n")[0] : "error"})`);
        continue;
      }
      // 404/410 = 消えた、5xx = 死んでいる。401/403/405/429 は bot ブロック = リンクは生きている。
      if (status === 404 || status === 410 || status >= 500) dead.push(`${url} -> ${status}`);
    }
    await ctx.dispose();
    expect(dead, `到達できない外部リンク: ${dead.join(", ")}`).toEqual([]);
  });
});
