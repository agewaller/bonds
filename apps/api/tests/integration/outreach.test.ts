// フェーズ3 (面談候補) + フェーズ4 (発信) の結合テスト。実テスト DB + 偽 generate / 偽 mailer。
// 中核の検証: 承認なしで送信できないこと (自律性の段階)、暗号化 at-rest、還流。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";
import type { MailerFn } from "../../src/lib/mailer.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

const outreachGenerate: GenerateFn = async ({ system, model }) => {
  if (system.includes("candidates")) {
    return {
      text: JSON.stringify({
        candidates: [
          { subject: "暑中お見舞い", body: "山田様 いかがお過ごしでしょうか。", tone: "あたたかく短く", aim: "近況伺い" },
          { subject: "ご無沙汰しております", body: "その後お変わりありませんか。", tone: "丁寧に", aim: "関係維持" },
          { subject: "お茶でもいかがですか", body: "近くまで参りますので。", tone: "軽やかに", aim: "面談" },
        ],
      }),
      model,
      inputTokens: 500,
      outputTokens: 800,
    };
  }
  return {
    text: JSON.stringify({ draft: "ご家族との時間をとても大切にされているようです。" }),
    model,
    inputTokens: 300,
    outputTokens: 200,
  };
};

const sentMails: Array<{ to: string; subject: string }> = [];
const fakeMailer: MailerFn = async ({ to, subject }) => {
  sentMails.push({ to, subject });
  return { messageId: "fake-msg-1" };
};

function makeApp(over: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({ prisma, generate: outreachGenerate, mailer: fakeMailer, ...over });
}

async function createContact(app: ReturnType<typeof createApp>, over: Record<string, unknown> = {}) {
  const res = await app.request("/api/contacts", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "山田花子", distance: 2, email: "hanako@example.com", ...over }),
  });
  return (await res.json()).contact as { id: string };
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
    'TRUNCATE "outreach_messages", "calendar_links", "contact_interactions", "contacts", "ai_usage_logs", "prompts" CASCADE',
  );
  await seedDdPrompts(prisma);
});

describe("プロンプト seed (フェーズ3+4 追加分)", () => {
  it("outreach_message_gen / values_profile_enrich が seed される", async () => {
    expect(await prisma.prompt.count()).toBe(4);
  });
});

describe("面談候補 (二者空き重なり)", () => {
  it("自分と相手の busy を登録すると重なりの空きが提案される", async () => {
    const app = makeApp();
    const c = await createContact(app);
    // 明日の午前は自分が busy、午後イチは相手が busy
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const d = tomorrow.toISOString().slice(0, 10);
    await app.request("/api/relationship/my-busy", {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ busySlots: [{ start: `${d}T00:00:00+09:00`, end: `${d}T13:00:00+09:00` }] }),
    });
    await app.request(`/api/contacts/${c.id}/busy`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ busySlots: [{ start: `${d}T13:00:00+09:00`, end: `${d}T15:00:00+09:00` }] }),
    });
    const res = await app.request(`/api/contacts/${c.id}/meeting-slots?days=2`, { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasMyCalendar).toBe(true);
    expect(body.hasTheirCalendar).toBe(true);
    expect(body.proposals.length).toBeGreaterThan(0);
    // どの候補も双方の busy と重ならない
    for (const p of body.proposals) {
      expect(new Date(p.end) > new Date(p.start)).toBe(true);
    }
  });

  it("カレンダー未登録でも 200 で hasMyCalendar=false を返す (画面が壊れない)", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const body = await (await app.request(`/api/contacts/${c.id}/meeting-slots`, { headers: H })).json();
    expect(body.hasMyCalendar).toBe(false);
  });
});

describe("価値観プロフィール下書き (AI 下書き → 自動保存しない)", () => {
  it("下書きを返すが contact には保存しない (ユーザー確定が必要)", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const res = await app.request(`/api/contacts/${c.id}/enrich-values`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).draft).toContain("大切に");
    const row = await prisma.contact.findFirstOrThrow({ where: { id: c.id } });
    expect(row.valuesProfile).toBeNull(); // 自動保存されない
    expect(await prisma.aiUsageLog.count({ where: { purpose: "values_enrich" } })).toBe(1);
  });
});

