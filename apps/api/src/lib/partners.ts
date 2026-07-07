// 提携先アウトリーチ (cares ADR-0022 の移植) の純粋ロジック。
// 候補の発見 → 個別連絡文の下書き → 承認送信 → 返信 → 提携 (公開ディレクトリ) を
// AI が肩代わりしつつ、外への送信は既定で承認制に保つ (CLAUDE.md 自律性の段階)。
//
// 安全装置 (すべて必須):
// - 自動送信は PARTNER_AUTO_SEND=1 の明示許可時のみ (既定 OFF = 下書きまで自動)
// - 送信者の明示 + 配信停止の案内フッタ (特定電子メール法等)
// - 日次送信上限 (PARTNER_DAILY_LIMIT、既定 20)
// - suppressed (送信除外) の提携先には二度と送らない

import { sanitizeProse } from "./plain-text.js";
import { extractJson } from "./dd-spec.js";

// bonds を外部へ説明する一言ピッチ (連絡文の素材)。
export const BONDS_PITCH =
  "bonds（ボンズ）は、大切な人とのつながりを育てるための連絡帳サービスです。連絡の間隔や誕生日を見守り、その人に合った文面の下書きや面談日程の調整まで、関係を温める手間を肩代わりします。";

// 自社プロダクトの公開 URL (連絡文・フッタに必ず入れる)。
export const BONDS_PRODUCT_URL = "https://agewaller.github.io/bonds/";

export const PARTNER_KINDS = [
  "site",
  "sns",
  "association",
  "community",
  "service",
  "corp",
  "other",
] as const;

export const PARTNER_STATUSES = [
  "candidate",
  "queued",
  "contacted",
  "replied",
  "partner",
  "declined",
  "suppressed",
] as const;

// 日次送信上限。env で上書き可 (不正値は既定、最大 500)。
export function partnerDailyLimit(): number {
  const n = Number(process.env.PARTNER_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 20;
}

// 自動送信の明示許可 (既定 OFF)。オーナーが env で 1 を設定したときだけ、
// 下書き生成の直後に送信まで進む。承認制が既定 (ADR-0022 §3)。
export function partnerAutoSendEnabled(): boolean {
  return process.env.PARTNER_AUTO_SEND === "1";
}

// 送信メールに必ず付ける送信者明示 + プロダクト URL + 配信停止フッタ。
export function buildPartnerFooter(): string {
  const identity =
    process.env.OUTREACH_SENDER_IDENTITY?.trim() ||
    "bonds 運営チーム（人間関係エージェント bonds）";
  return [
    "",
    "———",
    identity,
    `bonds: ${BONDS_PRODUCT_URL}`,
    "このメールは bonds との連携のご相談としてお送りしています。今後の配信をご希望されない場合は、このメールにそのままご返信ください。以後お送りすることはありません。",
  ].join("\n");
}

export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// ---------------- 発見 (discover) の出力検証 ----------------

export type DiscoveredTarget = {
  kind: string;
  name: string;
  url: string | null;
  reason: string;
};

export const PARTNER_DISCOVER_MAX = 10;

// AI 出力 {"targets":[{kind,name,url,reason}]} を検証・整形する。壊れた出力は空配列。
export function parseDiscoveredTargets(text: string): DiscoveredTarget[] {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== "object") return [];
  const list = (parsed as { targets?: unknown }).targets;
  if (!Array.isArray(list)) return [];
  const out: DiscoveredTarget[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== "string" || !rec.name.trim()) continue;
    const kind =
      typeof rec.kind === "string" && (PARTNER_KINDS as readonly string[]).includes(rec.kind)
        ? rec.kind
        : "other";
    const url =
      typeof rec.url === "string" && /^https?:\/\//.test(rec.url.trim()) ? rec.url.trim() : null;
    const reason = typeof rec.reason === "string" ? sanitizeProse(rec.reason).trim().slice(0, 300) : "";
    out.push({ kind, name: rec.name.trim().slice(0, 120), url, reason });
    if (out.length >= PARTNER_DISCOVER_MAX) break;
  }
  return out;
}

// ---------------- 連絡文の下書きの出力検証 ----------------

export type PartnerDraft = { subject: string; body: string };

// AI 出力 {"subject","body"} を検証。本文は記号サニタイズ (BR-09 の最終防衛線)。
export function validatePartnerDraft(raw: unknown):
  | { ok: true; draft: PartnerDraft }
  | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["出力が JSON オブジェクトではない"] };
  }
  const rec = raw as Record<string, unknown>;
  const subject = typeof rec.subject === "string" ? sanitizeProse(rec.subject).trim() : "";
  const body = typeof rec.body === "string" ? sanitizeProse(rec.body).trim() : "";
  const errors: string[] = [];
  if (!subject) errors.push("subject が無い");
  if (!body || body.length < 50) errors.push("body が無いか短すぎる");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, draft: { subject: subject.slice(0, 150), body } };
}

// 下書き生成に渡す JSON 出力指示 (DB プロンプトの末尾に付帯)。
export const PARTNER_DRAFT_JSON_INSTRUCTION = [
  '出力は次の JSON だけを返してください: {"subject":"件名","body":"本文"}',
  "本文にアスタリスク・シャープ・※・箇条書き記号・表などの記号装飾を使わず、ふつうの文章で書いてください。",
  "フッタ (署名・配信停止の案内) はシステムが自動で付けるため本文に含めないでください。",
].join("\n");
