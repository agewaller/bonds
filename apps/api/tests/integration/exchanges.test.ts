// やり取り台帳 (exchanges) API の結合テスト — 記録・収支・督促・改ざん検知・接触還流。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "exchanges", "contact_interactions", "contacts", "ai_usage_logs", "prompts" CASCADE',
  );
  await seedDdPrompts(prisma);
});

async function addContact(app: ReturnType<typeof createApp>, body: Record<string, unknown>): Promise<string> {
  const res = await app.request("/api/contacts", { method: "POST", headers: H, body: JSON.stringify(body) });
  return (await res.json()).contact.id;
}

describe("Exchange: 記録と接触還流", () => {
  it("完了済みのやり取りを記録すると接触にも還流する / title は暗号化される", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "佐藤 太郎" });
    const res = await app.request(`/api/contacts/${id}/exchanges`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "deal", direction: "outbound", title: "資料一式を納品", value: 50000, status: "done" }),
    });
    expect(res.status).toBe(201);
    const ex = (await res.json()).exchange;
    expect(ex.hash).toBeTruthy();
    // 接触として還流している
    expect(await prisma.contactInteraction.count({ where: { contactId: id, type: "exchange_out" } })).toBe(1);
    // title は DB 上で暗号文
    const raw = await prisma.$queryRawUnsafe<{ title: string }[]>("SELECT title FROM exchanges WHERE id = $1", ex.id);
    expect(isEncrypted(raw[0]!.title)).toBe(true);
  });

  it("open (約束/貸し) は接触に還流しない", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "鈴木 花子" });
    await app.request(`/api/contacts/${id}/exchanges`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "promise", direction: "outbound", title: "本を貸す約束", status: "open" }),
    });
    expect(await prisma.contactInteraction.count({ where: { contactId: id } })).toBe(0);
  });

  it("title が空なら 400", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "田中 一郎" });
    const res = await app.request(`/api/contacts/${id}/exchanges`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "gift", title: "  " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Exchange: 台帳と督促 (/api/exchanges)", () => {
  it("相手ごとに収支を集計し、期日の近い open を督促に出す", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "山田 次郎" });
    await app.request(`/api/contacts/${id}/exchanges`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "loan", direction: "inbound", title: "1万円借りた", value: 10000, status: "done" }),
    });
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    await app.request(`/api/contacts/${id}/exchanges`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "loan", direction: "inbound", title: "本を借りている", status: "open", dueAt: soon.toISOString() }),
    });
    const body = await (await app.request("/api/exchanges", { headers: H })).json();
    expect(body.ledgers).toHaveLength(1);
    expect(body.ledgers[0].contactName).toBe("山田 次郎");
    expect(body.ledgers[0].ledger.inboundValue).toBe(10000);
    expect(body.ledgers[0].ledger.openCount).toBe(1);
    // 督促
    expect(body.reminders.length).toBe(1);
    expect(body.reminders[0].title).toBe("本を借りている");
  });
});

describe("Exchange: 改ざん検知 (/api/exchanges/verify)", () => {
  it("正しく連なった台帳は intact、DB を直接書き換えると壊れたと分かる", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "高橋 三郎" });
    await app.request(`/api/contacts/${id}/exchanges`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "gift", direction: "outbound", title: "一件目", value: 1000, status: "done" }),
    });
    const r2 = await app.request(`/api/contacts/${id}/exchanges`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "gift", direction: "outbound", title: "二件目", value: 2000, status: "done" }),
    });
    const ex2 = (await r2.json()).exchange;
    let v = await (await app.request("/api/exchanges/verify", { headers: H })).json();
    expect(v.intact).toBe(true);
    expect(v.count).toBe(2);

    // DB 上で二件目の value を直接改ざん (hash は据え置き)
    await prisma.$executeRawUnsafe("UPDATE exchanges SET value = 999999 WHERE id = $1", ex2.id);
    v = await (await app.request("/api/exchanges/verify", { headers: H })).json();
    expect(v.intact).toBe(false);
    expect(v.brokenAt).toBe(1);
  });
});

describe("Exchange: 更新・削除", () => {
  it("状態を done に更新し、削除できる", async () => {
    const app = createApp({ prisma, generate: null });
    const id = await addContact(app, { name: "伊藤 四郎" });
    const created = (await (
      await app.request(`/api/contacts/${id}/exchanges`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ kind: "promise", direction: "outbound", title: "紹介する約束", status: "open" }),
      })
    ).json()).exchange;
    const upd = await app.request(`/api/exchanges/${created.id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ status: "done" }),
    });
    expect((await upd.json()).exchange.status).toBe("done");
    const del = await app.request(`/api/exchanges/${created.id}`, { method: "DELETE", headers: H });
    expect(del.status).toBe(200);
    expect(await prisma.exchange.count()).toBe(0);
  });
});
