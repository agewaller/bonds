// AI モデル定義とコスト計算 (純粋ロジック / ユニットテスト対象)。cares lib/cost.ts を踏襲。
// モデル ID は canonical alias のみ (datestamped ID のハードコード禁止 = BR-05 相当)。

export type AiProvider = "anthropic";

// USD/1M (公式レート)。bonds フェーズ1 は Anthropic のみ (フォールバック連鎖禁止)。
export const AVAILABLE_MODELS = [
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    inputUsdPer1M: 1.0,
    outputUsdPer1M: 5.0,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    inputUsdPer1M: 3.0,
    outputUsdPer1M: 15.0,
  },
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    inputUsdPer1M: 5.0,
    outputUsdPer1M: 25.0,
  },
] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number]["id"];

export function isValidModelId(id: string): id is ModelId {
  return AVAILABLE_MODELS.some((m) => m.id === id);
}

// 旧 ID や日付付き ID を canonical alias に解決するためのマップ。
export const MODEL_MAP: Record<string, ModelId> = {
  "claude-haiku-4-5": "claude-haiku-4-5",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-opus-4-7": "claude-opus-4-7",
  "claude-3-5-haiku": "claude-haiku-4-5",
  "claude-3-5-sonnet": "claude-sonnet-4-6",
};

/**
 * 任意のモデル文字列を canonical alias に正規化する。
 * 末尾 -YYYYMMDD の datestamped ID は日付を剥がして再解決。解決できなければ null。
 */
export function canonicalizeModelId(raw: string | null | undefined): ModelId | null {
  if (!raw) return null;
  if (isValidModelId(raw)) return raw;
  if (MODEL_MAP[raw]) return MODEL_MAP[raw];
  const stripped = raw.replace(/-\d{8}$/, "");
  if (isValidModelId(stripped)) return stripped;
  if (MODEL_MAP[stripped]) return MODEL_MAP[stripped];
  return null;
}

// 簡易固定レート (cares と同値)。
export const USD_JPY_RATE = 150;

export function calcCostJpy(id: ModelId, inputTokens: number, outputTokens: number): number {
  const m = AVAILABLE_MODELS.find((x) => x.id === id)!;
  const usd =
    (inputTokens * m.inputUsdPer1M) / 1_000_000 +
    (outputTokens * m.outputUsdPer1M) / 1_000_000;
  return usd * USD_JPY_RATE;
}
