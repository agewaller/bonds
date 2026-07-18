// 申し出カタログ (あなたが提供できること) と、相手のニーズとのマッチング — 純粋関数。
// gift の item.action (give/lend/teach/do/advise) の概念だけを、bonds のミッション
// 「貢献のためのアクション」に絞って新規実装。マーケットプレイス・ポイント経済・FB 認証は
// 移植しない。AI は使わない (毎回無料・決定的) — 言語非依存の文字 2-gram + 語の重なりで
// 「この申し出が役立ちそうな方」を根拠つきで挙げる。

export const OFFERING_KINDS = ["give", "lend", "teach", "help", "advise", "other"] as const;
export type OfferingKind = (typeof OFFERING_KINDS)[number];

export const OFFERING_KIND_LABEL: Record<string, string> = {
  give: "譲る",
  lend: "貸す",
  teach: "教える",
  help: "手伝う",
  advise: "相談にのる",
  other: "その他",
};

// 受け渡し・提供の方法 (gift の logistics を関係文脈に絞った選択肢)
export const LOGISTICS_OPTIONS = ["対面", "オンライン", "電話", "データ送付", "郵送", "手渡し", "貸与"];

export type OfferingInput = {
  kind: string;
  title: string;
  description: string | null;
  category: string | null;
  situations: string[];
  logistics: string[];
  maxDistance: number | null;
};

const clampStr = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** ユーザー入力を検証して申し出に整える。title 必須。 */
export function parseOfferingInput(raw: unknown): OfferingInput | { error: string; detail: string } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const title = clampStr(o.title, 120);
  if (!title) return { error: "title_required", detail: "何ができるか (例: 英語を教えられる) を入力してください" };
  const kind = OFFERING_KINDS.includes(o.kind as OfferingKind) ? (o.kind as string) : "help";
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 12) : [];
  const md = Number(o.maxDistance);
  return {
    kind,
    title,
    description: clampStr(o.description, 1000) || null,
    category: clampStr(o.category, 40) || null,
    situations: arr(o.situations),
    logistics: arr(o.logistics).filter((x) => LOGISTICS_OPTIONS.includes(x)),
    maxDistance: Number.isInteger(md) && md >= 1 && md <= 5 ? md : null,
  };
}

// ------- マッチング -------

/** テキストから照合用のトークンを作る: ASCII 語 (2 文字以上) + CJK 文字 2-gram。 */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  // ASCII の語 (英数)
  for (const m of lower.matchAll(/[a-z0-9]{2,}/g)) out.add(m[0]);
  // CJK (漢字・かな) の連なりから 2-gram
  for (const m of lower.matchAll(/[぀-ヿ一-鿿㐀-䶿]{2,}/g)) {
    const s = m[0];
    for (let i = 0; i + 2 <= s.length; i++) out.add(s.slice(i, i + 2));
    if (s.length <= 4) out.add(s); // 短語はそのものも
  }
  return out;
}

// 助詞・ありふれた 2-gram はノイズになるので照合から除く
const STOP = new Set(["こと", "して", "する", "です", "ます", "ました", "たい", "ている", "など", "から", "the", "and", "for", "you", "with"]);

export type OfferingLike = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  category: string | null;
  situations: string[];
  maxDistance: number | null;
};

export type ContactNeed = {
  id: string;
  name: string;
  distance: number;
  // ニーズを表すテキスト源 (悩み・課題・夢・論点整理・メモ)。復号済みで渡す。
  needTexts: string[];
};

export type OfferingMatch = {
  contactId: string;
  name: string;
  score: number;
  reason: string; // 相手側の該当箇所 (なぜ刺さるか)
};

/** 1 つの申し出について、ニーズが重なる連絡先を上位から返す。 */
export function matchOfferingToContacts(
  offering: OfferingLike,
  contacts: ContactNeed[],
  maxItems = 5,
): OfferingMatch[] {
  const offeringTokens = new Set<string>();
  for (const t of tokenize([offering.title, offering.description ?? "", offering.category ?? "", ...offering.situations].join(" "))) {
    if (!STOP.has(t)) offeringTokens.add(t);
  }
  if (offeringTokens.size === 0) return [];

  const out: OfferingMatch[] = [];
  for (const ct of contacts) {
    if (offering.maxDistance != null && ct.distance > offering.maxDistance) continue;
    let best = 0;
    let bestText = "";
    for (const text of ct.needTexts) {
      if (!text.trim()) continue;
      const toks = tokenize(text);
      let shared = 0;
      for (const t of toks) if (!STOP.has(t) && offeringTokens.has(t)) shared++;
      if (shared > best) {
        best = shared;
        bestText = text;
      }
    }
    if (best >= 2) {
      out.push({
        contactId: ct.id,
        name: ct.name,
        score: best,
        reason: bestText.trim().slice(0, 80),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || (a.contactId < b.contactId ? -1 : 1)).slice(0, maxItems);
}
