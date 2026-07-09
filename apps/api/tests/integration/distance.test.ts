// 距離感の自動レーティング API の結合テスト — 提案の算出と適用。
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
  await prisma.$executeRawUnsafe('TRUNCATE "contacts", "contact_interactions", "ai_usage_logs", "prompts" CASCADE');
  await seedDdPrompts(prisma);
});

async function addContact(app: ReturnType<typeof createApp>, body: Record<string, unknown>): Promise<string> {
  const res = await app.request("/api/contacts", { method: "POST", headers: H, body: JSON.stringify(body) });
  return (await res.json()).contact.id;
}

describe("距離感の自動レーティング", () => {
  it("頻繁なやりとりの人は近い距離を提案し、適用すると distance が更新される", async () => {
    const app = createApp({ prisma, generate: null });
    // 遠め (4) で登録した相手に、直近まで何度もやりとりの記録を積む
    const id = await addContact(app, { name: "田中 太郎", distance: 4 });
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      const d = new Date(now - i * 2 * 86_400_000).toISOString(); // 隔日で30回
      await prisma.contactInteraction.create({ data: { contactId: id, type: "message", occurredAt: new Date(d) } });
    }

    const sug = await (await app.request("/api/relationship/distance-suggestions", { headers: H })).json();
    const mine = sug.suggestions.find((s: { contactId: string }) => s.contactId === id);
    expect(mine).toBeTruthy();
    expect(mine.current).toBe(4);
    expect(mine.suggested).toBeLessThan(4); // もっと近いはず
    expect(typeof mine.reason).toBe("string");

    // 適用
    const apply = await app.request("/api/relationship/apply-distances", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ ids: [id] }),
    });
    expect((await apply.json()).applied).toBe(1);
    const after = await prisma.contact.findUnique({ where: { id } });
    expect(after!.distance).toBe(mine.suggested);
  });

  it("手がかりが乏しい人 (接触なし) は提案に出さない (勝手に上書きしない)", async () => {
    const app = createApp({ prisma, generate: null });
    await addContact(app, { name: "名刺だけ 花子", distance: 4 });
    const sug = await (await app.request("/api/relationship/distance-suggestions", { headers: H })).json();
    expect(sug.suggestions).toHaveLength(0);
    expect(sug.total).toBe(1);
  });

  it("ids 無指定なら確信のある提案をすべて適用する", async () => {
    const app = createApp({ prisma, generate: null });
    const a = await addContact(app, { name: "近い Aさん", distance: 5 });
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      await prisma.contactInteraction.create({
        data: { contactId: a, type: "call", occurredAt: new Date(now - i * 86_400_000) },
      });
    }
    const apply = await app.request("/api/relationship/apply-distances", { method: "POST", headers: H, body: "{}" });
    expect((await apply.json()).applied).toBeGreaterThanOrEqual(1);
  });
});
