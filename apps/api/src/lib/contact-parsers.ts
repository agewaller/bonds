// 連絡先取込パーサ (CSV / vCard) — lms js/app.js の parseCSVContacts / parseVCardContacts を
// TS 純粋関数に移植・堅牢化。取込の各サンプルは tests/unit/contact-parsers.test.ts に
// 固定資産として置き、回帰させない (DESIGN-HANDOVER.md §7)。

export type ParsedContact = {
  name: string;
  furigana?: string;
  phone?: string;
  email?: string;
  address?: string;
  company?: string;
  title?: string;
  birthday?: string; // YYYY-MM-DD
  distance?: number;
  relationship?: string;
  notes?: string;
  sns?: string; // SNS アカウント/URL (JSON 文字列または単一 URL)
  source?: string; // 取込元 (csv/vcard/linkedin/facebook/instagram/twitter)
};

// CSV の 1 行をフィールドに分解する (ダブルクォート・埋め込みカンマ対応)。
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// ヘッダ名 → フィールドの対応 (lms の互換 + 日本語ヘッダ)。
const HEADER_MAP: Record<string, keyof ParsedContact> = {
  name: "name", 氏名: "name", 名前: "name",
  furigana: "furigana", ふりがな: "furigana", フリガナ: "furigana",
  phone: "phone", tel: "phone", 電話: "phone", 電話番号: "phone",
  email: "email", メール: "email", メールアドレス: "email",
  address: "address", 住所: "address",
  company: "company", organization: "company", 会社: "company", 会社名: "company", 所属: "company",
  title: "title", 役職: "title",
  birthday: "birthday", 誕生日: "birthday",
  distance: "distance", 距離: "distance",
  relationship: "relationship", 関係: "relationship",
  notes: "notes", メモ: "notes", 備考: "notes",
  // Eight (名刺アプリ) の CSV エクスポートヘッダ
  "e-mail": "email", 携帯電話: "phone", 役職名: "title",
  // 年賀状リスト系 (宛名 = 氏名。郵便番号は対応フィールドが無いため取り込まない)
  宛名: "name",
};

// 名前の末尾に付いた敬称・肩書きを取り除く (チャットや議事録由来の「田中さん」→「田中」)。
// 名前の一部を誤って削らないよう、明確な接尾辞のみ・保守的に。全部消えたら元に戻す。
const HONORIFIC_SUFFIX =
  /(?:\s*(?:さん|サン|様|さま|サマ|君|くん|ちゃん|先生|せんせい|殿|どの|氏|社長|部長|課長|係長|専務|常務|会長|教授|博士|先輩))+$/;
export function stripHonorific(name: string): string {
  const stripped = name.replace(HONORIFIC_SUFFIX, "").trim();
  return stripped || name;
}

// 姓・名を分けて持つ CSV (Eight 名刺・年賀状ソフト・Outlook 等) のための列。
// 氏名がある行はそちらを優先し、無ければ姓+名を結合して name にする。
const FAMILY_HEADERS = new Set(["姓", "せい", "セイ", "苗字", "名字", "lastname", "last name", "family name", "surname"]);
const GIVEN_HEADERS = new Set(["名", "めい", "メイ", "firstname", "first name", "given name"]);

export function parseCsvContacts(csv: string): ParsedContact[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!).map((h) => h.replace(/"/g, "").toLowerCase());
  const fields = headers.map((h) => HEADER_MAP[h] ?? null);
  // 姓/名の列位置 (氏名が無い名刺 CSV 向け)
  const familyIdx = headers.findIndex((h) => FAMILY_HEADERS.has(h));
  const givenIdx = headers.findIndex((h) => GIVEN_HEADERS.has(h));
  const out: ParsedContact[] = [];
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line).map((v) => v.replace(/^"|"$/g, ""));
    const c: Partial<Record<keyof ParsedContact, string>> = {};
    fields.forEach((f, i) => {
      if (f && values[i]) c[f] = values[i];
    });
    // 氏名列が無ければ姓+名を結合する (どちらか片方だけでも採用)
    if (!c.name) {
      const family = familyIdx >= 0 ? (values[familyIdx] ?? "").trim() : "";
      const given = givenIdx >= 0 ? (values[givenIdx] ?? "").trim() : "";
      const joined = [family, given].filter(Boolean).join(" ");
      if (joined) c.name = joined;
    }
    if (!c.name) continue;
    out.push({
      ...c,
      name: c.name,
      distance: c.distance ? parseInt(c.distance, 10) || undefined : undefined,
    });
  }
  return out;
}

