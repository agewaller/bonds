// メール送信 (cares apps/api/src/lib/mailer.ts の SendGrid 方式を踏襲)。
// 鍵はサーバ側 env のみ。未設定なら null (呼び出し側で 503 = graceful degrade)。
// テストでは MailerFn を注入して実送信せずに検証する。

export type MailArgs = { to: string; subject: string; body: string };
export type MailResult = { messageId: string | null };
export type MailerFn = (args: MailArgs) => Promise<MailResult>;

export function buildSendGridMailer(): MailerFn | null {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.OUTREACH_FROM_EMAIL;
  if (!apiKey || !from) return null;
  return async ({ to, subject, body }) => {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
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
