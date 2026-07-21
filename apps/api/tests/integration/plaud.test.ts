// 録音メモ (Plaud のメール添付テキスト) の結合テスト: 添付を開いて読む → タスクと課題の
// 整理 → 表示 → 済み印・片付け、まで一気通貫。gmail.readonly の許可が無ければ 400。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";
import type { GoogleClient } from "../../src/lib/google.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

const TRANSCRIPT = "会議メモ。田中さんに金曜までに見積もりを送る。会場の予算は誰が決めるか未定のまま。";
const transcriptB64 = Buffer.from(TRANSCRIPT, "utf-8").toString("base64url");

const fakeGoogle: GoogleClient = {
  authUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
  exchangeCode: async () => ({ refreshToken: "rt", accessToken: "at", email: "me@example.com", name: "me", grantedScopes: "" }),
  refreshAccessToken: async () => "at",
  apiGet: async (url) => {
    if (url.includes("/messages?")) return { messages: [{ id: "pm1" }] };
    if (url.includes("/messages/pm1/attachments/att1")) return { data: transcriptB64 };
    if (url.includes("/messages/pm1")) {
      return {
        internalDate: String(Date.UTC(2026, 6, 19, 3, 0, 0)),
        payload: {
          mimeType: "multipart/mixed",
          headers: [{ name: "Subject", value: "文字起こしが届きました" }],
          parts: [
            { mimeType: "text/html", filename: "", body: { data: "aG9nZQ" } }, // 本文は読まない (添付が正)
            { mimeType: "text/plain", filename: "transcript.txt", body: { attachmentId: "att1" } },
          ],
        },
      };
    }
    return {};
  },
  apiPost: async () => ({}),
};

const fakeGenerate: GenerateFn = async ({ model }) => ({
  text: JSON.stringify({
    summary: "見積もりの送付と会場予算の担当決めが話し合われました。",
    tasks: [
      { text: "田中さんに金曜までに見積もりを送る", kind: "task" },
      { text: "会場の予算の決め方が未定", kind: "issue" },
    ],
  }),
  model,
  inputTokens: 10,
  outputTokens: 30,
});

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "voice_memos", "google_connections", "prompts", "ai_usage_logs", "app_config" CASCADE');
  await seedDdPrompts(prisma);
});

const connect = async (scopes: string) => {
  await prisma.googleConnection.create({
    data: { ownerUid: "owner", email: "me@example.com", refreshToken: "rt", scopes },
  });
};

describe("録音メモの読み取りと整理", () => {
  it("添付テキストを開いて読み、タスクと課題を整理して表示できる (冪等・暗号化)", async () => {
    const app = createApp({ prisma, generate: fakeGenerate, google: fakeGoogle });
    await connect("openid email https://www.googleapis.com/auth/gmail.readonly");

    const sync = await (await app.request("/api/relationship/sync-plaud", { method: "POST", headers: H, body: "{}" })).json();
    expect(sync.imported).toBe(1);
    expect(sync.digested).toBe(1);

    const list = await (await app.request("/api/relationship/voice-memos", { headers: H })).json();
    expect(list.memos).toHaveLength(1);
    const memo = list.memos[0];
    expect(memo.subject).toBe("文字起こしが届きました");
    expect(memo.summary).toContain("見積もり");
    expect(memo.tasks).toHaveLength(2);
    expect(memo.tasks[0]).toMatchObject({ kind: "task", done: false });
    expect(memo.tasks[1].kind).toBe("issue");

    // DB 上は中身が暗号化されている
    const raw = await prisma.$queryRawUnsafe<{ content: string; tasks: string }[]>(
      "SELECT content, tasks FROM voice_memos LIMIT 1",
    );
    expect(isEncrypted(raw[0]!.content)).toBe(true);
    expect(isEncrypted(raw[0]!.tasks)).toBe(true);

    // もう一度同期しても増えない (gmailMessageId で冪等)
    const again = await (await app.request("/api/relationship/sync-plaud", { method: "POST", headers: H, body: "{}" })).json();
    expect(again.imported).toBe(0);

    // 済み印 → 片付け
    const put = await (
      await app.request(`/api/relationship/voice-memos/${memo.id}`, {
        method: "PUT",
        headers: H,
        body: JSON.stringify({ taskIndex: 0, done: true }),
      })
    ).json();
    expect(put.memo.tasks[0].done).toBe(true);
    await app.request(`/api/relationship/voice-memos/${memo.id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ status: "dismissed" }),
    });
    const after = await (await app.request("/api/relationship/voice-memos", { headers: H })).json();
    expect(after.memos).toHaveLength(0);
  });

  it("メール読み取りの許可が無ければ 400 (scope_missing)、未接続も 400", async () => {
    const app = createApp({ prisma, generate: fakeGenerate, google: fakeGoogle });
    expect((await app.request("/api/relationship/sync-plaud", { method: "POST", headers: H, body: "{}" })).status).toBe(400);
    await connect("openid email https://www.googleapis.com/auth/gmail.metadata"); // metadata では足りない
    const res = await app.request("/api/relationship/sync-plaud", { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("scope_missing");
  });

  it("AI 未設定でもメモは残り、あとから「整理する」で救済できる", async () => {
    const app = createApp({ prisma, generate: null, google: fakeGoogle });
    await connect("https://www.googleapis.com/auth/gmail.readonly");
    const sync = await (await app.request("/api/relationship/sync-plaud", { method: "POST", headers: H, body: "{}" })).json();
    expect(sync.imported).toBe(1);
    expect(sync.digested).toBe(0);
    const list = await (await app.request("/api/relationship/voice-memos", { headers: H })).json();
    expect(list.memos[0].tasks).toHaveLength(0);
    expect(list.memos[0].excerpt).toContain("会議メモ");

    // AI が使える状態で整理し直す
    const app2 = createApp({ prisma, generate: fakeGenerate, google: fakeGoogle });
    const digest = await (
      await app2.request(`/api/relationship/voice-memos/${list.memos[0].id}/digest`, { method: "POST", headers: H, body: "{}" })
    ).json();
    expect(digest.memo.tasks).toHaveLength(2);
  });

  it("plaud-status の点検口が、どの段で止まっているかを返す", async () => {
    const app = createApp({ prisma, generate: null, google: fakeGoogle });
    // 未接続
    const none = await (await app.request("/api/admin/plaud-status", { headers: H })).json();
    expect(none.note).toBe("google_not_connected");
    // 許可なし
    await connect("openid email");
    const noScope = await (await app.request("/api/admin/plaud-status", { headers: H })).json();
    expect(noScope.note).toBe("mailread_scope_missing");
    // 許可あり → Gmail の件数と添付の形が見える
    await prisma.googleConnection.update({
      where: { ownerUid: "owner" },
      data: { scopes: "openid email https://www.googleapis.com/auth/gmail.readonly" },
    });
    const ok = await (await app.request("/api/admin/plaud-status", { headers: H })).json();
    expect(ok.gmail.strictQuery).toBe(1);
    expect(ok.samples[0].textAttachmentsFound).toContain("transcript.txt");
  });

  it("毎時 sweep は mailread 許可のある接続だけを同期する", async () => {
    const app = createApp({ prisma, generate: fakeGenerate, google: fakeGoogle });
    await connect("https://www.googleapis.com/auth/gmail.readonly");
    const r = await (await app.request("/api/admin/plaud/sync", { method: "POST", headers: H })).json();
    expect(r.synced).toBe(1);
    expect(r.imported).toBe(1);
  });
});
