// 提携先アウトリーチ (ADR-0022 移植) の結合テスト。実テスト DB + 偽 generate/Gmail。
// 送信の安全装置 (承認制既定・suppressed 除外・日次上限・法的フッタ・暗号化) を必ず検証する。
// 送信チャネルはオーナー自身の Gmail (2026-07-23。配信サービス経由はバウンス規律で停止を
// 招いたため廃止)。偽 GoogleClient の apiPost で raw (RFC822) を受け、復号して検証する。
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";
import { GOOGLE_SCOPES_SEND, type GoogleClient } from "../../src/lib/google.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

// 偽 generate: system の内容で discover / draft を判別して有効な JSON を返す
const partnerGenerate: GenerateFn = async ({ system, model }) => {
  const text = system.includes("リサーチ担当")
    ? JSON.stringify({
        targets: [
          { kind: "association", name: "全国つながり協会", url: "https://example.org", reason: "会員向けに相性がよい" },
          { kind: "service", name: "見守りサービスあんしん", url: null, reason: "利用者層が近い" },
        ],
      })
    : JSON.stringify({
        subject: "連携のご相談",
        body: "はじめまして。人のつながりを支える取り組みを拝見してご連絡しました。私たちは連絡帳サービスを運営しており、御会の会員の皆さまのお役に立てると考えています。一度お話の機会をいただけないでしょうか。",
      });
  return { text, model, inputTokens: 500, outputTokens: 300 };
};

// 偽 Gmail 送信: apiPost で受けた raw (base64url RFC822) を復号し、旧 mailer と同じ形
// ({to, subject, body}) に落として検証を続けられるようにする
const sentMails: Array<{ to: string; subject: string; body: string }> = [];
const fakeGmail: GoogleClient = {
  authUrl: () => "https://accounts.google.com/o/oauth2/v2/auth?fake",
  exchangeCode: async () => ({
    refreshToken: "rt",
    accessToken: "at",
    email: "me@example.com",
    name: "わたし",
    grantedScopes: GOOGLE_SCOPES_SEND.join(" "),
  }),
  refreshAccessToken: async () => "at",
  apiGet: async () => ({}),
  apiPost: async (url, _token, body) => {
    if (!url.includes("gmail/v1/users/me/messages/send")) return {};
    const text = Buffer.from((body as { raw: string }).raw, "base64url").toString("utf-8");
    const [head, b64] = text.split("\r\n\r\n");
    const subjectRaw = /Subject: (.+)/.exec(head ?? "")?.[1] ?? "";
    sentMails.push({
      to: /To: (.+)/.exec(head ?? "")?.[1] ?? "",
      subject: subjectRaw.startsWith("=?UTF-8?B?")
        ? Buffer.from(subjectRaw.slice(10, -2), "base64").toString("utf-8")
        : subjectRaw,
      body: Buffer.from(b64 ?? "", "base64").toString("utf-8"),
    });
    return { id: "gm-1" };
  },
};

// オーナーの Gmail 送信許可 (gmail.send スコープつきの接続) を用意する
async function grantSendPermission() {
  await prisma.googleConnection.create({
    data: { ownerUid: "owner", email: "me@example.com", refreshToken: "rt", scopes: GOOGLE_SCOPES_SEND.join(" ") },
  });
}

beforeAll(() => {
  prisma = createPrismaClient();
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  sentMails.length = 0;
  await prisma.$executeRawUnsafe(
    'TRUNCATE "partner_messages", "partner_targets", "google_connections", "ai_usage_logs", "prompts" CASCADE',
  );
  await seedDdPrompts(prisma);
  await grantSendPermission();
});

afterEach(() => {
  delete process.env.PARTNER_AUTO_SEND;
  delete process.env.PARTNER_DAILY_LIMIT;
});

async function createTarget(
  app: ReturnType<typeof createApp>,
  over: Record<string, unknown> = {},
) {
  const res = await app.request("/api/admin/partners/targets", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: "全国つながり協会",
      kind: "association",
      contactEmail: "info@example.org",
      ...over,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).target as { id: string; name: string; status: string };
}

