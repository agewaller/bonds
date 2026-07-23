// メール安全装置の結合テスト (2026-07 の Resend 停止の再発防止):
// 宛先の事前検証 (無効宛先は送らず送信除外) と、バウンス済みアドレスの取り込み
// (恒久サプレッション + 提携先の送信除外) を検証する。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";
import { GOOGLE_SCOPES_SEND, type GoogleClient } from "../../src/lib/google.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

const partnerGenerate: GenerateFn = async ({ model }) => ({
  text: JSON.stringify({
    subject: "連携のご相談",
    body: "はじめまして。人のつながりを支える取り組みを拝見してご連絡しました。一度お話の機会をいただけないでしょうか。",
  }),
  model,
  inputTokens: 100,
  outputTokens: 60,
});

let gmailCalls = 0;
const fakeGmail: GoogleClient = {
  authUrl: () => "https://accounts.google.com/o/oauth2/v2/auth?fake",
  exchangeCode: async () => ({
    refreshToken: "rt",
    accessToken: "at",
    email: "me@example.com",
    name: "わたし",
    grantedScopes: GOOGLE_SCOPES_SEND.join(" "),
  }),
  refreshAccessToken: async () => "at",
  apiGet: async () => ({}),
  apiPost: async (url) => {
    if (url.includes("messages/send")) gmailCalls++;
    return { id: "gm-1" };
  },
};

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  gmailCalls = 0;
  await prisma.$executeRawUnsafe(
    'TRUNCATE "partner_messages", "partner_targets", "google_connections", "email_suppressions", "ai_usage_logs", "prompts" CASCADE',
  );
  await seedDdPrompts(prisma);
  await prisma.googleConnection.create({
    data: { ownerUid: "owner", email: "me@example.com", refreshToken: "rt", scopes: GOOGLE_SCOPES_SEND.join(" ") },
  });
});

async function draftFor(app: ReturnType<typeof createApp>, email: string, name: string) {
  const t = await (
    await app.request("/api/admin/partners/targets", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name, kind: "association", contactEmail: email }),
    })
  ).json();
  const d = await (
    await app.request(`/api/admin/partners/targets/${t.target.id}/draft`, { method: "POST", headers: H, body: "{}" })
  ).json();
  return { targetId: t.target.id as string, messageId: d.message.id as string };
}

describe("宛先の事前検証 (送信前ゲート)", () => {
  it("無効判定の宛先には送らず、提携先を送信除外にする", async () => {
    const app = createApp({
      prisma,
      generate: partnerGenerate,
      google: fakeGmail,
      emailVerify: async () => "invalid",
    });
    const { targetId, messageId } = await draftFor(app, "dead@example.org", "宛先が死んでいる会");
    const res = await app.request(`/api/admin/partners/messages/${messageId}/send`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(res.status).toBe(422);
    expect((await res.json()).status).toBe("suppressed");
    expect(gmailCalls).toBe(0);
    const target = await prisma.partnerTarget.findUnique({ where: { id: targetId } });
    expect(target!.status).toBe("suppressed");
    const msg = await prisma.partnerMessage.findUnique({ where: { id: messageId } });
    expect(msg!.status).toBe("failed");
  });

  it("unknown 判定は送信を止めない (検証サービス障害で全体を止めない)", async () => {
    const app = createApp({
      prisma,
      generate: partnerGenerate,
      google: fakeGmail,
      emailVerify: async () => "unknown",
    });
    const { messageId } = await draftFor(app, "maybe@example.org", "判定つかない会");
    const res = await app.request(`/api/admin/partners/messages/${messageId}/send`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("sent");
    expect(gmailCalls).toBe(1);
  });
});

describe("バウンス済みアドレスの取り込み (恒久サプレッション)", () => {
  it("取り込みで配信停止に合流し、同じ宛先の提携先は送信除外・再取り込みは重複しない", async () => {
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const { targetId } = await draftFor(app, "bounced@example.org", "跳ねた宛先の会");

    const res = await app.request("/api/campaigns/suppressions/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ emails: ["bounced@example.org", "Bounced@Example.org", "other@example.com", "not-an-email"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(2); // 大文字小文字は同一・不正な形式は捨てる
    expect(body.added).toBe(2);
    expect(body.suppressedTargets).toBe(1);

    const target = await prisma.partnerTarget.findUnique({ where: { id: targetId } });
    expect(target!.status).toBe("suppressed");
    expect(await prisma.emailSuppression.count()).toBe(2);

    // 再取り込みは冪等 (追加 0)
    const again = await app.request("/api/campaigns/suppressions/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ emails: ["bounced@example.org"] }),
    });
    expect((await again.json()).added).toBe(0);

    // 空は 400・未認証は 401
    const empty = await app.request("/api/campaigns/suppressions/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ emails: [] }),
    });
    expect(empty.status).toBe(400);
    const noAuth = await app.request("/api/campaigns/suppressions/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails: ["a@b.co"] }),
    });
    expect(noAuth.status).toBe(401);
  });
});
