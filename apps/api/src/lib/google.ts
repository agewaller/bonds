// Google 連携 (Calendar / Gmail / Drive) — 人物データの受動収集 (CLAUDE.md 収集の柱)。
//
// 設計 (安全側の既定):
// - 読み取り専用の最小権限。Gmail は gmail.metadata (ヘッダのみ・本文は読まない)。
// - 接続はユーザー本人の Google 同意画面 (OAuth)。refresh token は暗号化して保存。
// - 通知メール・no-reply・会議室リソース・大人数イベントなどのノイズは取り込まない。
// - 取込は applyImport (同名スキップの冪等) に流す = 再同期しても二重登録しない。
//
// 純粋ロジック (パース・フィルタ・集約・state 署名) はこのファイルでユニットテスト対象。
// ネットワーク (OAuth 交換・API GET) は buildGoogleClient に隔離し、テストでは注入で差し替える。

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ParsedContact, ParsedInteraction } from "./contact-parsers.js";

// ---------------- 設定 ----------------

// 権限は三段に分ける (Google のアプリ確認 = 審査を軽くし、同意画面の警告を消すため):
// - BASE: 既定の接続。「センシティブ」区分のみ (カレンダー + 連絡先) = 通常審査で警告が消える
// - EXTENDED: 希望者だけの追加の許可。「制限付き」区分 (Gmail ヘッダ + Drive) を含む
//   (制限付きは重い審査が必要なため、既定の同意画面から外す)
// - GUEST: 日程調整の公開ページで相手が空きを重ねるときの最小権限 (空き情報 + 名乗りのみ)
export const GOOGLE_SCOPES_BASE = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  // 連絡先 (アドレス帳) の読み取り = 最も確実な取込元。読み取り専用。
  "https://www.googleapis.com/auth/contacts.readonly",
];

export const GOOGLE_SCOPES_EXTENDED = [
  ...GOOGLE_SCOPES_BASE,
  "https://www.googleapis.com/auth/gmail.metadata",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

// 録音メモ (Plaud) のメール添付テキストを読むための追加の許可。gmail.readonly は
// 本文・添付まで読める強い権限 (制限付き区分) なので、この機能を使いたい人だけの
// 明示オプトインにする。読むのは録音サービスからのメールに限る (実装側で送信元を絞る)。
export const GOOGLE_SCOPES_MAIL_READ = [
  ...GOOGLE_SCOPES_EXTENDED.filter((s) => !s.includes("gmail.metadata")),
  "https://www.googleapis.com/auth/gmail.readonly",
];

// 提携・紹介連絡をオーナー自身の Gmail から送るための追加の許可 (制限付き区分・明示オプトイン)。
// 配信サービス経由の新規宛先連絡はバウンス規律で停止を招いたため、送信チャネルを本人の
// メールボックスへ移す (lib/gmail-send.ts)。
export const GOOGLE_SCOPES_SEND = [
  ...GOOGLE_SCOPES_BASE,
  "https://www.googleapis.com/auth/gmail.send",
];

export const GOOGLE_SCOPES_GUEST = [
  "openid",
  "email",
  "profile",
  // freeBusy 照会のみ = 予定の中身は読めない。相手 (第三者) に求める最小の権限
  "https://www.googleapis.com/auth/calendar.freebusy",
];

/** 保存済みの許可スコープに Gmail/Drive (追加の許可) が含まれるか。 */
export function hasExtendedScopes(scopes: string | null | undefined): boolean {
  // gmail.readonly は metadata を包含する (メールの相手の取込にも使える)
  return !!scopes && (scopes.includes("gmail.metadata") || scopes.includes("gmail.readonly"));
}

/** 保存済みの許可スコープで、メールの本文・添付 (録音メモ) まで読めるか。 */
export function hasMailReadScope(scopes: string | null | undefined): boolean {
  return !!scopes && scopes.includes("gmail.readonly");
}

// People API から取り込む連絡先の上限 (1 同期あたり)。
export const CONTACTS_MAX = 2000;

// 同期の範囲 (広すぎるとノイズ・API 負荷が増える)
export const CALENDAR_LOOKBACK_DAYS = 90;
export const CALENDAR_LOOKAHEAD_DAYS = 30;
export const GMAIL_MAX_MESSAGES = 100; // SENT / INBOX 各
export const DRIVE_MAX_FILES = 50;
export const MAX_EVENT_ATTENDEES = 20; // これを超えるイベントはウェビナー等とみなし除外

// ---------------- OAuth state (CSRF 対策 + ownerUid の持ち回り) ----------------
// コールバックは未認証で叩かれるため、state に「誰の接続か」を HMAC 署名して埋める。
// 鍵は DATA_ENCRYPTION_KEY から導出 (追加の秘密を増やさない)。

function stateKey(): Buffer | null {
  const hex = process.env.DATA_ENCRYPTION_KEY;
  if (!hex) return null;
  return createHmac("sha256", "bonds-google-oauth-state").update(hex).digest();
}

export function signState(ownerUid: string, expEpochSec: number): string | null {
  const key = stateKey();
  if (!key) return null;
  const payload = `${ownerUid}.${expEpochSec}`;
  const mac = createHmac("sha256", key).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

export function verifyState(state: unknown, nowEpochSec: number): string | null {
  if (typeof state !== "string") return null;
  const key = stateKey();
  if (!key) return null;
  const [b64, mac] = state.split(".");
  if (!b64 || !mac) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf-8");
  } catch {
    return null;
  }
  const expect = createHmac("sha256", key).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const dot = payload.lastIndexOf(".");
  if (dot <= 0) return null;
  const ownerUid = payload.slice(0, dot);
  const exp = Number(payload.slice(dot + 1));
  if (!Number.isFinite(exp) || exp < nowEpochSec) return null;
  return ownerUid;
}

// ---------------- ヘッダ・アドレスのパース ----------------

export type Person = { name: string; email: string };

// "山田 太郎 <taro@example.com>, "Suzuki, Hanako" <h@example.com>" を分解する。
export function parseAddressList(header: string | null | undefined): Person[] {
  if (!header) return [];
  const out: Person[] = [];
  // クォート内のカンマを守りながら分割
  const parts: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of header) {
    if (ch === '"') inQ = !inQ;
    if (ch === "," && !inQ) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;
    const m = s.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
    if (m) {
      const email = m[2]!.trim().toLowerCase();
      const name = m[1]!.trim();
      if (email.includes("@")) out.push({ name: name || email.split("@")[0]!, email });
    } else if (s.includes("@")) {
      const email = s.replace(/[<>]/g, "").trim().toLowerCase();
      out.push({ name: email.split("@")[0]!, email });
    }
  }
  return out;
}

