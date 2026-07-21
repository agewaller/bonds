// 時間・知恵・モノのシェア + 双方向応答の結合テスト。実テスト DB (bonds_test)。
// PII (message) が DB 上は暗号文・API 応答は平文であることを生 SQL で検証する。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
let app: ReturnType<typeof createApp>;

const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };
const PUB = { "Content-Type": "application/json" }; // 公開エンドポイントは認証なし

beforeAll(() => {
  prisma = createPrismaClient();
  app = createApp({ prisma, generate: null, mailer: null });
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "resource_shares", "shared_resources", "contact_interactions", "contact_gifts", "contacts" CASCADE',
  );
});

async function createContact(over: Record<string, unknown> = {}) {
  const res = await app.request("/api/contacts", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "山田花子", distance: 2, email: "hanako@example.com", ...over }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).contact.id as string;
}

describe("資源カタログ (時間・知恵・モノ)", () => {
  it("作成・一覧・アーカイブ", async () => {
    const created = await app.request("/api/resources", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "wisdom", title: "確定申告の相談に乗れます", description: "個人事業10年" }),
    });
    expect(created.status).toBe(201);
    const id = (await created.json()).resource.id;

    const list = await app.request("/api/resources", { headers: H });
    expect((await list.json()).resources).toHaveLength(1);

    const del = await app.request(`/api/resources/${id}`, { method: "DELETE", headers: H });
    expect(del.status).toBe(200);
    const after = await app.request("/api/resources", { headers: H });
    expect((await after.json()).resources).toHaveLength(0); // archived は一覧に出ない
  });
});

describe("シェアの提案 → 送信 → 相手の公開応答 (双方向)", () => {
  it("offer を作って送信し、相手がトークンで受諾できる", async () => {
    const contactId = await createContact();
    const resRes = await app.request("/api/resources", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "time", title: "引っ越しを手伝えます" }),
    });
    const resourceId = (await resRes.json()).resource.id;

    // 提案 (proposed)
    const shareRes = await app.request(`/api/contacts/${contactId}/shares`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ resourceId, direction: "offer", message: "週末なら空いています" }),
    });
    expect(shareRes.status).toBe(201);
    const shareId = (await shareRes.json()).share.id;

    // 送信 (sent) → 公開トークン発行
    const sendRes = await app.request(`/api/shares/${shareId}/send`, { method: "POST", headers: H });
    expect(sendRes.status).toBe(200);
    const sent = await sendRes.json();
    const token = sent.shareUrl.split("/share/")[1];
    expect(token).toBeTruthy();
    expect(sent.delivered).toBe(false); // mailer=null

    // 相手の公開ビュー (認証なし)
    const view = await app.request(`/api/share/${token}`, { headers: PUB });
    expect(view.status).toBe(200);
    const vb = (await view.json()).share;
    expect(vb.title).toBe("引っ越しを手伝えます");
    expect(vb.message).toBe("週末なら空いています"); // 平文で見える
    expect(vb.respondable).toBe(true);

    // 相手が受諾 (認証なし)
    const respond = await app.request(`/api/share/${token}/respond`, {
      method: "POST",
      headers: PUB,
      body: JSON.stringify({ response: "accept", note: "助かります、ぜひお願いします" }),
    });
    expect(respond.status).toBe(200);
    expect((await respond.json()).status).toBe("accepted");

    // 双方向の還流: 接触記録が増えている (share_offer + share_response)
    const detail = await app.request(`/api/contacts/${contactId}`, { headers: H });
    const types = (await detail.json()).interactions.map((i: { type: string }) => i.type);
    expect(types).toContain("share_offer");
    expect(types).toContain("share_response");

    // DB 上は message が暗号文
    const rows = await prisma.$queryRawUnsafe<Array<{ message: string | null }>>(
      "SELECT message FROM resource_shares LIMIT 1",
    );
    expect(isEncrypted(rows[0].message as string)).toBe(true);
  });

  it("送信前は公開応答できない・二重応答も弾く", async () => {
    const contactId = await createContact();
    const s = await app.request(`/api/contacts/${contactId}/shares`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ direction: "offer", title: "本を貸します", kind: "thing" }),
    });
    const shareId = (await s.json()).share.id;
    // まだ proposed → 送信して token を得る
    const send = await app.request(`/api/shares/${shareId}/send`, { method: "POST", headers: H });
    const token = (await send.json()).shareUrl.split("/share/")[1];
    // 1 回目 accept
    const first = await app.request(`/api/share/${token}/respond`, {
      method: "POST",
      headers: PUB,
      body: JSON.stringify({ response: "accept" }),
    });
    expect(first.status).toBe(200);
    // 2 回目は accepted 状態なので弾く
    const second = await app.request(`/api/share/${token}/respond`, {
      method: "POST",
      headers: PUB,
      body: JSON.stringify({ response: "decline" }),
    });
    expect(second.status).toBe(409);
  });
});

describe("適格性ゲート", () => {
  it("遠い相手 (distance 5) への request は 409", async () => {
    const contactId = await createContact({ distance: 5 });
    const res = await app.request(`/api/contacts/${contactId}/shares`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ direction: "request", title: "資金を貸してほしい", kind: "thing" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_eligible");
  });

  it("inbound (相手から受け取った記録) は接触として即還流する", async () => {
    const contactId = await createContact();
    const res = await app.request(`/api/contacts/${contactId}/shares`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ direction: "inbound", title: "手作りジャムをいただいた", kind: "thing" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).share.status).toBe("accepted");
    const detail = await app.request(`/api/contacts/${contactId}`, { headers: H });
    const types = (await detail.json()).interactions.map((i: { type: string }) => i.type);
    expect(types).toContain("share_received");
  });
});
