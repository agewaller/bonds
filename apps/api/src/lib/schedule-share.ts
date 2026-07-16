// 共有リンク日程調整の中核 (timeshare FreeTimeShare / Proposal の概念を新規実装)。
// 純粋関数のみ (DB / API 非依存 = ユニットテスト対象)。
//
// パスワード保護はセッションを持たない二段構え:
// 1. unlock でパスワードを検証し、proof = HMAC(鍵=パスワードハッシュ, 文=shareKey) を返す
// 2. 以降のリクエストは proof を添える (サーバは保存済みハッシュから再計算して照合)。
//    パスワードを変えると proof は全部無効になる。状態を持たない = インスタンスに依存しない。
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { parseIsoIntervals, type Interval } from "./timeslots.js";
import { sanitizeProse } from "./plain-text.js";

const SCRYPT_PREFIX = "scrypt:v1:";

export function hashSharePassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${SCRYPT_PREFIX}${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifySharePassword(password: string, stored: string): boolean {
  if (!stored.startsWith(SCRYPT_PREFIX)) return false;
  const [saltHex, hashHex] = stored.slice(SCRYPT_PREFIX.length).split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function shareProof(shareKey: string, passwordHash: string): string {
  return createHmac("sha256", passwordHash).update(shareKey).digest("hex");
}

export function verifyShareProof(shareKey: string, passwordHash: string, proof: string): boolean {
  const expected = Buffer.from(shareProof(shareKey, passwordHash));
  const actual = Buffer.from(String(proof));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const SHARE_METHODS = ["meeting", "online", "phone"] as const;
export type ShareMethod = (typeof SHARE_METHODS)[number];

export const SHARE_METHOD_LABEL: Record<ShareMethod, string> = {
  meeting: "お会いして",
  online: "オンラインで",
  phone: "お電話で",
};

const clean = (v: unknown, max: number): string => sanitizeProse(typeof v === "string" ? v : "").trim().slice(0, max);

export type ShareInput = {
  title: string;
  displayName: string;
  method: ShareMethod;
  note: string;
  periodStart: Date;
  periodEnd: Date;
  slotMinutes: number;
  password: string | null; // null = 設定しない
  expiresAt: Date | null; // null = 期間終了 + 1 か月 (既定)
};

/** 作成/更新の入力を検証・整形する。壊れた値は安全な既定に落とす (公開ページに出る値のため)。 */
export function parseShareInput(raw: unknown, now = new Date()): ShareInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const days = Math.min(90, Math.max(1, Math.round(Number(o.periodDays)) || 14));
  let periodStart = o.periodStart ? new Date(String(o.periodStart)) : new Date(now);
  let periodEnd = o.periodEnd
    ? new Date(String(o.periodEnd))
    : new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  if (Number.isNaN(periodStart.getTime())) periodStart = new Date(now);
  if (Number.isNaN(periodEnd.getTime()) || periodEnd <= periodStart) {
    periodEnd = new Date(periodStart.getTime() + 14 * 24 * 60 * 60 * 1000);
  }
  // 期間は最長 90 日 (無期限の公開を作らない = 相手の尊厳とデータ主権の側から安全側)
  const maxEnd = new Date(periodStart.getTime() + 90 * 24 * 60 * 60 * 1000);
  if (periodEnd > maxEnd) periodEnd = maxEnd;

  const method = SHARE_METHODS.includes(o.method as ShareMethod) ? (o.method as ShareMethod) : "meeting";
  const password = typeof o.password === "string" && o.password.trim() ? o.password.trim().slice(0, 100) : null;

  let expiresAt: Date | null = new Date(periodEnd.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (o.expiresAt === null || o.expiresAt === "") {
    expiresAt = null; // 明示的に期限なし
  } else if (o.expiresAt) {
    const d = new Date(String(o.expiresAt));
    if (!Number.isNaN(d.getTime())) expiresAt = d;
  }

  return {
    title: clean(o.title, 80),
    displayName: clean(o.displayName, 60),
    method,
    note: clean(o.note, 500),
    periodStart,
    periodEnd,
    slotMinutes: Math.min(240, Math.max(15, Math.round(Number(o.slotMinutes)) || 60)),
    password,
    expiresAt,
  };
}

export type ProposalInput = {
  guestName: string;
  guestContact: string;
  message: string;
  candidates: Interval[];
};

export const MAX_PROPOSAL_CANDIDATES = 5;

/**
 * 相手 (第三者) からの提案入力を検証・整形する。名乗りは必須。
 * 候補は 1〜5 件。テキストは全部サニタイズ + 長さ上限 (公開フォームからの入力のため)。
 */
export function parseProposalInput(raw: unknown): ProposalInput | { error: string; detail: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const guestName = clean(o.guestName, 60);
  if (!guestName) return { error: "name_required", detail: "お名前を入れてください" };
  const candidates = parseIsoIntervals(o.candidates).slice(0, MAX_PROPOSAL_CANDIDATES);
  if (candidates.length === 0) {
    return { error: "candidates_required", detail: "ご都合のよい時間をひとつ以上選んでください" };
  }
  return {
    guestName,
    guestContact: clean(o.guestContact, 200),
    message: clean(o.message, 500),
    candidates,
  };
}

/** 共有が現時点で公開可能か (期限・状態)。 */
export function shareIsVisible(share: { state: string; expiresAt: Date | null }, now = new Date()): boolean {
  if (share.state !== "active") return false;
  if (share.expiresAt && share.expiresAt <= now) return false;
  return true;
}
