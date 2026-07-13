// メール送信 (cares apps/api/src/lib/mailer.ts と同じプロバイダ自動判別方式)。
// 鍵はサーバ側 env のみ。未設定なら null (呼び出し側で 503 = graceful degrade)。
// テストでは MailerFn を注入して実送信せずに検証する。
//
// 送信プロバイダは鍵の形式で自動判別する (cares と同じ鍵を使い回せる。SendGrid 専用契約は不要):
//   re_...   → Resend  (cares が使っている。無料枠が大きく日本からの到達率も良い)
//   それ以外 → SendGrid v3 (202 で受理)
// 本文はプレーンテキスト (記号装飾しない方針 = BR-09)。
// 環境変数は cares と揃える: 鍵は SENDGRID_API_KEY (中身は Resend でも可)、
// 送信元は OUTREACH_FROM_EMAIL、表示名は OUTREACH_SENDER_IDENTITY (任意)。

export type MailArgs = { to: string; subject: string; body: string };
export type MailResult = { messageId: string | null };
export type MailerFn = (args: MailArgs) => Promise<MailResult>;

export function buildMailer(): MailerFn | null {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.OUTREACH_FROM_EMAIL;
  if (!apiKey || !from) return null;
  const fromName = process.env.OUTREACH_SENDER_IDENTITY?.trim() || "bonds";
  const viaResend = apiKey.startsWith("re_");
  return async ({ to, subject, body }) => {
    if (viaResend) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text: body }),
      });
      if (!res.ok) {
        throw new Error(`resend_error: ${res.status} ${await res.text().catch(() => "")}`);
      }
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return { messageId: json.id ?? null };
    }
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: fromName },
        subject,
        content: [{ type: "text/plain", value: body }],
      }),
    });
    if (!res.ok) {
      throw new Error(`sendgrid_error: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return { messageId: res.headers.get("x-message-id") };
  };
}

// 旧名の別名 (呼び出し側の互換。中身はプロバイダ自動判別)。
export const buildSendGridMailer = buildMailer;

// ------------------------------------------------------------
// 発信文面候補の検証 (AI 出力の DdResultSpec 流の型強制)
// ------------------------------------------------------------

import { sanitizeProse } from "./plain-text.js";

export type OutreachCandidate = { subject: string; body: string; tone: string; aim: string };

export function validateOutreachCandidates(raw: unknown):
  | { ok: true; candidates: OutreachCandidate[] }
  | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["出力が JSON オブジェクトではない"] };
  }
  const list = (raw as { candidates?: unknown }).candidates;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, errors: ["candidates が無い"] };
  }
  const errors: string[] = [];
  const out: OutreachCandidate[] = [];
  list.slice(0, 5).forEach((c, i) => {
    if (!c || typeof c !== "object") {
      errors.push(`candidates[${i}] がオブジェクトでない`);
      return;
    }
    const rec = c as Record<string, unknown>;
    const subject = typeof rec.subject === "string" ? rec.subject.trim() : "";
    const body = typeof rec.body === "string" ? rec.body.trim() : "";
    if (!subject || !body) {
      errors.push(`candidates[${i}] に subject/body が無い`);
      return;
    }
    out.push({
      subject: sanitizeProse(subject),
      body: sanitizeProse(body),
      tone: typeof rec.tone === "string" ? rec.tone.trim() : "",
      aim: typeof rec.aim === "string" ? rec.aim.trim() : "",
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, candidates: out };
}

export const OUTREACH_JSON_INSTRUCTION = [
  "出力は JSON オブジェクト 1 個だけにしてください (前後の説明文・コードフェンス不要)。",
  "JSON スキーマ:",
  '{"candidates": [{"subject": "件名", "body": "本文", "tone": "トーンの説明", "aim": "この案の狙い"}, ... 3 案]}',
].join("\n");
