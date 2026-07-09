// 対応の提案 (playbook) API の結合テスト — 関係の見立て・交点・いまできる一手を返す。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

const fakePlaybook: GenerateFn = async () => ({
  text: JSON.stringify({
    relationship: "ほどよい距離のお付き合いで、これから深められる余地があります。",
    intersections: [
      { area: "仕事", point: "地域の子ども支援という関心が重なっています" },
      { area: "私的", point: "お互い山歩きが好きです" },
    ],
    actions: [
      { title: "近況をひとこと", detail: "先日の催しのお礼を添えて短くお便りを", why: "間があいてきたため" },
    ],
    somethingNew: "共通の知人を交えてお茶の機会をつくる",
    caution: "急な誘いは負担になるので、まずは軽い一報から",
  }),
  model: "claude-sonnet-5",
  inputTokens: 120,
  outputTokens: 80,
});

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "exchanges", "contact_gifts", "contact_interactions", "contacts", "ai_usage_logs", "prompts" CASCADE',
  );
  await seedDdPrompts(prisma);
});

async function addContact(app: ReturnType<typeof createApp>, body: Record<string, unknown>): Promise<string> {
  const res = await app.request("/api/contacts", { method: "POST", headers: H, body: JSON.stringify(body) });
  return (await res.json()).contact.id;
}

describe("対応の提案 (/api/contacts/:id/playbook)", () => {
  it("関係の見立て・交点・一手・新しい関わり方を返し、関係スコアも添える", async () => {
    const app = createApp({ prisma, generate: fakePlaybook });
    const id = await addContact(app, {
      name: "高橋 良子",
      distance: 3,
      personalProfile: "地域の子ども食堂を手伝っている",
      profileFacets: JSON.stringify({ skills: ["料理"], goals: ["支援の輪を広げたい"], opportunities: ["場所探しに力になれる"] }),
    });
    const res = await app.request(`/api/contacts/${id}/playbook`, { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.relationship).toContain("余地");
    expect(body.intersections.length).toBeGreaterThanOrEqual(1);
    expect(body.actions[0].title).toBeTruthy();
    expect(body.somethingNew).toBeTruthy();
    expect(body.score).toBeTruthy();
    expect(body.score.distance).toBeGreaterThanOrEqual(1);
    expect(body.score.distance).toBeLessThanOrEqual(5);
    expect(await prisma.aiUsageLog.count({ where: { purpose: "contact_playbook" } })).toBe(1);
  });

  it("AI 未設定なら 503 に縮退する", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "伊藤 健" });
    const res = await app.request(`/api/contacts/${id}/playbook`, { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(503);
  });
});
