// 相手情報の収集強化の結合テスト: ①近況メモ・返信の還流 (note → 接触記録 + 論点自動更新)
// ②会った直後のひとこと伺い (recent-meetings) ③1日1問 (daily-question)
// ④会社の最近の動き (company-news = 会社の公開ニュース検索 + 要約)
// ⑤トーク履歴の中身からの近況整理 (import 時の talk_digest)
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
delete process.env.PERSON_DD_MONTHLY_CAP_JPY;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

// 呼ばれたプロンプト種別に応じて答える偽 AI (system 本文で見分ける)
const fakeGenerate: GenerateFn = async ({ model, system }) => {
  let text: string;
  if (system.includes("トーク履歴")) {
    text = JSON.stringify({ note: "7月に引っ越しを控えているとのこと。仕事は変わらず設計を続けている。" });
  } else if (system.includes("最近の動き")) {
    text = JSON.stringify({ news: "6月に新工場の建設を発表しました。", hook: "新工場のご発表、拝見しました。おめでとうございます。" });
  } else {
    text = JSON.stringify({ summary: "誠実な方。", status: "引っ越し準備中", skills: [], concerns: [], goals: [], opportunities: [] });
  }
  return { text, model, inputTokens: 10, outputTokens: 30 };
};

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "contact_interactions", "contacts", "import_jobs", "ai_usage_logs", "prompts", "app_config" CASCADE',
  );
  await seedDdPrompts(prisma);
});

describe("近況メモ・返信の還流 (POST /api/contacts/:id/note)", () => {
  it("メモが接触記録になり、論点整理も自動で更新される", async () => {
    const app = createApp({ prisma, generate: fakeGenerate });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "田中先輩" } });
    const res = await app.request(`/api/contacts/${ct.id}/note`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ text: "久しぶりに会った。引っ越すらしい" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.facetsUpdated).toBe(true);
    const rows = await prisma.contactInteraction.findMany({ where: { contactId: ct.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("note");
    expect(rows[0]!.notes).toContain("引っ越す");
    const saved = await prisma.contact.findUnique({ where: { id: ct.id } });
    expect(JSON.parse(saved!.profileFacets!).status).toBe("引っ越し準備中");
  });

  it("返信の貼り付けは message として記録され、AI 未設定でも記録は残る", async () => {
    const app = createApp({ prisma, generate: null });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "鈴木" } });
    const res = await app.request(`/api/contacts/${ct.id}/note`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ text: "お元気ですか。おかげさまで娘の受験も終わりました", kind: "reply" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).facetsUpdated).toBe(false);
    const rows = await prisma.contactInteraction.findMany({ where: { contactId: ct.id } });
    expect(rows[0]!.type).toBe("message");
  });

  it("空の内容は 400", async () => {
    const app = createApp({ prisma, generate: null });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "空欄" } });
    const res = await app.request(`/api/contacts/${ct.id}/note`, { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(400);
  });
});

describe("会った直後のひとこと伺い (GET /api/relationship/recent-meetings)", () => {
  it("直近に会った方が挙がり、メモを書いたら消える", async () => {
    const app = createApp({ prisma, generate: null });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "面会 太郎" } });
    await prisma.contactInteraction.create({
      data: { contactId: ct.id, type: "meeting", occurredAt: new Date(Date.now() - 86_400_000) },
    });
    let body = await (await app.request("/api/relationship/recent-meetings", { headers: H })).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("面会 太郎");

    await app.request(`/api/contacts/${ct.id}/note`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ text: "お元気そうだった" }),
    });
    body = await (await app.request("/api/relationship/recent-meetings", { headers: H })).json();
    expect(body.items).toEqual([]);
  });
});

describe("1日1問 (GET /api/relationship/daily-question)", () => {
  it("知らない論点についての質問が返り、今日メモを書いた相手は選ばれない", async () => {
    const app = createApp({ prisma, generate: null });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "田中" } });
    let body = await (await app.request("/api/relationship/daily-question", { headers: H })).json();
    expect(body.question).not.toBeNull();
    expect(body.question.contactId).toBe(ct.id);
    expect(body.question.question).toContain("田中さん");

    // 答えを還流すると、今日はもう聞かない
    await app.request(`/api/contacts/${ct.id}/note`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ text: "設計の仕事をしている" }),
    });
    body = await (await app.request("/api/relationship/daily-question", { headers: H })).json();
    expect(body.question).toBeNull();
  });
});

describe("会社の最近の動き (POST /api/contacts/:id/company-news)", () => {
  const search = async () => [
    { title: "商事会社 新工場を発表", url: "https://example.com/news1", snippet: "商事会社は6月、新工場の建設を発表した" },
  ];

  it("会社の公開ニュースを要約し、連絡のきっかけと出典を返す", async () => {
    const app = createApp({ prisma, generate: fakeGenerate, search });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "営業 太郎", company: "商事会社" } });
    const res = await app.request(`/api/contacts/${ct.id}/company-news`, { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.news).toContain("新工場");
    expect(body.hook).toContain("おめでとうございます");
    expect(body.sources).toContain("https://example.com/news1");
  });

  it("所属が無い方は 422、検索が未設定なら 503 に縮退する", async () => {
    const app = createApp({ prisma, generate: fakeGenerate, search });
    const noCompany = await prisma.contact.create({ data: { ownerUid: "owner", name: "無所属" } });
    expect((await app.request(`/api/contacts/${noCompany.id}/company-news`, { method: "POST", headers: H, body: "{}" })).status).toBe(422);

    const appNoSearch = createApp({ prisma, generate: fakeGenerate, search: null });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "営業", company: "商事会社" } });
    expect((await appNoSearch.request(`/api/contacts/${ct.id}/company-news`, { method: "POST", headers: H, body: "{}" })).status).toBe(503);
  });
});

describe("トーク履歴の中身からの近況整理 (import + talk_digest)", () => {
  const LINE_TALK = [
    "[LINE] 田中太郎とのトーク履歴",
    "2026/07/10(金)",
    "10:23\t田中太郎\tこんにちは",
    "10:24\t田中太郎\t来月引っ越します",
  ].join("\n");

  it("トーク履歴の取込で、相手の近況メモが自動で添えられる", async () => {
    const app = createApp({ prisma, generate: fakeGenerate });
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: LINE_TALK, filename: "talk.txt" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.talkNotes).toBe(1);
    const ct = await prisma.contact.findFirst({ where: { ownerUid: "owner", name: "田中太郎" } });
    expect(ct!.notes).toContain("引っ越し");
  });

  it("AI 未設定でもトーク履歴の取込自体は従来どおり通る", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: LINE_TALK, filename: "talk.txt" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.talkNotes).toBe(0);
  });
});
