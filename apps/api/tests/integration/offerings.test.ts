// 申し出カタログ (offerings) と、相手のニーズとのマッチングの結合テスト。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
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
  await prisma.$executeRawUnsafe(
    'TRUNCATE "offering_interests", "offerings", "time_offers", "contacts", "contact_interactions" CASCADE',
  );
});

const makeApp = () => createApp({ prisma, generate: null });

async function addContact(app: ReturnType<typeof createApp>, body: Record<string, unknown>): Promise<string> {
  const res = await app.request("/api/contacts", { method: "POST", headers: H, body: JSON.stringify(body) });
  return (await res.json()).contact.id;
}

describe("Offering: CRUD", () => {
  it("作成・一覧・更新・削除できる。title は暗号化される", async () => {
    const app = makeApp();
    const created = await app.request("/api/offerings", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "teach", title: "英語を教えられます", description: "英会話の練習相手", maxDistance: 3 }),
    });
    expect(created.status).toBe(200);
    const offering = (await created.json()).offering;
    expect(offering.title).toBe("英語を教えられます");
    expect(offering.kindLabel).toBe("教える");

    // DB では暗号化されている
    const row = await prisma.offering.findUniqueOrThrow({ where: { id: offering.id } });
    expect(isEncrypted((row as unknown as { title: string }).title)).toBe(false); // 拡張 client が復号して返す
    const raw = await prisma.$queryRawUnsafe<{ title: string }[]>(
      `SELECT title FROM offerings WHERE id = '${offering.id}'`,
    );
    expect(isEncrypted(raw[0].title)).toBe(true);

    const list = await (await app.request("/api/offerings", { headers: H })).json();
    expect(list.offerings.length).toBe(1);
    expect(list.kinds.length).toBeGreaterThan(0);

    const updated = await app.request(`/api/offerings/${offering.id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ title: "英語とフランス語を教えられます", kind: "teach" }),
    });
    expect((await updated.json()).offering.title).toContain("フランス語");

    // active だけの切り替え
    const toggled = await app.request(`/api/offerings/${offering.id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ active: false }),
    });
    expect((await toggled.json()).offering.active).toBe(false);

    const del = await app.request(`/api/offerings/${offering.id}`, { method: "DELETE", headers: H });
    expect((await del.json()).deleted).toBe(true);
    expect(await prisma.offering.count()).toBe(0);
  });

  it("title 無しは 400", async () => {
    const app = makeApp();
    const r = await app.request("/api/offerings", { method: "POST", headers: H, body: JSON.stringify({ kind: "teach" }) });
    expect(r.status).toBe(400);
  });

  it("認証必須", async () => {
    const app = makeApp();
    const r = await app.request("/api/offerings");
    expect([401, 503]).toContain(r.status);
  });
});

