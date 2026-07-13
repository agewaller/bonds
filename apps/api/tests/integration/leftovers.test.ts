// 機能の積み残し実装 (チャンク A/B/D/E) の結合テスト。実テスト DB + 偽 AI/mailer/検索。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";
import type { SearchFn } from "../../src/lib/tavily.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

const candidateGenerate: GenerateFn = async ({ model }) => ({
  text: JSON.stringify({
    candidates: [
      { subject: "件名A", body: "本文A", tone: "a", aim: "x" },
      { subject: "件名B", body: "本文B", tone: "b", aim: "y" },
      { subject: "件名C", body: "本文C", tone: "c", aim: "z" },
    ],
  }),
  model,
  inputTokens: 10,
  outputTokens: 10,
});

function makeApp(over: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({
    prisma,
    generate: candidateGenerate,
    mailer: async () => ({ messageId: "m" }),
    search: null,
    ...over,
  });
}

async function createContact(app: ReturnType<typeof createApp>, over: Record<string, unknown> = {}) {
  const res = await app.request("/api/contacts", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "積残 太郎", distance: 3, email: "t@example.com", ...over }),
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
  await prisma.$executeRawUnsafe(
    'TRUNCATE "person_links", "person_dd_steps", "person_due_diligences", "dd_subjects", "outreach_messages", "calendar_links", "contact_gifts", "contact_interactions", "contacts", "ai_usage_logs", "prompts" CASCADE',
  );
  await seedDdPrompts(prisma);
});

describe("A: 贈り物の記録", () => {
  it("記録すると接触にも還流し、1 件単位で削除できる", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const res = await app.request(`/api/contacts/${c.id}/gifts`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ occasion: "birthday", item: "季節の花", amount: 3000, notes: "喜んでいただけた" }),
    });
    expect(res.status).toBe(201);
    const gift = (await res.json()).gift;
    expect(await prisma.contactInteraction.count()).toBe(1);
    const inter = await prisma.contactInteraction.findFirstOrThrow();
    expect(inter.type).toBe("gift_sent");
    // 詳細に載る
    const detail = await (await app.request(`/api/contacts/${c.id}`, { headers: H })).json();
    expect(detail.gifts).toHaveLength(1);
    // 削除
    const del = await app.request(`/api/contacts/${c.id}/gifts/${gift.id}`, { method: "DELETE", headers: H });
    expect(del.status).toBe(200);
    expect(await prisma.contactGift.count()).toBe(0);
  });

  it("item 無しは 400", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const res = await app.request(`/api/contacts/${c.id}/gifts`, {
      method: "POST", headers: H, body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("A: 発信チャネル (gift/nengajo) + mark-sent", () => {
  it("gift チャネルの draft → approve → mark-sent で贈り物と接触が記録される", async () => {
    let seenUserMessage = "";
    const spyGenerate: GenerateFn = async (args) => {
      seenUserMessage = args.userMessage;
      return candidateGenerate(args);
    };
    const app = makeApp({ generate: spyGenerate });
    const c = await createContact(app);
    const draft = await (
      await app.request("/api/outreach/draft", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ contactId: c.id, purpose: "birthday", channel: "gift" }),
      })
    ).json();
    expect(draft.channel).toBe("gift");
    expect(seenUserMessage).toContain("添え状"); // チャネル別の指示が入る
    // 未承認の mark-sent は 409
    expect(
      (await app.request(`/api/outreach/${draft.id}/mark-sent`, { method: "POST", headers: H, body: "{}" })).status,
    ).toBe(409);
    await app.request(`/api/outreach/${draft.id}/approve`, {
      method: "POST", headers: H, body: JSON.stringify({ subject: "お祝い", body: "添え状本文" }),
    });
    const done = await app.request(`/api/outreach/${draft.id}/mark-sent`, {
      method: "POST", headers: H, body: JSON.stringify({ item: "花束" }),
    });
    expect(done.status).toBe(200);
    expect(await prisma.contactGift.count()).toBe(1);
    const inter = await prisma.contactInteraction.findFirstOrThrow();
    expect(inter.type).toBe("gift_sent");
    const m = await prisma.outreachMessage.findFirstOrThrow();
    expect(m.status).toBe("sent");
  });
});

