// 出力履歴 (something new の構造化) の純粋関数 — AI-LEVERAGE-DESIGN.md の第1歩。
// 生成のたびに「出した提案の要旨」を短く残し、次の生成に「既出リスト」として渡して
// 同じ提案の繰り返しを構造的に防ぐ。履歴は短文なので追加のトークン費はほぼゼロ。

export type PriorOutput = { summary: string; createdAt: Date };

// 生成結果から履歴に残す要旨を作る (決定的・AI 不要)。空要素を除き、空白を畳み、上限で切る。
export function summarizeForHistory(parts: Array<string | null | undefined>, max = 200): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .join(" / ")
    .slice(0, max);
}

// 既出リストをプロンプトへ渡す形にする。新しい順で最大 take 件。履歴が無ければ空文字
// (プロンプトに何も足さない = 初回のコストは従来と同じ)。
export function buildPriorBlock(priors: PriorOutput[], take = 8): string {
  const lines = priors.slice(0, take).map((p) => `${p.createdAt.toISOString().slice(0, 10)} ${p.summary}`);
  if (lines.length === 0) return "";
  return [
    "これまでに出した提案 (既出):",
    ...lines,
    "既出と同じ内容や言い換えは出さない。既出に無い新しい視点か一手を必ず含める。",
  ].join("\n");
}
