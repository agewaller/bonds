// ZenTrack 受け口 (/api/ingest/zentrack) の結合テスト。
// 文字起こしを受けて会話抽出 → 関係グラフに人物が溜まる。専用シークレットで認証。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const INGEST_SECRET = "zentrack-test-secret";

let prisma: ExtendedPrismaClient;

// 会話から人物を1人抽出する偽 AI (import_extract の people JSON 契約)。
const fakeExtract: GenerateFn = async ({ model }) => ({
  text: JSON.stringify({
    people: [{ name: "田中 花子", relationship: "friend", note: "お孫さんが生まれたばかり" }],
  }),
  model,
  inputTokens: 100,
  outputTokens: 50,
});

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
  delete process.env.ZENTRACK_INGEST_SECRET;
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "import_jobs", "contacts", "contact_interactions", "ai_usage_logs", "prompts", "voice_memos" CASCADE');
  await seedDdPrompts(prisma);
});

describe("ZenTrack 受け口 (/api/ingest/zentrack)", () => {
  it("シークレット未設定なら準備中 (503)", async () => {
    delete process.env.ZENTRACK_INGEST_SECRET;
    const app = createApp({ prisma, generate: fakeExtract });
    const res = await app.request("/api/ingest/zentrack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "今日は田中さんとお茶をした" }),
    });
    expect(res.status).toBe(503);
  });

  it("シークレットが違えば 401、文字起こしが空なら 400", async () => {
    process.env.ZENTRACK_INGEST_SECRET = INGEST_SECRET;
    const app = createApp({ prisma, generate: fakeExtract });
    const wrong = await app.request("/api/ingest/zentrack", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-zentrack-secret": "nope" },
      body: JSON.stringify({ transcript: "text" }),
    });
    expect(wrong.status).toBe(401);
    const empty = await app.request("/api/ingest/zentrack", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-zentrack-secret": INGEST_SECRET },
      body: JSON.stringify({ transcript: "   " }),
    });
    expect(empty.status).toBe(400);
  });

  it("正しいシークレットで文字起こしを送ると、会話から人物が関係グラフに溜まる", async () => {
    process.env.ZENTRACK_INGEST_SECRET = INGEST_SECRET;
    const app = createApp({ prisma, generate: fakeExtract });
    const res = await app.request("/api/ingest/zentrack", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-zentrack-secret": INGEST_SECRET },
      body: JSON.stringify({
        transcript: "今日は田中花子さんとお茶をした。お孫さんが生まれたばかりで嬉しそうだった。",
        date: "2026-07-09",
        label: "朝のふりかえり",
      }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.jobId).toBe("string");

    // 会話抽出 → applyImport で連絡先が owner に溜まっている
    const contacts = await prisma.contact.findMany({ where: { ownerUid: "owner" } });
    expect(contacts.length).toBe(1);
    expect(contacts[0]!.name).toBe("田中 花子");
    // ジョブは done になり、本文は保持しない (データ最小化)
    const job = await prisma.importJob.findUnique({ where: { id: body.jobId } });
    expect(job!.status).toBe("done");
    expect(job!.payload).toBe("");
    // 録音メモ (タスクと課題) にも入る (source=zentrack・ハッシュつき)
    expect(body.memo).toBe("created");
    const memos = await prisma.voiceMemo.findMany({ where: { ownerUid: "owner" } });
    expect(memos).toHaveLength(1);
    expect(memos[0]!.source).toBe("zentrack");
    expect(memos[0]!.contentHash).toBeTruthy();
    expect(memos[0]!.subject).toBe("朝のふりかえり");
  });

  it("同じ文字起こしをもう一度送っても録音メモは増えない (経路内の冪等)", async () => {
    process.env.ZENTRACK_INGEST_SECRET = INGEST_SECRET;
    const app = createApp({ prisma, generate: fakeExtract });
    const payload = {
      transcript: "会議メモ。金曜までに見積もりを送る。",
      date: "2026-07-20",
      label: "会議",
    };
    const first = await app.request("/api/ingest/zentrack", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-zentrack-secret": INGEST_SECRET },
      body: JSON.stringify(payload),
    });
    expect((await first.json()).memo).toBe("created");
    const again = await app.request("/api/ingest/zentrack", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-zentrack-secret": INGEST_SECRET },
      body: JSON.stringify(payload),
    });
    expect((await again.json()).memo).toBe("duplicate");
    expect(await prisma.voiceMemo.count()).toBe(1);
  });

  it("Gmail 経由で取り込み済みの文字起こしは、ZenTrack から届いても二重にしない (経路またぎの冪等)", async () => {
    process.env.ZENTRACK_INGEST_SECRET = INGEST_SECRET;
    const app = createApp({ prisma, generate: fakeExtract });
    const transcript = "打ち合わせ。来週の火曜に資料を持参する。  ";
    // Gmail 経路で入った既存メモ (ハッシュ未計上の旧行 = backfill の対象) を再現
    await prisma.voiceMemo.create({
      data: {
        ownerUid: "owner",
        gmailMessageId: "gm-1",
        source: "gmail",
        content: "打ち合わせ。来週の火曜に資料を持参する。",
      },
    });
    const res = await app.request("/api/ingest/zentrack", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-zentrack-secret": INGEST_SECRET },
      body: JSON.stringify({ transcript, label: "打ち合わせ" }),
    });
    expect((await res.json()).memo).toBe("duplicate"); // 空白のゆらぎがあっても同一と判定
    expect(await prisma.voiceMemo.count()).toBe(1);
    // backfill で既存行にもハッシュが付いている
    const row = await prisma.voiceMemo.findFirstOrThrow({ where: { gmailMessageId: "gm-1" } });
    expect(row.contentHash).toBeTruthy();
  });
});
