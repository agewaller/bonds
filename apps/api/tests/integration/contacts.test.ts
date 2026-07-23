// 関係性 (contacts) API の結合テスト。実テスト DB (bonds_test)。
// PII の項目暗号化が「DB 上は暗号文、API 応答は平文」であることを生 SQL で必ず検証する。
// (取り込み元フィルタのテストは本ファイル末尾に追記)
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
let app: ReturnType<typeof createApp>;

const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

beforeAll(() => {
  prisma = createPrismaClient();
  app = createApp({ prisma, generate: null });
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "contact_gifts", "contact_interactions", "contact_groups", "contacts" CASCADE',
  );
});

async function createContact(over: Record<string, unknown> = {}) {
  const res = await app.request("/api/contacts", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: "山田花子",
      distance: 2,
      email: "hanako@example.com",
      phone: "090-1111-2222",
      personalProfile: "腰痛持ち。娘の受験が心配。将来は郷里でカフェを開きたい",
      valuesProfile: "家族第一。誠実さを重んじる",
      notes: "テニス仲間",
      ...over,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).contact as { id: string; name: string; email: string | null };
}

describe("PII 暗号化 (最重要)", () => {
  it("DB 上は enc:v1: 暗号文、API 応答は平文で返る", async () => {
    const c = await createContact();
    // API 応答は透過復号された平文
    expect(c.email).toBe("hanako@example.com");

    // 生 SQL では暗号文 (平文が DB に無いこと)
    const rows = await prisma.$queryRawUnsafe<
      Array<{ email: string; phone: string; personal_profile: string; values_profile: string; notes: string }>
    >(`SELECT email, phone, personal_profile, values_profile, notes FROM contacts WHERE id = '${c.id}'`);
    const raw = rows[0]!;
    for (const v of Object.values(raw)) {
      expect(isEncrypted(v)).toBe(true);
      expect(v).not.toContain("hanako");
      expect(v).not.toContain("腰痛");
      expect(v).not.toContain("テニス");
    }

    // 読み直しても平文で返る (findMany 復号)
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.contacts[0].personalProfile).toContain("腰痛");
  });

  it("interaction.notes も暗号化される", async () => {
    const c = await createContact();
    const res = await app.request(`/api/contacts/${c.id}/interactions`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ type: "call", quality: 5, notes: "娘さんの受験が終わったとのこと" }),
    });
    expect(res.status).toBe(201);
    const rows = await prisma.$queryRawUnsafe<Array<{ notes: string }>>(
      `SELECT notes FROM contact_interactions`,
    );
    expect(isEncrypted(rows[0]!.notes)).toBe(true);
    // 詳細 API では平文
    const detail = await (await app.request(`/api/contacts/${c.id}`, { headers: H })).json();
    expect(detail.interactions[0].notes).toContain("受験");
  });
});

