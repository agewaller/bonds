// データ所在の診断 (読み取り専用) — バケツ別の連絡先件数と、呼び出し元の解決先を返す。
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
  await prisma.$executeRawUnsafe('TRUNCATE "contacts" CASCADE');
});

describe("データ所在の診断 (/api/admin/data-locator)", () => {
  it("ownerUid バケツ別に active/archived を集計し、呼び出し元の解決先を返す", async () => {
    const app = createApp({ prisma, generate: null });
    // owner バケツに実データ相当を多め、別 uid バケツに少なめ、監査は archived
    await prisma.contact.createMany({
      data: [
        ...Array.from({ length: 5 }, (_, i) => ({ ownerUid: "owner", name: `本物 ${i}` })),
        { ownerUid: "owner", name: "監査アーカイブ", state: "archived" },
        { ownerUid: "firebase-uid-xyz", name: "別バケツ 田中" },
      ],
    });
    const res = await app.request("/api/admin/data-locator", { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();

    const owner = body.contactBuckets.find((b: { ownerUid: string }) => b.ownerUid === "owner");
    expect(owner.active).toBe(5);
    expect(owner.archived).toBe(1);
    const other = body.contactBuckets.find((b: { ownerUid: string }) => b.ownerUid === "firebase-uid-xyz");
    expect(other.active).toBe(1);

    // 件数の多い順に並ぶ (探す手がかり)
    expect(body.contactBuckets[0].ownerUid).toBe("owner");

    // break-glass 呼び出しは owner スコープに解決される
    expect(body.callerResolvesTo.ownerUid).toBe("owner");
    expect(body.callerResolvesTo.isOwner).toBe(true);
  });

  it("認証必須 (トークン無しは 401/503)", async () => {
    const app = createApp({ prisma, generate: null });
    const r = await app.request("/api/admin/data-locator");
    expect([401, 503]).toContain(r.status);
  });
});
