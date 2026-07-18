// テスト・監査データの片づけ (名前が「監査」で始まるものを owner バケツから掃除)。
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
  await prisma.$executeRawUnsafe(
    'TRUNCATE "schedule_shares", "time_offers", "dd_subjects", "partner_targets", "contacts" CASCADE',
  );
});

const makeApp = () => createApp({ prisma, generate: null });

describe("テストデータの片づけ (/api/admin/audit-data)", () => {
  it("「監査」で始まるものだけを拾い、実在データは触らない。連絡先はアーカイブ", async () => {
    const app = makeApp();
    // 監査フィクスチャ + 実在データを混ぜて作る
    await prisma.contact.createMany({
      data: [
        { ownerUid: "owner", name: "監査 太郎" },
        { ownerUid: "owner", name: "監査ノート 岡本" },
        { ownerUid: "owner", name: "山田 花子" }, // 実在 (残す)
      ],
    });
    await prisma.ddSubject.createMany({
      data: [
        { slug: "kansa-shibusawa", name: "監査用 渋沢栄一" },
        { slug: "shibusawa", name: "渋沢栄一" }, // 実在 (残す)
      ],
    });
    await prisma.scheduleShare.create({
      data: {
        ownerUid: "owner",
        shareKey: "k1",
        title: "監査のお打ち合わせ",
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    await prisma.timeOffer.create({
      data: { ownerUid: "owner", offerKey: "o1", title: "監査の30分ご相談", minutes: 30, priceJpy: 0 },
    });

    // 件数の確認 (dry run)
    const view = await (await app.request("/api/admin/audit-data", { headers: H })).json();
    expect(view.total).toBe(5); // 連絡先2 + 人物1 + 共有1 + 出品1
    expect(view.contacts).toBe(2);
    expect(view.subjects).toBe(1);
    expect(view.sample).toContain("監査 太郎");

    // 片づけ
    const purged = await (await app.request("/api/admin/audit-data/purge", { method: "POST", headers: H, body: "{}" })).json();
    expect(purged.archivedContacts).toBe(2);
    expect(purged.deletedSubjects).toBe(1);
    expect(purged.deletedShares).toBe(1);
    expect(purged.deletedOffers).toBe(1);

    // 実在データは残る。監査の連絡先はアーカイブ (active から消える)
    const activeContacts = await prisma.contact.findMany({ where: { state: "active" } });
    expect(activeContacts.map((c) => c.name)).toEqual(["山田 花子"]);
    expect(await prisma.ddSubject.count()).toBe(1); // 渋沢栄一 が残る
    expect(await prisma.scheduleShare.count()).toBe(0);
    expect(await prisma.timeOffer.count()).toBe(0);
    // アーカイブなので連絡先の行自体は残る (30日以内は復元可能)
    expect(await prisma.contact.count()).toBe(3);

    // もう一度見ると 0 件
    const after = await (await app.request("/api/admin/audit-data", { headers: H })).json();
    expect(after.total).toBe(0);
  });

  it("認証必須 (トークン無しは 401/503)", async () => {
    const app = makeApp();
    const r = await app.request("/api/admin/audit-data");
    expect([401, 503]).toContain(r.status);
  });
});
