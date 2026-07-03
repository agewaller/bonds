import { describe, it, expect } from "vitest";
import {
  CONSCIOUSNESS_WEIGHTS,
  DIMENSION_KEYS,
  clampScore,
  normalizeConfidence,
  confidenceValue,
  extractJson,
  rankFromScore,
  validateConsciousness7d,
  validateSocialValueCreation,
  moduleScoreOf,
  confidenceScoreOf,
  buildOutputInstruction,
  isDdType,
} from "../../src/lib/dd-spec.js";

// 有効な consciousness_7d 出力のファクトリ
function valid7d(overrides: Record<string, unknown> = {}) {
  const dim = (score: number) => ({
    score,
    confidence: "B",
    key_evidence: [{ summary: "著作で言及", certainty: "fact" }],
    risks: ["時代背景の違い"],
  });
  return {
    identified: true,
    subject_note: "実業家の渋沢栄一 (1840-1931) を前提",
    dimensions: {
      "1D": dim(7), "2D": dim(8), "3D": dim(9), "4D": dim(9),
      "5D": dim(8), "6D": dim(9), "7D": dim(7),
    },
    allocation: { "1D": 5, "2D": 10, "3D": 20, "4D": 25, "5D": 15, "6D": 20, "7D": 5 },
    public_value_score: 85,
    created_value_estimate: "約500社の設立に関与",
    social_costs: "特筆すべき負債は限定的",
    counterfactual: "日本の資本主義形成が遅れた可能性",
    evolution_conditions: ["a", "b", "c"],
    summary: "総括",
    ...overrides,
  };
}

// 有効な social_value_creation 出力のファクトリ
function validSvc(overrides: Record<string, unknown> = {}) {
  return {
    identified: true,
    subject_note: "実業家の渋沢栄一を前提",
    frames: {
      f1: "a", f2: "b", f3: "c", f4: "d", f5: "e", f6: "f", f7: "g", f8: "h",
    },
    items: Array.from({ length: 10 }, (_, i) => ({
      key: `項目${i + 1}`,
      score: 8,
      reason: "理由",
    })),
    grade: 9,
    created_value: {
      annual_jpy: "約100億円",
      cumulative_jpy: "約1兆円",
      low: "0.5兆", mid: "1兆", high: "2兆",
      assumptions: ["設立関与企業の付加価値の一部を帰属"],
      confidence: "B",
    },
    counterfactual_contribution_pct: 30,
    comparative: "岩崎弥太郎との比較",
    verdict: "総合判断",
    something_new: "新視点",
    limitations: ["学習知識ベースの限界"],
    summary: "総括",
    ...overrides,
  };
}

