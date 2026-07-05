// 人物DD の DdResultSpec — vm-suite の DD 出力スキーマ検証を人物評価軸に再定義
// (DESIGN-HANDOVER.md §4.2)。純粋ロジックのみ (DB / ネットワーク非依存 = ユニットテスト対象)。
//
// 方針 (設計書):
// - 「必ず推計しスコアは出す」→ スコア欠落は invalid (エラー)、範囲外はクランプ (警告扱い)
// - 「根拠が弱ければ確信度を下げる」→ confidence A–D を型で強制し、数値化して集計
// - エビデンスは certainty (fact / estimate / unconfirmed) を型で強制する

import { sanitizeProse } from "./plain-text.js";

export const DD_TYPES = ["consciousness_7d", "social_value_creation"] as const;
export type DdType = (typeof DD_TYPES)[number];

export function isDdType(v: unknown): v is DdType {
  return typeof v === "string" && (DD_TYPES as readonly string[]).includes(v);
}

// 七次元の重み (合計 100)。公的社会価値創造スコア = Σ score/10 * weight。
export const CONSCIOUSNESS_WEIGHTS: Record<string, number> = {
  "1D": 10,
  "2D": 12,
  "3D": 15,
  "4D": 18,
  "5D": 15,
  "6D": 20,
  "7D": 10,
};
export const DIMENSION_KEYS = ["1D", "2D", "3D", "4D", "5D", "6D", "7D"] as const;

export type Confidence = "A" | "B" | "C" | "D";
const CONFIDENCE_VALUES: Record<Confidence, number> = { A: 1.0, B: 0.75, C: 0.5, D: 0.25 };

export type Certainty = "fact" | "estimate" | "unconfirmed";
const CERTAINTIES: readonly string[] = ["fact", "estimate", "unconfirmed"];

export type Evidence = { summary: string; certainty: Certainty };

export type DimensionResult = {
  score: number; // 0–10
  confidence: Confidence;
  keyEvidence: Evidence[];
  risks: string[];
};

export type Consciousness7dResult = {
  identified: true;
  subjectNote: string; // 同姓同名の前提・特定の根拠など
  dimensions: Record<(typeof DIMENSION_KEYS)[number], DimensionResult>;
  allocation: Record<(typeof DIMENSION_KEYS)[number], number>; // 意識配分 (正規化後 合計100)
  publicValueScore: number; // 0–100 (重み付き)
  rank: "S" | "A" | "B" | "C" | "D";
  createdValueEstimate: string; // 創造社会価値の推計 (散文)
  socialCosts: string; // 社会的コスト・負債
  counterfactual: string; // 反実仮想
  evolutionConditions: string[]; // 進化条件 3 つ
  summary: string;
};

export type SvcScoreItem = { key: string; score: number; reason: string };

export type SocialValueCreationResult = {
  identified: true;
  subjectNote: string;
  frames: Record<string, string>; // 8 フレーム所見
  items: SvcScoreItem[]; // 10 項目
  total100: number; // 再計算した合計 (各項目 0–10 × 10 項目)
  grade: number; // 1–10
  createdValue: {
    annualJpy: string; // 金額レンジは桁が大きく揺れるため文字列表現のまま保持
    cumulativeJpy: string;
    low: string;
    mid: string;
    high: string;
    assumptions: string[];
    confidence: Confidence;
  };
  counterfactualContributionPct: number; // 0–100
  comparative: string;
  verdict: string;
  somethingNew: string;
  limitations: string[];
  summary: string;
};

// 「特定できない/私人」の正当な拒否出力。評価失敗ではなく仕様どおりの応答として扱う。
export type NotIdentifiedResult = {
  identified: false;
  reason: string;
  neededInfo: string;
};

export type ValidationOutcome<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

// ------------------------------------------------------------
// 共通ヘルパ
// ------------------------------------------------------------

/** 数値を [min,max] にクランプする。数値でなければ null。 */
export function clampScore(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function normalizeConfidence(v: unknown): Confidence | null {
  if (typeof v !== "string") return null;
  const u = v.trim().toUpperCase();
  return u === "A" || u === "B" || u === "C" || u === "D" ? (u as Confidence) : null;
}

export function confidenceValue(c: Confidence): number {
  return CONFIDENCE_VALUES[c];
}

function normalizeCertainty(v: unknown): Certainty {
  if (typeof v === "string" && CERTAINTIES.includes(v.trim().toLowerCase())) {
    return v.trim().toLowerCase() as Certainty;
  }
  return "unconfirmed"; // 型を満たさない根拠は「未確認」に落とす (安全側)
}

function asString(v: unknown): string {
  // 散文フィールドの共通入口。記号装飾はここで落とす (CLAUDE.md 文体規約の最終防衛線)
  return typeof v === "string" ? sanitizeProse(v) : "";
}

function asStringArray(v: unknown, max = 10): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => sanitizeProse(x as string))
    .slice(0, max);
}

