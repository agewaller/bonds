// 出力履歴 (something new の構造化) の結合テスト — 生成のたびに要旨が履歴へ残り、
// 次の生成のプロンプトに「既出リスト」として渡ること・履歴が暗号化保存されることを確認する。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

// 直近に AI へ渡った userMessage を捕まえる偽 AI
let lastUserMessage = "";
const capture =
  (text: string): GenerateFn =>
  async (args) => {
    lastUserMessage = (args as { userMessage: string }).userMessage;
    return { text, model: "claude-sonnet-5", inputTokens: 100, outputTokens: 60 };
  };

const playbookJson = JSON.stringify({
  relationship: "ほどよい距離のお付き合いです。",
  intersections: [{ area: "私的", point: "山歩きが好き" }],
  actions: [{ title: "近況をひとこと", detail: "短いお便りを", why: "間があいたため" }],
  somethingNew: "共通の知人とお茶の機会をつくる",
  caution: "",
});

const giftJson = JSON.stringify({
  suggestions: [
    { idea: "季節の和菓子", why: "甘いものがお好き", priceRange: "3千円ほど", howToFind: "百貨店の銘菓コーナー" },
  ],
  note: "",
});

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "output_history", "exchanges", "contact_gifts", "contact_interactions", "contacts", "ai_usage_logs", "prompts" CASCADE',
  );
  await seedDdPrompts(prisma);
  lastUserMessage = "";
});

async function addContact(app: ReturnType<typeof createApp>, name: string): Promise<string> {
  const res = await app.request("/api/contacts", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name, distance: 3 }),
  });
  return (await res.json()).contact.id;
}

describe("出力履歴 (something new の構造化)", () => {
  it("対応の提案: 要旨が履歴に残り、2回目のプロンプトに既出として渡る", async () => {
    const app = createApp({ prisma, generate: capture(playbookJson) });
    const id = await addContact(app, "高橋 良子");

    const first = await app.request(`/api/contacts/${id}/playbook`, { method: "POST", headers: H, body: "{}" });
    expect(first.status).toBe(200);
    // 初回のプロンプトには既出リストが無い
    expect(lastUserMessage).not.toContain("既出");

    const rows = await prisma.outputHistory.findMany({ where: { contactId: id, kind: "playbook" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toContain("近況をひとこと");

    const second = await app.request(`/api/contacts/${id}/playbook`, { method: "POST", headers: H, body: "{}" });
    expect(second.status).toBe(200);
    expect(lastUserMessage).toContain("これまでに出した提案 (既出):");
    expect(lastUserMessage).toContain("近況をひとこと");
    expect(lastUserMessage).toContain("新しい視点");
  });

  it("贈り物の提案: 同じ仕組みが効き、履歴は kind で分かれる", async () => {
    const app = createApp({ prisma, generate: capture(giftJson) });
    const id = await addContact(app, "田中 一郎");

    const first = await app.request(`/api/contacts/${id}/gift-suggest`, { method: "POST", headers: H, body: "{}" });
    expect(first.status).toBe(200);
    expect(lastUserMessage).not.toContain("既出");

    const second = await app.request(`/api/contacts/${id}/gift-suggest`, { method: "POST", headers: H, body: "{}" });
    expect(second.status).toBe(200);
    expect(lastUserMessage).toContain("季節の和菓子");

    // 贈り物の履歴は playbook のプロンプトに混ざらない (kind 分離)
    const gifts = await prisma.outputHistory.findMany({ where: { contactId: id } });
    expect(gifts.every((g) => g.kind === "gift_suggest")).toBe(true);
  });

  it("要旨は保存時に暗号化される (at-rest)", async () => {
    const app = createApp({ prisma, generate: capture(playbookJson) });
    const id = await addContact(app, "佐藤 花子");
    await app.request(`/api/contacts/${id}/playbook`, { method: "POST", headers: H, body: "{}" });

    const raw = await prisma.$queryRawUnsafe<Array<{ summary: string }>>(
      `SELECT summary FROM output_history WHERE contact_id = '${id}'`,
    );
    expect(raw).toHaveLength(1);
    expect(raw[0].summary.startsWith("enc:v1:")).toBe(true);
    expect(raw[0].summary).not.toContain("近況");
  });
});
