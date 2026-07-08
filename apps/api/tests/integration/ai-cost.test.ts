// 利用者ごとの月次コスト上限 (task #36) の結合テスト。
// オーナー本人は無制限、それ以外の利用者は app_config の設定額で月次上限が効くことを確かめる。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";
import type { VerifyIdTokenFn } from "../../src/lib/auth.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
process.env.OWNER_EMAIL = "agewaller@gmail.com";
delete process.env.PERSON_DD_MONTHLY_CAP_JPY; // オーナー既定 3000 (無制限相当ではないが利用者上限より十分大きい)

const ADMIN_H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

const okGenerate: GenerateFn = async ({ model }) => ({
  text: JSON.stringify({ people: [] }),
  model,
  inputTokens: 10,
  outputTokens: 10,
});

// 一般ユーザー (isOwner=false) を装う verifier。Bearer <uid> を uid にする。
const verifyIdToken: VerifyIdTokenFn = async (token) => ({
  uid: token,
  email: token === "owner-token" ? "agewaller@gmail.com" : "user@example.com",
});

function makeApp() {
  return createApp({ prisma, generate: okGenerate, mailer: async () => ({ messageId: "m" }), search: null, verifyIdToken });
}

async function seedUsage(ownerUid: string, costJpy: number) {
  await prisma.aiUsageLog.create({
    data: { ownerUid, provider: "anthropic", model: "claude-sonnet-4-6", purpose: "seed", inputTokens: 1, outputTokens: 1, costJpy },
  });
}

async function extract(app: ReturnType<typeof createApp>, headers: Record<string, string>) {
  return app.request("/api/contacts/extract-from-conversation", {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "田中さんと会いました" }),
  });
}

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "ai_usage_logs", "app_config", "prompts" CASCADE');
  await seedDdPrompts(prisma);
});

describe("管理: AI コスト上限の設定", () => {
  it("既定は未設定だが既定額を返し、PUT で保存すると反映される", async () => {
    const app = makeApp();
    const g = await app.request("/api/admin/ai-cost-config", { headers: ADMIN_H });
    expect(g.status).toBe(200);
    const gb = await g.json();
    expect(gb.isDefault).toBe(true);
    expect(gb.defaultJpy).toBe(500);

    const p = await app.request("/api/admin/ai-cost-config", {
      method: "PUT",
      headers: ADMIN_H,
      body: JSON.stringify({ userCapJpy: 800 }),
    });
    expect(p.status).toBe(200);
    expect((await p.json()).userCapJpy).toBe("800");

    const g2 = await app.request("/api/admin/ai-cost-config", { headers: ADMIN_H });
    const g2b = await g2.json();
    expect(g2b.userCapJpy).toBe("800");
    expect(g2b.unlimited).toBe(false);
  });

  it("0 は無制限として保存される", async () => {
    const app = makeApp();
    const p = await app.request("/api/admin/ai-cost-config", {
      method: "PUT",
      headers: ADMIN_H,
      body: JSON.stringify({ userCapJpy: 0 }),
    });
    expect((await p.json()).unlimited).toBe(true);
  });

  it("負数・非整数は 400", async () => {
    const app = makeApp();
    const neg = await app.request("/api/admin/ai-cost-config", {
      method: "PUT",
      headers: ADMIN_H,
      body: JSON.stringify({ userCapJpy: -1 }),
    });
    expect(neg.status).toBe(400);
    const frac = await app.request("/api/admin/ai-cost-config", {
      method: "PUT",
      headers: ADMIN_H,
      body: JSON.stringify({ userCapJpy: 12.5 }),
    });
    expect(frac.status).toBe(400);
  });

  it("管理ルートは認証必須 (トークン無しは 401/503)", async () => {
    const app = makeApp();
    const r = await app.request("/api/admin/ai-cost-config");
    expect([401, 503]).toContain(r.status);
  });
});

describe("利用: 月次上限の適用", () => {
  it("一般ユーザーは当月消費が上限を超えると 422 になる", async () => {
    const app = makeApp();
    // 上限を 500 円に。ユーザーの当月消費を 600 円まで積む。
    await app.request("/api/admin/ai-cost-config", {
      method: "PUT",
      headers: ADMIN_H,
      body: JSON.stringify({ userCapJpy: 500 }),
    });
    await seedUsage("user-token", 600);
    const r = await extract(app, { "Content-Type": "application/json", authorization: "Bearer user-token" });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe("quota_exceeded");
  });

  it("オーナー本人は同じ消費でも上限に掛からない (無制限)", async () => {
    const app = makeApp();
    await app.request("/api/admin/ai-cost-config", {
      method: "PUT",
      headers: ADMIN_H,
      body: JSON.stringify({ userCapJpy: 500 }),
    });
    // break-glass (owner) と OWNER_EMAIL ログインの双方が通ること。
    await seedUsage("owner", 600);
    const viaBreakglass = await extract(app, ADMIN_H);
    expect(viaBreakglass.status).toBe(200);
    const viaOwnerLogin = await extract(app, { "Content-Type": "application/json", authorization: "Bearer owner-token" });
    expect(viaOwnerLogin.status).toBe(200);
  });

  it("上限内の一般ユーザーは通り、消費が本人の ownerUid に計上される", async () => {
    const app = makeApp();
    await app.request("/api/admin/ai-cost-config", {
      method: "PUT",
      headers: ADMIN_H,
      body: JSON.stringify({ userCapJpy: 5000 }),
    });
    const r = await extract(app, { "Content-Type": "application/json", authorization: "Bearer user-token" });
    expect(r.status).toBe(200);
    const logs = await prisma.aiUsageLog.findMany({ where: { ownerUid: "user-token", purpose: "conversation_extract" } });
    expect(logs.length).toBe(1);
  });
});

describe("管理: 当月の利用状況", () => {
  it("利用者ごとに当月コストを集計して返す", async () => {
    const app = makeApp();
    await seedUsage("owner", 300);
    await seedUsage("user-a", 120);
    await seedUsage("user-a", 80);
    const r = await app.request("/api/admin/ai-usage", { headers: ADMIN_H });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.totalJpy).toBe(500);
    const owner = b.perUser.find((u: { ownerUid: string }) => u.ownerUid === "owner");
    const userA = b.perUser.find((u: { ownerUid: string }) => u.ownerUid === "user-a");
    expect(owner.costJpy).toBe(300);
    expect(userA.costJpy).toBe(200);
  });
});
