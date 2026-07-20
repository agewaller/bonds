// 一斉配信 (メールのお便り) の純粋関数 — テンプレの差し込み・宛先セグメント判定・
// 配信停止トークン・受信者の一意化。AI は使わない (テンプレ + お名前差し込みで無料)。
// 送信そのものは既存の mailer + キュー (少しずつ送る) を流用する。
import { createHmac, timingSafeEqual } from "node:crypto";

// {{お名前}} / {{名前}} / {{name}} と {{会社}} / {{会社名}} / {{company}} を差し込む。
// 相手ごとに違うのは名前と会社だけ (AI を使わないので費用ゼロ)。
export function renderTemplate(tpl: string, vars: { name: string; company: string | null }): string {
  return tpl
    .replace(/\{\{\s*(?:お名前|名前|name)\s*\}\}/gi, vars.name)
    .replace(/\{\{\s*(?:会社名|会社|company)\s*\}\}/gi, vars.company ?? "")
    .trim();
}

// 宛先セグメント (誰に送るか)。メールのある方だけが対象で、外した方 (excluded) は必ず除く。
export type Segment = {
  all?: boolean; // メールのある全員 (他条件と併用可)
  distanceMax?: number; // 距離感がこれ以下 (近い方だけ)
  lastContactDaysMin?: number; // 最終接触からこれ以上あいた方 (間が空いた層。未接触も含む)
  company?: string; // 会社名にこの語を含む
  pinnedOnly?: boolean; // 「大切」と印を付けた方だけ
};

export type CampaignContact = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  distance: number;
  lastContactDays: number | null;
  focusPreference: string | null;
};

export function matchesSegment(c: CampaignContact, seg: Segment): boolean {
  if (!c.email) return false; // メールが無い方は一斉配信の対象にしない
  if (c.focusPreference === "excluded") return false; // 外した方には送らない (尊厳)
  if (seg.pinnedOnly && c.focusPreference !== "pinned") return false;
  if (typeof seg.distanceMax === "number" && c.distance > seg.distanceMax) return false;
  if (typeof seg.lastContactDaysMin === "number") {
    // 最近やりとりした方は除く。一度も接触の無い方 (null) は「間が空いている」に含める。
    if (c.lastContactDays != null && c.lastContactDays < seg.lastContactDaysMin) return false;
  }
  if (seg.company && !(c.company ?? "").toLowerCase().includes(seg.company.trim().toLowerCase())) return false;
  return true;
}

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

// 配信停止リスト (suppression) は、復号せずに突き合わせられるよう鍵つきハッシュで持つ。
export function emailHash(email: string, secret: string): string {
  return createHmac("sha256", secret).update(normalizeEmail(email)).digest("hex");
}

// 配信停止リンクのトークン (未認証で叩かれるので HMAC 署名。ownerUid とメールを埋める)。
export function signUnsub(ownerUid: string, email: string, secret: string): string {
  const payload = `${ownerUid}\n${normalizeEmail(email)}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

export function verifyUnsub(token: unknown, secret: string): { ownerUid: string; email: string } | null {
  if (typeof token !== "string") return null;
  const [b64, mac] = token.split(".");
  if (!b64 || !mac) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf-8");
  } catch {
    return null;
  }
  const expect = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const nl = payload.indexOf("\n");
  if (nl <= 0) return null;
  return { ownerUid: payload.slice(0, nl), email: payload.slice(nl + 1) };
}

// 送信者の明示 + 配信停止リンク (特定電子メール法: 送信者表示と配信停止手段が必須)。
export function buildCampaignFooter(identity: string, unsubUrl: string): string {
  return [
    "",
    "———",
    identity,
    `配信の停止はこちら: ${unsubUrl}`,
    "このメールは、これまでにご縁のあった方にお送りしています。今後の配信をご希望でない場合は、上のリンクからお手続きください。以後お送りしません。",
  ].join("\n");
}
