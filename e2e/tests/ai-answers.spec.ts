import { test, expect } from "@playwright/test";

// AI 実機スモーク (cares CLAUDE.md: モックは常に成功する偽 AI なので、この層を必ず実機で通す)。
// 「渋沢栄一 → 意識の七次元 + 社会価値創造の 2 評価が実際に返る」をデプロイゲートにする。
// 実行は既定 ON。API 側に ANTHROPIC_API_KEY が無い環境では E2E_INCLUDE_AI=0 で明示的に止める
// (黙って skip して緑に見せない)。
const INCLUDE_AI = process.env.E2E_INCLUDE_AI !== "0";

test.describe("人物評価 (実機)", () => {
  test.skip(!INCLUDE_AI, "E2E_INCLUDE_AI=0 のため AI 実機スモークを明示的に停止中");
  // 2 評価並列で 1〜2 分 + 余裕
  test.setTimeout(240_000);

  test("渋沢栄一で二つの評価が実際に返り、スコアが表示される", async ({ page }) => {
    await page.goto("/subjects");
    const name = `渋沢栄一 実機 ${Date.now()}`;
    await page.getByLabel("人物名").fill(name);
    await page.getByRole("button", { name: "追加" }).click();
    await page.getByRole("link", { name: new RegExp(name.slice(0, 6)) }).click();
    await page.getByRole("button", { name: "二つの視点で評価する" }).click();

    // 完了までポーリング表示。エラーバナーが出たら即失敗。
    const alert = page.getByRole("alert");
    const score7d = page.getByText(/公的社会価値創造スコア/);
    await expect(score7d.or(alert)).toBeVisible({ timeout: 200_000 });
    await expect(alert, "評価がエラーで終わった").toHaveCount(0);
    await expect(score7d).toBeVisible();
    // 社会価値創造 (二つ目・長い方) も最後まで完了していること。途中停止の回帰を防ぐ。
    await expect(page.getByText(/総合 \d+/)).toBeVisible();
    await expect(
      page.getByText("前回の評価は完了しませんでした。もう一度お試しください。"),
      "いずれかの評価が途中停止した",
    ).toHaveCount(0);
  });
});