describe("clampScore / normalizeConfidence / rankFromScore", () => {
  it("範囲内はそのまま、範囲外はクランプ、非数値は null", () => {
    expect(clampScore(5, 0, 10)).toBe(5);
    expect(clampScore(-3, 0, 10)).toBe(0);
    expect(clampScore(15, 0, 10)).toBe(10);
    expect(clampScore("7", 0, 10)).toBe(7); // 文字列数値は許容
    expect(clampScore("abc", 0, 10)).toBeNull();
    expect(clampScore(null, 0, 10)).toBeNull();
    expect(clampScore(NaN, 0, 10)).toBeNull();
  });

  it("confidence は大文字小文字を吸収し A–D 以外は null", () => {
    expect(normalizeConfidence("a")).toBe("A");
    expect(normalizeConfidence(" B ")).toBe("B");
    expect(normalizeConfidence("E")).toBeNull();
    expect(normalizeConfidence(1)).toBeNull();
    expect(confidenceValue("A")).toBe(1.0);
    expect(confidenceValue("D")).toBe(0.25);
  });

  it("rank 閾値: 85→S / 70→A / 55→B / 40→C / それ未満→D", () => {
    expect(rankFromScore(85)).toBe("S");
    expect(rankFromScore(84.9)).toBe("A");
    expect(rankFromScore(70)).toBe("A");
    expect(rankFromScore(55)).toBe("B");
    expect(rankFromScore(40)).toBe("C");
    expect(rankFromScore(39.9)).toBe("D");
  });

  it("重みの合計は 100", () => {
    expect(Object.values(CONSCIOUSNESS_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("isDdType は 2 モジュールのみ許可", () => {
    expect(isDdType("consciousness_7d")).toBe(true);
    expect(isDdType("social_value_creation")).toBe(true);
    expect(isDdType("legal_dd")).toBe(false);
  });
});

describe("extractJson", () => {
  it("素の JSON / コードフェンス / 前後の散文を許容する", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('前置きです。\n{"a":{"b":2}}\n以上。')).toEqual({ a: { b: 2 } });
  });

  it("文字列リテラル内の括弧に惑わされない", () => {
    expect(extractJson('{"note":"括弧 } を含む文"}')).toEqual({ note: "括弧 } を含む文" });
  });

  it("JSON が無い/壊れているときは null", () => {
    expect(extractJson("散文だけの応答です")).toBeNull();
    expect(extractJson('{"broken": ')).toBeNull();
  });
});

describe("validateConsciousness7d", () => {
  it("有効な出力を受理し、スコアを重みから再計算する", () => {
    const r = validateConsciousness7d(valid7d());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.identified).toBe(true);
    if (!r.value.identified) return;
    // 7×1.0 + 8×1.2 + 9×1.5 + 9×1.8 + 8×1.5 + 9×2.0 + 7×1.0 = 83.3
    expect(r.value.publicValueScore).toBeCloseTo(83.3, 1);
    expect(r.value.rank).toBe("A");
    expect(r.value.dimensions["6D"].keyEvidence[0]?.certainty).toBe("fact");
  });

  it("identified:false (私人/特定不能) は正当な結果として受理する", () => {
    const r = validateConsciousness7d({ identified: false, reason: "特定できない", needed_info: "国・所属" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.identified).toBe(false);
  });

  it("score 欠落した次元があれば invalid (必ず推計する原則)", () => {
    const bad = valid7d();
    (bad.dimensions as Record<string, Record<string, unknown>>)["4D"] = {
      confidence: "B", key_evidence: [], risks: [],
    };
    const r = validateConsciousness7d(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join()).toContain("4D");
  });

  it("範囲外 score はクランプして警告 (エラーにしない)", () => {
    const over = valid7d();
    (over.dimensions as Record<string, Record<string, unknown>>)["1D"] = {
      score: 12, confidence: "A", key_evidence: [], risks: [],
    };
    const r = validateConsciousness7d(over);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.identified) return;
    expect(r.value.dimensions["1D"].score).toBe(10);
    expect(r.warnings.join()).toContain("1D");
  });

  it("confidence が A–D 以外なら invalid", () => {
    const bad = valid7d();
    (bad.dimensions as Record<string, Record<string, unknown>>)["2D"] = {
      score: 5, confidence: "高", key_evidence: [], risks: [],
    };
    expect(validateConsciousness7d(bad).ok).toBe(false);
  });

  it("allocation は合計 100 に正規化する", () => {
    const r = validateConsciousness7d(valid7d({ allocation: { "1D": 1, "2D": 1, "3D": 1, "4D": 1, "5D": 1, "6D": 1, "7D": 1 } }));
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.identified) return;
    const sum = DIMENSION_KEYS.reduce((a, k) => a + r.value.allocation[k], 0);
    expect(sum).toBeCloseTo(100, 0);
  });

  it("allocation 全ゼロ/欠落は invalid", () => {
    expect(validateConsciousness7d(valid7d({ allocation: {} })).ok).toBe(false);
  });

  it("certainty が不正な evidence は unconfirmed に落とす (安全側)", () => {
    const v = valid7d();
    (v.dimensions as Record<string, Record<string, unknown>>)["1D"] = {
      score: 5, confidence: "A",
      key_evidence: [{ summary: "根拠", certainty: "definitely-true" }],
      risks: [],
    };
    const r = validateConsciousness7d(v);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.identified) return;
    expect(r.value.dimensions["1D"].keyEvidence[0]?.certainty).toBe("unconfirmed");
  });

  it("JSON オブジェクトでない入力は invalid", () => {
    expect(validateConsciousness7d(null).ok).toBe(false);
    expect(validateConsciousness7d([1, 2]).ok).toBe(false);
    expect(validateConsciousness7d("text").ok).toBe(false);
  });
});

