// 取り込みジョブ (ページを離れても続く) の結合テスト。
// 預ける → run で処理 → 連絡先が入る・状況が done になる。sweep バックストップも確認。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
delete process.env.PERSON_DD_MONTHLY_CAP_JPY;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

const noopGenerate: GenerateFn = async ({ model }) => ({
  text: JSON.stringify({ people: [] }),
  model,
  inputTokens: 1,
  outputTokens: 1,
});

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "import_jobs", "contacts", "ai_usage_logs", "prompts", "app_config" CASCADE');
  await seedDdPrompts(prisma);
});

describe("取り込みジョブ (ページを離れても続く)", () => {
  it("テキストを預けて run すると連絡先が入り、状況が done になる", async () => {
    const app = createApp({ prisma, generate: noopGenerate });
    // 預ける (処理はまだ)
    const create = await app.request("/api/contacts/import-jobs", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: "氏名,会社名\n佐藤太郎,佐藤商店\n鈴木花子,鈴木堂" }),
    });
    expect(create.status).toBe(201);
    const jobId = (await create.json()).job.id as string;
    expect(await prisma.contact.count()).toBe(0); // まだ処理されていない

    // payload は DB 上で暗号文
    const raw = await prisma.$queryRawUnsafe<{ payload: string }[]>('SELECT payload FROM import_jobs WHERE id = $1', jobId);
    expect(isEncrypted(raw[0]!.payload)).toBe(true);

    // 処理する
    const run = await app.request("/api/contacts/import-jobs/run", { method: "POST", headers: H });
    expect(run.status).toBe(200);
    expect((await run.json()).remaining).toBe(0);

    expect(await prisma.contact.count()).toBe(2);
    const list = await (await app.request("/api/contacts/import-jobs", { headers: H })).json();
    expect(list.active).toBe(0);
    expect(list.jobs[0].status).toBe("done");
    expect(list.jobs[0].imported).toBe(2);
    // 済んだら本文は保持しない
    const after = await prisma.importJob.findUnique({ where: { id: jobId } });
    expect(after!.payload).toBe("");
  });

  it("状況一覧・片付け (done/error を消せる)", async () => {
    const app = createApp({ prisma, generate: noopGenerate });
    await app.request("/api/contacts/import-jobs", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: "氏名\n山田一郎" }),
    });
    await app.request("/api/contacts/import-jobs/run", { method: "POST", headers: H });
    let list = await (await app.request("/api/contacts/import-jobs", { headers: H })).json();
    expect(list.jobs.length).toBe(1);
    await app.request("/api/contacts/import-jobs/clear", { method: "POST", headers: H });
    list = await (await app.request("/api/contacts/import-jobs", { headers: H })).json();
    expect(list.jobs.length).toBe(0);
  });

  it("バックストップ (admin sweep) が残った待ち行列を処理する", async () => {
    const app = createApp({ prisma, generate: noopGenerate });
    await app.request("/api/contacts/import-jobs", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: "氏名\n田中次郎" }),
    });
    // ユーザーが run しなくても、sweep が拾って処理する
    const sweep = await app.request("/api/admin/contacts/process-import-jobs?batch=10", { method: "POST", headers: H });
    expect(sweep.status).toBe(200);
    expect((await sweep.json()).processed).toBe(1);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("読み取れない内容 (AI 未設定) は error として残り、原因が detail に出る", async () => {
    const app = createApp({ prisma, generate: null });
    await app.request("/api/contacts/import-jobs", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: "名前の列がない自由な文章です" }),
    });
    await app.request("/api/contacts/import-jobs/run", { method: "POST", headers: H });
    const list = await (await app.request("/api/contacts/import-jobs", { headers: H })).json();
    expect(list.jobs[0].status).toBe("error");
    expect(typeof list.jobs[0].detail).toBe("string");
  });
});