// vCard の 1 プロパティ行から値を取り出す (パラメータ ;TYPE=... を無視)。
function vcardValue(line: string): string {
  const idx = line.indexOf(":");
  return idx >= 0 ? line.slice(idx + 1).trim() : "";
}

export function parseVCardContacts(vcf: string): ParsedContact[] {
  const out: ParsedContact[] = [];
  // 折り返し行 (先頭が空白/タブ) を前の行に連結する (RFC 6350)
  const unfolded = vcf.replace(/\r?\n[ \t]/g, "");
  for (const card of unfolded.split(/BEGIN:VCARD/i).slice(1)) {
    const c: ParsedContact = { name: "" };
    for (const rawLine of card.split(/\r?\n/)) {
      const line = rawLine.trim();
      const upper = line.toUpperCase();
      if (upper.startsWith("FN")) c.name = vcardValue(line);
      else if (upper.startsWith("N;") || upper.startsWith("N:")) {
        // FN が無い場合のフォールバック: N の姓;名 を結合
        if (!c.name) c.name = vcardValue(line).split(";").filter(Boolean).join(" ");
      } else if (upper.startsWith("TEL")) c.phone ??= vcardValue(line);
      else if (upper.startsWith("EMAIL")) c.email ??= vcardValue(line);
      else if (upper.startsWith("ORG")) c.company = vcardValue(line).split(";")[0];
      else if (upper.startsWith("TITLE")) c.title = vcardValue(line);
      else if (upper.startsWith("ADR")) c.address ??= vcardValue(line).split(";").filter(Boolean).join(" ");
      else if (upper.startsWith("BDAY")) {
        const v = vcardValue(line).replace(/[^0-9]/g, "");
        if (v.length === 8) c.birthday = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
      }
    }
    if (c.name) out.push(c);
  }
  return out;
}

// ------------------------------------------------------------
// SNS アーカイブの取込 (lms js/sns-integrations.js を TS 移植)
// ------------------------------------------------------------

// Facebook: ダウンロードアーカイブの friends.json (friends_v2)
export function parseFacebookFriends(jsonText: string): ParsedContact[] {
  try {
    const data = JSON.parse(jsonText) as Record<string, unknown>;
    const friends = (data.friends_v2 ?? data.friends ?? []) as Array<{ name?: string }>;
    return friends
      .filter((f) => typeof f?.name === "string" && f.name.trim())
      .map((f) => ({ name: f.name!.trim(), source: "facebook", distance: 4 }));
  } catch {
    return [];
  }
}

// Instagram: アーカイブの following.json (relationships_following)
export function parseInstagramFollowing(jsonText: string): ParsedContact[] {
  try {
    const data = JSON.parse(jsonText) as Record<string, unknown>;
    const list = (data.relationships_following ?? data.following ?? []) as Array<{
      string_list_data?: Array<{ value?: string; href?: string }>;
    }>;
    return list
      .map((item) => item.string_list_data?.[0])
      .filter((e): e is { value: string; href?: string } => typeof e?.value === "string" && !!e.value.trim())
      .map((e) => ({ name: e.value.trim(), sns: e.href ?? e.value, source: "instagram", distance: 5 }));
  } catch {
    return [];
  }
}

// X (Twitter): アーカイブの following.js — window.YTD.following.part0 = [ ... ]
export function parseTwitterFollowing(text: string): ParsedContact[] {
  try {
    const cleaned = text.replace(/^window\.YTD\.[^=]+=\s*/, "");
    const data = JSON.parse(cleaned) as Array<{ following?: { accountId?: string; userLink?: string } }>;
    return data
      .map((item) => item.following)
      .filter((f): f is { accountId: string; userLink?: string } => typeof f?.accountId === "string" && !!f.accountId)
      .map((f) => ({ name: f.accountId, sns: f.userLink ?? "", source: "twitter", distance: 5 }));
  } catch {
    return [];
  }
}

