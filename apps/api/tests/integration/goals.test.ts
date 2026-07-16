// 関係の目標の結合テスト: 設定 (暗号化保存)・詳細への同梱・一覧 (差と次の一手)・削除・
// 「対応を考える」への接地 (プロンプトの文脈に目標が入る)。
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

describe("関係の目標 (PUT/DELETE /api/contacts/:id/goal)", () => {
  it("目標を設定すると暗号化で保存され、詳細に計画つきで載る", async () => {
    const app = createApp({ prisma, generate: null });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "営業 太郎", distance: 4 } });
    const res = await app.request(`/api/contacts/${ct.id}/goal`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ purpose: "business", targetDistance: 2, note: "来期の協業につなげたい" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.goal.startDistance).toBe(4);
    expect(body.plan.direction).toBe("closer");
    expect(body.plan.nextMove).toContain("情報や記事");

    // DB 上は暗号文
    const raw = await prisma.$queryRawUnsafe<{ goal: string | null }[]>(
      "SELECT goal FROM contacts WHERE id = $1",
      ct.id,
    );
    expect(isEncrypted(raw[0]!.goal!)).toBe(true);

    // 詳細 API に goal と goalPlan が同梱される
    const detail = await (await app.request(`/api/contacts/${ct.id}`, { headers: H })).json();
    expect(detail.goal.purpose).toBe("business");
    expect(detail.goalPlan.direction).toBe("closer");
  });

  it("目標の微調整では進捗の基準 (設定時の距離) を引き継ぎ、削除で消える", async () => {
    const app = createApp({ prisma, generate: null });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "友人 花子", distance: 4 } });
    await app.request(`/api/contacts/${ct.id}/goal`, {
      method: "PUT", headers: H, body: JSON.stringify({ purpose: "friend", targetDistance: 2 }),
    });
    // 距離が縮まったあとに目標を変えても、基準は最初の 4 のまま
    await prisma.contact.update({ where: { id: ct.id }, data: { distance: 3 } });
    const second = await (
      await app.request(`/api/contacts/${ct.id}/goal`, {
        method: "PUT", headers: H, body: JSON.stringify({ purpose: "friend", targetDistance: 1 }),
      })
    ).json();
    expect(second.goal.startDistance).toBe(4);
    expect(second.plan.progress).toBe(1);

    const del = await app.request(`/api/contacts/${ct.id}/goal`, { method: "DELETE", headers: H });
    expect(del.status).toBe(200);
    const detail = await (await app.request(`/api/contacts/${ct.id}`, { headers: H })).json();
    expect(detail.goal).toBeNull();
  });

  it("不正な入力は 400", async () => {
    const app = createApp({ prisma, generate: null });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "誰か" } });
    const res = await app.request(`/api/contacts/${ct.id}/goal`, {
      method: "PUT", headers: H, body: JSON.stringify({ purpose: "business", targetDistance: 9 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("目標の一覧 (GET /api/relationship/goals)", () => {
  it("目標を持つ方だけが、間が空いた方を先頭に並ぶ", async () => {
    const app = createApp({ prisma, generate: null });
    const fresh = await prisma.contact.create({ data: { ownerUid: "owner", name: "最近 会太", distance: 3 } });
    const stale = await prisma.contact.create({ data: { ownerUid: "owner", name: "無沙汰 久子", distance: 3 } });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "目標なし" } });
    for (const [id, daysAgo] of [
      [fresh.id, 1],
      [stale.id, 60],
    ] as const) {
      await prisma.contactInteraction.create({
        data: { contactId: id, type: "message", occurredAt: new Date(Date.now() - daysAgo * 86_400_000) },
      });
      await app.request(`/api/contacts/${id}/goal`, {
        method: "PUT", headers: H, body: JSON.stringify({ purpose: "friend", targetDistance: 2 }),
      });
    }
    const body = await (await app.request("/api/relationship/goals", { headers: H })).json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].name).toBe("無沙汰 久子");
    expect(body.items[0].plan.overdue).toBe(true);
    expect(body.items[0].purposeLabel).toBe("友人・プライベート");
  });
});

describe("目標の接地 (対応を考える)", () => {
  it("playbook の文脈に目標が入り、提案が目標に沿う前提になる", async () => {
    let captured = "";
    const fake: GenerateFn = async ({ model, userMessage }) => {
      captured = userMessage;
      return {
        text: JSON.stringify({ relationship: "良い関係です。", intersections: [], actions: [], somethingNew: "", caution: "" }),
        model,
        inputTokens: 10,
        outputTokens: 20,
      };
    };
    const app = createApp({ prisma, generate: fake });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "営業 太郎", distance: 4 } });
    await app.request(`/api/contacts/${ct.id}/goal`, {
      method: "PUT", headers: H, body: JSON.stringify({ purpose: "business", targetDistance: 2, note: "協業したい" }),
    });
    const res = await app.request(`/api/contacts/${ct.id}/playbook`, { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(200);
    expect(captured).toContain("この関係の目標");
    expect(captured).toContain("協業したい");
  });
});
