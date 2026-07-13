// 引き合わせの提案 API の結合テスト — 論点 (facets) の噛み合いから候補を出し、AI が是非を判断する。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

// 名簿に出た2人を素直に引き合わせる偽 AI。
const fakeIntro: GenerateFn = async ({ userMessage }) => {
  const hasTanaka = userMessage.includes("田中");
  const hasSuzuki = userMessage.includes("鈴木");
  const intros = hasTanaka && hasSuzuki
    ? [{ personA: "田中", personB: "鈴木", reason: "資金調達の悩みに投資の強みが噛み合います", how: "今度お茶の席をつくる", caution: "" }]
    : [];
  return { text: JSON.stringify({ introductions: intros }), model: "claude-sonnet-5", inputTokens: 50, outputTokens: 30 };
};

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "contacts", "ai_usage_logs", "prompts", "app_config" CASCADE');
  await seedDdPrompts(prisma);
});

async function addContact(app: ReturnType<typeof createApp>, name: string, facets: Record<string, unknown>) {
  const res = await app.request("/api/contacts", { method: "POST", headers: H, body: JSON.stringify({ name }) });
  const id = (await res.json()).contact.id as string;
  await prisma.contact.update({ where: { id }, data: { profileFacets: JSON.stringify(facets) } });
  return id;
}

describe("引き合わせの提案 (/api/relationship/introductions)", () => {
  it("困りごと↔強みが噛み合う二人を提案する", async () => {
    const app = createApp({ prisma, generate: fakeIntro });
    await addContact(app, "田中", { concerns: ["資金調達に悩んでいる"], goals: [], skills: ["新規事業の経験"], opportunities: [] });
    await addContact(app, "鈴木", { concerns: [], goals: [], skills: ["投資家として資金調達を支援できる"], opportunities: [] });
    await addContact(app, "佐藤", { concerns: ["健康の不安"], goals: [], skills: ["料理"], opportunities: [] });

    const res = await app.request("/api/relationship/introductions", { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.introductions.length).toBe(1);
    expect(new Set([body.introductions[0].personA, body.introductions[0].personB])).toEqual(new Set(["田中", "鈴木"]));
    expect(body.introductions[0].how).toContain("お茶");
    expect(await prisma.aiUsageLog.count({ where: { purpose: "intro_suggest" } })).toBe(1);
  });

  it("噛み合う二人がいなければ空 + 案内文 (AI を呼ばない)", async () => {
    const app = createApp({ prisma, generate: fakeIntro });
    await addContact(app, "独りの人", { concerns: ["健康の不安"], skills: [] });
    const res = await app.request("/api/relationship/introductions", { headers: H });
    const body = await res.json();
    expect(body.introductions).toEqual([]);
    expect(typeof body.note).toBe("string");
    expect(await prisma.aiUsageLog.count({ where: { purpose: "intro_suggest" } })).toBe(0);
  });

  it("AI 未設定なら噛み合う手がかりだけ添えて候補を返す (縮退)", async () => {
    const app = createApp({ prisma, generate: null });
    await addContact(app, "田中", { concerns: ["資金調達に悩んでいる"], skills: [] });
    await addContact(app, "鈴木", { concerns: [], skills: ["資金調達を支援できる"] });
    const res = await app.request("/api/relationship/introductions", { headers: H });
    const body = await res.json();
    expect(body.introductions.length).toBe(1);
    expect(body.introductions[0].reason).toContain("資金調達");
  });
});
