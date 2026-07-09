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
  await prisma.$executeRawUnsafe('TRUNCATE "import_jobs", "contacts", "contact_interactions", "ai_usage_logs", "prompts" CASCADE');
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
  });
});