describe("targets CRUD と暗号化", () => {
  it("作成 → 一覧 → 更新 → ソフト削除。contact_email は DB 上で暗号文", async () => {
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const t = await createTarget(app);
    expect(t.status).toBe("candidate");

    const rows = await prisma.$queryRawUnsafe<Array<{ contact_email: string }>>(
      `SELECT contact_email FROM partner_targets`,
    );
    expect(isEncrypted(rows[0]!.contact_email)).toBe(true);

    const list = await (await app.request("/api/admin/partners/targets", { headers: H })).json();
    expect(list.targets).toHaveLength(1);
    expect(list.targets[0].contactEmail).toBe("info@example.org"); // API 応答は復号済み

    const patched = await app.request(`/api/admin/partners/targets/${t.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ status: "partner", isPublic: true, blurb: "人のつながりを支える協会" }),
    });
    expect(patched.status).toBe(200);

    const del = await app.request(`/api/admin/partners/targets/${t.id}`, { method: "DELETE", headers: H });
    expect(del.status).toBe(200);
    const after = await (await app.request("/api/admin/partners/targets", { headers: H })).json();
    expect(after.targets).toHaveLength(0);
  });

  it("管理系は認証必須、公開ディレクトリは未認証で PII 無し", async () => {
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const noAuth = await app.request("/api/admin/partners/targets");
    expect(noAuth.status).toBe(401);

    const t = await createTarget(app);
    await app.request(`/api/admin/partners/targets/${t.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ status: "partner", isPublic: true, blurb: "紹介文" }),
    });
    await createTarget(app, { name: "非公開のほう", contactEmail: "x@example.com" });

    const pub = await app.request("/api/partners");
    expect(pub.status).toBe(200);
    const body = await pub.json();
    expect(body.partners).toHaveLength(1); // is_public のみ
    expect(body.partners[0].name).toBe("全国つながり協会");
    expect(body.partners[0].contactEmail).toBeUndefined(); // PII を返さない
    expect(JSON.stringify(body)).not.toContain("example.org"); // url は入れたら出るが email は出ない
  });
});