describe("Offering: マッチング", () => {
  it("有効な申し出について、ニーズが重なる相手を根拠つきで挙げる。距離ゲートを尊重", async () => {
    const app = makeApp();
    // 相手を用意 (facets の悩みにニーズを入れる)
    const near = await addContact(app, { name: "田中 一郎", distance: 2 });
    const far = await addContact(app, { name: "鈴木 花子", distance: 5 });
    await prisma.contact.update({
      where: { id: near },
      data: { profileFacets: JSON.stringify({ concerns: ["転職に向けて英語の勉強をやり直したい"] }) },
    });
    await prisma.contact.update({
      where: { id: far },
      data: { profileFacets: JSON.stringify({ concerns: ["英語の学習をもっと進めたい"] }) },
    });

    await app.request("/api/offerings", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "teach", title: "英語の学習をお手伝いできます", maxDistance: 3 }),
    });

    const res = await (await app.request("/api/relationship/offering-matches", { headers: H })).json();
    expect(res.matches.length).toBe(1);
    const ids = res.matches[0].contacts.map((x: { contactId: string }) => x.contactId);
    expect(ids).toContain(near);
    expect(ids).not.toContain(far); // 距離 5 > maxDistance 3 で除外
    expect(res.matches[0].contacts[0].reason).toContain("英語");
  });

  it("無効 (active=false) の申し出はマッチング対象外", async () => {
    const app = makeApp();
    const id = await addContact(app, { name: "田中" });
    await prisma.contact.update({
      where: { id },
      data: { profileFacets: JSON.stringify({ concerns: ["英語の勉強をやりたい"] }) },
    });
    const created = await (
      await app.request("/api/offerings", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ kind: "teach", title: "英語の学習を手伝えます" }),
      })
    ).json();
    await app.request(`/api/offerings/${created.offering.id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ active: false }),
    });
    const res = await (await app.request("/api/relationship/offering-matches", { headers: H })).json();
    expect(res.matches).toEqual([]);
  });
});

describe("公開掲示板 (/market)", () => {
  it("公開した申し出だけが掲示板に出て、訪問者の問い合わせ→承認で新しい連絡先になる", async () => {
    const app = makeApp();
    // 申し出を作成 (既定は非公開なので掲示板に出ない)
    const off = await (
      await app.request("/api/offerings", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ kind: "teach", title: "英語を教えられます", description: "英会話の練習相手" }),
      })
    ).json();

    // 非公開のうちは掲示板に出ない
    let market = await (await app.request("/api/public/market")).json();
    expect(market.offerings.length).toBe(0);

    // 公開に切り替え (published だけの PUT)
    const pub = await app.request(`/api/offerings/${off.offering.id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ published: true }),
    });
    expect((await pub.json()).offering.published).toBe(true);

    // 掲示板 (公開・認証不要) に出る。PII は無い
    market = await (await app.request("/api/public/market")).json();
    expect(market.offerings.length).toBe(1);
    expect(market.offerings[0].title).toBe("英語を教えられます");

    // 訪問者が問い合わせ (認証不要)
    const interest = await app.request(`/api/public/market/offerings/${off.offering.id}/interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "山本 太郎", guestContact: "taro@example.com", message: "ぜひ教わりたいです" }),
    });
    expect(interest.status).toBe(201);

    // オーナーの受け箱に「新規」で入る。名乗り・本文は復号して返る
    const inbox = await (await app.request("/api/relationship/offering-interests", { headers: H })).json();
    expect(inbox.interests.length).toBe(1);
    expect(inbox.interests[0].guestName).toBe("山本 太郎");
    expect(inbox.interests[0].offeringTitle).toBe("英語を教えられます");

    // 承認 → 新しい連絡先 + 接触記録ができる
    const approve = await app.request(`/api/relationship/offering-interests/${inbox.interests[0].id}/approve`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    const approved = await approve.json();
    expect(approved.approved).toBe(true);
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: approved.contactId } });
    expect(contact.name).toBe("山本 太郎");
    expect(contact.source).toBe("market");
    expect(contact.email).toBe("taro@example.com");
    expect(await prisma.contactInteraction.count({ where: { contactId: contact.id } })).toBe(1);

    // 承認済みは受け箱から消える
    const inbox2 = await (await app.request("/api/relationship/offering-interests", { headers: H })).json();
    expect(inbox2.interests.length).toBe(0);
  });

  it("問い合わせは名前とメッセージが必須。DB では暗号化される", async () => {
    const app = makeApp();
    const off = await (
      await app.request("/api/offerings", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ kind: "advise", title: "子育ての相談にのれます", published: true }),
      })
    ).json();
    // 名前なしは 400
    const noName = await app.request(`/api/public/market/offerings/${off.offering.id}/interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "相談したいです" }),
    });
    expect(noName.status).toBe(400);
    // 正常
    await app.request(`/api/public/market/offerings/${off.offering.id}/interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "鈴木", message: "相談したいです" }),
    });
    const raw = await prisma.$queryRawUnsafe<{ guest_name: string }[]>(
      `SELECT guest_name FROM offering_interests LIMIT 1`,
    );
    expect(isEncrypted(raw[0].guest_name)).toBe(true);
  });

  it("問い合わせの受け箱と承認はオーナースコープ (ownerUid 分離)", async () => {
    const app = makeApp();
    // 別オーナーの申し出 + 問い合わせを直接作る
    const other = await prisma.offering.create({
      data: { ownerUid: "someone-else", kind: "help", title: "他人の申し出", published: true },
    });
    await prisma.offeringInterest.create({
      data: { offeringId: other.id, ownerUid: "someone-else", guestName: "他人ゲスト", message: "x" },
    });
    // owner の受け箱には出ない
    const inbox = await (await app.request("/api/relationship/offering-interests", { headers: H })).json();
    expect(inbox.interests.length).toBe(0);
  });
});
