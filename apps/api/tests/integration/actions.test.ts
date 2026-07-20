// 実行待ち (受け入れた提案の在庫) の結合テスト。実テスト DB (bonds_test)。
// 「受け入れたら貯まる」「同じ提案の二重受け入れは 1 件」「済み/見送り/削除が 1 件単位」
// 「暗号化 at-rest」「ownerUid 分離」を守る。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient();
  await seedDdPrompts(prisma);
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "action_items", "contact_interactions", "contacts" CASCADE');
});

const makeApp = () => createApp({ prisma, generate: null });

describe("実行待ち /api/actions", () => {
  it("受け入れた提案が貯まり、種類別 (連絡→会う→贈り物→申し出) に相手の名前つきで並ぶ", async () => {
    const app = makeApp();
    const c = await (
      await app.request("/api/contacts", {
        method: "POST", headers: H,
        body: JSON.stringify({ name: "田中太郎", distance: 3, email: "tanaka@example.com" }),
      })
    ).json();
    const mk = (kind: string, title: string) =>
      app.request("/api/actions", {
        method: "POST", headers: H,
        body: JSON.stringify({ kind, title, contactId: c.contact.id }),
      });
    expect((await mk("gift", "お中元を選ぶ")).status).toBe(201);
    expect((await mk("email", "近況伺いのメール")).status).toBe(201);
    expect((await mk("meet", "面談の候補日を送る")).status).toBe(201);
    const list = await (await app.request("/api/actions", { headers: H })).json();
    expect(list.items.map((x: { kind: string }) => x.kind)).toEqual(["email", "meet", "gift"]);
    expect(list.items[0].name).toBe("田中太郎");
    expect(list.items[0].email).toBe("tanaka@example.com");
    expect(list.items[0].kindLabel).toBe("連絡する");
    // at-rest 暗号化 (title)
    const raw = await prisma.$queryRawUnsafe<Array<{ title: string }>>("SELECT title FROM action_items LIMIT 1");
    expect(isEncrypted(raw[0]!.title)).toBe(true);
  });

  it("同じ提案 (source) の二重受け入れは 1 件のまま。済みにした後の再受け入れは pending に戻る", async () => {
    const app = makeApp();
    const body = JSON.stringify({ kind: "offer", title: "英語のレッスンを申し出る", sourceKind: "offering", sourceKey: "o1:c1" });
    const first = await app.request("/api/actions", { method: "POST", headers: H, body });
    expect(first.status).toBe(201);
    const again = await app.request("/api/actions", { method: "POST", headers: H, body });
    expect(again.status).toBe(200);
    expect(await prisma.actionItem.count()).toBe(1);
    // 済みにする → 一覧から消える
    const id = (await first.json()).action.id;
    await app.request(`/api/actions/${id}`, { method: "PUT", headers: H, body: JSON.stringify({ status: "done" }) });
    expect((await (await app.request("/api/actions", { headers: H })).json()).items).toHaveLength(0);
    // もう一度受け入れると pending に戻る (新しい行は作らない)
    await app.request("/api/actions", { method: "POST", headers: H, body });
    expect(await prisma.actionItem.count()).toBe(1);
    expect((await (await app.request("/api/actions", { headers: H })).json()).items).toHaveLength(1);
  });

  it("見送り・削除は 1 件単位。題名なしは 400・未認証は 401・他人の連絡先は 404", async () => {
    const app = makeApp();
    const created = await (
      await app.request("/api/actions", {
        method: "POST", headers: H, body: JSON.stringify({ kind: "other", title: "電話をかける" }),
      })
    ).json();
    await app.request(`/api/actions/${created.action.id}`, {
      method: "PUT", headers: H, body: JSON.stringify({ status: "dismissed" }),
    });
    expect((await (await app.request("/api/actions", { headers: H })).json()).items).toHaveLength(0);
    expect((await app.request(`/api/actions/${created.action.id}`, { method: "DELETE", headers: H })).status).toBe(200);
    expect(await prisma.actionItem.count()).toBe(0);
    expect(
      (await app.request("/api/actions", { method: "POST", headers: H, body: JSON.stringify({ kind: "email" }) })).status,
    ).toBe(400);
    expect(
      (
        await app.request("/api/actions", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "x" }),
        })
      ).status,
    ).toBe(401);
    const other = await prisma.contact.create({ data: { ownerUid: "someone-else", name: "他人", distance: 3 } });
    expect(
      (
        await app.request("/api/actions", {
          method: "POST", headers: H, body: JSON.stringify({ title: "x", contactId: other.id }),
        })
      ).status,
    ).toBe(404);
  });
});
