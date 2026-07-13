// こじれ・疎遠の検知 API の結合テスト — 途絶えている近しい関係を拾い、無関係な相手は出さない。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";

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
  await prisma.$executeRawUnsafe('TRUNCATE "contact_interactions", "contacts" CASCADE');
});

async function addContact(app: ReturnType<typeof createApp>, name: string, distance: number) {
  const res = await app.request("/api/contacts", { method: "POST", headers: H, body: JSON.stringify({ name, distance }) });
  return (await res.json()).contact.id as string;
}
async function touch(contactId: string, daysAgo: number) {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  await prisma.contactInteraction.create({ data: { contactId, type: "message", occurredAt: at } });
}

describe("こじれ・疎遠の検知 (/api/relationship/drift)", () => {
  it("近しい相手 (距離2) の連絡が長く途絶えていれば拾い、最近の相手は拾わない", async () => {
    const app = createApp({ prisma, generate: null });
    const faded = await addContact(app, "疎遠 花子", 2);
    await touch(faded, 90); // 距離2の適正7日を大きく超える
    const fresh = await addContact(app, "最近 太郎", 2);
    await touch(fresh, 3);

    const res = await app.request("/api/relationship/drift", { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.items.map((x: { name: string }) => x.name);
    expect(names).toContain("疎遠 花子");
    expect(names).not.toContain("最近 太郎");
    const item = body.items.find((x: { name: string }) => x.name === "疎遠 花子");
    expect(item.kind).toBe("faded");
    expect(item.daysSince).toBeGreaterThanOrEqual(89);
  });

  it("連絡先が無ければ空", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await app.request("/api/relationship/drift", { headers: H });
    expect((await res.json()).items).toEqual([]);
  });
});
