// メーラーのプロバイダ自動判別 (cares と同じ鍵を使い回せることの担保)。
// 鍵が re_ 始まりなら Resend、そうでなければ SendGrid に振り分ける。実送信はせず fetch を差し替えて確認。
import { describe, it, expect, afterEach, vi } from "vitest";
import { buildMailer, buildSendGridMailer } from "../../src/lib/mailer.js";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

describe("buildMailer (プロバイダ自動判別)", () => {
  it("鍵か送信元が無ければ null (未設定なら送信しない = 呼び出し側で 503)", () => {
    delete process.env.SENDGRID_API_KEY;
    delete process.env.OUTREACH_FROM_EMAIL;
    expect(buildMailer()).toBeNull();
    process.env.SENDGRID_API_KEY = "re_abc";
    delete process.env.OUTREACH_FROM_EMAIL;
    expect(buildMailer()).toBeNull(); // 送信元が無ければ送らない
  });

  it("re_ 始まりの鍵は Resend の口を叩く (cares の鍵をそのまま使える)", async () => {
    process.env.SENDGRID_API_KEY = "re_test123";
    process.env.OUTREACH_FROM_EMAIL = "hello@example.com";
    process.env.OUTREACH_SENDER_IDENTITY = "山野";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "rs_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const mailer = buildMailer()!;
    const r = await mailer({ to: "a@example.com", subject: "件名", body: "本文" });
    expect(r.messageId).toBe("rs_1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.from).toBe("山野 <hello@example.com>");
    expect(sent.to).toEqual(["a@example.com"]);
    expect(sent.text).toBe("本文"); // プレーンテキスト
  });

  it("re_ 以外の鍵は SendGrid の口を叩く", async () => {
    process.env.SENDGRID_API_KEY = "SG.xxxx";
    process.env.OUTREACH_FROM_EMAIL = "hello@example.com";
    const fetchMock = vi.fn(async () => new Response("", { status: 202, headers: { "x-message-id": "sg_1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const mailer = buildMailer()!;
    const r = await mailer({ to: "a@example.com", subject: "件名", body: "本文" });
    expect(r.messageId).toBe("sg_1");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.sendgrid.com/v3/mail/send");
  });

  it("旧名 buildSendGridMailer は buildMailer の別名 (呼び出し側の互換)", () => {
    expect(buildSendGridMailer).toBe(buildMailer);
  });
});
