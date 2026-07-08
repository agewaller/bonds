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

    // 意識の七次元の完了マーカー (スコアの見出し・完全一致で narrative の部分一致を避ける)。
    // 実際のエラーは画面の <p> バナー本文で判定する (Next.js の空 route-announcer[role=alert]
    // を誤検知しないため、role ではなく本文テキストで拾う)。
    const score7d = page.getByText("公的社会価値創造スコア", { exact: true });
    const errorBanner = page.getByText(/評価を実行できませんでした|利用枠は終了しました|うまくいきませんでした/);
    // 長い評価なので余裕を持って、完了かエラーのどちらかが出るまで待つ。
    await expect(score7d.or(errorBanner).first()).toBeVisible({ timeout: 220_000 });
    await expect(errorBanner, "評価がエラーで終わった").toHaveCount(0);
    await expect(score7d).toBeVisible();
    // 社会価値創造 (二つ目・長い方) も最後まで完了していること (svc 固有の「10段階で N」チップ)。
    // 途中停止すると出ない = 途中停止の回帰を防ぐハードゲート。
    await expect(page.getByText(/10段階で\s*\d+/).first()).toBeVisible();
    await expect(
      page.getByText("前回の評価は完了しませんでした。もう一度お試しください。"),
      "いずれかの評価が途中停止した",
    ).toHaveCount(0);
  });
});