// LinkedIn: Connections.csv (先頭に注記行が入ることがあるためヘッダ行を探す)
export function parseLinkedInConnections(csvText: string): ParsedContact[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    if (lines[i]!.toLowerCase().includes("first name")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0 || lines.length <= headerIdx + 1) return [];
  const headers = splitCsvLine(lines[headerIdx]!).map((h) => h.toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const out: ParsedContact[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const v = splitCsvLine(line);
    const name = [v[idx("first name")], v[idx("last name")]].filter(Boolean).join(" ").trim();
    if (!name) continue;
    out.push({
      name,
      email: v[idx("email address")] || undefined,
      company: v[idx("company")] || undefined,
      title: v[idx("position")] || undefined,
      sns: idx("url") >= 0 ? v[idx("url")] || undefined : undefined,
      source: "linkedin",
      distance: 4,
    });
  }
  return out;
}

// ------------------------------------------------------------
// トーク履歴 (LINE / WhatsApp) — 相手の連絡先だけでなく、日ごとの接触履歴も復元する。
// LINE には友だちリストの公式エクスポートが存在しないため、トーク履歴の
// 「1トーク=1ファイル送信」機能が現実的な唯一の取込経路 (lms parseLINEChat を発展)。
// ------------------------------------------------------------

export type ParsedInteraction = {
  name: string; // 接触相手 (contacts.name に一致させる)
  occurredAt: string; // YYYY-MM-DD
  type: string; // message など
  note?: string; // その日のやりとりの短いメモ (AI 抽出由来など)
};

export type ParsedImport = {
  contacts: ParsedContact[];
  interactions: ParsedInteraction[];
};

const MAX_TALK_DAYS = 365; // 接触履歴として残す日数の上限 (直近から数える)

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// LINE 公式のトーク履歴テキスト。1 行目: 「[LINE] ○○とのトーク履歴」/ "[LINE] Chat history with ○○"
// 日付行: 「2026/06/01(月)」、メッセージ行: 「10:23\t○○\t本文」
export function parseLineTalk(text: string, filenameHint?: string): ParsedImport {
  const lines = text.split(/\r?\n/);
  const header = lines[0] ?? "";
  const m = header.match(/\[LINE\]\s*(.+?)とのトーク(?:履歴)?\s*$|\[LINE\]\s*Chat history with\s*(.+?)\s*$/);
  let partner = (m?.[1] ?? m?.[2] ?? "").trim();
  if (!partner && filenameHint) {
    const fm = filenameHint.match(/(.+?)とのトーク|Chat history with\s*(.+?)(?:\.txt)?$/i);
    partner = (fm?.[1] ?? fm?.[2] ?? "").trim();
  }
  const senderTally = new Map<string, number>();
  const days = new Set<string>();
  let currentDay: string | null = null;
  let dayHasMessage = false;
  const commitDay = () => {
    if (currentDay && dayHasMessage) days.add(currentDay);
  };
  for (const line of lines.slice(1)) {
    const d =
      line.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:\([^)]*\))?\s*$/) ??
      line.match(/^[A-Z][a-z]{2},\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
    if (d) {
      commitDay();
      const [y, mo, da] =
        d[0].match(/^\d{4}/) != null
          ? [d[1]!, d[2]!, d[3]!]
          : [d[3]!, d[1]!, d[2]!]; // en 形式は M/D/YYYY
      currentDay = `${y}-${pad2(parseInt(mo, 10))}-${pad2(parseInt(da, 10))}`;
      dayHasMessage = false;
      continue;
    }
    const msg = line.match(/^\d{1,2}:\d{2}\t([^\t]+)\t/);
    if (msg) {
      dayHasMessage = true;
      const sender = msg[1]!.trim();
      if (sender) senderTally.set(sender, (senderTally.get(sender) ?? 0) + 1);
    }
  }
  commitDay();
  if (!partner) {
    // ヘッダもファイル名も無い場合は最頻の送信者を相手とみなす (自分の名前は分からない前提の妥協)
    partner = [...senderTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }
  if (!partner) return { contacts: [], interactions: [] };
  const contacts: ParsedContact[] = [{ name: partner, source: "line", distance: 3 }];
  // グループトークの他の参加者 (3 通以上) も連絡先候補にする (lms と同じ扱い)
  for (const [name, count] of senderTally) {
    if (name !== partner && count >= 3) contacts.push({ name, source: "line", distance: 4 });
  }
  const interactions = [...days]
    .sort()
    .slice(-MAX_TALK_DAYS)
    .map((occurredAt) => ({ name: partner, occurredAt, type: "message" }));
  return { contacts, interactions };
}

