// 統合ハブ (知り合い/リストの集約 + 双方向メッセージ) の結合テスト。実テスト DB。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
process.env.INBOUND_WEBHOOK_SECRET = "inbound-secret";

let prisma: ExtendedPrismaClient;
let app: ReturnType<typeof createApp>;

const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };
// 送信できる偽 mailer (send=true の経路検証用)
const mailer = async () => ({ messageId: "msg-1" });

beforeAll(() => {
  prisma = createPrismaClient();
  app = createApp({ prisma, generate: null, mailer });
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "messages", "message_threads", "contact_external_refs", "resource_shares", "shared_resources", "contact_interactions", "contacts" CASCADE',
  );
});

describe("知り合い/リストの統合 (外部参照つき冪等 upsert)", () => {
  it("他プロダクトの人物を取り込み、再取込しても重複しない", async () => {
    const first = await app.request("/api/contacts/upsert-external", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        product: "vm",
        externalId: "investor-42",
        kind: "investor",
        name: "松本 大",
        email: "oki@example.com",
        distance: 3,
      }),
    });
    expect(first.status).toBe(201);
    const fb = await first.json();
    expect(fb.created).toBe(true);
    const contactId = fb.contact.id;

    // 同じ (product, externalId) を再 upsert → 新規作成せず既存を返す
    const again = await app.request("/api/contacts/upsert-external", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ product: "vm", externalId: "investor-42", name: "松本 大" }),
    });
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);

    const all = await prisma.contact.count();
    expect(all).toBe(1); // 重複していない

    // 外部参照が辿れる
    const refs = await app.request(`/api/contacts/${contactId}/external-refs`, { headers: H });
    const rb = await refs.json();
    expect(rb.refs).toHaveLength(1);
    expect(rb.refs[0].product).toBe("vm");
    expect(rb.refs[0].externalId).toBe("investor-42");
  });

  it("未知の製品は弾く", async () => {
    const res = await app.request("/api/contacts/upsert-external", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ product: "bogus", externalId: "x", name: "誰か" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("双方向メッセージ", () => {
  async function makeContact(email = "hanako@example.com") {
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "山田花子", distance: 2, email }),
    });
    return (await res.json()).contact.id as string;
  }

  it("outbound を送信し、inbound webhook で返信を受けてスレッドが往復になる", async () => {
    const contactId = await makeContact("hanako@example.com");

    // outbound (send=true → 偽 mailer で sent)
    const out = await app.request(`/api/contacts/${contactId}/messages`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ body: "先日はありがとう。来週お茶でもどう?", subject: "お礼", send: true }),
    });
    expect(out.status).toBe(201);
    expect((await out.json()).message.status).toBe("sent");

    // inbound webhook (相手の返信) — 認証は共有シークレット
    const inb = await app.request("/api/inbound/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-inbound-secret": "inbound-secret" },
      body: JSON.stringify({ from: "Hanako <hanako@example.com>", text: "ぜひ! 火曜の午後が空いています" }),
    });
    expect(inb.status).toBe(200);
    expect((await inb.json()).matched).toBe(true);

    // スレッドが往復 (outbound + inbound) になっている
    const view = await app.request(`/api/contacts/${contactId}/messages`, { headers: H });
    const vb = await view.json();
    expect(vb.threads).toHaveLength(1);
    const dirs = vb.threads[0].messages.map((m: { direction: string }) => m.direction);
    expect(dirs).toEqual(["outbound", "inbound"]);
    expect(vb.threads[0].messages[1].body).toContain("火曜の午後"); // 平文で復号されている

    // DB 上は body が暗号文
    const rows = await prisma.$queryRawUnsafe<Array<{ body: string }>>("SELECT body FROM messages LIMIT 1");
    expect(isEncrypted(rows[0].body)).toBe(true);

    // 双方向の還流: 接触記録が積まれている (送信 + 返信)
    const detail = await app.request(`/api/contacts/${contactId}`, { headers: H });
    const msgs = (await detail.json()).interactions.filter((i: { type: string }) => i.type === "message");
    expect(msgs.length).toBe(2);
  });

  it("未知の送信元は静かに無視 (matched=false)", async () => {
    await makeContact("known@example.com");
    const inb = await app.request("/api/inbound/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-inbound-secret": "inbound-secret" },
      body: JSON.stringify({ from: "stranger@example.com", text: "誰?" }),
    });
    expect(inb.status).toBe(200);
    expect((await inb.json()).matched).toBe(false);
  });

  it("シークレット不一致の受信は 401", async () => {
    const inb = await app.request("/api/inbound/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-inbound-secret": "wrong" },
      body: JSON.stringify({ from: "x@example.com", text: "hi" }),
    });
    expect(inb.status).toBe(401);
  });
});

