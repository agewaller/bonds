// あらゆるファイル取込 (import-file の AI 人物抽出経路) の結合テスト。
// 実テスト DB + 偽 generate。Word 文書 → AI 抽出 → 連絡帳への整理格納と、
// 既存の方への補完 (上書きしない)・再取込の冪等・AI なし時の縮退を検証する。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
const H = { "x-admin-token": ADMIN_TOKEN };
const JH = { ...H, "Content-Type": "application/json" };

function buildDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<w:document><w:body>${body}</w:body></w:document>`),
  });
}

// 偽 AI: 渡された本文に応じて人物 JSON を返す (実 API は呼ばない)
const fakeExtract: GenerateFn = async (args) => {
  const people =
    args.userMessage.includes("佐藤 花子") || args.userMessage.includes("面談メモ")
      ? [
          {
            name: "佐藤 花子",
            email: "hanako@example.com",
            company: "サトウ企画",
            title: "代表",
            relationship: "work",
            note: "四月に独立されたとのこと。展示会の準備でお忙しいようです。",
            dates: [{ date: "2026-06-20", type: "meeting", summary: "新宿で面談。協業の相談。" }],
          },
        ]
      : [];
  return {
    text: JSON.stringify({ people }),
    model: "claude-sonnet-5",
    inputTokens: 100,
    outputTokens: 50,
  };
};

beforeAll(() => {
  prisma = createPrismaClient();
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "contact_interactions", "contacts", "ai_usage_logs", "prompts" CASCADE',
  );
  await seedDdPrompts(prisma); // import_extract プロンプトを DB に載せる
});

async function upload(app: ReturnType<typeof createApp>, bytes: Uint8Array, filename: string) {
  return app.request(`/api/contacts/import-file?filename=${encodeURIComponent(filename)}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/octet-stream" },
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
}

describe("あらゆるファイルからの人物抽出 → 整理格納", () => {
  it("Word の面談メモから人物・属性・接触記録まで DB に整理される", async () => {
    const app = createApp({ prisma, generate: fakeExtract });
    const res = await upload(app, buildDocx(["面談メモ 佐藤 花子さん (サトウ企画)"]), "面談メモ.docx");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.aiPeople).toBe(1);
    expect(body.interactionsAdded).toBe(1);

    const list = await (await app.request("/api/contacts", { headers: H })).json();
    const hanako = list.contacts.find((c: { name: string }) => c.name === "佐藤 花子");
    expect(hanako.email).toBe("hanako@example.com");
    expect(hanako.company).toBe("サトウ企画");
    expect(hanako.relationship).toBe("work");
    expect(hanako.notes).toContain("独立された");
    const detail = await (await app.request(`/api/contacts/${hanako.id}`, { headers: H })).json();
    expect(detail.interactions).toHaveLength(1);
    expect(detail.interactions[0].notes).toContain("新宿で面談");

    // AI 使用は記録される (コスト規律)
    expect(await prisma.aiUsageLog.count({ where: { purpose: "import_extract" } })).toBe(1);
  });

  it("同じファイルの再取込は冪等 (二重登録・二重書き足しをしない)", async () => {
    const app = createApp({ prisma, generate: fakeExtract });
    await upload(app, buildDocx(["面談メモ 佐藤 花子さん"]), "面談メモ.docx");
    const again = await (await upload(app, buildDocx(["面談メモ 佐藤 花子さん"]), "面談メモ.docx")).json();
    expect(again.imported).toBe(0);
    expect(again.enriched).toBe(0); // メモは既に書いてある → 変更なし
    expect(again.interactionsAdded).toBe(0); // 同じ日の接触は重複しない
    expect(await prisma.contact.count()).toBe(1);
  });

  it("既存の方には空いている項目の補完とメモの書き足しだけ行い、上書きしない", async () => {
    const app = createApp({ prisma, generate: fakeExtract });
    await app.request("/api/contacts", {
      method: "POST",
      headers: JH,
      body: JSON.stringify({ name: "佐藤 花子", title: "部長", notes: "旧知の友人" }),
    });
    const body = await (await upload(app, buildDocx(["面談メモ 佐藤 花子さん"]), "memo.docx")).json();
    expect(body.imported).toBe(0);
    expect(body.enriched).toBe(1);
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    const hanako = list.contacts[0];
    expect(hanako.title).toBe("部長"); // ユーザーが書いた値が勝つ (上書きしない)
    expect(hanako.email).toBe("hanako@example.com"); // 空欄は補完
    expect(hanako.notes).toContain("旧知の友人"); // 既存メモは残る
    expect(hanako.notes).toContain("独立された"); // 分かったことを書き足す
  });

  it("AI 未設定 (キー無し) で書類だけのときは 422 に縮退し、構造化 CSV は従来どおり通る", async () => {
    const app = createApp({ prisma, generate: null });
    const res = await upload(app, buildDocx(["面談メモ 佐藤 花子さん"]), "memo.docx");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("extract_unavailable");

    const csv = strToU8("name,email\n山田 太郎,taro@example.com\n");
    const ok = await (await upload(app, csv, "contacts.csv")).json();
    expect(ok.imported).toBe(1);
  });

  it("読み取れないバイナリは 422 (no_contacts_found)", async () => {
    const app = createApp({ prisma, generate: fakeExtract });
    const res = await upload(app, new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]), "photo.bin");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("no_contacts_found");
  });
});
