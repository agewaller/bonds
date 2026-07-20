// パーティ・イベントで一気に増えた知り合い (ニューカマー) の一括取り込み。
// 「名前と SNS の URL やメールを 1 行に混ぜて貼るだけ」で連絡帳に迎えられるよう、
// 行単位の軽量パーサ (AI 不要・決定的) と、イベント文脈 (どこで・いつ出会ったか) を
// 取込結果へ添える装飾関数を提供する。Eight/Facebook の公式エクスポートを経由しない
// 「その場で書き留めた/もらったものをそのまま放り込む」道をつくるのが狙い。
import type { ParsedContact, ParsedImport, ParsedInteraction } from "./contact-parsers.js";
import { stripHonorific } from "./contact-parsers.js";

export type NewcomerEvent = {
  name: string; // 例: 「◯◯交流会」
  date: string; // YYYY-MM-DD (出会った日)
};

const MAX_LINES = 500;
const URL_RE = /^https?:\/\/\S+$/i;
const BARE_SNS_URL_RE = /^(?:www\.)?(?:x\.com|twitter\.com|instagram\.com|facebook\.com|linkedin\.com|note\.com|github\.com|youtube\.com|threads\.net)\/\S+$/i;
const EMAIL_RE = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
const PHONE_RE = /^\+?[\d][\d\-() ]{8,}$/;
const COMPANY_RE = /(株式会社|合同会社|有限会社|\(株\)|（株）|Inc\.?$|Corp\.?$|LLC$|K\.K\.$|大学$|研究所$|事務所$|クリニック$|病院$)/;
const TITLE_RE = /^(代表|社長|会長|副社長|専務|常務|取締役|執行役員|部長|課長|係長|主任|マネージャー|リーダー|CEO|CTO|COO|CFO|エンジニア|デザイナー|プロデューサー|ディレクター|医師|弁護士|会計士|税理士|教授|准教授|研究員|コンサルタント|フリーランス)$/;

// 1 行 = 1 人。行内の URL は SNS、メールはメール、数字の並びは電話、
// 会社らしい語は所属、肩書きらしい語は役職、残りが名前になる。
// 名前が見つからない行 (URL だけ等) は誤登録を避けて取り込まない。
export function parseNewcomerLines(text: string): ParsedContact[] {
  const out: ParsedContact[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-・*•◦‣]+/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);
  for (const line of lines) {
    const tokens = line.split(/[\s\t,、]+/).filter(Boolean);
    const urls: string[] = [];
    const extras: string[] = [];
    const nameTokens: string[] = [];
    let email: string | undefined;
    let phone: string | undefined;
    let company: string | undefined;
    let title: string | undefined;
    for (const tk of tokens) {
      if (URL_RE.test(tk)) urls.push(tk);
      else if (BARE_SNS_URL_RE.test(tk)) urls.push(`https://${tk.replace(/^www\./i, "")}`);
      else if (EMAIL_RE.test(tk)) email = email ?? tk;
      else if (PHONE_RE.test(tk) && tk.replace(/\D/g, "").length >= 10) phone = phone ?? tk;
      else if (/^@[\w.]+$/.test(tk)) extras.push(tk); // platform 不明の @handle は名前に混ぜずメモへ
      else if (COMPANY_RE.test(tk)) company = company ?? tk;
      else if (TITLE_RE.test(tk)) title = title ?? tk;
      else nameTokens.push(tk);
    }
    const name = stripHonorific(nameTokens.slice(0, 3).join(" ")).slice(0, 100);
    if (!name) continue; // 名前の無い行は人として登録できない
    const contact: ParsedContact = { name, source: "event" };
    if (urls.length > 0) contact.sns = JSON.stringify(urls.slice(0, 6));
    if (email) contact.email = email;
    if (phone) contact.phone = phone;
    if (company) contact.company = company;
    if (title) contact.title = title;
    if (extras.length > 0) contact.notes = extras.join(" ");
    out.push(contact);
  }
  return out;
}

// イベントの日付を安全な YYYY-MM-DD に正規化する。壊れた日付・未来日は
// 「今日」に倒す (出会いの記録は過去にしか存在しない)。
export function normalizeEventDate(raw: unknown, today: Date = new Date()): string {
  // サーバは TZ=Asia/Tokyo で動く。UTC (toISOString) だと日本の早朝に前日へずれるため
  // ローカル日付で「今日」を組み立てる。
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (typeof raw !== "string") return todayStr;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return todayStr;
  const d = new Date(`${raw.trim()}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return todayStr;
  return raw.trim() <= todayStr ? raw.trim() : todayStr;
}

// 取込結果へイベント文脈を添える: 各人のメモに「◯◯で出会う」を書き足し、
// 出会った日の接触記録 (meeting) を作る。既に同日の接触があれば applyImport 側の
// 同日重複除外がそのまま効く (ここでは足すだけでよい)。
export function decorateWithEvent(parsed: ParsedImport, event: NewcomerEvent): ParsedImport {
  const label = `${event.date} ${event.name}で出会う`;
  const contacts = parsed.contacts.map((ct) => ({
    ...ct,
    notes: ct.notes ? `${ct.notes}\n${label}` : label,
  }));
  const seen = new Set(parsed.interactions.map((it) => `${it.name}\n${it.occurredAt}`));
  const added: ParsedInteraction[] = [];
  for (const ct of contacts) {
    const key = `${ct.name}\n${event.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ name: ct.name, occurredAt: event.date, type: "meeting", note: event.name });
  }
  return { contacts, interactions: [...parsed.interactions, ...added] };
}