describe("SendGrid Inbound Parse 互換の受信", () => {
  async function makeContact(email: string) {
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "受信 太郎", distance: 2, email }),
    });
    return (await res.json()).contact.id as string;
  }

  it("フォーム送信 + URL クエリのシークレット + 表示名つき from で受信できる", async () => {
    const contactId = await makeContact("form-sender@example.com");
    // SendGrid は multipart/form-data で from/text/envelope 等を送り、カスタムヘッダは付けない。
    const form = new URLSearchParams({
      from: "田中 一郎 <Form-Sender@Example.com>",
      subject: "Re: ご案内",
      text: "承知しました。ぜひ進めましょう。",
      envelope: JSON.stringify({ to: ["reply@bonds"], from: "form-sender@example.com" }),
    });
    const inb = await app.request("/api/inbound/email?secret=inbound-secret", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    expect(inb.status).toBe(200);
    expect((await inb.json()).matched).toBe(true);

    const view = await app.request(`/api/contacts/${contactId}/messages`, { headers: H });
    const vb = await view.json();
    expect(vb.threads[0].messages.some((m: { direction: string; body: string }) => m.direction === "inbound" && m.body.includes("ぜひ進めましょう"))).toBe(true);
  });

  it("URL クエリのシークレットが不一致なら 401", async () => {
    const inb = await app.request("/api/inbound/email?secret=wrong", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ from: "a@example.com", text: "hi" }).toString(),
    });
    expect(inb.status).toBe(401);
  });

  it("from が本文フィールドに無くても envelope から復元する", async () => {
    const contactId = await makeContact("env-only@example.com");
    const inb = await app.request("/api/inbound/email?secret=inbound-secret", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        text: "envelope 経由です",
        envelope: JSON.stringify({ from: "env-only@example.com", to: ["reply@bonds"] }),
      }).toString(),
    });
    expect(inb.status).toBe(200);
    expect((await inb.json()).matched).toBe(true);
    const view = await app.request(`/api/contacts/${contactId}/messages`, { headers: H });
    expect((await view.json()).threads.length).toBe(1);
  });
});

describe("データ主権: エクスポートに新データも含まれる", () => {
  it("シェア・資源・メッセージ・外部参照が復号済みで書き出される", async () => {
    // 外部参照つきの人物 + 資源 + シェア + メッセージ往復を用意
    const up = await app.request("/api/contacts/upsert-external", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ product: "vm", externalId: "exp-1", name: "書出 太郎", email: "exp@example.com" }),
    });
    const contactId = (await up.json()).contact.id;
    const res = await app.request("/api/resources", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "wisdom", title: "相談に乗れます", description: "秘密の詳細" }),
    });
    const resourceId = (await res.json()).resource.id;
    await app.request(`/api/contacts/${contactId}/shares`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ resourceId, direction: "offer", message: "ひみつの一言" }),
    });
    await app.request(`/api/contacts/${contactId}/messages`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ body: "ひみつの本文", subject: "件名" }),
    });

    const exp = await app.request("/api/contacts/export", { headers: H });
    expect(exp.status).toBe(200);
    const b = await exp.json();
    expect(b.externalRefs.some((r: { externalId: string }) => r.externalId === "exp-1")).toBe(true);
    // 暗号化列が復号されて書き出されている (ロックインしない)
    expect(b.resources.some((r: { description: string | null }) => r.description === "秘密の詳細")).toBe(true);
    expect(b.shares.some((s: { message: string | null }) => s.message === "ひみつの一言")).toBe(true);
    expect(b.messages.some((m: { body: string }) => m.body === "ひみつの本文")).toBe(true);
    expect(b.threads.length).toBeGreaterThanOrEqual(1);
  });
});
