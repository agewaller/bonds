// ユーザー向け AI 散文を読みやすいプレーン文章に整える (最終防衛線)。
// 一次対策は system プロンプトの記号禁止指示だが、モデルが取りこぼして
// Markdown 記号を出した場合に備え、検証・保存の段階で保守的に除去する。
// cares apps/api/src/lib/plain-text.ts と同じ規則 (BR-09 / CLAUDE.md 文体規約)。

export function sanitizeProse(input: string | null | undefined): string {
  if (!input) return "";
  let s = input;
  // コードフェンス ``` を除去 (中身は残す)
  s = s.replace(/```[a-zA-Z]*\n?/g, "");
  // 行頭の見出し記号 (#, ##, ...) を除去
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  // 行頭の箇条書き記号 (-, *, +) を除去。日本語の「・」は残す
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  // 強調 **x** / __x__ / *x* / _x_ → 中身だけ残す
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/\*([^*\n]+)\*/g, "$1");
  s = s.replace(/(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g, "$1");
  // 対になっていない ** の残骸も装飾目的なので消す
  s = s.replace(/\*\*/g, "");
  // AI が好みがちな装飾・注記記号を除去
  s = s.replace(/^[ \t]*[※●▼◆■★◎►]+[ \t]*/gm, "");
  s = s.replace(/[※●▼◆■★◎►]/g, "");
  // 3 行以上の連続改行を 2 行に圧縮
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
