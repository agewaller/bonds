// 応答言語 (cares lib/locale.ts の縮約版)。散文プロンプトにのみ付帯し、
// 構造化 JSON プロンプトには付けない (DESIGN-HANDOVER.md §6)。
// 人物DD の出力 JSON は散文フィールドを含むため、「散文フィールドの言語」を指示する。

const KNOWN = new Map<string, string>([
  ["ja", "Japanese"],
  ["en", "English"],
  ["zh-hans", "Simplified Chinese"],
  ["zh-hant", "Traditional Chinese"],
  ["ko", "Korean"],
  ["fr", "French"],
  ["de", "German"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
]);

export function normalizeLocale(input: string | null | undefined): string {
  if (!input) return "ja";
  const s = String(input).trim().toLowerCase();
  if (!s) return "ja";
  if (KNOWN.has(s)) return s === "zh-hans" ? "zh-Hans" : s === "zh-hant" ? "zh-Hant" : s;
  const base = s.split(/[-_]/)[0] ?? "";
  if (base === "zh") return /hant|tw|hk|mo/i.test(s) ? "zh-Hant" : "zh-Hans";
  if (KNOWN.has(base)) return base;
  return /^[a-z]{2,3}$/.test(base) ? base : "ja";
}

/** JSON 内の散文フィールド向け言語指示。JSON 構造そのものは崩させない。 */
export function jsonProseLanguageDirective(code: string | null | undefined): string {
  const norm = normalizeLocale(code);
  if (norm === "ja") {
    return "JSON のキー名・構造は変えず、散文フィールド (summary / reason / 所見など) の値は必ず日本語で書いてください。";
  }
  const name = KNOWN.get(norm.toLowerCase()) ?? norm;
  return `Keep all JSON keys and structure unchanged, but write every prose field value (summary / reason / findings etc.) entirely in ${name} (${norm}).`;
}