// 人ではない送信元 (通知・配信・システム) を除外する。
const NOISE_LOCAL = /^(no-?reply|noreply|do-?not-?reply|notification|notifications|newsletter|news|info|support|mailer-daemon|postmaster|bounce|alert|alerts|billing|receipt|updates?|hello|team|admin|system|automated|digest)([+.-]|$)/i;
const NOISE_DOMAIN = /(googlegroups\.com|calendar-server\.bounces\.google\.com|docs\.google\.com|resource\.calendar\.google\.com|amazonses\.com|sendgrid\.net|mailchimp|substack\.com|github\.com|slack\.com|atlassian\.(com|net)|zoom\.us|linkedin\.com|facebookmail\.com|twitter\.com|x\.com|youtube\.com|apple\.com|paypal\.(com|jp)|amazon\.(com|co\.jp)|rakuten\.co\.jp|smartnews|mercari|note\.com)$/i;

export function isNoisePerson(p: Person): boolean {
  const [local, domain] = p.email.split("@");
  if (!local || !domain) return true;
  if (NOISE_LOCAL.test(local)) return true;
  if (NOISE_DOMAIN.test(domain)) return true;
  return false;
}

// ---------------- 取得データ → 取込形への集約 ----------------

export type GmailHeaderMessage = {
  // format=metadata で取れるヘッダ (From/To/Cc/Date) と、SENT 由来かどうか
  from?: string;
  to?: string;
  cc?: string;
  dateMs?: number; // internalDate
  sent: boolean; // 自分が送った (SENT ラベル)
};

export type CalendarEvent = {
  startDate?: string; // YYYY-MM-DD (date or dateTime の日付部分)
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean; resource?: boolean }>;
};

export type DriveFile = {
  owners?: Array<{ displayName?: string; emailAddress?: string; me?: boolean }>;
  lastModifyingUser?: { displayName?: string; emailAddress?: string; me?: boolean };
};

export type GoogleCollected = {
  contacts: ParsedContact[];
  interactions: ParsedInteraction[];
};

