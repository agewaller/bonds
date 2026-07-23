// Gmail 送信 (RFC822 組み立て・スコープ判定) の純粋関数テスト
import { describe, it, expect } from "vitest";
import { GMAIL_SEND_SCOPE, hasMailSendScope, buildRfc822Raw } from "../../src/lib/gmail-send.js";

describe("hasMailSendScope", () => {
  it("gmail.send を含むときだけ真", () => {
    expect(hasMailSendScope(`openid ${GMAIL_SEND_SCOPE}`)).toBe(true);
    expect(hasMailSendScope("openid https://www.googleapis.com/auth/gmail.readonly")).toBe(false);
    expect(hasMailSendScope(null)).toBe(false);
    expect(hasMailSendScope(undefined)).toBe(false);
  });
});

describe("buildRfc822Raw", () => {
  function decode(raw: string) {
    const text = Buffer.from(raw, "base64url").toString("utf-8");
    const [head, b64] = text.split("\r\n\r\n");
    return { head: head ?? "", body: Buffer.from(b64 ?? "", "base64").toString("utf-8") };
  }

  it("宛先・件名 (日本語は RFC2047)・本文が正しく入る", () => {
    const raw = buildRfc822Raw({ to: "info@example.org", subject: "連携のご相談", body: "はじめまして。\nよろしくお願いいたします。" });
    const { head, body } = decode(raw);
    expect(head).toContain("To: info@example.org");
    const encoded = /Subject: =\?UTF-8\?B\?(.+)\?=/.exec(head)?.[1] ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe("連携のご相談");
    expect(head).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(body).toBe("はじめまして。\nよろしくお願いいたします。");
  });

  it("ASCII の件名はそのまま・From は指定時のみ付く", () => {
    const withFrom = decode(buildRfc822Raw({ to: "a@b.co", subject: "Hello", body: "hi", from: "Me <me@example.com>" }));
    expect(withFrom.head).toContain("Subject: Hello");
    expect(withFrom.head).toContain("From: Me <me@example.com>");
    const noFrom = decode(buildRfc822Raw({ to: "a@b.co", subject: "Hello", body: "hi" }));
    expect(noFrom.head).not.toContain("From:");
  });
});
