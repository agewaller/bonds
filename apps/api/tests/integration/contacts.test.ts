// 関係性 (contacts) API の結合テスト。実テスト DB (bonds_test)。
// PII の項目暗号化が「DB 上は暗号文、API 応答は平文」であることを生 SQL で必ず検証する。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
let app: ReturnType<typeof createApp>;

const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

beforeAll(() => {
  prisma = createPrismaClient();
  app = createApp({ prisma, generate: null });
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "contact_gifts", "contact_interactions", "contact_groups", "contacts" CASCADE',
  );
});

async function createContact(over: Record<string, unknown> = {}) {
  const res = await app.request("/api/contacts", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: "山田花子",
      distance: 2,
      email: "hanako@example.com",
      phone: "090-1111-2222",
      personalProfile: "腰痛持ち。娘の受験が心配。将来は郷里でカフェを開きたい",
      valuesProfile: "家族第一。誠実さを重んじる",
      notes: "テニス仲間",
      ...over,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).contact as { id: string; name: string; email: string | null };
}

describe("PII 暗号化 (最重要)", () => {
  it("DB 上は enc:v1: 暗号文、API 応答は平文で返る", async () => {
    const c = await createContact();
    // API 応答は透過復号された平文
    expect(c.email).toBe("hanako@example.com");

    // 生 SQL では暗号文 (平文が DB に無いこと)
    const rows = await prisma.$queryRawUnsafe<
      Array<{ email: string; phone: string; personal_profile: string; values_profile: string; notes: string }>
    >(`SELECT email, phone, personal_profile, values_profile, notes FROM contacts WHERE id = '${c.id}'`);
    const raw = rows[0]!;
    for (const v of Object.values(raw)) {
      expect(isEncrypted(v)).toBe(true);
      expect(v).not.toContain("hanako");
      expect(v).not.toContain("腰痛");
      expect(v).not.toContain("テニス");
    }

    // 読み直しても平文で返る (findMany 復号)
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.contacts[0].personalProfile).toContain("腰痛");
  });

  it("interaction.notes も暗号化される", async () => {
    const c = await createContact();
    const res = await app.request(`/api/contacts/${c.id}/interactions`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ type: "call", quality: 5, notes: "娘さんの受験が終わったとのこと" }),
    });
    expect(res.status).toBe(201);
    const rows = await prisma.$queryRawUnsafe<Array<{ notes: string }>>(
      `SELECT notes FROM contact_interactions`,
    );
    expect(isEncrypted(rows[0]!.notes)).toBe(true);
    // 詳細 API では平文
    const detail = await (await app.request(`/api/contacts/${c.id}`, { headers: H })).json();
    expect(detail.interactions[0].notes).toContain("受験");
  });
});

describe("contacts CRUD (データ主権: 1 件単位の編集・削除・エクスポート)", () => {
  it("作成 → 一覧 → 詳細 → 編集 → ソフト削除", async () => {
    const c = await createContact();
    const detail = await (await app.request(`/api/contacts/${c.id}`, { headers: H })).json();
    expect(detail.contact.name).toBe("山田花子");

    const put = await app.request(`/api/contacts/${c.id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ name: "山田花子", distance: 1, notes: "毎週会うことにした" }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).contact.distance).toBe(1);

    const del = await app.request(`/api/contacts/${c.id}`, { method: "DELETE", headers: H });
    expect(del.status).toBe(200);
    // アーカイブ後は一覧に出ないが、行は消えていない (ソフト削除)
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.contacts).toHaveLength(0);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("エクスポートに全データが復号済みで含まれる", async () => {
    await createContact();
    const res = await app.request("/api/contacts/export", { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts[0].email).toBe("hanako@example.com");
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("認証なしの読み取りは 401 (PII を守る)", async () => {
    expect((await app.request("/api/contacts")).status).toBe(401);
    expect((await app.request("/api/relationship/summary")).status).toBe(401);
  });
});

describe("取込 (CSV / vCard)", () => {
  it("CSV を取り込み、暗号化されて保存される", async () => {
    const csv = "氏名,電話,メール,距離\n佐藤太郎,03-1234-5678,taro@example.com,2\n鈴木次郎,,jiro@example.com,3";
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: csv, format: "csv" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toBe(2);
    const rows = await prisma.$queryRawUnsafe<Array<{ email: string }>>(`SELECT email FROM contacts`);
    for (const r of rows) expect(isEncrypted(r.email)).toBe(true);
  });

  it("vCard の自動判別で取り込める", async () => {
    const vcf = "BEGIN:VCARD\nFN:高橋三郎\nTEL:070-5555-6666\nEND:VCARD";
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: vcf }),
    });
    expect((await res.json()).imported).toBe(1);
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.contacts[0].name).toBe("高橋三郎");
    expect(list.contacts[0].phone).toBe("070-5555-6666");
  });

  it("空の取込は 400", async () => {
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("つながりサマリ (lms 距離スコアの結合検証)", () => {
  it("接触なしの親しい人がいると警告水準になり、記録すると回復する", async () => {
    const c = await createContact({ distance: 2 });
    let s = await (await app.request("/api/relationship/summary", { headers: H })).json();
    expect(s.isolation.level).toBe("warning"); // 999 日途絶扱い
    expect(s.today.some((t: { contactId: string }) => t.contactId === c.id)).toBe(true);

    // 「連絡しました」を記録すると適正間隔内に戻る
    await app.request(`/api/contacts/${c.id}/interactions`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ type: "message" }),
    });
    s = await (await app.request("/api/relationship/summary", { headers: H })).json();
    expect(s.isolation.level).toBe("good");
    expect(s.connectionScore).toBe(100);
    expect(s.today).toHaveLength(0);
  });

  it("誕生日 3 日以内は今日のおすすめに最優先で載る", async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const c = await createContact({
      distance: 4, // 監視対象外の距離でも誕生日は拾う
      birthday: `1960-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`,
    });
    const s = await (await app.request("/api/relationship/summary", { headers: H })).json();
    expect(s.today[0]).toMatchObject({ contactId: c.id, kind: "birthday" });
  });
});
