// 取込 (ファイル/ZIP/トーク履歴/会話抽出) の結合テスト。実テスト DB (bonds_test)。
// 「ZIP をそのまま放り込める」「再取込しても二重登録しない」「トーク履歴が接触記録に還流する」を守る。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;

const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };
const BIN = { "Content-Type": "application/octet-stream", "x-admin-token": ADMIN_TOKEN };

beforeAll(async () => {
  prisma = createPrismaClient();
  await seedDdPrompts(prisma);
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "contact_gifts", "contact_interactions", "contact_groups", "contacts" CASCADE',
  );
});

const LINE_TALK = `[LINE] 友里恵とのトーク履歴
保存日時：2026/07/01 12:00

2026/06/01(月)
10:23\t友里恵\tこんにちは
2026/06/03(水)
09:00\t友里恵\t元気？
`;

describe("ファイル/ZIP 取込 (import-file)", () => {
  it("Facebook の ZIP をそのまま放り込むと friends.json を自動発見して取り込む", async () => {
    const app = createApp({ prisma, generate: null });
    const zip = zipSync({
      "your_facebook_activity/friends_and_followers/friends.json": strToU8(
        JSON.stringify({ friends_v2: [{ name: "FB 一郎" }, { name: "FB 二郎" }] }),
      ),
    });
    const res = await app.request("/api/contacts/import-file?filename=facebook.zip", {
      method: "POST",
      headers: BIN,
      body: zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    expect(body.foundIn[0].file).toContain("friends.json");
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.contacts.map((c: { name: string }) => c.name).sort()).toEqual(["FB 一郎", "FB 二郎"]);
  });

  it("LINE トーク履歴は相手の連絡先と日別の接触記録を作り、再取込しても増えない (冪等)", async () => {
    const app = createApp({ prisma, generate: null });
    const post = () =>
      app.request("/api/contacts/import-file?filename=line-talk.txt", {
        method: "POST",
        headers: BIN,
        body: new TextEncoder().encode(LINE_TALK).buffer as ArrayBuffer,
      });
    const first = await (await post()).json();
    expect(first.imported).toBe(1);
    expect(first.interactionsAdded).toBe(2);

    const second = await (await post()).json();
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.interactionsAdded).toBe(0); // 同じ相手・同じ日は登録しない

    const interactions = await prisma.contactInteraction.findMany();
    expect(interactions).toHaveLength(2);
    expect(interactions.every((i) => i.type === "message")).toBe(true);
  });

  it("知らない形式は 422 で対応形式を案内する", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await app.request("/api/contacts/import-file", {
      method: "POST",
      headers: BIN,
      body: new TextEncoder().encode("ただのメモ書きです").buffer as ArrayBuffer,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).detail).toContain("LinkedIn");
  });

  it("上限超過は 413", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await app.request("/api/contacts/import-file", {
      method: "POST",
      headers: BIN,
      body: new Uint8Array(31 * 1024 * 1024).buffer as ArrayBuffer,
    });
    expect(res.status).toBe(413);
  });

  it("テキスト取込 (import) も lms エクスポート/トーク履歴を判別し、同名スキップする", async () => {
    const app = createApp({ prisma, generate: null });
    const lms = JSON.stringify({
      relationship_contacts: [{ name: "lms山田", distance: 2, email: "lms@example.com" }],
      relationship_interactions: [{ person: "lms山田", type: "call", timestamp: "2026-06-20T10:00:00.000Z" }],
    });
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: lms }),
    });
    const body = await res.json();
    expect(body).toMatchObject({ imported: 1, interactionsAdded: 1 });

    // 暗号化も守られている (email が平文で DB に無い)
    const rows = await prisma.$queryRawUnsafe<Array<{ email: string | null }>>(
      `SELECT email FROM contacts WHERE email IS NOT NULL`,
    );
    for (const r of rows) expect(isEncrypted(r.email!)).toBe(true);

    // 同名の再取込はスキップ
    const again = await (
      await app.request("/api/contacts/import", { method: "POST", headers: H, body: JSON.stringify({ content: lms }) })
    ).json();
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
  });
});

describe("会話からの取り込み (extract-from-conversation)", () => {
  const fakeGenerate: GenerateFn = async () => ({
    text: JSON.stringify({
      people: [
        { name: "田中良子", note: "**お孫さん**が生まれたばかりとのこと", date: "2026-07-03" },
        { name: "既存 花子", note: "腰の調子が良くなってきたようです", date: "" },
        { name: "", note: "名無しは捨てる", date: "" },
      ],
    }),
    model: "claude-sonnet-4-6",
    inputTokens: 100,
    outputTokens: 50,
  });

  it("登場人物と近況を提案として返す (自動反映しない・記号はサニタイズ・既存は contactId 付き)", async () => {
    const app = createApp({ prisma, generate: fakeGenerate });
    const created = await (
      await app.request("/api/contacts", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ name: "既存 花子" }),
      })
    ).json();

    const res = await app.request("/api/contacts/extract-from-conversation", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ text: "昨日は田中良子さんと花子さんに会った。" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposals).toHaveLength(2);
    expect(body.proposals[0]).toMatchObject({ name: "田中良子", date: "2026-07-03", contactId: null });
    expect(body.proposals[0].note).not.toContain("**"); // BR-09 最終防衛線
    expect(body.proposals[1]).toMatchObject({ name: "既存 花子", contactId: created.contact.id });

    // 提案しただけでは連絡先は増えない (承認してから反映)
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.contacts).toHaveLength(1);

    // 利用記録 (月次キャップの集計元) が残る
    const logs = await prisma.aiUsageLog.findMany({ where: { purpose: "conversation_extract" } });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it("AI キー未設定は 503 に縮退し、本文なしは 400", async () => {
    const app = createApp({ prisma, generate: null });
    const no = await app.request("/api/contacts/extract-from-conversation", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ text: "会話" }),
    });
    expect(no.status).toBe(503);
    const empty = await app.request("/api/contacts/extract-from-conversation", {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
  });
});