describe("A: 面談招待 (.ics)", () => {
  it("候補時間から text/calendar を返す。不正な時間は 400", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const res = await app.request(
      `/api/contacts/${c.id}/meeting-invite?start=2026-08-01T05:00:00Z&end=2026-08-01T06:00:00Z`,
      { headers: H },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("積残 太郎様と面談");
    expect(
      (await app.request(`/api/contacts/${c.id}/meeting-invite?start=bad&end=2026-08-01T06:00:00Z`, { headers: H })).status,
    ).toBe(400);
  });
});

describe("空き時間の貼り付けテキスト (/api/contacts/:id/free-slots-text)", () => {
  it("カレンダー未連携なら count 0 (勝手に全部空きにしない)", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const res = await app.request(`/api/contacts/${c.id}/free-slots-text`, { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasMyCalendar).toBe(false);
    expect(body.count).toBe(0);
    expect(body.text).toBe("");
  });

  it("自分の予定を登録すると空き時間が日本語テキストで返る", async () => {
    const app = makeApp();
    const c = await createContact(app);
    // 十分先の平日を busy に。営業時間内を一部埋めて空きが残るようにする
    const put = await app.request("/api/relationship/my-busy", {
      method: "PUT",
      headers: H,
      body: JSON.stringify({
        busySlots: [{ start: "2030-01-01T00:00:00Z", end: "2030-01-01T00:30:00Z" }],
      }),
    });
    expect(put.status).toBe(200);
    const res = await app.request(`/api/contacts/${c.id}/free-slots-text?days=30`, { headers: H });
    const body = await res.json();
    expect(body.hasMyCalendar).toBe(true);
    expect(body.basis).toBe("mine");
    expect(typeof body.text).toBe("string");
    // 記号 (BR-09) を含まない
    expect(body.text).not.toMatch(/[・*＊#※]/);
  });
});

describe("B: 前進の記録 (ゲーミフィケーション)", () => {
  it("接触を重ねるとバッジと次の節目が返る", async () => {
    const app = makeApp();
    const c = await createContact(app);
    await app.request(`/api/contacts/${c.id}/interactions`, {
      method: "POST", headers: H, body: JSON.stringify({ type: "call" }),
    });
    const p = await (await app.request("/api/relationship/progress", { headers: H })).json();
    expect(p.streakDays).toBe(1);
    expect(p.totalInteractions).toBe(1);
    expect(p.badges.find((b: { key: string }) => b.key === "first_step")?.achieved).toBe(true);
    expect(p.nextMilestone).not.toBeNull();
  });
});

describe("D: 人物DD 検索ステップ (Tavily 注入)", () => {
  it("検索器があれば search ステップが completed になり、参考情報が evaluate に渡る", async () => {
    let evalMessage = "";
    const ddGenerate: GenerateFn = async (args) => {
      evalMessage = args.userMessage;
      return {
        text: JSON.stringify({ identified: false, reason: "テスト", needed_info: "" }),
        model: args.model,
        inputTokens: 10,
        outputTokens: 10,
      };
    };
    const fakeSearch: SearchFn = async (q) => [
      { title: `結果 ${q}`, url: "https://example.com/a", snippet: "公開情報の抜粋" },
    ];
    const app = makeApp({ generate: ddGenerate, search: fakeSearch });
    const subj = await (
      await app.request("/api/dd/subjects", {
        method: "POST", headers: H, body: JSON.stringify({ name: "検索対象" }),
      })
    ).json();
    const res = await app.request(`/api/dd/subjects/${subj.subject.slug}/run`, {
      method: "POST", headers: H, body: JSON.stringify({ ddType: "consciousness_7d" }),
    });
    expect(res.status).toBe(200);
    const steps = await prisma.personDdStep.findMany({ orderBy: { createdAt: "asc" } });
    expect(steps.map((s) => `${s.stepKey}:${s.status}`)).toEqual(["search:completed", "evaluate:completed"]);
    expect(evalMessage).toContain("https://example.com/a"); // 出典つきで注入
    expect(evalMessage).toContain("確からしさは自分で判定");
  });

  it("検索が失敗しても評価は知識ベースで続行する (failed 記録)", async () => {
    const boom: SearchFn = async () => {
      throw new Error("tavily down");
    };
    const ddGenerate: GenerateFn = async (args) => ({
      text: JSON.stringify({ identified: false, reason: "r", needed_info: "" }),
      model: args.model, inputTokens: 1, outputTokens: 1,
    });
    const app = makeApp({ generate: ddGenerate, search: boom });
    const subj = await (
      await app.request("/api/dd/subjects", {
        method: "POST", headers: H, body: JSON.stringify({ name: "失敗対象" }),
      })
    ).json();
    const res = await app.request(`/api/dd/subjects/${subj.subject.slug}/run`, {
      method: "POST", headers: H, body: JSON.stringify({ ddType: "consciousness_7d" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.consciousness_7d.status).toBe("completed");
    const steps = await prisma.personDdStep.findMany({ orderBy: { createdAt: "asc" } });
    expect(steps[0]).toMatchObject({ stepKey: "search", status: "failed" });
  });
});

describe("E: person_links (公人 ⇔ 連絡先)", () => {
  it("slug でリンクし、詳細に載り、外せる", async () => {
    const app = makeApp();
    const c = await createContact(app);
    const subj = await (
      await app.request("/api/dd/subjects", {
        method: "POST", headers: H, body: JSON.stringify({ name: "Public Person" }),
      })
    ).json();
    const link = await app.request(`/api/contacts/${c.id}/links`, {
      method: "POST", headers: H, body: JSON.stringify({ slug: subj.subject.slug }),
    });
    expect(link.status).toBe(201);
    const detail = await (await app.request(`/api/contacts/${c.id}`, { headers: H })).json();
    expect(detail.linkedSubjects).toHaveLength(1);
    expect(detail.linkedSubjects[0].name).toBe("Public Person");
    const del = await app.request(`/api/contacts/${c.id}/links/${detail.linkedSubjects[0].linkId}`, {
      method: "DELETE", headers: H,
    });
    expect(del.status).toBe(200);
    // 存在しない slug は 404
    expect(
      (await app.request(`/api/contacts/${c.id}/links`, { method: "POST", headers: H, body: JSON.stringify({ slug: "nope" }) })).status,
    ).toBe(404);
  });
});

describe("E: プロンプト版管理 (管理 API)", () => {
  it("一覧が返り、編集は新しい版として積まれる (既存版は不変)", async () => {
    const app = makeApp();
    const list = await (await app.request("/api/admin/prompts", { headers: H })).json();
    expect(list.prompts.length).toBe(14);
    const post = await app.request("/api/admin/prompts/person_eval_7d", {
      method: "POST", headers: H, body: JSON.stringify({ body: "改訂版プロンプト" }),
    });
    expect(post.status).toBe(201);
    expect((await post.json()).prompt.version).toBe(2);
    // 旧版は残っている
    expect(await prisma.prompt.count({ where: { key: "person_eval_7d" } })).toBe(2);
    // ランナーは最新版を拾う
    const { getPromptText } = await import("../../src/dd/runner.js");
    const latest = await getPromptText(prisma, "person_eval_7d");
    expect(latest?.version).toBe(2);
    expect(latest?.body).toBe("改訂版プロンプト");
  });
});