function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Calendar / Gmail / Drive の生データから、連絡先候補と接触記録を組み立てる。
// - 自分自身 (selfEmails) は除外
// - Gmail は「自分が送った相手」か「2 回以上登場する相手」だけ (一方的な受信ノイズを避ける)
// - 接触記録は相手 × 日付で 1 件 (applyImport 側でも同日重複は防がれる = 二重の守り)
export function collectGooglePeople(input: {
  selfEmails: string[];
  calendarEvents?: CalendarEvent[];
  gmailMessages?: GmailHeaderMessage[];
  driveFiles?: DriveFile[];
  todayIso?: string; // 未来イベントを接触記録にしないための基準日 (省略時は実時刻)
}): GoogleCollected {
  const self = new Set(input.selfEmails.map((e) => e.toLowerCase()));
  const today = input.todayIso ?? new Date().toISOString().slice(0, 10);
  const byEmail = new Map<string, { name: string; source: string; sentTo: boolean; count: number }>();
  const interactions: ParsedInteraction[] = [];
  const seenInteraction = new Set<string>();

  const better = (a: string, b: string) => (b.length > a.length && !b.includes("@") ? b : a);

  const addPerson = (p: Person, source: string, sentTo: boolean) => {
    if (self.has(p.email) || isNoisePerson(p)) return;
    const cur = byEmail.get(p.email);
    if (cur) {
      cur.name = better(cur.name, p.name);
      cur.sentTo = cur.sentTo || sentTo;
      cur.count++;
    } else {
      byEmail.set(p.email, { name: p.name, source, sentTo, count: 1 });
    }
  };

  const addInteraction = (email: string, date: string, type: string) => {
    const key = `${email}|${date}`;
    if (seenInteraction.has(key)) return;
    seenInteraction.add(key);
    interactions.push({ name: email, occurredAt: date, type }); // name は後で実名に差し替える
  };

  // ---- Calendar: 出席者 = 会った人。過去イベントは meeting の接触記録に。
  for (const ev of input.calendarEvents ?? []) {
    const attendees = (ev.attendees ?? []).filter((a) => !a.resource && !a.self && a.email);
    if (attendees.length === 0 || attendees.length > MAX_EVENT_ATTENDEES) continue;
    for (const a of attendees) {
      const p: Person = {
        email: a.email!.toLowerCase(),
        name: (a.displayName ?? "").trim() || a.email!.split("@")[0]!,
      };
      if (self.has(p.email) || isNoisePerson(p)) continue;
      addPerson(p, "google_calendar", true); // 同席は能動的な接点として扱う
      if (ev.startDate && ev.startDate <= today) addInteraction(p.email, ev.startDate, "meeting");
    }
  }

  // ---- Gmail: 送った相手は無条件、受信だけの相手は 2 回以上で採用。
  for (const m of input.gmailMessages ?? []) {
    const date = m.dateMs ? dateOnly(m.dateMs) : null;
    const counterparts = m.sent
      ? [...parseAddressList(m.to), ...parseAddressList(m.cc)]
      : parseAddressList(m.from);
    for (const p of counterparts) {
      if (self.has(p.email) || isNoisePerson(p)) continue;
      addPerson(p, "gmail", m.sent);
      if (date) addInteraction(p.email, date, "email");
    }
  }

  // ---- Drive: 共有ファイルの持ち主・最終更新者 = 一緒に作業している人。
  for (const f of input.driveFiles ?? []) {
    const people = [...(f.owners ?? []), ...(f.lastModifyingUser ? [f.lastModifyingUser] : [])];
    for (const u of people) {
      if (!u.emailAddress || u.me) continue;
      const p: Person = {
        email: u.emailAddress.toLowerCase(),
        name: (u.displayName ?? "").trim() || u.emailAddress.split("@")[0]!,
      };
      addPerson(p, "google_drive", false);
    }
  }

  // 採用判定 → 取込形へ。受信のみ 1 回きりの相手は落とす (メルマガ・単発通知の残り)。
  const emailToName = new Map<string, string>();
  const contacts: ParsedContact[] = [];
  for (const [email, v] of byEmail) {
    if (!v.sentTo && v.count < 2) continue;
    emailToName.set(email, v.name);
    contacts.push({ name: v.name, email, source: v.source });
  }
  const kept = interactions
    .filter((i) => emailToName.has(i.name))
    .map((i) => ({ ...i, name: emailToName.get(i.name)! }));
  return { contacts, interactions: kept };
}

// ---------------- Google 連絡先 (People API) ----------------

