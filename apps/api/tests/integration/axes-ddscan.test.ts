// 軸検索・公人評価の自動下ごしらえ (dd-scan)・SNS 候補の仮登録の結合テスト。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";
import type { SearchFn } from "../../src/lib/tavily.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
delete process.env.PERSON_DD_MONTHLY_CAP_JPY;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

// identify には名前に応じた候補、digest には散文、DD 評価には不正出力 (失敗として記録される)
const fakeGenerate: GenerateFn = async ({ model, system, userMessage }) => {
  let text = "not-json";
  if (system.includes("人物名の曖昧さを解消する係")) {
    text = userMessage.includes("曖昧")
      ? JSON.stringify({
          candidates: [
            { name: "曖昧 太郎", description: "青空商事の社長。1960年生まれ" },
            { name: "曖昧 太郎", description: "作家。同名の別人" },
          ],
        })
      : JSON.stringify({ candidates: [{ name: "特定 一意", description: "赤山工業の社長。製造業の経営者" }] });
  } else if (system.includes("相棒")) {
    text = JSON.stringify({ digest: "最近は新しい事業を始めた様子です。" });
  }
  return { text, model, inputTokens: 5, outputTokens: 10 };
};

const searchFn: SearchFn = async () => [
  { url: "https://x.com/tokutei_ichii", title: "特定 一意 (@tokutei_ichii)", snippet: "赤山工業の社長" },
  { url: "https://x.com/tokutei_ichii/status/1", title: "投稿", snippet: "新事業" },
];

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "dd_suggestions", "person_links", "person_dd_steps", "person_due_diligences", "dd_subjects", "suggestion_dismissals", "contacts", "prompts", "ai_usage_logs", "app_config" CASCADE',
  );
  await seedDdPrompts(prisma);
});

describe("軸検索 (GET /api/relationship/axis-search)", () => {
  it("影響力の軸で、社長の肩書きの方だけが理由つきで挙がる", async () => {
    const app = createApp({ prisma, generate: null });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "社長 一郎", title: "代表取締役社長", company: "青空商事" } });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "平社員 次郎" } });
    const body = await (await app.request("/api/relationship/axis-search?axis=influence", { headers: H })).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("社長 一郎");
    expect(body.items[0].reasons.join(" ")).toContain("代表取締役社長");
    // 不正な軸は 400
    expect((await app.request("/api/relationship/axis-search?axis=bogus", { headers: H })).status).toBe(400);
  });
});

describe("公人評価の自動下ごしらえ (dd-scan)", () => {
  it("一意に特定→自動登録+評価実施。候補多数→保留でユーザーが選ぶ。公人らしくない方は対象外", async () => {
    const app = createApp({ prisma, generate: fakeGenerate, search: null });
    const unique = await prisma.contact.create({ data: { ownerUid: "owner", name: "特定 一意", title: "社長", company: "赤山工業" } });
    const ambiguous = await prisma.contact.create({ data: { ownerUid: "owner", name: "曖昧 太郎", title: "代表" } });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "平社員 三郎", title: "主任" } });

    const scan = await (await app.request("/api/admin/contacts/dd-scan?batch=5", { method: "POST", headers: H })).json();
    expect(scan.identified).toBe(1);
    expect(scan.held).toBe(1);
    expect(scan.evaluated).toBe(1); // 一意に特定した方の評価を 1 人ぶん実施 (結果は fake AI のため失敗記録でも可)

    // 一意 → subject + link + resolved
    const link = await prisma.personLink.findFirst({ where: { contactId: unique.id } });
    expect(link).toBeTruthy();
    const subject = await prisma.ddSubject.findUnique({ where: { id: link!.subjectId } });
    expect(subject!.name).toBe("特定 一意");
    expect(subject!.profileHint).toContain("赤山工業");
    // 評価の実行記録が残る (成否は問わない)
    expect(await prisma.personDueDiligence.count({ where: { subjectId: subject!.id } })).toBeGreaterThan(0);

    // 曖昧 → 保留 (確認待ち一覧に出る)
    const list = await (await app.request("/api/relationship/dd-suggestions", { headers: H })).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].contactId).toBe(ambiguous.id);
    expect(list.items[0].candidates).toHaveLength(2);

    // ユーザーが 1 人目を選ぶ → subject + link + resolved
    const resolve = await (
      await app.request(`/api/relationship/dd-suggestions/${list.items[0].id}/resolve`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ candidateIndex: 0 }),
      })
    ).json();
    expect(resolve.resolved).toBe(true);
    const link2 = await prisma.personLink.findFirst({ where: { contactId: ambiguous.id } });
    expect(link2).toBeTruthy();

    // 二度スキャンしても同じ方を重ねて確認しない
    const scan2 = await (await app.request("/api/admin/contacts/dd-scan?batch=5", { method: "POST", headers: H })).json();
    expect(scan2.identified + scan2.held).toBe(0);
  });
});

describe("SNS 候補の仮登録 (未確認 → 承認/削除)", () => {
  it("公開検索で見つけた本人らしきアカウントを候補として仮置きし、承認で登録・削除で再提示しない", async () => {
    const app = createApp({ prisma, generate: fakeGenerate, search: searchFn });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "特定 一意", company: "赤山工業" } });

    // 公開情報も調べてまとめ直す → 候補が仮置きされる
    const r = await (
      await app.request(`/api/contacts/${ct.id}/refresh-digest`, { method: "POST", headers: H, body: JSON.stringify({ includePublic: true }) })
    ).json();
    expect(r.snsFound).toBe(1);
    let sns = await (await app.request(`/api/contacts/${ct.id}/sns`, { headers: H })).json();
    expect(sns.candidates).toHaveLength(1);
    expect(sns.candidates[0]).toMatchObject({ platform: "x", handle: "tokutei_ichii" });
    expect(sns.accounts).toHaveLength(0); // まだ本人とは断定しない

    // 承認 → 正式な登録に移る
    sns = await (
      await app.request(`/api/contacts/${ct.id}/sns-candidates`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ action: "approve", platform: "x", handle: "tokutei_ichii" }),
      })
    ).json();
    expect(sns.accounts).toHaveLength(1);
    expect(sns.candidates).toHaveLength(0);
  });

  it("削除 (reject) した候補は、再び検索しても出てこない", async () => {
    const app = createApp({ prisma, generate: fakeGenerate, search: searchFn });
    const ct = await prisma.contact.create({ data: { ownerUid: "owner", name: "特定 一意", company: "赤山工業" } });
    await app.request(`/api/contacts/${ct.id}/refresh-digest`, { method: "POST", headers: H, body: JSON.stringify({ includePublic: true }) });
    await app.request(`/api/contacts/${ct.id}/sns-candidates`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ action: "reject", platform: "x", handle: "tokutei_ichii" }),
    });
    // もう一度調べ直しても、見送った候補は仮置きされない
    await app.request(`/api/contacts/${ct.id}/refresh-digest`, { method: "POST", headers: H, body: JSON.stringify({ includePublic: true }) });
    const sns = await (await app.request(`/api/contacts/${ct.id}/sns`, { headers: H })).json();
    expect(sns.candidates).toHaveLength(0);
    expect(sns.accounts).toHaveLength(0);
  });
});
