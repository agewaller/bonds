// 録音デバイス汎用の受信口 (/api/inbound/conversation) の結合テスト:
// 共有シークレット認証 → Omi 形式/素の text の両方を受ける → Plaud と同じ録音メモとして
// 保存・整理 → 外部 id で冪等。AI 無しでもメモは残る。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };
const SECRET = "test-inbound-secret";

let prisma: ExtendedPrismaClient;

const fakeGenerate: GenerateFn = async ({ model }) => ({
  text: JSON.stringify({
    summary: "打ち合わせの要点です。",
    tasks: [{ text: "資料を送る", kind: "task" }],
  }),
  model,
  inputTokens: 10,
  outputTokens: 20,
});

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "voice_memos", "prompts", "ai_usage_logs", "app_config" CASCADE');
  await seedDdPrompts(prisma);
  process.env.INBOUND_WEBHOOK_SECRET = SECRET;
});

const post = (app: ReturnType<typeof createApp>, body: unknown, opts?: { secret?: string; source?: string }) =>
  app.request(`/api/inbound/conversation${opts?.source ? `?source=${opts.source}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-inbound-secret": opts?.secret ?? SECRET },
    body: JSON.stringify(body),
  });

describe("録音デバイス汎用の受信口", () => {
  it("シークレット未設定は 503・不一致は 401 (fail closed)", async () => {
    const app = createApp({ prisma, generate: fakeGenerate });
    delete process.env.INBOUND_WEBHOOK_SECRET;
    expect((await post(app, { text: "会話" })).status).toBe(503);
    process.env.INBOUND_WEBHOOK_SECRET = SECRET;
    expect((await post(app, { text: "会話" }, { secret: "wrong" })).status).toBe(401);
    expect((await post(app, {})).status).toBe(400); // text 無し
  });

  it("Omi 形式 (transcript_segments) を平文化して録音メモに保存し、タスクを整理する", async () => {
    const app = createApp({ prisma, generate: fakeGenerate });
    const res = await post(
      app,
      {
        id: "omi-mem-1",
        created_at: "2026-07-21T09:00:00Z",
        structured: { title: "山田さんと打ち合わせ" },
        transcript_segments: [
          { text: "資料は金曜までに送りますね", speaker: "自分" },
          { text: "はい、お願いします", speaker: "山田" },
        ],
      },
      { source: "omi" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stored).toBe(true);
    expect(body.digested).toBe(true);

    const list = await (await app.request("/api/relationship/voice-memos", { headers: H })).json();
    expect(list.memos).toHaveLength(1);
    expect(list.memos[0].subject).toBe("山田さんと打ち合わせ");
    expect(list.memos[0].summary).toContain("要点");
    expect(list.memos[0].tasks).toHaveLength(1);

    // DB 上は中身が暗号化されている
    const raw = await prisma.$queryRawUnsafe<{ content: string; gmail_message_id: string }[]>(
      "SELECT content, gmail_message_id FROM voice_memos LIMIT 1",
    );
    expect(isEncrypted(raw[0]!.content)).toBe(true);
    expect(raw[0]!.gmail_message_id).toBe("ext:omi:omi-mem-1");

    // 同じ外部 id は冪等 (二重保存しない)
    const again = await post(app, { id: "omi-mem-1", text: "同じ会話" }, { source: "omi" });
    expect((await again.json()).duplicate).toBe(true);
    const count = await prisma.voiceMemo.count();
    expect(count).toBe(1);
  });

  it("素の text だけでも保存でき、AI 無しならメモだけ残る (id 無しは本文ハッシュで冪等)", async () => {
    const app = createApp({ prisma }); // generate 無し
    const res = await post(app, { text: "きょうの散歩で佐藤さんに会った" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stored).toBe(true);
    expect(body.digested).toBe(false);

    const memo = await prisma.voiceMemo.findFirst();
    expect(memo?.summary).toBeNull();
    expect(memo?.content).toContain("佐藤さん");

    // 同じ本文の再送は増えない
    await post(app, { text: "きょうの散歩で佐藤さんに会った" });
    expect(await prisma.voiceMemo.count()).toBe(1);
  });
});
