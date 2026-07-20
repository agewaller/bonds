// 一斉配信 (メールのお便り) の結合テスト: 作成 → 宛先解決 (メール無し/除外/重複/配信停止を除く)
// → 少しずつ送信 → 差し込み + 配信停止フッタ → 配信停止で以後除外、まで一気通貫。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import type { MailerFn } from "../../src/lib/mailer.js";

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
    'TRUNCATE "email_campaign_recipients", "email_campaigns", "email_suppressions", "contact_interactions", "contacts" CASCADE',
  );
});

describe("一斉配信 (campaigns)", () => {
  it("宛先を解決して少しずつ送り、差し込みと配信停止フッタが付く。配信停止で以後除外", async () => {
    const sent: { to: string; subject: string; body: string }[] = [];
    const mailer: MailerFn = async (m) => {
      sent.push(m);
      return { messageId: `m${sent.length}` };
    };
    const app = createApp({ prisma, generate: null, mailer });

    // A / E は宛先。B(メール無し)・C(除外)・D(A と同じメール=重複) は対象外。
    await prisma.contact.create({ data: { ownerUid: "owner", name: "田中", email: "a@example.com", company: "青空商事", distance: 3 } });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "佐藤", distance: 3 } }); // メール無し
    await prisma.contact.create({ data: { ownerUid: "owner", name: "鈴木", email: "c@example.com", focusPreference: "excluded", distance: 3 } });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "田中(重複)", email: "a@example.com", distance: 4 } });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "高橋", email: "e@example.com", distance: 4 } });

    // 作成
    const created = await (
      await app.request("/api/campaigns", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ subject: "夏のご挨拶", body: "{{お名前}}様、いつもお世話になっております。", fromName: "山田太郎", segment: { all: true } }),
      })
    ).json();
    const id = created.campaign.id as string;

    // プレビュー: 宛先は 2 名 (a@ と e@。重複・メール無し・除外は除く)
    const prev = await (await app.request(`/api/campaigns/${id}/preview`, { method: "POST", headers: H, body: "{}" })).json();
    expect(prev.audience).toBe(2);

    // 承認 → 受信者確定
    const appr = await (await app.request(`/api/campaigns/${id}/approve`, { method: "POST", headers: H, body: "{}" })).json();
    expect(appr.audience).toBe(2);
    expect(appr.campaign.status).toBe("approved");

    // 送信 sweep
    const proc = await (await app.request("/api/admin/campaigns/process?batch=100", { method: "POST", headers: H })).json();
    expect(proc.sent).toBe(2);
    expect(sent).toHaveLength(2);
    // 差し込み (お名前) と 配信停止フッタ・差出人表示が入る
    const toA = sent.find((s) => s.to === "a@example.com")!;
    expect(toA.body).toContain("田中様");
    expect(toA.body).toContain("配信の停止はこちら");
    expect(toA.body).toContain("山田太郎");
    // 送信で接触記録が残る
    const interactions = await prisma.contactInteraction.count();
    expect(interactions).toBe(2);
    // 配信済みに
    const after = await (await app.request(`/api/campaigns/${id}`, { headers: H })).json();
    expect(after.campaign.status).toBe("sent");
    expect(after.campaign.sent).toBe(2);

    // 配信停止: 送信メール中のリンクからトークンを取り出して叩く
    const token = toA.body.match(/unsubscribe\?t=([^\s]+)/)![1];
    const unsub = await app.request(`/api/public/unsubscribe/${token}`);
    expect(unsub.status).toBe(200);
    expect(await prisma.emailSuppression.count()).toBe(1);

    // もう一度作って承認すると、配信停止した a@ は宛先から外れる (e@ の 1 名)
    const created2 = await (
      await app.request("/api/campaigns", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ subject: "再送", body: "{{お名前}}様", segment: { all: true } }),
      })
    ).json();
    const appr2 = await (await app.request(`/api/campaigns/${created2.campaign.id}/approve`, { method: "POST", headers: H, body: "{}" })).json();
    expect(appr2.audience).toBe(1);
  });

  it("テスト送信は指定アドレスに 1 通、件名に [テスト] が付く", async () => {
    const sent: { to: string; subject: string }[] = [];
    const mailer: MailerFn = async (m) => {
      sent.push(m);
      return { messageId: "m" };
    };
    const app = createApp({ prisma, generate: null, mailer });
    const created = await (
      await app.request("/api/campaigns", { method: "POST", headers: H, body: JSON.stringify({ subject: "ご挨拶", body: "{{お名前}}様", segment: { all: true } }) })
    ).json();
    const res = await app.request(`/api/campaigns/${created.campaign.id}/send-test`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ to: "me@example.com" }),
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("me@example.com");
    expect(sent[0]!.subject).toContain("[テスト]");
  });

  it("認証必須", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await app.request("/api/campaigns");
    expect([401, 503]).toContain(res.status);
  });
});
