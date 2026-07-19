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

// ------- 一括取込 (スプレッドシート / 貼り付け) からの分類 -------

// 「提供できるもの」の 1 行を、申し出の種類にざっくり振り分けるためのキーワード。
// 上から順に見て最初に当たった種類にする (教える > 相談 > 貸す > 譲る > 手伝う)。
// AI を使わず無料・決定的。外れても後から 1 件ずつ直せる。
const KIND_KEYWORDS: Array<{ kind: OfferingKind; words: string[] }> = [
  { kind: "teach", words: ["教え", "講座", "レッスン", "指導", "コーチ", "講師", "セミナー", "ワークショップ", "レクチャー", "ノウハウ", "使い方", "勉強", "塾", "teach", "lesson", "coach", "tutor"] },
  { kind: "advise", words: ["相談", "アドバイス", "助言", "悩み", "カウンセ", "メンタ", "コンサル", "話を聞", "診断", "advice", "consult"] },
  { kind: "lend", words: ["貸", "レンタル", "お貸し", "貸出", "貸与", "lend", "rent"] },
  { kind: "give", words: ["譲", "あげ", "差し上げ", "プレゼント", "無料で", "おさがり", "お下がり", "中古", "進呈", "give", "free"] },
  { kind: "help", words: ["手伝", "手助け", "サポート", "送迎", "運搬", "運ぶ", "作業", "代行", "支援", "付き添い", "help", "support"] },
];

/** 「提供できるもの」1 行を申し出の種類に分類する (当たらなければ その他)。 */
export function classifyOffering(text: string): OfferingKind {
  const t = text.toLowerCase();
  for (const { kind, words } of KIND_KEYWORDS) {
    if (words.some((w) => t.includes(w.toLowerCase()))) return kind;
  }
  return "other";
}

export type ParsedOffering = { kind: OfferingKind; kindLabel: string; title: string; description: string | null };

const HEADER_RE = /^(タイトル|名称|項目|内容|提供できるもの|提供|できること|title|name|item|offer)$/i;

/**
 * 貼り付けたスプレッドシート / CSV / 箇条書きを、1 行 1 件の申し出に分解して分類する。
 * 1 列目を見出し、残りの列を説明にする (タブ区切りも CSV も可)。ヘッダ行と空行・重複は飛ばす。
 */
export function parseOfferingsBulk(text: string, max = 100): ParsedOffering[] {
  const out: ParsedOffering[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-・*•]\s*/, ""); // 箇条書き記号を落とす
    if (!line) continue;
    const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    const title = (cells[0] ?? "").slice(0, 120);
    if (!title || HEADER_RE.test(title)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rest = cells.slice(1).filter(Boolean).join(" ").slice(0, 1000);
    const kind = classifyOffering(`${title} ${rest}`);
    out.push({ kind, kindLabel: OFFERING_KIND_LABEL[kind]!, title, description: rest || null });
    if (out.length >= max) break;
  }
  return out;
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

/**
 * 1 つの申し出について、ニーズが重なる連絡先を上位から返す。
 * 将来「ユーザーが互いに持ち寄るマーケットプレイス」では、相手を「連絡先」から
 * 「他ユーザー (の公開に同意したニーズ)」に一般化した matchOfferingToUsers を、この
 * ContactNeed 契約を保ったまま足せる。距離ゲートは距離/同意ゲートへ拡張する。
 * 設計は docs/FUTURE-MARKETPLACE.md。
 */
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
