// 優先リストのカスタムと自動ケアの結合テスト:
// くり返し取込での source_hits 加算、pinned/excluded の意思、focus のカスタム項目、
// priority-care sweep の提案生成 (冪等・見送りの尊重)、提案の解決。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "care_suggestions", "contact_interactions", "contact_gifts", "exchanges", "contacts", "ai_usage_logs", "prompts", "app_config" CASCADE',
  );
  await seedDdPrompts(prisma);
});

const makeApp = () => createApp({ prisma, generate: null });

describe("くり返し登場のカウント (source_hits)", () => {
  it("同じ方が別の取込で再登場すると加算され、優先リストの理由になる", async () => {
    const app = makeApp();
    const csv = "氏名,メール\n重複 登,noboru@example.com";
    for (let i = 0; i < 3; i++) {
      await app.request("/api/contacts/import", { method: "POST", headers: H, body: JSON.stringify({ content: csv }) });
    }
    const ct = await prisma.contact.findFirst({ where: { name: "重複 登" } });
    expect(ct!.sourceHits).toBe(3);

    // やりとりを足して閾値を越えると、理由に「くり返し登場」が出る
    await prisma.contactInteraction.create({ data: { contactId: ct!.id, type: "message", occurredAt: new Date() } });
    const focus = await (await app.request("/api/relationship/focus", { headers: H })).json();
    const item = focus.items.find((x: { contactId: string }) => x.contactId === ct!.id);
    expect(item?.reasons).toContain("取り込みにくり返し登場");
  });
});

describe("優先リストのカスタム (focus-preference と同梱項目)", () => {
  it("pinned は材料が無くても載り、excluded は消える。距離感と目標が同梱される", async () => {
    const app = makeApp();
    const weak = await prisma.contact.create({ data: { ownerUid: "owner", name: "静か 一郎", source: "facebook" } });
    const strong = await prisma.contact.create({
      data: { ownerUid: "owner", name: "交流 花子", source: "manual", distance: 2, email: "h@example.com" },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.contactInteraction.create({ data: { contactId: strong.id, type: "message", occurredAt: new Date() } });
    }

    // 弱い方をピン留め → 必ず載る
    const pin = await app.request(`/api/contacts/${weak.id}/focus-preference`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ preference: "pinned" }),
    });
    expect(pin.status).toBe(200);
    let focus = await (await app.request("/api/relationship/focus", { headers: H })).json();
    expect(focus.items.map((x: { contactId: string }) => x.contactId)).toContain(weak.id);
    const strongItem = focus.items.find((x: { contactId: string }) => x.contactId === strong.id);
    expect(strongItem.distance).toBe(2);
    expect(strongItem.goal).toBeNull();

    // 強い方を外す → 消える (記録は残る)
    await app.request(`/api/contacts/${strong.id}/focus-preference`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ preference: "excluded" }),
    });
    focus = await (await app.request("/api/relationship/focus", { headers: H })).json();
    expect(focus.items.map((x: { contactId: string }) => x.contactId)).not.toContain(strong.id);
    expect(await prisma.contact.count({ where: { id: strong.id, state: "active" } })).toBe(1);
  });
});

describe("優先度に基づく自動ケア (POST /api/admin/relationship/priority-care)", () => {
  const seedFocusContact = async () => {
    const ct = await prisma.contact.create({
      data: { ownerUid: "owner", name: "大切 花子", source: "manual", distance: 2, email: "hana@example.com" },
    });
    // 昔のやりとりだけ → 「間が空いている」一手が出る形
    for (let i = 0; i < 5; i++) {
      await prisma.contactInteraction.create({
        data: { contactId: ct.id, type: "message", occurredAt: new Date(Date.now() - (100 + i) * 86_400_000) },
      });
    }
    return ct;
  };

  it("提案が受け箱に入り (暗号化)、再実行しても重ならず、見送り後 30 日はそっとしておく", async () => {
    const app = makeApp();
    const ct = await seedFocusContact();
    const r1 = await (await app.request("/api/admin/relationship/priority-care", { method: "POST", headers: H })).json();
    expect(r1.suggested).toBeGreaterThan(0);

    // 本文は DB 上暗号化
    const raw = await prisma.$queryRawUnsafe<{ body: string }[]>("SELECT body FROM care_suggestions LIMIT 1");
    expect(isEncrypted(raw[0]!.body)).toBe(true);

    // 一覧に名前つきで出る
    const list = await (await app.request("/api/relationship/care-suggestions", { headers: H })).json();
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items[0].name).toBe("大切 花子");
    expect(list.items.some((x: { kind: string }) => x.kind === "reach_out")).toBe(true);

    // 再実行しても同じ提案は重ならない
    const before = await prisma.careSuggestion.count();
    await app.request("/api/admin/relationship/priority-care", { method: "POST", headers: H });
    expect(await prisma.careSuggestion.count()).toBe(before);

    // 見送り → すぐの再実行では出し直さない
    const target = list.items.find((x: { kind: string }) => x.kind === "reach_out");
    const resolved = await app.request(`/api/relationship/care-suggestions/${target.id}/resolve`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ status: "dismissed" }),
    });
    expect(resolved.status).toBe(200);
    await app.request("/api/admin/relationship/priority-care", { method: "POST", headers: H });
    const again = await prisma.careSuggestion.findMany({ where: { contactId: ct.id, kind: "reach_out", status: "proposed" } });
    expect(again).toHaveLength(0);
  });

  it("batch=0 は提案だけを置き、AI を一切呼ばない (監査・動作確認用の速い経路)", async () => {
    let aiCalls = 0;
    const app = createApp({
      prisma,
      generate: async () => {
        aiCalls++;
        return { text: "{}", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1 };
      },
    });
    const ct = await seedFocusContact();
    // 材料 (会社) を足して、AI 整理の対象になりうる状態にしておく
    await prisma.contact.update({ where: { id: ct.id }, data: { company: "商事会社" } });
    const r = await (
      await app.request("/api/admin/relationship/priority-care?batch=0", { method: "POST", headers: H })
    ).json();
    expect(r.suggested).toBeGreaterThan(0);
    expect(r.enriched).toBe(0);
    expect(aiCalls).toBe(0);
  });

  it("excluded にすると未対応の提案も片付き、以後は対象にならない", async () => {
    const app = makeApp();
    const ct = await seedFocusContact();
    await app.request("/api/admin/relationship/priority-care", { method: "POST", headers: H });
    expect(await prisma.careSuggestion.count({ where: { contactId: ct.id, status: "proposed" } })).toBeGreaterThan(0);

    await app.request(`/api/contacts/${ct.id}/focus-preference`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ preference: "excluded" }),
    });
    expect(await prisma.careSuggestion.count({ where: { contactId: ct.id, status: "proposed" } })).toBe(0);
    const r = await (await app.request("/api/admin/relationship/priority-care", { method: "POST", headers: H })).json();
    expect(r.suggested).toBe(0);
  });
});
