// ニューカマー (パーティ・イベント) 取込の結合テスト。実テスト DB (bonds_test)。
// 「貼るだけで連絡帳に入り、出会いの記録 (メモ + meeting 接触) が付く」
// 「再取込しても二重登録しない」「名刺写真ジョブにもイベント文脈が乗る」を守る。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

beforeAll(async () => {
  prisma = createPrismaClient();
  await seedDdPrompts(prisma);
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "import_jobs", "contact_interactions", "contacts" CASCADE');
});

describe("POST /api/contacts/newcomers", () => {
  it("名前と SNS/メール混在の貼り付けが連絡帳に入り、出会いの記録が付く", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await app.request("/api/contacts/newcomers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        eventName: "七夕交流会",
        eventDate: "2026-07-07",
        content: "田中太郎 https://x.com/tanaka_taro tanaka@example.com\n山田花子さん 株式会社青空",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    expect(body.interactionsAdded).toBe(2);
    const tanaka = await prisma.contact.findFirst({ where: { name: "田中太郎" } });
    expect(tanaka).not.toBeNull();
    expect(tanaka!.source).toBe("event");
    expect(tanaka!.email).toBe("tanaka@example.com");
    expect(tanaka!.notes).toContain("七夕交流会で出会う");
    expect(JSON.parse(tanaka!.sns!)).toEqual(["https://x.com/tanaka_taro"]);
    const it1 = await prisma.contactInteraction.findFirst({ where: { contactId: tanaka!.id } });
    expect(it1!.type).toBe("meeting");
    expect(it1!.notes).toBe("七夕交流会");
    expect(it1!.occurredAt.toISOString()).toContain("2026-07-07");
    const hanako = await prisma.contact.findFirst({ where: { name: "山田花子" } });
    expect(hanako!.company).toBe("株式会社青空");
  });

  it("同じ貼り付けをもう一度送っても二重登録しない (冪等)", async () => {
    const app = createApp({ prisma, generate: null });
    const payload = {
      eventName: "交流会",
      eventDate: "2026-07-07",
      content: "田中太郎 https://x.com/tanaka_taro",
    };
    const first = await app.request("/api/contacts/newcomers", { method: "POST", headers: H, body: JSON.stringify(payload) });
    expect((await first.json()).imported).toBe(1);
    const again = await app.request("/api/contacts/newcomers", { method: "POST", headers: H, body: JSON.stringify(payload) });
    const body = await again.json();
    expect(body.imported).toBe(0);
    expect(body.interactionsAdded).toBe(0); // 同日の接触は増やさない
    expect(await prisma.contact.count({ where: { name: "田中太郎" } })).toBe(1);
    expect(await prisma.contactInteraction.count()).toBe(1);
  });

  it("既知の構造化形式 (CSV) はいつもの取込で読み、イベントの記録も付く", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await app.request("/api/contacts/newcomers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        eventName: "名刺交換会",
        eventDate: "2026-07-10",
        content: "氏名,会社名,E-mail\n佐藤一郎,株式会社山川,sato@example.com",
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toBe(1);
    const sato = await prisma.contact.findFirst({ where: { name: "佐藤一郎" } });
    expect(sato!.company).toBe("株式会社山川");
    expect(sato!.notes).toContain("名刺交換会で出会う");
    expect(await prisma.contactInteraction.count({ where: { contactId: sato!.id } })).toBe(1);
  });

  it("内容が無ければ 400。認証が無ければ 401", async () => {
    const app = createApp({ prisma, generate: null });
    const empty = await app.request("/api/contacts/newcomers", { method: "POST", headers: H, body: JSON.stringify({}) });
    expect(empty.status).toBe(400);
    const anon = await app.request("/api/contacts/newcomers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "田中太郎" }),
    });
    expect(anon.status).toBe(401);
  });
});

describe("取り込みジョブへのイベント文脈", () => {
  it("イベント付きで積んだテキストジョブを処理すると、出会いの記録が付く", async () => {
    const app = createApp({ prisma, generate: null });
    const created = await app.request("/api/contacts/import-jobs", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        content: "氏名,会社名\n鈴木次郎,株式会社海山",
        eventName: "夏祭り",
        eventDate: "2026-07-15",
      }),
    });
    expect(created.status).toBe(201);
    const run = await app.request("/api/contacts/import-jobs/run", { method: "POST", headers: H });
    expect((await run.json()).processed).toBe(1);
    const suzuki = await prisma.contact.findFirst({ where: { name: "鈴木次郎" } });
    expect(suzuki).not.toBeNull();
    expect(suzuki!.notes).toContain("夏祭りで出会う");
    const inter = await prisma.contactInteraction.findFirst({ where: { contactId: suzuki!.id } });
    expect(inter!.type).toBe("meeting");
    expect(inter!.occurredAt.toISOString()).toContain("2026-07-15");
  });
});
