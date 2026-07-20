// 関係を育てるとよい方々 + 距離の縮め方 (GET /api/relationship/growth) の結合テスト。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";

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
  await prisma.$executeRawUnsafe('TRUNCATE "offerings", "contacts", "contact_interactions", "suggestion_dismissals" CASCADE');
});

const makeApp = () => createApp({ prisma, generate: null });

describe("関係を育てるとよい方々 (GET /api/relationship/growth)", () => {
  it("伸びしろのある方を挙げ、申し出が刺されば「提示」の一手、会う一手を添える", async () => {
    const app = makeApp();
    // 申し出: 英語のレッスン
    await app.request("/api/offerings", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ title: "英語のレッスン", kind: "teach" }),
    });
    // ニーズ (英語を学びたい) がある・会社/メール/距離4 の方 → 育てるとよい + 申し出が刺さる
    const target = await prisma.contact.create({
      data: {
        ownerUid: "owner",
        name: "育成 田中",
        company: "青空商事",
        email: "tanaka@example.com",
        distance: 4,
        notes: "英語のレッスンを受けたいと話していた",
      },
    });
    // 手がかりの薄い遠い方 (閾値未満で出ない想定)
    await prisma.contact.create({ data: { ownerUid: "owner", name: "薄い 佐藤", distance: 5 } });

    const body = await (await app.request("/api/relationship/growth", { headers: H })).json();
    const item = (body.items as { contactId: string; moves: { kind: string; label: string }[]; email: string | null }[]).find(
      (x) => x.contactId === target.id,
    );
    expect(item, "育てるとよい方に挙がる").toBeTruthy();
    expect(item!.email).toBe("tanaka@example.com");
    expect(item!.moves.some((m) => m.kind === "catchup")).toBe(true);
    expect(item!.moves.some((m) => m.kind === "offer" && m.label.includes("英語のレッスン"))).toBe(true);
    expect(item!.moves.some((m) => m.kind === "meet")).toBe(true);
    // 薄い方は出ない
    expect((body.items as { name: string }[]).some((x) => x.name === "薄い 佐藤")).toBe(false);
  });

  it("認証必須", async () => {
    const app = makeApp();
    const res = await app.request("/api/relationship/growth");
    expect([401, 503]).toContain(res.status);
  });
});