// WhatsApp のチャットエクスポート (.txt)。iOS: 「[2026/07/01 12:34:56] ○○: 本文」、
// Android: 「01/07/2026, 12:34 - ○○: 本文」。相手名はファイル名 (Chat with ○○) を優先する。
export function parseWhatsAppChat(text: string, filenameHint?: string): ParsedImport {
  const senderTally = new Map<string, number>();
  const daysBySender = new Map<string, Set<string>>();
  for (const line of text.split(/\r?\n/)) {
    const m =
      line.match(/^\[(\d{4})[/.](\d{1,2})[/.](\d{1,2})[^\]]*\]\s*([^:]+):\s/) ??
      line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+\d{1,2}:\d{2}\s*-\s*([^:]+):\s/);
    if (!m) continue;
    const iso = m[0].startsWith("[")
      ? `${m[1]}-${pad2(parseInt(m[2]!, 10))}-${pad2(parseInt(m[3]!, 10))}`
      : (() => {
          const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
          // 地域により D/M か M/D かが揺れるため、12 を超える方を日とみなす
          const a = parseInt(m[1]!, 10);
          const b = parseInt(m[2]!, 10);
          const [mo, da] = a > 12 ? [b, a] : [a, b];
          return `${y}-${pad2(mo)}-${pad2(da)}`;
        })();
    const sender = m[4]!.trim();
    if (!sender) continue;
    senderTally.set(sender, (senderTally.get(sender) ?? 0) + 1);
    if (!daysBySender.has(sender)) daysBySender.set(sender, new Set());
    daysBySender.get(sender)!.add(iso);
  }
  let partner = "";
  const fm = filenameHint?.match(/Chat with\s*(.+?)(?:\.txt)?$/i) ?? filenameHint?.match(/(.+?)とのWhatsApp/i);
  if (fm) partner = fm[1]!.trim();
  if (!partner) partner = [...senderTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  if (!partner) return { contacts: [], interactions: [] };
  const contacts: ParsedContact[] = [{ name: partner, source: "whatsapp", distance: 3 }];
  for (const [name, count] of senderTally) {
    if (name !== partner && count >= 3) contacts.push({ name, source: "whatsapp", distance: 4 });
  }
  const partnerDays = daysBySender.get(partner) ?? new Set<string>();
  const interactions = [...partnerDays]
    .sort()
    .slice(-MAX_TALK_DAYS)
    .map((occurredAt) => ({ name: partner, occurredAt, type: "message" }));
  return { contacts, interactions };
}

// ------------------------------------------------------------
// Google 連絡先 CSV (contacts.google.com → エクスポート)。
// 姓・名が別カラムのため専用に組み立てる (CJK は姓→名の順で結合)。
// ------------------------------------------------------------

function hasCjk(s: string): boolean {
  return /[぀-ヿ㐀-鿿]/.test(s);
}

export function looksLikeGoogleContactsCsv(head: string): boolean {
  return /e-mail 1 - value/i.test(head) && /first name/i.test(head);
}

export function parseGoogleContactsCsv(csvText: string): ParsedContact[] {
  const lines = csvText.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const pick = (v: string[], name: string) => (idx(name) >= 0 ? v[idx(name)] || "" : "");
  const out: ParsedContact[] = [];
  for (const line of lines.slice(1)) {
    const v = splitCsvLine(line);
    const first = pick(v, "first name");
    const middle = pick(v, "middle name");
    const last = pick(v, "last name");
    let name = pick(v, "name");
    if (!name) {
      name = hasCjk(last + first)
        ? [last, first].filter(Boolean).join(" ")
        : [first, middle, last].filter(Boolean).join(" ");
    }
    name = name.trim();
    if (!name) continue;
    const birthdayRaw = pick(v, "birthday").replace(/[^0-9]/g, "");
    out.push({
      name,
      furigana: [pick(v, "phonetic last name"), pick(v, "phonetic first name")].filter(Boolean).join(" ") || undefined,
      email: pick(v, "e-mail 1 - value") || undefined,
      phone: pick(v, "phone 1 - value") || undefined,
      company: pick(v, "organization name") || pick(v, "organization 1 - name") || undefined,
      title: pick(v, "organization title") || pick(v, "organization 1 - title") || undefined,
      birthday:
        birthdayRaw.length === 8
          ? `${birthdayRaw.slice(0, 4)}-${birthdayRaw.slice(4, 6)}-${birthdayRaw.slice(6, 8)}`
          : undefined,
      source: "google",
    });
  }
  return out;
}

