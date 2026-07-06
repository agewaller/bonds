import { describe, it, expect } from "vitest";
import { sanitizeProse } from "../../src/lib/plain-text.js";
import { validateConsciousness7d } from "../../src/lib/dd-spec.js";

describe("sanitizeProse (文体規約の最終防衛線)", () => {
  it("Markdown 記号 (** ## - ※) を落とし、ふつうの文章にする", () => {
    expect(sanitizeProse("## 結論\n**渋沢栄一**は※重要。\n- 第一\n* 第二")).toBe(
      "結論\n渋沢栄一は重要。\n第一\n第二",
    );
  });
  it("日本語の中黒「・」と本文は残す", () => {
    expect(sanitizeProse("銀行・鉄道・保険の設立")).toBe("銀行・鉄道・保険の設立");
  });
  it("空/null は空文字", () => {
    expect(sanitizeProse(null)).toBe("");
    expect(sanitizeProse("")).toBe("");
  });
});

describe("dd-spec の散文フィールドは検証段階で記号が落ちる", () => {
  it("summary に ** が来ても保存値はプレーン", () => {
    const dim = { score: 8, confidence: "B", key_evidence: [], risks: ["**時代**の違い"] };
    const r = validateConsciousness7d({
      identified: true,
      subject_note: "n",
      dimensions: { "1D": dim, "2D": dim, "3D": dim, "4D": dim, "5D": dim, "6D": dim, "7D": dim },
      allocation: { "1D": 100 },
      evolution_conditions: ["a", "b", "c"],
      summary: "## 総括\n**大きな**功績",
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.identified) return;
    expect(r.value.summary).toBe("総括\n大きな功績");
    expect(r.value.dimensions["1D"].risks[0]).toBe("時代の違い");
  });
});

describe("表・番号・区切り線の除去 (人物DD の脱AI化)", () => {
  it("Markdown 表は罫線行を消し、データ行は文章として開く", () => {
    const table = "| 次元 | 点数 |\n|---|---|\n| 一の次元 | 8 |";
    expect(sanitizeProse(table)).toBe("次元　点数\n\n一の次元　8"); // 罫線行の跡は段落間隔になる
  });
  it("番号付き見出し・丸数字・区切り線を落とす", () => {
    expect(sanitizeProse("1. 結論\nこの人物は…\n---\n② 意識配分")).toBe("結論\nこの人物は…\n\n意識配分");
  });
  it("文中の数字 (2026年 や 3割) は壊さない", () => {
    expect(sanitizeProse("2026年時点で 3 割の貢献")).toBe("2026年時点で 3 割の貢献");
  });
});