function parseEvidence(v: unknown, max = 5): Evidence[] {
  if (!Array.isArray(v)) return [];
  const out: Evidence[] = [];
  for (const e of v.slice(0, max)) {
    if (typeof e === "string" && e.trim()) {
      out.push({ summary: sanitizeProse(e), certainty: "unconfirmed" });
    } else if (e && typeof e === "object") {
      const summary = asString((e as Record<string, unknown>).summary);
      if (summary) out.push({ summary, certainty: normalizeCertainty((e as Record<string, unknown>).certainty) });
    }
  }
  return out;
}

/**
 * AI 出力テキストから JSON オブジェクトを取り出す。
 * コードフェンス (```json ... ```) と前後の散文を許容し、最初の { から対応する } までを解析する。
 */
export function extractJson(text: string): unknown | null {
  const stripped = text.replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("{");
  if (start < 0) return null;
  // 対応する閉じ括弧を深さ追跡で探す (文字列リテラル内の {} を無視)
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(stripped.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function rankFromScore(score: number): "S" | "A" | "B" | "C" | "D" {
  if (score >= 85) return "S";
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  return "D";
}

// identified:false (特定不能/私人) の共通判定。
function parseNotIdentified(root: Record<string, unknown>): NotIdentifiedResult | null {
  if (root.identified === false) {
    return {
      identified: false,
      reason: asString(root.reason) || "対象を特定できませんでした",
      neededInfo: asString(root.needed_info ?? root.neededInfo),
    };
  }
  return null;
}

// ------------------------------------------------------------
// consciousness_7d の検証
// ------------------------------------------------------------

export function validateConsciousness7d(
  raw: unknown,
): ValidationOutcome<Consciousness7dResult | NotIdentifiedResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["出力が JSON オブジェクトではない"], warnings };
  }
  const root = raw as Record<string, unknown>;

  const notIdentified = parseNotIdentified(root);
  if (notIdentified) return { ok: true, value: notIdentified, warnings };

  const dimsRaw = root.dimensions;
  if (!dimsRaw || typeof dimsRaw !== "object") {
    return { ok: false, errors: ["dimensions が無い"], warnings };
  }
  const dims = {} as Consciousness7dResult["dimensions"];
  for (const key of DIMENSION_KEYS) {
    const d = (dimsRaw as Record<string, unknown>)[key];
    if (!d || typeof d !== "object") {
      errors.push(`dimensions.${key} が無い`);
      continue;
    }
    const rec = d as Record<string, unknown>;
    const score = clampScore(rec.score, 0, 10);
    if (score === null) {
      errors.push(`dimensions.${key}.score が数値でない (必ず推計してスコアを出す)`);
      continue;
    }
    if (score !== rec.score) warnings.push(`dimensions.${key}.score を 0–10 にクランプ`);
    const confidence = normalizeConfidence(rec.confidence);
    if (!confidence) {
      errors.push(`dimensions.${key}.confidence が A–D でない`);
      continue;
    }
    dims[key] = {
      score,
      confidence,
      keyEvidence: parseEvidence(rec.key_evidence ?? rec.keyEvidence),
      risks: asStringArray(rec.risks),
    };
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  // 意識配分: 合計 ~100 に正規化。全ゼロ/欠落はエラー。
  const allocRaw = (root.allocation ?? {}) as Record<string, unknown>;
  const allocVals = DIMENSION_KEYS.map((k) => clampScore(allocRaw[k], 0, 100) ?? 0);
  const allocSum = allocVals.reduce((a, b) => a + b, 0);
  if (allocSum <= 0) {
    return { ok: false, errors: ["allocation (意識配分) が無い/全ゼロ"], warnings };
  }
  if (Math.abs(allocSum - 100) > 1) warnings.push(`allocation 合計 ${allocSum} → 100 に正規化`);
  const allocation = {} as Consciousness7dResult["allocation"];
  DIMENSION_KEYS.forEach((k, i) => {
    allocation[k] = Math.round(((allocVals[i] ?? 0) / allocSum) * 1000) / 10;
  });

  // 公的社会価値創造スコア: モデル申告値は使わず重みから再計算する (検証の要)
  let publicValueScore = 0;
  for (const k of DIMENSION_KEYS) {
    publicValueScore += (dims[k].score / 10) * (CONSCIOUSNESS_WEIGHTS[k] ?? 0);
  }
  publicValueScore = Math.round(publicValueScore * 10) / 10;
  const declared = clampScore(root.public_value_score ?? root.publicValueScore, 0, 100);
  if (declared !== null && Math.abs(declared - publicValueScore) > 5) {
    warnings.push(`申告スコア ${declared} と再計算 ${publicValueScore} が乖離 (再計算を採用)`);
  }

  const evolutionConditions = asStringArray(root.evolution_conditions ?? root.evolutionConditions, 5);
  if (evolutionConditions.length < 3) warnings.push("進化条件が 3 つ未満");

  return {
    ok: true,
    warnings,
    value: {
      identified: true,
      subjectNote: asString(root.subject_note ?? root.subjectNote),
      dimensions: dims,
      allocation,
      publicValueScore,
      rank: rankFromScore(publicValueScore),
      createdValueEstimate: asString(root.created_value_estimate ?? root.createdValueEstimate),
      socialCosts: asString(root.social_costs ?? root.socialCosts),
      counterfactual: asString(root.counterfactual),
      evolutionConditions,
      summary: asString(root.summary),
    },
  };
}