// ------------------------------------------------------------
// lms (Life Management System) のエクスポート JSON。
// 全体エクスポート { relationship_contacts: [...] } と
// 領域エクスポート { contacts: [...], interactions: [...] } の両形式を受ける。
// ------------------------------------------------------------

export function parseLmsExport(jsonText: string): ParsedImport {
  try {
    const data = JSON.parse(jsonText) as Record<string, unknown>;
    const rawContacts = (data.relationship_contacts ?? data.contacts ?? []) as Array<Record<string, unknown>>;
    const rawInteractions = (data.relationship_interactions ?? data.interactions ?? []) as Array<
      Record<string, unknown>
    >;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const contacts: ParsedContact[] = [];
    for (const c of rawContacts) {
      const name = str(c.name);
      if (!name) continue;
      const distance = parseInt(String(c.distance ?? ""), 10);
      contacts.push({
        name,
        phone: str(c.phone),
        email: str(c.email),
        address: str(c.address),
        company: str(c.company),
        title: str(c.title),
        birthday: str(c.birthday)?.slice(0, 10),
        distance: Number.isFinite(distance) && distance >= 1 && distance <= 5 ? distance : undefined,
        notes: str(c.notes),
        source: "lms",
      });
    }
    const interactions: ParsedInteraction[] = [];
    for (const it of rawInteractions) {
      const name = str(it.person) ?? str(it.name);
      const when = str(it.timestamp) ?? str(it.date);
      if (!name || !when) continue;
      const day = when.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      interactions.push({ name, occurredAt: day, type: str(it.type) ?? "message" });
    }
    return { contacts, interactions };
  } catch {
    return { contacts: [], interactions: [] };
  }
}

export function looksLikeLmsExport(head: string): boolean {
  return /"relationship_contacts"\s*:/.test(head) || (/"contacts"\s*:\s*\[/.test(head) && /"distance"/.test(head));
}

// 拡張子/内容からパーサを選ぶ (SNS アーカイブも自動判別)。
export function parseContacts(
  content: string,
  format: "csv" | "vcard" | "auto" = "auto",
): ParsedContact[] {
  if (format === "csv") return parseCsvContacts(content);
  if (format === "vcard") return parseVCardContacts(content);
  const head = content.slice(0, 2000);
  if (/BEGIN:VCARD/i.test(head)) return parseVCardContacts(content);
  if (/^window\.YTD\./.test(content.trimStart())) return parseTwitterFollowing(content);
  if (/"friends_v2"|"friends"\s*:/.test(head)) {
    const r = parseFacebookFriends(content);
    if (r.length > 0) return r;
  }
  if (/"relationships_following"|"string_list_data"/.test(head)) {
    const r = parseInstagramFollowing(content);
    if (r.length > 0) return r;
  }
  if (looksLikeGoogleContactsCsv(head)) return parseGoogleContactsCsv(content);
  if (/first name/i.test(head) && /last name/i.test(head)) return parseLinkedInConnections(content);
  return parseCsvContacts(content);
}

// テキスト全般の統合判別 — 連絡先だけでなく接触履歴 (トーク由来) も返す。
// 画面の「まとめて取り込む」とファイル取込 API の両方がここを通る。
export function parseImportText(content: string, filenameHint?: string): ParsedImport {
  const head = content.slice(0, 2000);
  if (/^\[LINE\]/.test(content.trimStart()) || /とのトーク履歴/.test(head)) {
    const r = parseLineTalk(content, filenameHint);
    if (r.contacts.length > 0) return r;
  }
  if (/^\[?\d{1,4}[/.]\d{1,2}[/.]\d{1,4}.*(?:\]\s*|-\s*)[^:]+:\s/m.test(head) && /whatsapp/i.test(filenameHint ?? "")) {
    const r = parseWhatsAppChat(content, filenameHint);
    if (r.contacts.length > 0) return r;
  }
  if (looksLikeLmsExport(head)) {
    const r = parseLmsExport(content);
    if (r.contacts.length > 0) return r;
  }
  // WhatsApp はファイル名が無くても本文パターンで拾う (LINE 形式より後に判定)
  if (/^(\[\d{4}[/.]\d{1,2}[/.]\d{1,2}[^\]]*\]|\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*-)\s*[^:]+:\s/m.test(head)) {
    const r = parseWhatsAppChat(content, filenameHint);
    if (r.contacts.length > 0) return r;
  }
  return { contacts: parseContacts(content), interactions: [] };
}