describe("発見 (discover)", () => {
  it("テーマから候補を作成し、同名は重複させない", async () => {
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    await createTarget(app); // 既存の「全国つながり協会」
    const res = await app.request("/api/admin/partners/discover", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ theme: "シニアの孤立予防" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(2);
    expect(body.created).toHaveLength(1); // 既存と同名はスキップ
    expect(body.created[0].name).toBe("見守りサービスあんしん");
    expect(await prisma.aiUsageLog.count({ where: { purpose: "partner_discover" } })).toBe(1);
  });
});

describe("下書き → 承認 → 送信 (既定は承認制)", () => {
  it("draft は自動送信されず、確認送信でフッタ付きメールが送られ target が contacted になる", async () => {
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const t = await createTarget(app);

    const draftRes = await app.request(`/api/admin/partners/targets/${t.id}/draft`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(draftRes.status).toBe(201);
    const draftBody = await draftRes.json();
    expect(draftBody.message.status).toBe("draft"); // 既定 = 承認制 (自動送信しない)
    expect(draftBody.autoSend).toBeNull();
    expect(sentMails).toHaveLength(0);

    // 本文は DB 上で暗号文
    const raw = await prisma.$queryRawUnsafe<Array<{ body: string }>>(`SELECT body FROM partner_messages`);
    expect(isEncrypted(raw[0]!.body)).toBe(true);

    // 人が確認して送信
    const send = await app.request(`/api/admin/partners/messages/${draftBody.message.id}/send`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(send.status).toBe(200);
    expect((await send.json()).status).toBe("sent");
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]!.to).toBe("info@example.org");
    // 法的フッタ (送信者明示 + 配信停止) が必ず付く
    expect(sentMails[0]!.body).toContain("bonds 運営チーム");
    expect(sentMails[0]!.body).toContain("配信をご希望されない場合");

    const target = await prisma.partnerTarget.findUnique({ where: { id: t.id } });
    expect(target!.status).toBe("contacted");
    expect(target!.lastContactedAt).not.toBeNull();
  });

  it("suppressed の相手には送らない・メール未設定は送らない・二重送信は 409", async () => {
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const t = await createTarget(app);
    const draft = await (
      await app.request(`/api/admin/partners/targets/${t.id}/draft`, { method: "POST", headers: H, body: "{}" })
    ).json();

    await app.request(`/api/admin/partners/targets/${t.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ status: "suppressed" }),
    });
    const blocked = await app.request(`/api/admin/partners/messages/${draft.message.id}/send`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).status).toBe("suppressed");
    expect(sentMails).toHaveLength(0);

    // メール未設定
    const t2 = await createTarget(app, { name: "メール無し", contactEmail: undefined });
    const d2 = await (
      await app.request(`/api/admin/partners/targets/${t2.id}/draft`, { method: "POST", headers: H, body: "{}" })
    ).json();
    const noEmail = await app.request(`/api/admin/partners/messages/${d2.message.id}/send`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(noEmail.status).toBe(422);
    expect((await noEmail.json()).status).toBe("no_email");

    // 送信済みへの再送は 409
    const t3 = await createTarget(app, { name: "送信済み先", contactEmail: "a@example.com" });
    const d3 = await (
      await app.request(`/api/admin/partners/targets/${t3.id}/draft`, { method: "POST", headers: H, body: "{}" })
    ).json();
    await app.request(`/api/admin/partners/messages/${d3.message.id}/send`, { method: "POST", headers: H, body: "{}" });
    const again = await app.request(`/api/admin/partners/messages/${d3.message.id}/send`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(again.status).toBe(409);
    expect(sentMails).toHaveLength(1);
  });

  it("日次送信上限に達したら送らない (rate_limited)", async () => {
    process.env.PARTNER_DAILY_LIMIT = "1";
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const t1 = await createTarget(app, { name: "一件目", contactEmail: "a@example.com" });
    const t2 = await createTarget(app, { name: "二件目", contactEmail: "b@example.com" });
    const d1 = await (
      await app.request(`/api/admin/partners/targets/${t1.id}/draft`, { method: "POST", headers: H, body: "{}" })
    ).json();
    const d2 = await (
      await app.request(`/api/admin/partners/targets/${t2.id}/draft`, { method: "POST", headers: H, body: "{}" })
    ).json();
    await app.request(`/api/admin/partners/messages/${d1.message.id}/send`, { method: "POST", headers: H, body: "{}" });
    const limited = await app.request(`/api/admin/partners/messages/${d2.message.id}/send`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(limited.status).toBe(422);
    expect((await limited.json()).status).toBe("rate_limited");
    expect(sentMails).toHaveLength(1);
  });

  it("承認は本文の手直しを反映し、承認済みは process-queue が送る", async () => {
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const t = await createTarget(app);
    const d = await (
      await app.request(`/api/admin/partners/targets/${t.id}/draft`, { method: "POST", headers: H, body: "{}" })
    ).json();
    const approved = await app.request(`/api/admin/partners/messages/${d.message.id}/approve`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ body: "手直しした本文です。ご確認のほどよろしくお願いいたします。この文章は五十文字以上になるように書いています。" }),
    });
    expect(approved.status).toBe(200);
    expect((await approved.json()).message.status).toBe("approved");

    const q = await app.request("/api/admin/partners/process-queue?batch=10", {
      method: "POST",
      headers: H,
      body: "{}",
    });
    const qBody = await q.json();
    expect(qBody.sent).toBe(1);
    expect(sentMails[0]!.body).toContain("手直しした本文です");
  });
});

describe("自動送信 (PARTNER_AUTO_SEND=1 の明示許可時のみ)", () => {
  it("許可時は下書き直後に送信まで進む。送信基盤が無ければ承認済み保留に縮退", async () => {
    process.env.PARTNER_AUTO_SEND = "1";
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const t = await createTarget(app);
    const res = await app.request(`/api/admin/partners/targets/${t.id}/draft`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    const body = await res.json();
    expect(body.autoSend.status).toBe("sent");
    expect(body.message.status).toBe("sent");
    expect(sentMails).toHaveLength(1);

    // Gmail の送信許可なし → 承認済みとして保留 (許可が整えば process-queue が送る)
    await prisma.googleConnection.deleteMany();
    const appNoMail = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const t2 = await createTarget(appNoMail, { name: "保留先", contactEmail: "c@example.com" });
    const r2 = await appNoMail.request(`/api/admin/partners/targets/${t2.id}/draft`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    const b2 = await r2.json();
    expect(b2.autoSend.status).toBe("approved");
    expect(b2.message.status).toBe("approved");
  });
});

describe("返信の記録と返事の下書き", () => {
  it("inbound を記録すると replied になり、reply-draft がスレッド文脈で下書きを作る", async () => {
    const app = createApp({ prisma, generate: partnerGenerate, google: fakeGmail });
    const t = await createTarget(app);

    // 返信が無いうちは reply-draft できない
    const early = await app.request(`/api/admin/partners/targets/${t.id}/reply-draft`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(early.status).toBe(400);

    const inbound = await app.request(`/api/admin/partners/targets/${t.id}/inbound`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ body: "ご連絡ありがとうございます。詳しくお聞かせください。" }),
    });
    expect(inbound.status).toBe(201);
    const target = await prisma.partnerTarget.findUnique({ where: { id: t.id } });
    expect(target!.status).toBe("replied");

    const reply = await app.request(`/api/admin/partners/targets/${t.id}/reply-draft`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(reply.status).toBe(201);
    expect((await reply.json()).message.status).toBe("draft");
  });
});

describe("AI キー無し環境", () => {
  it("discover / draft は 503 に縮退 (フォールバックしない)", async () => {
    const app = createApp({ prisma, generate: null, google: fakeGmail });
    const t = await createTarget(app);
    const d = await app.request(`/api/admin/partners/targets/${t.id}/draft`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(d.status).toBe(503);
    const disc = await app.request("/api/admin/partners/discover", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ theme: "テーマ" }),
    });
    expect(disc.status).toBe(503);
  });
});
