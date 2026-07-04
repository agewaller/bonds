import { describe, it, expect } from "vitest";
import {
  clampName,
  slugify,
  PERSON_DD_MAX_NAME_LENGTH,
  PERSON_EVAL_GUARD,
  PERSON_EVAL_SAFETY,
  buildPersonEvalUserMessage,
} from "../../src/lib/person-eval.js";
import { canonicalizeModelId, calcCostJpy, USD_JPY_RATE } from "../../src/lib/cost.js";
import { buildSystemPrompt } from "../../src/dd/runner.js";

describe("clampName", () => {
  it("trim して最大長に丸める", () => {
    expect(clampName("  渋沢栄一  ")).toBe("渋沢栄一");
    expect(clampName("x".repeat(200))).toHaveLength(PERSON_DD_MAX_NAME_LENGTH);
    expect(clampName(123)).toBe("");
    expect(clampName(undefined)).toBe("");
  });
});

describe("slugify", () => {
  it("ASCII 名は小文字ハイフン化", () => {
    expect(slugify("Eiichi Shibusawa")).toBe("eiichi-shibusawa");
    expect(slugify("John F. Kennedy")).toBe("john-f-kennedy");
  });

  it("日本語名は安定したハッシュ slug (同名なら同 slug)", () => {
    const a = slugify("渋沢栄一");
    expect(a).toMatch(/^p-[a-z0-9]+$/);
    expect(slugify("渋沢栄一")).toBe(a);
    expect(slugify("岩崎弥太郎")).not.toBe(a);
  });
});

describe("canonicalizeModelId / calcCostJpy", () => {
  it("canonical alias はそのまま、datestamped は日付を剥がして解決 (BR-05)", () => {
    expect(canonicalizeModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(canonicalizeModelId("claude-sonnet-4-6-20260101")).toBe("claude-sonnet-4-6");
    expect(canonicalizeModelId("claude-3-5-sonnet")).toBe("claude-sonnet-4-6");
    expect(canonicalizeModelId("gpt-4o")).toBeNull(); // フェーズ1 は anthropic のみ
    expect(canonicalizeModelId(null)).toBeNull();
  });

  it("コストは USD 単価 × トークン × 為替", () => {
    // sonnet: in $3/1M, out $15/1M
    const jpy = calcCostJpy("claude-sonnet-4-6", 1_000_000, 1_000_000);
    expect(jpy).toBeCloseTo((3 + 15) * USD_JPY_RATE, 5);
    expect(calcCostJpy("claude-sonnet-4-6", 0, 0)).toBe(0);
  });
});

describe("buildSystemPrompt", () => {
  it("ガード・倫理制約・JSON 指示を必ず含み、プレースホルダを残さない", () => {
    const template = "{{RESPOND_LANGUAGE_INSTRUCTION}}\n評価基準本文\n{{UNKNOWN_VAR}}";
    const s = buildSystemPrompt(template, "consciousness_7d", "ja");
    expect(s).toContain("評価基準本文");
    expect(s).toContain(PERSON_EVAL_GUARD.split("\n")[1]); // 注入耐性行
    expect(s).toContain(PERSON_EVAL_SAFETY.split("\n")[1]); // 人格攻撃禁止行
    expect(s).toContain('"identified": false');
    expect(s).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("locale=en なら英語の散文言語指示になる", () => {
    const s = buildSystemPrompt("{{RESPOND_LANGUAGE_INSTRUCTION}}", "social_value_creation", "en");
    expect(s).toContain("English");
  });
});

describe("buildPersonEvalUserMessage", () => {
  it("評価対象人物として名前を渡す (名前は指示でなくデータ)", () => {
    const m = buildPersonEvalUserMessage("渋沢栄一");
    expect(m).toContain("評価対象人物: 渋沢栄一");
    expect(m).toContain("対象期間");
  });
});
