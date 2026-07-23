// 出力履歴 (something new の構造化) の純粋関数テスト
import { describe, it, expect } from "vitest";
import { summarizeForHistory, buildPriorBlock } from "../../src/lib/novelty.js";

describe("summarizeForHistory", () => {
  it("空要素を除き、空白を畳んで区切りで繋ぐ", () => {
    expect(summarizeForHistory(["お礼の\n一報", "", null, "  山歩きの誘い  "])).toBe("お礼の 一報 / 山歩きの誘い");
  });
  it("上限で切る", () => {
    expect(summarizeForHistory(["あ".repeat(300)], 200)).toHaveLength(200);
  });
  it("全て空なら空文字", () => {
    expect(summarizeForHistory(["", undefined, null])).toBe("");
  });
});

describe("buildPriorBlock", () => {
  it("履歴が無ければ空文字 (プロンプトに何も足さない)", () => {
    expect(buildPriorBlock([])).toBe("");
  });
  it("日付つきの既出と、重複禁止・新しい視点の指示を含む", () => {
    const block = buildPriorBlock([{ summary: "お礼の一報", createdAt: new Date("2026-07-01T00:00:00Z") }]);
    expect(block).toContain("既出");
    expect(block).toContain("2026-07-01 お礼の一報");
    expect(block).toContain("新しい視点");
  });
  it("最大件数までに絞る", () => {
    const priors = Array.from({ length: 12 }, (_, i) => ({
      summary: `第${i}案`,
      createdAt: new Date(Date.UTC(2026, 0, i + 1)),
    }));
    const block = buildPriorBlock(priors, 8);
    expect(block).toContain("第0案");
    expect(block).toContain("第7案");
    expect(block).not.toContain("第8案");
  });
});