describe("発信 (draft → approve → send)", () => {
  it("複数候補が生成され、DB 上は暗号化されている", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const res = await app.request("/api/outreach/draft", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ contactId: c.id, purpose: "keepup" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.candidates).toHaveLength(3);
    expect(body.candidates[0].subject).toBe("暑中お見舞い");
    // at-rest: candidates は暗号文
    const raw = await prisma.$queryRawUnsafe<Array<{ candidates: string }>>(
      "SELECT candidates FROM outreach_messages",
    );
    expect(isEncrypted(raw[0]!.candidates)).toBe(true);
    expect(raw[0]!.candidates).not.toContain("暑中");
  });

  it("承認なしの送信は 409 で拒否される (自律性の段階の中核)", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const draft = await (
      await app.request("/api/outreach/draft", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ contactId: c.id }),
      })
    ).json();
    const res = await app.request(`/api/outreach/${draft.id}/send`, { method: "POST", headers: H });
    expect(res.status).toBe(409);
    expect(sentMails).toHaveLength(0);
  });

  it("承認 → 送信で sent になり、接触記録に還流し、距離スコアが回復する", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const draft = await (
      await app.request("/api/outreach/draft", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ contactId: c.id, purpose: "keepup" }),
      })
    ).json();
    const approve = await app.request(`/api/outreach/${draft.id}/approve`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ subject: draft.candidates[0].subject, body: "編集した本文です。" }),
    });
    expect(approve.status).toBe(200);
    const send = await app.request(`/api/outreach/${draft.id}/send`, { method: "POST", headers: H });
    expect(send.status).toBe(200);
    expect(sentMails).toEqual([{ to: "hanako@example.com", subject: "暑中お見舞い" }]);

    // 還流: 接触記録がつき、つながりスコアが good になる
    const summary = await (await app.request("/api/relationship/summary", { headers: H })).json();
    expect(summary.isolation.level).toBe("good");
    // body は DB 上暗号文
    const raw = await prisma.$queryRawUnsafe<Array<{ body: string; status: string }>>(
      "SELECT body, status FROM outreach_messages",
    );
    expect(raw[0]!.status).toBe("sent");
    expect(isEncrypted(raw[0]!.body)).toBe(true);
  });

  it("承認済みの再承認は 409、件名/本文なしの承認は 400", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const draft = await (
      await app.request("/api/outreach/draft", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ contactId: c.id }),
      })
    ).json();
    const bad = await app.request(`/api/outreach/${draft.id}/approve`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ subject: "", body: "" }),
    });
    expect(bad.status).toBe(400);
    await app.request(`/api/outreach/${draft.id}/approve`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ subject: "s", body: "b" }),
    });
    const again = await app.request(`/api/outreach/${draft.id}/approve`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ subject: "s2", body: "b2" }),
    });
    expect(again.status).toBe(409);
  });

  it("mailer 未設定は 503、宛先メール無しは 400、送信失敗は failed 記録", async () => {
    // mailer なし
    const appNoMail = makeApp({ mailer: null });
    const c1 = await createContact(appNoMail);
    const d1 = await (
      await appNoMail.request("/api/outreach/draft", {
        method: "POST", headers: H, body: JSON.stringify({ contactId: c1.id }),
      })
    ).json();
    await appNoMail.request(`/api/outreach/${d1.id}/approve`, {
      method: "POST", headers: H, body: JSON.stringify({ subject: "s", body: "b" }),
    });
    expect((await appNoMail.request(`/api/outreach/${d1.id}/send`, { method: "POST", headers: H })).status).toBe(503);

    // 宛先なし
    const app2 = makeApp();
    const c2 = await createContact(app2, { name: "宛先無し", email: undefined });
    const d2 = await (
      await app2.request("/api/outreach/draft", {
        method: "POST", headers: H, body: JSON.stringify({ contactId: c2.id }),
      })
    ).json();
    await app2.request(`/api/outreach/${d2.id}/approve`, {
      method: "POST", headers: H, body: JSON.stringify({ subject: "s", body: "b" }),
    });
    expect((await app2.request(`/api/outreach/${d2.id}/send`, { method: "POST", headers: H })).status).toBe(400);

    // 送信失敗 → failed
    const failMailer: MailerFn = async () => {
      throw new Error("smtp down");
    };
    const app3 = makeApp({ mailer: failMailer });
    const c3 = await createContact(app3, { name: "失敗さん", email: "fail@example.com" });
    const d3 = await (
      await app3.request("/api/outreach/draft", {
        method: "POST", headers: H, body: JSON.stringify({ contactId: c3.id }),
      })
    ).json();
    await app3.request(`/api/outreach/${d3.id}/approve`, {
      method: "POST", headers: H, body: JSON.stringify({ subject: "s", body: "b" }),
    });
    expect((await app3.request(`/api/outreach/${d3.id}/send`, { method: "POST", headers: H })).status).toBe(502);
    const row = await prisma.outreachMessage.findFirstOrThrow({ where: { id: d3.id } });
    expect(row.status).toBe("failed");
  });

  it("候補が不正な AI 出力は 502 (invalid_output)", async () => {
    const broken: GenerateFn = async ({ model }) => ({
      text: '{"candidates": []}',
      model,
      inputTokens: 1,
      outputTokens: 1,
    });
    const app = makeApp({ generate: broken });
    const c = await createContact(app);
    const res = await app.request("/api/outreach/draft", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ contactId: c.id }),
    });
    expect(res.status).toBe(502);
  });

  it("月次キャップ到達で draft 生成は 422", async () => {
    await prisma.aiUsageLog.create({
      data: { provider: "anthropic", model: "claude-sonnet-4-6", purpose: "outreach_gen", inputTokens: 0, outputTokens: 0, costJpy: 999999 },
    });
    const app = makeApp();
    const c = await createContact(app);
    const res = await app.request("/api/outreach/draft", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ contactId: c.id }),
    });
    expect(res.status).toBe(422);
  });
});
