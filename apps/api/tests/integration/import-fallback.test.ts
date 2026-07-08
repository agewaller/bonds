// 貼り付け取込 (/api/contacts/import) の AI フォールバックの結合テスト。
// 構造化パーサ (CSV/vCard) で 1 件も拾えない内容 (自由な名簿・未知の列並び) でも、
// AI 抽出 (import_extract) に回して人物を拾えることを確かめる (Eight など救済の要)。
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

// import_extract に対して people JSON を返す偽 AI。
const peopleGenerate: GenerateFn = async ({ model }) => ({
  text: JSON.stringify({
    people: [
      { name: "田中一郎", company: "田中商店", note: "先日お会いした" },
      { name: "佐藤花子", email: "hanako@example.com" },
    ],
  }),
  model,
  inputTokens: 10,
  outputTokens: 20,
});

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "contact_interactions", "contacts", "ai_usage_logs", "prompts", "app_config" CASCADE');
  await seedDdPrompts(prisma);
});

describe("貼り付け取込の AI フォールバック", () => {
  it("構造化で拾えない自由な名簿でも AI 抽出で人物を取り込む", async () => {
    const app = createApp({ prisma, generate: peopleGenerate });
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: "先日、田中商店の田中一郎さんと佐藤花子さんにお会いしました。" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    const names = (await prisma.contact.findMany({ select: { name: true } })).map((c) => c.name).sort();
    expect(names).toEqual(["佐藤花子", "田中一郎"]);
  });

  it("AI が未設定なら 503 に縮退する (黙って 0 件成功にしない)", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: "名前の列がない自由な文章です" }),
    });
    expect(res.status).toBe(503);
  });

  it("氏名列のある CSV は従来どおり構造化取込 (AI を呼ばない)", async () => {
    const app = createApp({ prisma, generate: null }); // AI 無しでも通る = 構造化で拾えている証拠
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: "氏名,会社名\n近藤五郎,エイト商事" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toBe(1);
  });
});
