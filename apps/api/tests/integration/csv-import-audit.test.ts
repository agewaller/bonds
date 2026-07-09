// ユーザー目線の監査: 中身が崩れがちな CSV を、実際の取り込み経路
// (貼り付け → ジョブ処理 → 保存 → 取り出し) にそのまま通して、
// きちんと連絡先データとして管理されるかを確かめる。
// AI は使わない (構造化 CSV は AI 不要で通るのが正しい挙動)。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

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

// ユーザーがやること: 内容を預ける → 処理させる → 連絡帳を開く。この3手を関数化。
async function importAndList(app: ReturnType<typeof createApp>, content: string) {
  const create = await app.request("/api/contacts/import-jobs", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ content }),
  });
  expect(create.status).toBe(201);
  const run = await app.request("/api/contacts/import-jobs/run", { method: "POST", headers: H });
  expect(run.status).toBe(200);
  const list = await (await app.request("/api/contacts", { headers: H })).json();
  return list.contacts as Array<Record<string, string | number | null>>;
}

describe("崩れた CSV のユーザー目線監査", () => {
  it("BOM・CRLF・空行・前後の空白があっても正しく取り込む", async () => {
    const app = createApp({ prisma, generate: null });
    // BOM 付き + CRLF + 途中に空行 + 値の前後に空白
    const csv = "﻿氏名,会社名,メールアドレス,電話番号\r\n  佐藤 太郎 , 佐藤商店 , sato@example.com , 090-1111-2222 \r\n\r\n鈴木 花子,鈴木堂,hanako@example.com,03-3333-4444\r\n";
    const contacts = await importAndList(app, csv);
    expect(contacts).toHaveLength(2);
    const sato = contacts.find((c) => c.name === "佐藤 太郎");
    expect(sato).toBeTruthy();
    expect(sato!.company).toBe("佐藤商店");
    expect(sato!.email).toBe("sato@example.com");
    expect(sato!.phone).toBe("090-1111-2222");
  });

  it("引用符でくくったカンマ入りの値を1つの値として扱う (列ズレを起こさない)", async () => {
    const app = createApp({ prisma, generate: null });
    const csv = ['氏名,会社名,メモ', '"山田, 一郎","株式会社山田, 東京","昨年 ""感謝"" と言われた"'].join("\n");
    const contacts = await importAndList(app, csv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toBe("山田, 一郎");
    expect(contacts[0]!.company).toBe("株式会社山田, 東京");
    expect(contacts[0]!.notes).toContain('感謝'); // "" のエスケープが復元される
  });

  it("Eight 名刺の姓/名分割・英語混在ヘッダ (会社名/役職名/携帯電話/e-mail) を結合して取り込む", async () => {
    const app = createApp({ prisma, generate: null });
    const csv = [
      "姓,名,会社名,役職名,e-mail,携帯電話",
      "田中,次郎,田中工業,部長,tanaka@example.com,080-5555-6666",
    ].join("\n");
    const contacts = await importAndList(app, csv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toBe("田中 次郎");
    expect(contacts[0]!.company).toBe("田中工業");
    expect(contacts[0]!.title).toBe("部長");
    expect(contacts[0]!.email).toBe("tanaka@example.com");
    expect(contacts[0]!.phone).toBe("080-5555-6666");
  });

  it("列数が揃わないラギッドな行・未知の列・氏名欠落の行があっても壊れない", async () => {
    const app = createApp({ prisma, generate: null });
    // 1行目: 列が足りない / 2行目: 未知列(郵便番号)は無視 / 3行目: 氏名が空 → 取り込まない
    const csv = [
      "氏名,会社名,郵便番号,電話番号",
      "高橋 三郎,高橋商会", // 列不足 (郵便番号/電話が無い)
      "伊藤 四郎,伊藤堂,150-0001,06-7777-8888", // 未知列 郵便番号 は無視
      ",名無し商店,100-0001,03-0000-0000", // 氏名なし → スキップ
    ].join("\n");
    const contacts = await importAndList(app, csv);
    const names = contacts.map((c) => c.name).sort();
    expect(names).toEqual(["伊藤 四郎", "高橋 三郎"]);
    const ito = contacts.find((c) => c.name === "伊藤 四郎")!;
    expect(ito.company).toBe("伊藤堂");
    expect(ito.phone).toBe("06-7777-8888"); // 未知列を飛ばしても電話が正しい列から取れる
    const taka = contacts.find((c) => c.name === "高橋 三郎")!;
    expect(taka.company).toBe("高橋商会");
  });

  it("距離の文字列は数値になり、範囲外は 1〜5 に収まる", async () => {
    const app = createApp({ prisma, generate: null });
    const csv = ["氏名,距離", "近 之助,1", "遠 之介,9", "変 テコ,abc"].join("\n");
    const contacts = await importAndList(app, csv);
    const near = contacts.find((c) => c.name === "近 之助")!;
    const far = contacts.find((c) => c.name === "遠 之介")!;
    const weird = contacts.find((c) => c.name === "変 テコ")!;
    expect(near.distance).toBe(1);
    expect(far.distance).toBeLessThanOrEqual(5);
    expect(far.distance).toBeGreaterThanOrEqual(1);
    // 数値にならない距離は既定値 (未指定扱い) で保存され、1〜5 に収まる
    expect(weird.distance).toBeGreaterThanOrEqual(1);
    expect(weird.distance).toBeLessThanOrEqual(5);
  });

  it("同じCSVを二度取り込んでも二重登録しない (冪等)", async () => {
    const app = createApp({ prisma, generate: null });
    const csv = ["氏名,会社名", "渡辺 五郎,渡辺屋", "小林 六子,小林院"].join("\n");
    await importAndList(app, csv);
    const second = await importAndList(app, csv);
    expect(second).toHaveLength(2); // 増えていない
  });

  it("メールが同じなら表記の違う名前でも同一人物として結合する (二重化を防ぐ)", async () => {
    const app = createApp({ prisma, generate: null });
    await importAndList(app, ["氏名,メールアドレス,会社名", "山本 七郎,nana@example.com,"].join("\n"));
    // 二回目: 名前の表記ゆれ + 会社が埋まる
    const after = await importAndList(app, ["氏名,メールアドレス,会社名", "山本七郎,nana@example.com,山本製作所"].join("\n"));
    expect(after).toHaveLength(1); // 別人として増えない
    expect(after[0]!.company).toBe("山本製作所"); // 空いていた項目が補完される
  });

  it("Excel や年賀状ソフトが書き出す Shift_JIS の CSV を、ファイル取込で文字化けせず取り込む", async () => {
    const app = createApp({ prisma, generate: null });
    // "氏名,会社名,メールアドレス\n山田太郎,山田商店,taro@example.com\n" を Shift_JIS(cp932) で符号化したバイト列
    const sjis = new Uint8Array([
      142, 129, 150, 188, 44, 137, 239, 142, 208, 150, 188, 44, 131, 129, 129, 91, 131, 139, 131,
      65, 131, 104, 131, 140, 131, 88, 10, 142, 82, 147, 99, 145, 190, 152, 89, 44, 142, 82, 147,
      99, 143, 164, 147, 88, 44, 116, 97, 114, 111, 64, 101, 120, 97, 109, 112, 108, 101, 46, 99,
      111, 109, 10,
    ]);
    const res = await app.request("/api/contacts/import-file?filename=meibo.csv", {
      method: "POST",
      headers: { "x-admin-token": ADMIN_TOKEN, "Content-Type": "text/csv" },
      body: sjis,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    const list = (await (await app.request("/api/contacts", { headers: H })).json()).contacts;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("山田太郎"); // 文字化け (□ や �) にならず正しく読める
    expect(list[0].company).toBe("山田商店");
    expect(list[0].email).toBe("taro@example.com");
  });

  it("保存された連絡先の PII (メール・電話) は DB 上では暗号文になっている", async () => {
    const app = createApp({ prisma, generate: null });
    await importAndList(app, ["氏名,メールアドレス,電話番号", "秘密 太郎,secret@example.com,090-9999-0000"].join("\n"));
    const rows = await prisma.$queryRawUnsafe<{ email: string | null; phone: string | null; name: string }[]>(
      'SELECT name, email, phone FROM contacts LIMIT 1',
    );
    expect(rows[0]!.name).toBe("秘密 太郎"); // 名前は平文 (検索のため)
    expect(isEncrypted(rows[0]!.email!)).toBe(true); // メールは暗号文
    expect(isEncrypted(rows[0]!.phone!)).toBe(true); // 電話も暗号文
  });
});