// People API connections.list の応答から連絡先を組み立てる。氏名・メール・電話・所属を
// 直接持つ最も確実な取込元。表示名が無い相手は最初のメールのローカル部を仮名にする。
export function parseGoogleConnections(response: unknown): ParsedContact[] {
  const conns = (response as { connections?: unknown } | null)?.connections;
  if (!Array.isArray(conns)) return [];
  const out: ParsedContact[] = [];
  for (const p of conns as Array<Record<string, unknown>>) {
    const names = Array.isArray(p.names) ? (p.names as Array<Record<string, unknown>>) : [];
    const emails = Array.isArray(p.emailAddresses) ? (p.emailAddresses as Array<Record<string, unknown>>) : [];
    const phones = Array.isArray(p.phoneNumbers) ? (p.phoneNumbers as Array<Record<string, unknown>>) : [];
    const orgs = Array.isArray(p.organizations) ? (p.organizations as Array<Record<string, unknown>>) : [];
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const email = str(emails[0]?.value);
    let name = str(names[0]?.displayName);
    if (!name && email) name = email.split("@")[0];
    if (!name) continue;
    const org = orgs[0] ?? {};
    out.push({
      name,
      email,
      phone: str(phones[0]?.value),
      company: str(org.name),
      title: str(org.title),
      source: "google_contacts",
      distance: 4,
    });
  }
  return out;
}

// ---------------- ネットワーク層 (注入可能) ----------------

export type GoogleClient = {
  authUrl: (state: string, redirectUri: string, scopes: string[], opts?: { offline?: boolean }) => string;
  exchangeCode: (
    code: string,
    redirectUri: string,
  ) => Promise<{
    refreshToken: string | null;
    accessToken: string;
    email: string | null;
    name: string | null; // id_token の name (profile スコープを求めたときだけ入る)
    grantedScopes: string | null; // 実際に許可されたスコープ (space 区切り)
  }>;
  // scopes を渡すと、許可済みの範囲内でそのスコープだけに絞ったトークンを取る (RFC 6749 §6)。
  // Gmail はトークンに gmail.metadata が同居していると検索 (q) を 403 で拒否するため、
  // 検索が要る経路 (Plaud) は gmail.readonly だけに絞って取り直す。
  refreshAccessToken: (refreshToken: string, scopes?: string) => Promise<string>;
  apiGet: (url: string, accessToken: string) => Promise<unknown>;
  apiPost: (url: string, accessToken: string, body: unknown) => Promise<unknown>;
};

// env (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) が無ければ null =
// 連携機能は「準備中」に縮退 (他の機能は動く)。番兵値 "unset" も未設定として扱う。
export function buildGoogleClient(): GoogleClient | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret || clientSecret === "unset" || clientId === "unset") return null;

  const tokenReq = async (body: Record<string, string>) => {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`google_token_error: ${res.status} ${await res.text().catch(() => "")}`);
    return (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string; scope?: string };
  };

  return {
    authUrl: (state, redirectUri, scopes, opts) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: scopes.join(" "),
        // 追加の許可 (incremental auth): すでに許可済みのスコープは引き継ぐ
        include_granted_scopes: "true",
        ...(opts?.offline === false
          ? {} // ゲストの一度きりの照会は refresh token を発行させない (立ち入った鍵を持たない)
          : { access_type: "offline", prompt: "consent" }),
        state,
      }).toString()}`,
    exchangeCode: async (code, redirectUri) => {
      const t = await tokenReq({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      if (!t.access_token) throw new Error("google_token_error: no access_token");
      // email / name は id_token (JWT) の payload から取る (検証は不要 = 表示用途のみ)
      let email: string | null = null;
      let name: string | null = null;
      if (t.id_token) {
        try {
          const payload = JSON.parse(
            Buffer.from(t.id_token.split(".")[1] ?? "", "base64url").toString("utf-8"),
          ) as { email?: string; name?: string };
          email = payload.email ?? null;
          name = payload.name ?? null;
        } catch {
          email = null;
        }
      }
      return {
        refreshToken: t.refresh_token ?? null,
        accessToken: t.access_token,
        email,
        name,
        grantedScopes: t.scope ?? null,
      };
    },
    refreshAccessToken: async (refreshToken, scopes) => {
      const t = await tokenReq({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        ...(scopes ? { scope: scopes } : {}),
      });
      if (!t.access_token) throw new Error("google_token_error: no access_token");
      return t.access_token;
    },
    apiGet: async (url, accessToken) => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        throw new Error(`google_api_error: ${res.status} ${url.split("?")[0]} ${detail}`);
      }
      return res.json();
    },
    apiPost: async (url, accessToken, body) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`google_api_error: ${res.status} ${url.split("?")[0]}`);
      return res.json();
    },
  };
}
