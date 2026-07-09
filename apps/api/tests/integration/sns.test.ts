// SNS 情報 API の結合テスト — 構造化保存/参照・暗号化・近況把握 (公開検索は明示時のみ)。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";
import type { SearchFn } from "../../src/lib/tavily.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
delete process.env.PERSON_DD_MONTHLY_CAP_JPY;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "contacts", "contact_interactions", "ai_usage_logs", "prompts", "app_config" CASCADE');
  await seedDdPrompts(prisma);
});

async function addContact(app: ReturnType<typeof createApp>, body: Record<string, unknown>): Promise<string> {
  const res = await app.request("/api/contacts", { method: "POST", headers: H, body: JSON.stringify(body) });
  return (await res.json()).contact.id;
}

describe("SNS: 構造化保存と参照", () => {
  it("URL を保存すると platform ごとに構造化して返す / sns は暗号化される", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "渋沢 栄一" });
    const put = await app.request(`/api/contacts/${id}/sns`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ raw: "https://x.com/shibusawa_e\nnote: eiichi_note" }),
    });
    expect(put.status).toBe(200);
    const accounts = (await put.json()).accounts;
    expect(accounts.map((a: { platform: string }) => a.platform).sort()).toEqual(["note", "x"]);

    // 参照でも同じ構造で返る
    const get = await app.request(`/api/contacts/${id}/sns`, { headers: H });
    expect((await get.json()).accounts).toHaveLength(2);

    // DB 上は暗号文
    const raw = await prisma.$queryRawUnsafe<{ sns: string }[]>("SELECT sns FROM contacts WHERE id = $1", id);
    expect(isEncrypted(raw[0]!.sns)).toBe(true);
  });

  it("構造化配列でも受け取れる", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "山田 太郎" });
    const put = await app.request(`/api/contacts/${id}/sns`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ accounts: [{ url: "https://www.instagram.com/taro/" }] }),
    });
    expect((await put.json()).accounts[0].platform).toBe("instagram");
  });
});

describe("SNS: 近況把握 (相手ノート)", () => {
  const fakeAi: GenerateFn = async ({ model }) => ({
    text: JSON.stringify({ digest: "最近は新しいお仕事を始められたご様子で、前向きに過ごしておられます" }),
    model,
    inputTokens: 50,
    outputTokens: 30,
  });

  it("includePublic のときだけ、SNS ハンドルを軸に公開情報を検索して近況をまとめる", async () => {
    const searched: string[] = [];
    const fakeSearch: SearchFn = async (q) => {
      searched.push(q);
      return [{ title: "新会社を設立", url: "https://x.com/shibusawa_e/status/1", snippet: "新しい挑戦を始めました" }];
    };
    const app = createApp({ prisma, generate: fakeAi, search: fakeSearch });
    const id = await addContact(app, { name: "渋沢 栄一" });
    await app.request(`/api/contacts/${id}/sns`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ raw: "https://x.com/shibusawa_e" }),
    });
    const res = await app.request(`/api/contacts/${id}/refresh-digest`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ includePublic: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.searched).toBe(true);
    expect(body.digest).toContain("お仕事");
    // 検索クエリにハンドルが含まれる (別人を拾いにくくする)
    expect(searched.some((q) => q.includes("shibusawa_e"))).toBe(true);
  });

  it("includePublic を付けなければ検索しない (相手の尊厳: 自動巡回しない)", async () => {
    let called = 0;
    const fakeSearch: SearchFn = async () => {
      called++;
      return [];
    };
    const app = createApp({ prisma, generate: fakeAi, search: fakeSearch });
    const id = await addContact(app, { name: "山田 太郎" });
    await app.request(`/api/contacts/${id}/sns`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ raw: "https://x.com/yamada" }),
    });
    const res = await app.request(`/api/contacts/${id}/refresh-digest`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).searched).toBe(false);
    expect(called).toBe(0);
  });
});
