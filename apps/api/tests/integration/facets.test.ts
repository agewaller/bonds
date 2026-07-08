// 相手の論点整理 (/api/contacts/:id/facets) の結合テスト。偽 AI で JSON を返し、
// サニタイズして保存 → 詳細 API に平文で載る (DB は暗号文) ことを確かめる。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
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
    summary: "頼れる先輩。",
    contact: "夜はLINEが早い",
    status: "転職を検討中とのこと",
    work: "設計の仕事",
    family: "お子さんが二人",
    health: "",
    values: "誠実さを大事にしている",
    skills: ["設計", "後輩の育成"],
    concerns: ["転職の不安", "腰の痛み"],
    goals: ["独立したい"],
    likes: ["登山"],
    cautions: [],
    opportunities: ["転職先の紹介ができるかも"],
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
  await prisma.$executeRawUnsafe('TRUNCATE "contact_interactions", "contacts", "ai_usage_logs", "prompts", "app_config" CASCADE');
  await seedDdPrompts(prisma);
});

async function createContact() {
  const res = await prisma.contact.create({ data: { ownerUid: "owner", name: "田中先輩", personalProfile: "設計の仕事。腰痛持ち" } });
  return res;
}

describe("相手の論点整理 (facets)", () => {
  it("整理すると論点が保存され、詳細 API に平文で載る (DB は暗号文)", async () => {
    const app = createApp({ prisma, generate: facetsGenerate });
    const c = await createContact();
    const res = await app.request(`/api/contacts/${c.id}/facets`, { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facets.summary).toBe("頼れる先輩。");
    expect(body.facets.skills).toEqual(["設計", "後輩の育成"]);
    expect(body.facets.concerns).toContain("転職の不安");

    // 詳細 API で平文の JSON 文字列として返る
    const detail = await (await app.request(`/api/contacts/${c.id}`, { headers: H })).json();
    const parsed = JSON.parse(detail.contact.profileFacets);
    expect(parsed.family).toBe("お子さんが二人");

    // DB 上は暗号文
    const raw = await prisma.$queryRawUnsafe<{ profile_facets: string | null }[]>(
      'SELECT profile_facets FROM contacts WHERE id = $1',
      c.id,
    );
    expect(isEncrypted(raw[0]!.profile_facets!)).toBe(true);
  });

  it("AI 未設定なら 503 に縮退する", async () => {
    const app = createApp({ prisma, generate: null });
    const c = await createContact();
    const res = await app.request(`/api/contacts/${c.id}/facets`, { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(503);
  });

  it("存在しない相手は 404", async () => {
    const app = createApp({ prisma, generate: facetsGenerate });
    const res = await app.request("/api/contacts/nope/facets", { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(404);
  });
});
