// Gmail 送信 (提携・紹介連絡の送信チャネル)。共有の配信サービス (Resend 等) は
// バウンス率の規律で新規宛先への連絡と相性が悪く、実際にアカウント停止を招いた
// (2026-07 の実障害)。未面識への提携連絡は、オーナー自身の Gmail から少量ずつ送る:
// 差出人は本人・返信はそのまま受信箱へ・量は日次上限で規律する。
// gmail.send は制限付き区分のため明示オプトイン (auth-url?scope=send)。

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

// RFC 2047 (UTF-8 B encoding) — 件名に日本語を使えるようにする。ASCII のみならそのまま。
function encodeWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, "utf-8").toString("base64")}?=`;
}

// Gmail API users.messages.send に渡す raw (base64url の RFC822) を組み立てる純粋関数。
// 本文は base64 の text/plain (UTF-8) — 日本語も改行もそのまま安全に通る。
export function buildRfc822Raw(input: { to: string; subject: string; body: string; from?: string }): string {
  const lines = [
    ...(input.from ? [`From: ${input.from}`] : []),
    `To: ${input.to}`,
    `Subject: ${encodeWord(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.body, "utf-8").toString("base64"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf-8").toString("base64url");
}
