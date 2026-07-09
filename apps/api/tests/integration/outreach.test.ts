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
  it("outreach_message_gen / values_profile_enrich / partner 系が seed される", async () => {
    expect(await prisma.prompt.count()).toBe(13);
    expect(await prisma.prompt.count({ where: { key: { startsWith: "partner_" } } })).toBe(3);
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

describe("ICS カレンダー同期 (ライブ同期)", () => {
  const ICS = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20990101T010000Z\nDTEND:20990101T020000Z\nEND:VEVENT\nEND:VCALENDAR";

  it("icsUrl 登録で取得・保存され、URL は DB 上暗号化される", async () => {
    let served = ICS;
    const app = makeApp({ fetchText: async () => served });
    await app.request("/api/relationship/my-busy", {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ icsUrl: "https://calendar.google.com/secret.ics" }),
    }).then(async (r) => expect((await r.json()).saved).toBe(1));
    const raw = await prisma.$queryRawUnsafe<Array<{ ics_url: string; provider: string }>>(
      "SELECT ics_url, provider FROM calendar_links",
    );
    expect(raw[0]!.provider).toBe("ics");
    expect(isEncrypted(raw[0]!.ics_url)).toBe(true); // 秘密のアドレス = トークンとして暗号化
    expect(raw[0]!.ics_url).not.toContain("google");

    // refresh で最新の中身に更新される (ライブ同期)
    served = ICS.replace("END:VEVENT", "END:VEVENT\nBEGIN:VEVENT\nDTSTART:20990102T010000Z\nDTEND:20990102T020000Z\nEND:VEVENT");
    const ref = await (await app.request("/api/relationship/refresh-calendars", { method: "POST", headers: H })).json();
    expect(ref).toMatchObject({ refreshed: 1, failed: [] });
    const link = await prisma.calendarLink.findFirstOrThrow();
    expect(link.busySlots).toHaveLength(2);
  });

  it("ICS 貼り付けでも取り込め、http URL や非 ICS は 400", async () => {
    const app = makeApp({ fetchText: async () => "not an ics" });
    const paste = await app.request("/api/relationship/my-busy", {
      method: "PUT", headers: H, body: JSON.stringify({ ics: ICS }),
    });
    expect((await paste.json()).saved).toBe(1);
    expect((await app.request("/api/relationship/my-busy", {
      method: "PUT", headers: H, body: JSON.stringify({ icsUrl: "http://insecure" }),
    })).status).toBe(400);
    expect((await app.request("/api/relationship/my-busy", {
      method: "PUT", headers: H, body: JSON.stringify({ icsUrl: "https://example.com/x.ics" }),
    })).status).toBe(400);
  });
});

describe("一括配信キュー (schedule → process-queue)", () => {
  async function approvedMessage(app: ReturnType<typeof makeApp>, email = "q@example.com") {
    const c = await createContact(app, { name: `キュー ${Math.random()}`, email });
    const d = await (await app.request("/api/outreach/draft", {
      method: "POST", headers: H, body: JSON.stringify({ contactId: c.id }),
    })).json();
    await app.request(`/api/outreach/${d.id}/approve`, {
      method: "POST", headers: H, body: JSON.stringify({ subject: "s", body: "b" }),
    });
    return d.id as string;
  }

  it("承認済みだけ schedule でき、期限到来分だけ process-queue が送る", async () => {
    const app = makeApp();
    const dueId = await approvedMessage(app);
    const futureId = await approvedMessage(app, "future@example.com");
    // 未承認 (draft) は schedule できない
    const c3 = await createContact(app, { name: "未承認", email: "x@example.com" });
    const draft3 = await (await app.request("/api/outreach/draft", {
      method: "POST", headers: H, body: JSON.stringify({ contactId: c3.id }),
    })).json();
    expect((await app.request(`/api/outreach/${draft3.id}/schedule`, {
      method: "POST", headers: H, body: JSON.stringify({}),
    })).status).toBe(409);

    await app.request(`/api/outreach/${dueId}/schedule`, {
      method: "POST", headers: H, body: JSON.stringify({}), // いますぐ
    });
    await app.request(`/api/outreach/${futureId}/schedule`, {
      method: "POST", headers: H, body: JSON.stringify({ sendAt: "2099-01-01T00:00:00Z" }),
    });

    const r = await (await app.request("/api/admin/outreach/process-queue", {
      method: "POST", headers: H,
    })).json();
    expect(r).toMatchObject({ picked: 1, sent: 1, failed: 0 });
    expect(sentMails).toHaveLength(1);
    // 期限未到来はそのまま approved
    const future = await prisma.outreachMessage.findFirstOrThrow({ where: { id: futureId } });
    expect(future.status).toBe("approved");
    // 送信済みは還流までされている
    const sentRow = await prisma.outreachMessage.findFirstOrThrow({ where: { id: dueId } });
    expect(sentRow.status).toBe("sent");
    expect(await prisma.contactInteraction.count()).toBe(1);
  });

  it("1 通の失敗は failed 記録して残りを送り続ける (batch 上限つき)", async () => {
    let call = 0;
    const flakyMailer: MailerFn = async (args) => {
      call++;
      if (args.to === "boom@example.com") throw new Error("smtp down");
      return { messageId: `m${call}` };
    };
    const app = makeApp({ mailer: flakyMailer });
    const okId = await approvedMessage(app, "ok@example.com");
    const boomId = await approvedMessage(app, "boom@example.com");
    for (const id of [okId, boomId]) {
      await app.request(`/api/outreach/${id}/schedule`, { method: "POST", headers: H, body: "{}" });
    }
    const r = await (await app.request("/api/admin/outreach/process-queue?batch=1", {
      method: "POST", headers: H,
    })).json();
    expect(r.picked).toBe(1); // batch 上限
    const r2 = await (await app.request("/api/admin/outreach/process-queue", {
      method: "POST", headers: H,
    })).json();
    expect(r.sent + r2.sent).toBe(1);
    expect(r.failed + r2.failed).toBe(1);
    expect((await prisma.outreachMessage.findFirstOrThrow({ where: { id: boomId } })).status).toBe("failed");
  });
});
