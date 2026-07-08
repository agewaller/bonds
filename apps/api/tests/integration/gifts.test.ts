// 贈り物 (Gift) API の結合テスト — 行事リマインド・贈答台帳・AI 提案。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

const fakeGift: GenerateFn = async () => ({
  text: JSON.stringify({
    suggestions: [
      { idea: "上質なお茶の詰め合わせ", why: "健康に気をつかっておられるとのことなので", priceRange: "3000〜5000円", howToFind: "百貨店の食品売り場か、老舗茶舗のオンラインで" },
    ],
    note: "お中元は7月上旬から中旬に届くように手配すると丁寧です",
  }),
  model: "claude-sonnet-5",
  inputTokens: 100,
  outputTokens: 50,
});

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "contact_gifts", "contact_interactions", "contacts", "ai_usage_logs", "prompts" CASCADE',
  );
  await seedDdPrompts(prisma);
});

async function addContact(app: ReturnType<typeof createApp>, body: Record<string, unknown>): Promise<string> {
  const res = await app.request("/api/contacts", { method: "POST", headers: H, body: JSON.stringify(body) });
  return (await res.json()).contact.id;
}

describe("Gift: 行事リマインド (/api/gifts/occasions)", () => {
  it("誕生日と未返礼を拾って返す", async () => {
    const app = createApp({ prisma, generate: null });
    // 45日以内に誕生日が来る相手 (今日を基準にした近い月日を使う)
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const bday = `1960-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
    const id = await addContact(app, { name: "山田 太郎", birthday: bday });
    // いただいたまま (60日前) の相手
    const other = await addContact(app, { name: "鈴木 花子" });
    const past = new Date();
    past.setDate(past.getDate() - 60);
    await app.request(`/api/contacts/${other}/gifts`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ item: "お菓子", direction: "inbound", givenAt: past.toISOString() }),
    });

    const body = await (await app.request("/api/gifts/occasions", { headers: H })).json();
    const kinds = body.occasions.map((o: { kind: string }) => o.kind);
    expect(kinds).toContain("birthday");
    expect(kinds).toContain("return");
    // 未返礼は先頭
    expect(body.occasions[0].kind).toBe("return");
    expect(body.occasions.find((o: { contactName: string }) => o.contactName === "山田 太郎")).toBeTruthy();
    expect(id).toBeTruthy();
  });
});

describe("Gift: 贈答台帳 (/api/gifts)", () => {
  it("相手ごとに贈った/いただいたを集計し、未返礼を先頭にする", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "佐藤 次郎" });
    await app.request(`/api/contacts/${id}/gifts`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ item: "ワイン", direction: "inbound", amount: 4000, givenAt: "2026-06-01T00:00:00Z" }),
    });
    const body = await (await app.request("/api/gifts", { headers: H })).json();
    expect(body.ledgers).toHaveLength(1);
    expect(body.ledgers[0].contactName).toBe("佐藤 次郎");
    expect(body.ledgers[0].ledger.inboundTotal).toBe(4000);
    expect(body.ledgers[0].ledger.needsReturn).toBe(true);
  });
});

describe("Gift: 贈り物の提案 (/api/contacts/:id/gift-suggest)", () => {
  it("相手に合わせた候補を返す (AI 未設定は 503)", async () => {
    const withAi = createApp({ prisma, generate: fakeGift });
    const id = await addContact(withAi, { name: "田中 三郎", personalProfile: "健康志向" });
    const res = await withAi.request(`/api/contacts/${id}/gift-suggest`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ occasion: "お中元", budget: "5000円" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestions[0].idea).toContain("お茶");
    expect(body.note).toContain("お中元");
    expect(await prisma.aiUsageLog.count({ where: { purpose: "gift_suggest" } })).toBe(1);

    const noAi = createApp({ prisma, generate: null });
    const res2 = await noAi.request(`/api/contacts/${id}/gift-suggest`, { method: "POST", headers: H, body: "{}" });
    expect(res2.status).toBe(503);
  });
});