// ------------------------------------------------------------
// social_value_creation の検証
// ------------------------------------------------------------

export function validateSocialValueCreation(
  raw: unknown,
): ValidationOutcome<SocialValueCreationResult | NotIdentifiedResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["出力が JSON オブジェクトではない"], warnings };
  }
  const root = raw as Record<string, unknown>;

  const notIdentified = parseNotIdentified(root);
  if (notIdentified) return { ok: true, value: notIdentified, warnings };

  const itemsRaw = root.items ?? root.scores;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    return { ok: false, errors: ["items (10 項目スコア) が無い"], warnings };
  }
  if (itemsRaw.length !== 10) warnings.push(`items が ${itemsRaw.length} 件 (期待 10)`);
  const items: SvcScoreItem[] = [];
  itemsRaw.slice(0, 10).forEach((it, i) => {
    if (!it || typeof it !== "object") {
      errors.push(`items[${i}] がオブジェクトでない`);
      return;
    }
    const rec = it as Record<string, unknown>;
    const score = clampScore(rec.score, 0, 10);
    if (score === null) {
      errors.push(`items[${i}].score が数値でない (必ず推計してスコアを出す)`);
      return;
    }
    if (score !== rec.score) warnings.push(`items[${i}].score を 0–10 にクランプ`);
    items.push({
      key: asString(rec.key ?? rec.name) || `item_${i + 1}`,
      score,
      reason: asString(rec.reason),
    });
  });
  if (errors.length > 0) return { ok: false, errors, warnings };

  // total は申告値でなく再計算 (10 項目 0–10 → 0–100)。項目不足時は 10 項目換算に比例補正。
  const rawTotal = items.reduce((a, b) => a + b.score, 0);
  const total100 = Math.round((items.length > 0 ? (rawTotal / items.length) * 10 : 0) * 10) / 10;

  const gradeDeclared = clampScore(root.grade, 1, 10);
  const grade = gradeDeclared !== null ? Math.round(gradeDeclared) : Math.min(10, Math.max(1, Math.ceil(total100 / 10)));

  const cvRaw = (root.created_value ?? root.createdValue ?? {}) as Record<string, unknown>;
  const cvConfidence = normalizeConfidence(cvRaw.confidence) ?? "D";
  if (!normalizeConfidence(cvRaw.confidence)) warnings.push("created_value.confidence 欠落 → D 扱い");

  const pct = clampScore(
    root.counterfactual_contribution_pct ?? root.counterfactualContributionPct,
    0,
    100,
  );
  if (pct === null) {
    return { ok: false, errors: ["counterfactual_contribution_pct (反事実貢献率) が無い"], warnings };
  }

  const framesRaw = (root.frames ?? {}) as Record<string, unknown>;
  const frames: Record<string, string> = {};
  for (const [k, v] of Object.entries(framesRaw)) {
    if (typeof v === "string" && v.trim()) frames[k] = v.trim();
  }
  if (Object.keys(frames).length < 8) warnings.push(`frames が ${Object.keys(frames).length} 件 (期待 8)`);

  return {
    ok: true,
    warnings,
    value: {
      identified: true,
      subjectNote: asString(root.subject_note ?? root.subjectNote),
      frames,
      items,
      total100,
      grade,
      createdValue: {
        annualJpy: asString(cvRaw.annual_jpy ?? cvRaw.annualJpy ?? cvRaw.annual),
        cumulativeJpy: asString(cvRaw.cumulative_jpy ?? cvRaw.cumulativeJpy ?? cvRaw.cumulative),
        low: asString(cvRaw.low),
        mid: asString(cvRaw.mid),
        high: asString(cvRaw.high),
        assumptions: asStringArray(cvRaw.assumptions),
        confidence: cvConfidence,
      },
      counterfactualContributionPct: pct,
      comparative: asString(root.comparative),
      verdict: asString(root.verdict),
      somethingNew: asString(root.something_new ?? root.somethingNew),
      limitations: asStringArray(root.limitations),
      summary: asString(root.summary),
    },
  };
}

