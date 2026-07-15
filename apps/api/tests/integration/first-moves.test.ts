// 取り込み直後の自動把握 (enrich-imports) と「はじめの一手」(first-moves) の結合テスト。
// 取り込んだきりの方が自動で論点整理され、動いたほうがよい方が理由つきで挙がることを確かめる。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
delete process.env.PERSON_DD_MONTHLY_CAP_JPY;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

const facetsGenerate: GenerateFn = async ({ model }) => ({
  text: JSON.stringify({
    summary: "頼れる方。",
    work: "設計の仕事",
    skills: ["設計"],
    concerns: [],
    goals: ["独立したい"],
    opportunities: ["場所探しに力になれる"],
  }),
  model,
  inputTokens: 10,
  outputTokens: 30,
});

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "contact_interactions", "contacts", "ai_usage_logs", "prompts", "app_config" CASCADE',
  );
  await seedDdPrompts(prisma);
});

describe("はじめの一手 (GET /api/relationship/first-moves)", () => {
  it("取り込んだきりの方が挙がり、会社のある方が仕事の一手として先頭に来る", async () => {
    const app = createApp({ prisma, generate: null });
    await prisma.contact.create({
      data: { ownerUid: "owner", name: "営業 太郎", company: "商事会社", title: "部長", email: "taro@example.com", source: "csv" },
    });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "白紙 四子", source: "csv" } });
    const res = await app.request("/api/relationship/first-moves", { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.moves.length).toBe(2);
    expect(body.moves[0].name).toBe("営業 太郎");
    expect(body.moves[0].kind).toBe("work");
    expect(body.moves[0].reason).toContain("商事会社");
    expect(body.moves[1].kind).toBe("enrich");
  });

  it("すでにやりとりの始まった方は挙げない", async () => {
    const app = createApp({ prisma, generate: null });
    const c = await prisma.contact.create({
      data: { ownerUid: "owner", name: "既知 花子", company: "会社", email: "hanako@example.com", source: "csv" },
    });
    await prisma.contactInteraction.create({
      data: { contactId: c.id, type: "meeting", occurredAt: new Date() },
    });
    const body = await (await app.request("/api/relationship/first-moves", { headers: H })).json();
    expect(body.moves).toEqual([]);
  });

  it("論点整理の貢献余地が理由に織り込まれる", async () => {
    const app = createApp({ prisma, generate: null });
    await prisma.contact.create({
      data: {
        ownerUid: "owner",
        name: "困り 次郎",
        email: "jiro@example.com",
        source: "csv",
        profileFacets: JSON.stringify({ opportunities: ["場所探しに力になれる"], goals: [] }),
      },
    });
    const body = await (await app.request("/api/relationship/first-moves", { headers: H })).json();
    expect(body.moves[0].kind).toBe("work");
    expect(body.moves[0].reason).toContain("場所探し");
  });
});

describe("取り込み直後の自動把握 (POST /api/admin/contacts/enrich-imports)", () => {
  it("材料のある方の論点整理が自動で進み、材料の無い方は飛ばす", async () => {
    const app = createApp({ prisma, generate: facetsGenerate });
    const rich = await prisma.contact.create({
      data: { ownerUid: "owner", name: "材料 有太", company: "商事会社", source: "csv" },
    });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "白紙 四子", source: "csv" } });
    const res = await app.request("/api/admin/contacts/enrich-imports?batch=5", { method: "POST", headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enriched).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.candidates).toBe(2);

    const saved = await prisma.contact.findUnique({ where: { id: rich.id } });
    const facets = JSON.parse(saved!.profileFacets!);
    expect(facets.opportunities).toContain("場所探しに力になれる");
    expect(saved!.profileFacetsAt).not.toBeNull();
  });

  it("すでに論点のある方は対象にしない (二重に AI を呼ばない)", async () => {
    const app = createApp({ prisma, generate: facetsGenerate });
    await prisma.contact.create({
      data: { ownerUid: "owner", name: "整理 済子", company: "会社", source: "csv", profileFacets: JSON.stringify({ summary: "済" }) },
    });
    const body = await (
      await app.request("/api/admin/contacts/enrich-imports", { method: "POST", headers: H })
    ).json();
    expect(body.candidates).toBe(0);
    expect(body.enriched).toBe(0);
  });

  it("AI 未設定なら 503 に縮退する", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await app.request("/api/admin/contacts/enrich-imports", { method: "POST", headers: H });
    expect(res.status).toBe(503);
  });
});
