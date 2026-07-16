// 大切にしたい方々 (focus) と名寄せの自動実行 (auto-merge) の結合テスト。
// 死んだリストは一覧に出さず、メール/電話一致の同一人物は黙ってまとまることを確かめる。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
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
    'TRUNCATE "contact_interactions", "contact_gifts", "exchanges", "contacts", "ai_usage_logs", "prompts", "app_config" CASCADE',
  );
  await seedDdPrompts(prisma);
});

describe("大切にしたい方々 (GET /api/relationship/focus)", () => {
  it("やりとりのある方だけが選ばれ、死んだ名簿は出ない (総数は返す)", async () => {
    const app = createApp({ prisma, generate: null });
    const alive = await prisma.contact.create({
      data: { ownerUid: "owner", name: "交流 花子", source: "manual", distance: 2, email: "hanako@example.com" },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.contactInteraction.create({
        data: { contactId: alive.id, type: "message", occurredAt: new Date(Date.now() - i * 86_400_000) },
      });
    }
    for (let i = 0; i < 20; i++) {
      await prisma.contact.create({ data: { ownerUid: "owner", name: `名簿 ${i}号`, source: "facebook" } });
    }
    const body = await (await app.request("/api/relationship/focus", { headers: H })).json();
    expect(body.total).toBe(21);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("交流 花子");
    expect(body.items[0].reasons.length).toBeGreaterThan(0);
  });
});

describe("名寄せの自動実行 (POST /api/admin/contacts/auto-merge)", () => {
  it("メールが同じ二人は情報の厚い方に自動でまとまり、記録も引き継がれる", async () => {
    const app = createApp({ prisma, generate: null });
    const rich = await prisma.contact.create({
      data: { ownerUid: "owner", name: "山田 太郎", email: "taro@example.com", company: "商事会社", title: "部長", source: "eight" },
    });
    const thin = await prisma.contact.create({
      data: { ownerUid: "owner", name: "山田太郎", email: "TARO@example.com", phone: "090-1111-2222", source: "google" },
    });
    await prisma.contactInteraction.create({
      data: { contactId: thin.id, type: "message", occurredAt: new Date() },
    });
    const res = await app.request("/api/admin/contacts/auto-merge", { method: "POST", headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mergedGroups).toBe(1);
    expect(body.mergedContacts).toBe(1);

    const survivor = await prisma.contact.findUnique({ where: { id: rich.id } });
    expect(survivor!.state).toBe("active");
    expect(survivor!.phone).toBe("090-1111-2222"); // 空欄は補完される
    const archived = await prisma.contact.findUnique({ where: { id: thin.id } });
    expect(archived!.state).toBe("archived");
    // 接触記録は残る方へ付け替え
    expect(await prisma.contactInteraction.count({ where: { contactId: rich.id } })).toBe(1);
  });

  it("名前だけが同じ二人は自動でまとめない (同姓同名の別人を守る)", async () => {
    const app = createApp({ prisma, generate: null });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "田中一郎", email: "a@example.com" } });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "田中一郎", email: "b@example.com" } });
    const body = await (
      await app.request("/api/admin/contacts/auto-merge", { method: "POST", headers: H })
    ).json();
    expect(body.mergedGroups).toBe(0);
    expect(await prisma.contact.count({ where: { state: "active" } })).toBe(2);
  });

  it("別のユーザー (ownerUid) の同じメールはまとめない", async () => {
    const app = createApp({ prisma, generate: null });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "共有 一子", email: "same@example.com" } });
    await prisma.contact.create({ data: { ownerUid: "someone-else", name: "共有 一子", email: "same@example.com" } });
    const body = await (
      await app.request("/api/admin/contacts/auto-merge", { method: "POST", headers: H })
    ).json();
    expect(body.mergedGroups).toBe(0);
  });
});