describe("validateSocialValueCreation", () => {
  it("有効な出力を受理し total を再計算する", () => {
    const r = validateSocialValueCreation(validSvc());
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.identified) return;
    expect(r.value.total100).toBe(80); // 8×10 項目
    expect(r.value.grade).toBe(9);
    expect(r.value.counterfactualContributionPct).toBe(30);
  });

  it("items 欠落は invalid", () => {
    expect(validateSocialValueCreation(validSvc({ items: [] })).ok).toBe(false);
    expect(validateSocialValueCreation(validSvc({ items: undefined })).ok).toBe(false);
  });

  it("項目の score 非数値は invalid、範囲外はクランプ", () => {
    const badScore = validSvc();
    (badScore.items as Record<string, unknown>[])[3] = { key: "x", score: "高い", reason: "" };
    expect(validateSocialValueCreation(badScore).ok).toBe(false);

    const over = validSvc();
    (over.items as Record<string, unknown>[])[0] = { key: "x", score: 11, reason: "" };
    const r = validateSocialValueCreation(over);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.identified) return;
    expect(r.value.items[0]?.score).toBe(10);
  });

  it("items が 10 件未満でも比例補正で 0–100 に換算する (警告つき)", () => {
    const five = validSvc({
      items: Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, score: 6, reason: "r" })),
    });
    const r = validateSocialValueCreation(five);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.identified) return;
    expect(r.value.total100).toBe(60);
    expect(r.warnings.join()).toContain("5 件");
  });

  it("反事実貢献率の欠落は invalid、範囲外はクランプ", () => {
    expect(
      validateSocialValueCreation(validSvc({ counterfactual_contribution_pct: undefined })).ok,
    ).toBe(false);
    const r = validateSocialValueCreation(validSvc({ counterfactual_contribution_pct: 150 }));
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.identified) return;
    expect(r.value.counterfactualContributionPct).toBe(100);
  });

  it("created_value.confidence 欠落は D 扱いで警告", () => {
    const v = validSvc();
    (v.created_value as Record<string, unknown>).confidence = undefined;
    const r = validateSocialValueCreation(v);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value.identified) return;
    expect(r.value.createdValue.confidence).toBe("D");
    expect(r.warnings.join()).toContain("confidence");
  });

  it("identified:false は正当な結果として受理する", () => {
    const r = validateSocialValueCreation({ identified: false, reason: "私人と思われる" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.identified).toBe(false);
  });
});

describe("moduleScoreOf / confidenceScoreOf", () => {
  it("7d は重み付き再計算スコア、svc は total100", () => {
    const r7 = validateConsciousness7d(valid7d());
    const rs = validateSocialValueCreation(validSvc());
    if (!r7.ok || !rs.ok) throw new Error("fixture invalid");
    expect(moduleScoreOf(r7.value)).toBeCloseTo(83.3, 1);
    expect(moduleScoreOf(rs.value)).toBe(80);
  });

  it("confidence: 7d は重み付き平均、svc は created_value.confidence", () => {
    const r7 = validateConsciousness7d(valid7d()); // 全次元 B = 0.75
    const rs = validateSocialValueCreation(validSvc()); // B
    if (!r7.ok || !rs.ok) throw new Error("fixture invalid");
    expect(confidenceScoreOf(r7.value)).toBeCloseTo(0.75, 2);
    expect(confidenceScoreOf(rs.value)).toBe(0.75);
  });

  it("identified:false のときは null (スコア無し)", () => {
    expect(moduleScoreOf({ identified: false, reason: "", neededInfo: "" })).toBeNull();
    expect(confidenceScoreOf({ identified: false, reason: "", neededInfo: "" })).toBeNull();
  });
});

describe("buildOutputInstruction", () => {
  it("両モジュールともスキーマと identified:false 経路を含む", () => {
    for (const t of ["consciousness_7d", "social_value_creation"] as const) {
      const s = buildOutputInstruction(t);
      expect(s).toContain('"identified": false');
      expect(s).toContain("fact|estimate|unconfirmed");
      expect(s).toContain(t);
    }
    expect(buildOutputInstruction("consciousness_7d")).toContain("1D10/2D12/3D15/4D18/5D15/6D20/7D10");
    expect(buildOutputInstruction("social_value_creation")).toContain("counterfactual_contribution_pct");
  });
});