// ------------------------------------------------------------
// スコア集計 (person_due_diligences.module_score / confidence_score)
// ------------------------------------------------------------

export function moduleScoreOf(
  result: Consciousness7dResult | SocialValueCreationResult | NotIdentifiedResult,
): number | null {
  if (!result.identified) return null;
  return "publicValueScore" in result ? result.publicValueScore : result.total100;
}

export function confidenceScoreOf(
  result: Consciousness7dResult | SocialValueCreationResult | NotIdentifiedResult,
): number | null {
  if (!result.identified) return null;
  if ("dimensions" in result) {
    // 七次元: 重み付き平均 (根拠が弱い次元が重いほど確信度が下がる)
    let sum = 0;
    for (const k of DIMENSION_KEYS) {
      sum += confidenceValue(result.dimensions[k].confidence) * (CONSCIOUSNESS_WEIGHTS[k] ?? 0);
    }
    return Math.round(sum) / 100;
  }
  return confidenceValue(result.createdValue.confidence);
}

// ------------------------------------------------------------
// JSON 出力指示 (DB プロンプトの末尾に付帯する)
// ------------------------------------------------------------

const COMMON_JSON_RULES = [
  "出力は JSON オブジェクト 1 個だけにしてください (前後の説明文・コードフェンス不要)。",
  "散文フィールド (summary / reason / 所見 / 推計などの値) の中では、アスタリスクやシャープ、※、箇条書き記号、表などの記号装飾・Markdown を一切使わず、ふつうの文章で書いてください。強調は記号でなく言葉で行います。",
  '対象を公人として特定できない場合・私人と思われる場合は {"identified": false, "reason": "...", "needed_info": "..."} だけを返してください。',
  "スコアは必ず数値で出してください。根拠が弱い場合はスコアを空にせず、confidence (A=確実〜D=推測) を下げて表現してください。",
  'key_evidence の各要素は {"summary": "...", "certainty": "fact|estimate|unconfirmed"} で、事実か推計か未確認かを必ず区別してください。',
].join("\n");

export function buildOutputInstruction(ddType: DdType): string {
  if (ddType === "consciousness_7d") {
    return `${COMMON_JSON_RULES}

JSON スキーマ (consciousness_7d):
{
  "identified": true,
  "subject_note": "特定した人物の前提 (同姓同名がいる場合は必ず明記)",
  "dimensions": {
    "1D": {"score": 0-10, "confidence": "A|B|C|D", "key_evidence": [{"summary": "...", "certainty": "fact|estimate|unconfirmed"}], "risks": ["..."]},
    "2D": {...}, "3D": {...}, "4D": {...}, "5D": {...}, "6D": {...}, "7D": {...}
  },
  "allocation": {"1D": 数値, ..., "7D": 数値},  // 意識配分。合計 100
  "public_value_score": 0-100,  // 参考申告値 (重み 1D10/2D12/3D15/4D18/5D15/6D20/7D10 で再計算されます)
  "created_value_estimate": "創造した社会価値の推計 (散文)",
  "social_costs": "社会的コスト・負債 (散文)",
  "counterfactual": "反実仮想: この人がいなかったら (散文)",
  "evolution_conditions": ["進化条件1", "進化条件2", "進化条件3"],
  "summary": "総括 (散文)"
}`;
  }
  return `${COMMON_JSON_RULES}

JSON スキーマ (social_value_creation):
{
  "identified": true,
  "subject_note": "特定した人物の前提 (同姓同名がいる場合は必ず明記)",
  "frames": {"frame1": "所見", ... 8 フレームぶん},
  "items": [{"key": "項目名", "score": 0-10, "reason": "..."}, ... 10 項目],
  "grade": 1-10,
  "created_value": {
    "annual_jpy": "年間の創造価値 (例: 約120億円)",
    "cumulative_jpy": "累積",
    "low": "...", "mid": "...", "high": "...",
    "assumptions": ["前提1", "前提2"],
    "confidence": "A|B|C|D"
  },
  "counterfactual_contribution_pct": 0-100,
  "comparative": "比較評価 (散文)",
  "verdict": "総合判断 (散文)",
  "something_new": "新しい視点 (散文)",
  "limitations": ["評価の限界", "追加調査すべき点", "変動条件"],
  "summary": "総括 (散文)"
}`;
}