describe("contacts CRUD (データ主権: 1 件単位の編集・削除・エクスポート)", () => {
  it("作成 → 一覧 → 詳細 → 編集 → ソフト削除", async () => {
    const c = await createContact();
    const detail = await (await app.request(`/api/contacts/${c.id}`, { headers: H })).json();
    expect(detail.contact.name).toBe("山田花子");

    const put = await app.request(`/api/contacts/${c.id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ name: "山田花子", distance: 1, notes: "毎週会うことにした" }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).contact.distance).toBe(1);

    const del = await app.request(`/api/contacts/${c.id}`, { method: "DELETE", headers: H });
    expect(del.status).toBe(200);
    // アーカイブ後は一覧に出ないが、行は消えていない (ソフト削除)
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.contacts).toHaveLength(0);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("エクスポートに全データが復号済みで含まれる", async () => {
    await createContact();
    const res = await app.request("/api/contacts/export", { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts[0].email).toBe("hanako@example.com");
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("認証なしの読み取りは 401 (PII を守る)", async () => {
    expect((await app.request("/api/contacts")).status).toBe(401);
    expect((await app.request("/api/relationship/summary")).status).toBe(401);
  });
});

describe("取込 (CSV / vCard)", () => {
  it("CSV を取り込み、暗号化されて保存される", async () => {
    const csv = "氏名,電話,メール,距離\n佐藤太郎,03-1234-5678,taro@example.com,2\n鈴木次郎,,jiro@example.com,3";
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: csv, format: "csv" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toBe(2);
    const rows = await prisma.$queryRawUnsafe<Array<{ email: string }>>(`SELECT email FROM contacts`);
    for (const r of rows) expect(isEncrypted(r.email)).toBe(true);
  });

  it("vCard の自動判別で取り込める", async () => {
    const vcf = "BEGIN:VCARD\nFN:高橋三郎\nTEL:070-5555-6666\nEND:VCARD";
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: vcf }),
    });
    expect((await res.json()).imported).toBe(1);
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.contacts[0].name).toBe("高橋三郎");
    expect(list.contacts[0].phone).toBe("070-5555-6666");
  });

  it("空の取込は 400", async () => {
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("取込時の同姓同名 (既存・取込内の重複) は冪等にスキップし、sameName で知らせる", async () => {
    await createContact({ name: "佐藤太郎" });
    const csv = "氏名,距離\n佐藤太郎,3\n鈴木次郎,3\n鈴木次郎,2";
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: csv, format: "csv" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1); // 再取込で二重登録しない (冪等)
    expect(body.skipped).toBe(2);
    expect(body.sameName.sort()).toEqual(["佐藤太郎", "鈴木次郎"]); // 見送りは黙って捨てず知らせる
  });
});

describe("同姓同名の確認 (追加時)", () => {
  it("同じ名前の追加は 409 + 既存の簡単なプロフィールを返し、confirmNew:true で別人として追加できる", async () => {
    await createContact({ name: "山田太郎", company: "青空商事", title: "部長", distance: 2 });
    // 確認なしの再追加 → 409 で既存者のプロフィールが返る
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "山田太郎", distance: 4 }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("same_name_exists");
    expect(body.duplicates).toHaveLength(1);
    expect(body.duplicates[0].company).toBe("青空商事");
    expect(body.duplicates[0].title).toBe("部長");
    expect(body.duplicates[0].distance).toBe(2);
    // PII (メール・電話・プロフィール) は確認応答に含めない
    expect(body.duplicates[0].email).toBeUndefined();
    expect(body.duplicates[0].personalProfile).toBeUndefined();

    // ユーザーが「別の人」と特定 → confirmNew:true で追加できる
    const confirmed = await app.request("/api/contacts", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "山田太郎", distance: 4, confirmNew: true }),
    });
    expect(confirmed.status).toBe(201);
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.contacts.filter((c: { name: string }) => c.name === "山田太郎")).toHaveLength(2);
  });

  it("別名の追加や、アーカイブ済み同名は確認なしで通る", async () => {
    const c = await createContact({ name: "田中一郎" });
    // 違う名前は素通り
    const other = await app.request("/api/contacts", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "田中二郎" }),
    });
    expect(other.status).toBe(201);
    // ソフト削除した同名は対象外
    await app.request(`/api/contacts/${c.id}`, { method: "DELETE", headers: H });
    const again = await app.request("/api/contacts", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "田中一郎" }),
    });
    expect(again.status).toBe(201);
  });
});

describe("つながりサマリ (lms 距離スコアの結合検証)", () => {
  it("接触なしの親しい人がいると警告水準になり、記録すると回復する", async () => {
    const c = await createContact({ distance: 2 });
    let s = await (await app.request("/api/relationship/summary", { headers: H })).json();
    expect(s.isolation.level).toBe("warning"); // 999 日途絶扱い
    expect(s.today.some((t: { contactId: string }) => t.contactId === c.id)).toBe(true);

    // 「連絡しました」を記録すると適正間隔内に戻る
    await app.request(`/api/contacts/${c.id}/interactions`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ type: "message" }),
    });
    s = await (await app.request("/api/relationship/summary", { headers: H })).json();
    expect(s.isolation.level).toBe("good");
    expect(s.connectionScore).toBe(100);
    expect(s.today).toHaveLength(0);
  });

  it("誕生日 3 日以内は今日のおすすめに最優先で載る", async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const c = await createContact({
      distance: 4, // 監視対象外の距離でも誕生日は拾う
      birthday: `1960-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`,
    });
    const s = await (await app.request("/api/relationship/summary", { headers: H })).json();
    expect(s.today[0]).toMatchObject({ contactId: c.id, kind: "birthday" });
  });
});

describe("監査ログ (フェーズ5)", () => {
  it("書き込みに actor/method/path が記録され、読み取りは記録されない", async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "audit_logs"');
    const c = await createContact();
    await app.request("/api/contacts", { headers: H }); // GET は記録しない
    // 監査記録は fire-and-forget なので少し待つ
    await new Promise((r) => setTimeout(r, 200));
    // 前テストの fire-and-forget が truncate 後に着地しうるため、内容で検証する
    const logs = await prisma.auditLog.findMany();
    expect(logs.filter((l) => l.method === "GET")).toHaveLength(0); // 読み取りは記録しない
    const post = logs.find((l) => l.method === "POST" && l.path === "/api/contacts");
    expect(post).toMatchObject({ actor: "breakglass", status: 201 });
    void c;
  });

  it("Firebase admin claim のトークンでも書き込みでき actor が firebase:<uid> になる", async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "audit_logs"');
    const appFb = createApp({
      prisma,
      generate: null,
      verifyIdToken: async () => ({ uid: "admin-uid", admin: true }),
    });
    const res = await appFb.request("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: "Bearer fake" },
      body: JSON.stringify({ name: "Firebase経由" }),
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    const logs = await prisma.auditLog.findMany();
    expect(logs[0]?.actor).toBe("firebase:admin-uid");
  });
});

describe("Google ログインユーザーのデータ分離 (ダッシュボード基盤)", () => {
  it("Firebase ユーザーごとに ownerUid で完全分離され、他人のデータは見えない", async () => {
    const appFor = (uid: string) =>
      createApp({
        prisma,
        generate: null,
        verifyIdToken: async () => ({ uid }),
      });
    const bearer = { "Content-Type": "application/json", authorization: "Bearer t" };
    const alice = appFor("alice-uid");
    const bob = appFor("bob-uid");

    const res = await alice.request("/api/contacts", {
      method: "POST",
      headers: bearer,
      body: JSON.stringify({ name: "アリスの友人", distance: 2, email: "friend@example.com" }),
    });
    expect(res.status).toBe(201);

    // アリスには見える
    const aliceList = await (await alice.request("/api/contacts", { headers: bearer })).json();
    expect(aliceList.contacts).toHaveLength(1);
    // ボブには見えない (一覧・詳細・サマリすべて)
    const bobList = await (await bob.request("/api/contacts", { headers: bearer })).json();
    expect(bobList.contacts).toHaveLength(0);
    const contactId = aliceList.contacts[0].id;
    expect((await bob.request(`/api/contacts/${contactId}`, { headers: bearer })).status).toBe(404);
    const bobSummary = await (await bob.request("/api/relationship/summary", { headers: bearer })).json();
    expect(bobSummary.isolation.total).toBe(0);
    // break-glass ("owner" スコープ) にも見えない
    const ownerList = await (await app.request("/api/contacts", { headers: H })).json();
    expect(ownerList.contacts).toHaveLength(0);
    // DB には ownerUid = alice-uid で格納
    const row = await prisma.contact.findFirstOrThrow();
    expect(row.ownerUid).toBe("alice-uid");
  });

  it("トークン無しは 401 (サインインが必要)", async () => {
    const appFb = createApp({ prisma, generate: null, verifyIdToken: async () => ({ uid: "x" }) });
    const res = await appFb.request("/api/contacts");
    expect(res.status).toBe(401);
  });

  it("エクスポートに他ユーザーの接触記録・贈答記録が混ざらない", async () => {
    const appFor = (uid: string) => createApp({ prisma, generate: null, verifyIdToken: async () => ({ uid }) });
    const bearer = { "Content-Type": "application/json", authorization: "Bearer t" };
    const alice = appFor("alice-uid");
    const bob = appFor("bob-uid");
    // それぞれが連絡先 + 接触記録 + 贈答記録を作る
    for (const [app, who] of [
      [alice, "alice"],
      [bob, "bob"],
    ] as const) {
      const { contact } = await (
        await app.request("/api/contacts", {
          method: "POST",
          headers: bearer,
          body: JSON.stringify({ name: `${who}の友人` }),
        })
      ).json();
      await app.request(`/api/contacts/${contact.id}/interactions`, {
        method: "POST",
        headers: bearer,
        body: JSON.stringify({ type: "note", notes: `${who}の秘密メモ`, occurredAt: "2026-07-01" }),
      });
      await app.request(`/api/contacts/${contact.id}/gifts`, {
        method: "POST",
        headers: bearer,
        body: JSON.stringify({ item: `${who}の贈り物`, direction: "given", notes: `${who}の贈答メモ` }),
      });
    }
    const exported = await (await alice.request("/api/contacts/export", { headers: bearer })).json();
    // アリスの分は入り、ボブの記録は 1 件も混ざらない (テナント越境しない)
    expect(exported.contacts).toHaveLength(1);
    const iNotes = exported.interactions.map((i: { notes: string | null }) => i.notes);
    const gNotes = exported.gifts.map((g: { notes: string | null }) => g.notes);
    expect(iNotes).toContain("aliceの秘密メモ");
    expect(iNotes).not.toContain("bobの秘密メモ");
    expect(gNotes).toContain("aliceの贈答メモ");
    expect(gNotes).not.toContain("bobの贈答メモ");
    // ボブの export にはアリスの記録が入らない (逆向きも確認)
    const bobExport = await (await bob.request("/api/contacts/export", { headers: bearer })).json();
    expect(bobExport.interactions.map((i: { notes: string | null }) => i.notes)).not.toContain("aliceの秘密メモ");
  });
});

describe("名寄せ (identity resolution)", () => {
  const plain = { phone: undefined, personalProfile: undefined, valuesProfile: undefined, notes: undefined };

  it("取込でメールが同じなら名前が違っても既存に結合する (二重登録しない)", async () => {
    await createContact({ name: "田中", email: "tanaka@example.com", ...plain });
    const res = await app.request("/api/contacts/import", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ content: "氏名,メール,会社名\n田中一郎,TANAKA@example.com,田中商店" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(0);
    expect(body.enriched).toBe(1);
    const all = await prisma.contact.findMany({ where: { state: "active" } });
    expect(all).toHaveLength(1);
    expect(all[0]!.company).toBe("田中商店");
  });

  it("重複を検出し、マージでやりとり記録が統合先へ移り、片方は archived になる", async () => {
    const a = await createContact({ name: "佐藤", email: "sato@example.com", ...plain });
    const b = await createContact({ name: "佐藤 別表記", email: "SATO@example.com", ...plain });
    await prisma.contactInteraction.create({
      data: { contactId: b.id, type: "meeting", occurredAt: new Date("2026-06-01T12:00:00Z") },
    });

    const dupes = await (await app.request("/api/contacts/duplicates", { headers: H })).json();
    expect(dupes.groups.length).toBe(1);
    expect(dupes.groups[0].strong).toBe(true);
    expect(dupes.groups[0].members).toHaveLength(2);

    const merge = await app.request("/api/contacts/merge", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ primaryId: a.id, otherIds: [b.id] }),
    });
    expect(merge.status).toBe(200);
    expect((await merge.json()).merged).toBe(1);

    const active = await prisma.contact.findMany({ where: { state: "active" } });
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(a.id);
    const moved = await prisma.contactInteraction.findMany({ where: { contactId: a.id } });
    expect(moved).toHaveLength(1);
    const archived = await prisma.contact.findUnique({ where: { id: b.id } });
    expect(archived!.state).toBe("archived");
  });

  it("merge は相手未指定なら 400", async () => {
    const a = await createContact({ ...plain });
    const res = await app.request("/api/contacts/merge", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ primaryId: a.id, otherIds: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("「別人として扱う」で見送った同名の組は、二度と duplicates に出ない", async () => {
    await createContact({ name: "田中 太郎", ...plain });
    await createContact({ name: "田中太郎", ...plain }); // 正規化で同名 = 弱い一致
    const before = await (await app.request("/api/contacts/duplicates", { headers: H })).json();
    expect(before.groups.length).toBe(1);
    const key = before.groups[0].key as string;
    expect(typeof key).toBe("string");

    const dismiss = await app.request("/api/relationship/dismissals", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "dupe", key }),
    });
    expect(dismiss.status).toBe(200);

    const after = await (await app.request("/api/contacts/duplicates", { headers: H })).json();
    expect(after.groups.length).toBe(0);
  });
});

describe("連絡先の検索 (GET /api/contacts?q= 全員が対象)", () => {
  it("名前・ふりがな・ローマ字・メール・電話・会社で見つかり、総数も返る", async () => {
    await prisma.contact.create({
      data: {
        ownerUid: "owner", name: "田中 太郎", furigana: "たなか たろう",
        company: "エイト商事", email: "taro@example.co.jp", phone: "090-1234-5678",
      },
    });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "渋沢 栄一", furigana: "しぶさわ えいいち" } });
    await prisma.contact.create({ data: { ownerUid: "owner", name: "無関係 三郎" } });

    const q = async (word: string) =>
      (await (await app.request(`/api/contacts?q=${encodeURIComponent(word)}`, { headers: H })).json()) as {
        contacts: Array<{ name: string }>;
        total: number;
      };

    expect((await q("たなか")).contacts.map((x) => x.name)).toEqual(["田中 太郎"]);
    expect((await q("shibusawa")).contacts.map((x) => x.name)).toEqual(["渋沢 栄一"]);
    expect((await q("taro@example")).contacts.map((x) => x.name)).toEqual(["田中 太郎"]);
    expect((await q("09012345678")).contacts.map((x) => x.name)).toEqual(["田中 太郎"]);
    expect((await q("エイト商事")).contacts.map((x) => x.name)).toEqual(["田中 太郎"]);
    const miss = await q("該当なしのことば");
    expect(miss.contacts).toEqual([]);
    expect(miss.total).toBe(3);

    // q なしの一覧にも総数が付く
    const list = await (await app.request("/api/contacts", { headers: H })).json();
    expect(list.total).toBe(3);
  });
});

describe("取り込み元フィルタ (GET /api/contacts?source= と contact-sources)", () => {
  it("経路別の内訳が数えられ、source=line で LINE から迎えた方だけが返る", async () => {
    await prisma.contact.createMany({
      data: [
        { ownerUid: "owner", name: "LINE の花子", distance: 3, source: "line" },
        { ownerUid: "owner", name: "LINE の太郎", distance: 4, source: "line" },
        { ownerUid: "owner", name: "名刺の次郎", distance: 4, source: "import" },
        { ownerUid: "someone-else", name: "他人の LINE", distance: 4, source: "line" },
      ],
    });
    const sources = await (await app.request("/api/relationship/contact-sources", { headers: H })).json();
    const line = sources.items.find((x: { source: string }) => x.source === "line");
    expect(line.count).toBe(2); // 他人の分は数えない
    const res = await (await app.request("/api/contacts?source=line", { headers: H })).json();
    expect(res.total).toBe(2);
    expect(res.contacts.map((c: { name: string }) => c.name).sort()).toEqual(["LINE の太郎", "LINE の花子"]);
  });
});

describe("連絡先がわからない方の橋渡し (GET /api/relationship/reachability)", () => {
  it("連絡手段の無い方に、同じ所属で連絡手段のある方が橋渡し役として付く", async () => {
    await prisma.contact.createMany({
      data: [
        { ownerUid: "owner", name: "届かない太郎", distance: 3, company: "青空商事", sourceHits: 3 },
        { ownerUid: "owner", name: "橋渡し花子", distance: 3, company: "青空商事", email: "hanako@example.com" },
        { ownerUid: "owner", name: "無関係の方", distance: 4, company: "別の会社", email: "other@example.com" },
      ],
    });
    const res = await app.request("/api/relationship/reachability", { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    const target = body.items.find((x: { name: string }) => x.name === "届かない太郎");
    expect(target).toBeDefined();
    expect(target.bridges).toHaveLength(1);
    expect(target.bridges[0].name).toBe("橋渡し花子");
    expect(target.bridges[0].reasons[0]).toContain("青空商事");
    expect(body.unreachableTotal).toBeGreaterThanOrEqual(1);
    expect((await app.request("/api/relationship/reachability")).status).toBe(401);
  });
});
