import { describe, it, expect } from "vitest";
import {
  splitCsvLine,
  parseCsvContacts,
  parseVCardContacts,
  parseContacts,
  parseLinkedInConnections,
  parseFacebookFriends,
  parseInstagramFollowing,
  parseTwitterFollowing,
} from "../../src/lib/contact-parsers.js";

// 取込サンプルの固定資産 (回帰テスト用 = DESIGN-HANDOVER.md §7)

const CSV_JA = `氏名,ふりがな,電話,メール,会社,距離,メモ
山田花子,やまだはなこ,090-1111-2222,hanako@example.com,テスト商事,2,"大学の同期, テニス仲間"
佐藤太郎,,03-1234-5678,taro@example.com,,3,
,,,noname@example.com,,,`;

const CSV_EN = `Name,Phone,Email,Organization,Title,Birthday
"Smith, John",+1-555-0100,john@example.com,Acme Inc,CEO,1970-01-15`;

const VCF = `BEGIN:VCARD
VERSION:3.0
FN:鈴木一郎
N:鈴木;一郎;;;
TEL;TYPE=CELL:080-9999-8888
EMAIL;TYPE=WORK:ichiro@example.co.jp
ORG:サンプル株式会社;営業部
TITLE:部長
BDAY:19651123
END:VCARD
BEGIN:VCARD
VERSION:3.0
N:Tanaka;Yuki;;;
TEL:070-0000-1111
END:VCARD`;

describe("splitCsvLine", () => {
  it("クォート内のカンマとエスケープされた引用符を扱う", () => {
    expect(splitCsvLine('a,"b, c",d')).toEqual(["a", "b, c", "d"]);
    expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
    expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });
});

describe("parseCsvContacts", () => {
  it("日本語ヘッダの CSV を取り込み、名前の無い行はスキップ", () => {
    const rows = parseCsvContacts(CSV_JA);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "山田花子",
      furigana: "やまだはなこ",
      phone: "090-1111-2222",
      email: "hanako@example.com",
      company: "テスト商事",
      distance: 2,
      notes: "大学の同期, テニス仲間",
    });
    expect(rows[1]?.distance).toBe(3);
  });

  it("英語ヘッダ (Organization/Title/Birthday) も lms 互換で取り込む", () => {
    const rows = parseCsvContacts(CSV_EN);
    expect(rows[0]).toMatchObject({
      name: "Smith, John",
      company: "Acme Inc",
      title: "CEO",
      birthday: "1970-01-15",
    });
  });

  it("ヘッダのみ/空文字は空配列", () => {
    expect(parseCsvContacts("name,phone")).toEqual([]);
    expect(parseCsvContacts("")).toEqual([]);
  });
});

describe("parseVCardContacts", () => {
  it("FN/TEL/EMAIL/ORG/TITLE/BDAY を取り込む", () => {
    const rows = parseVCardContacts(VCF);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "鈴木一郎",
      phone: "080-9999-8888",
      email: "ichiro@example.co.jp",
      company: "サンプル株式会社",
      title: "部長",
      birthday: "1965-11-23",
    });
  });

  it("FN が無ければ N から名前を組み立てる", () => {
    const rows = parseVCardContacts(VCF);
    expect(rows[1]?.name).toBe("Tanaka Yuki");
  });

  it("折り返し行 (RFC 6350) を連結する", () => {
    const folded = "BEGIN:VCARD\nFN:とても長い\n 名前の人\nEND:VCARD";
    expect(parseVCardContacts(folded)[0]?.name).toBe("とても長い名前の人");
  });
});

describe("parseContacts (auto)", () => {
  it("BEGIN:VCARD の有無で自動判別する", () => {
    expect(parseContacts(VCF)[0]?.name).toBe("鈴木一郎");
    expect(parseContacts(CSV_JA)[0]?.name).toBe("山田花子");
  });
});

describe("Eight / 年賀状リストの取込 (フェーズ3)", () => {
  it("Eight エクスポート形式 (会社名/部署名/役職/氏名/e-mail/TEL) を取り込む", () => {
    const eight = `会社名,部署名,役職,氏名,e-mail,TEL,携帯電話,住所
株式会社エイト商事,営業部,部長,近藤五郎,goro@eight-example.co.jp,03-0000-1111,090-2222-3333,東京都港区1-2-3`;
    const rows = parseCsvContacts(eight);
    expect(rows[0]).toMatchObject({
      name: "近藤五郎",
      company: "株式会社エイト商事",
      title: "部長",
      email: "goro@eight-example.co.jp",
      address: "東京都港区1-2-3",
    });
    // TEL と携帯電話が両方あるときは後勝ち (携帯優先の列順)
    expect(rows[0]?.phone).toBe("090-2222-3333");
  });

  it("年賀状リスト (宛名/郵便番号/住所) を取り込む", () => {
    const nenga = `宛名,郵便番号,住所
田村八重子,100-0001,東京都千代田区千代田1-1`;
    const rows = parseCsvContacts(nenga);
    expect(rows[0]).toMatchObject({ name: "田村八重子", address: "東京都千代田区千代田1-1" });
  });

  it("氏名が無く姓/名に分かれた名刺 CSV (Eight の別形式) を結合して取り込む", () => {
    const split = `会社名,役職,姓,名,e-mail
株式会社エイト商事,課長,近藤,五郎,goro@eight-example.co.jp`;
    const rows = parseCsvContacts(split);
    expect(rows[0]).toMatchObject({
      name: "近藤 五郎",
      company: "株式会社エイト商事",
      title: "課長",
      email: "goro@eight-example.co.jp",
    });
  });

  it("Last Name / First Name (英語ヘッダの姓名分割) も結合する", () => {
    const en = `First Name,Last Name,Email\nJohn,Smith,john@example.com`;
    const rows = parseCsvContacts(en);
    expect(rows[0]).toMatchObject({ name: "Smith John", email: "john@example.com" });
  });
});

describe("SNS アーカイブ取込 (lms 移植)", () => {
  it("LinkedIn Connections.csv (注記行つき) を取り込む", () => {
    const csv = `Notes:\n"When exporting your connection data..."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n太郎,山本,https://www.linkedin.com/in/taro,taro@example.com,リンク株式会社,部長,06 Jan 2020`;
    const rows = parseLinkedInConnections(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "太郎 山本",
      email: "taro@example.com",
      company: "リンク株式会社",
      title: "部長",
      source: "linkedin",
    });
  });

  it("Facebook friends.json を取り込む", () => {
    const json = JSON.stringify({ friends_v2: [{ name: "友達 一号", timestamp: 1500000000 }, { name: "" }] });
    const rows = parseFacebookFriends(json);
    expect(rows).toEqual([{ name: "友達 一号", source: "facebook", distance: 4 }]);
  });

  it("Instagram following.json を取り込む", () => {
    const json = JSON.stringify({
      relationships_following: [
        { string_list_data: [{ value: "insta_user", href: "https://instagram.com/insta_user" }] },
      ],
    });
    const rows = parseInstagramFollowing(json);
    expect(rows[0]).toMatchObject({ name: "insta_user", sns: "https://instagram.com/insta_user", source: "instagram" });
  });

  it("X (Twitter) following.js の window.YTD 形式を取り込む", () => {
    const js = 'window.YTD.following.part0 = [ {"following": {"accountId": "12345", "userLink": "https://twitter.com/intent/user?user_id=12345"}} ]';
    const rows = parseTwitterFollowing(js);
    expect(rows[0]).toMatchObject({ name: "12345", source: "twitter" });
  });

  it("parseContacts の自動判別で SNS 形式を見分ける", () => {
    expect(parseContacts('window.YTD.following.part0 = [{"following":{"accountId":"1"}}]')[0]?.source).toBe("twitter");
    expect(parseContacts(JSON.stringify({ friends_v2: [{ name: "F" }] }))[0]?.source).toBe("facebook");
    expect(parseContacts("First Name,Last Name\nA,B")[0]?.name).toBe("A B");
  });

  it("壊れた JSON は空配列 (取り込みを壊さない)", () => {
    expect(parseFacebookFriends("{broken")).toEqual([]);
    expect(parseTwitterFollowing("window.YTD.x = {bad")).toEqual([]);
  });
});

// ------------------------------------------------------------
// トーク履歴・Google 連絡先・lms エクスポートの取込 (2026-07-06 追加)
// ------------------------------------------------------------

import {
  parseLineTalk,
  parseWhatsAppChat,
  parseGoogleContactsCsv,
  parseLmsExport,
  parseImportText,
} from "../../src/lib/contact-parsers.js";

const LINE_TALK = `[LINE] 山田太郎とのトーク履歴
保存日時：2026/07/01 12:00

2026/06/01(月)
10:23\t山田太郎\tこんにちは
10:24\t自分\tどうも
2026/06/03(水)
09:00\t山田太郎\t写真を送信しました
2026/06/05(金)
`;

describe("parseLineTalk (LINE トーク履歴)", () => {
  it("ヘッダから相手名、日付行から日別の接触履歴を復元する", () => {
    const r = parseLineTalk(LINE_TALK);
    expect(r.contacts[0]).toMatchObject({ name: "山田太郎", source: "line", distance: 3 });
    expect(r.interactions).toEqual([
      { name: "山田太郎", occurredAt: "2026-06-01", type: "message" },
      { name: "山田太郎", occurredAt: "2026-06-03", type: "message" },
    ]); // 6/5 はメッセージが無いので数えない
  });

  it("英語ヘッダ (Chat history with) も受ける", () => {
    const r = parseLineTalk("[LINE] Chat history with John Smith\n\n2026/06/01(Mon)\n10:00\tJohn Smith\thi\n");
    expect(r.contacts[0]?.name).toBe("John Smith");
  });

  it("グループトークの他の参加者 (3通以上) も連絡先候補になる", () => {
    const msgs = Array.from({ length: 3 }, (_, i) => `10:0${i}\t佐藤次郎\tやあ`).join("\n");
    const r = parseLineTalk(`[LINE] 山田太郎とのトーク履歴\n\n2026/06/01(月)\n10:23\t山田太郎\tこんにちは\n${msgs}\n`);
    expect(r.contacts.map((c) => c.name)).toEqual(["山田太郎", "佐藤次郎"]);
  });
});

describe("parseWhatsAppChat", () => {
  it("iOS 形式 [YYYY/MM/DD hh:mm:ss] を取り込む (相手はファイル名から)", () => {
    const txt = "[2026/07/01 12:34:56] 田中良子: こんにちは\n[2026/07/02 08:00:00] 自分: どうも\n";
    const r = parseWhatsAppChat(txt, "WhatsApp Chat with 田中良子.txt");
    expect(r.contacts[0]).toMatchObject({ name: "田中良子", source: "whatsapp" });
    expect(r.interactions).toEqual([{ name: "田中良子", occurredAt: "2026-07-01", type: "message" }]);
  });

  it("Android 形式 D/M/YYYY, hh:mm - も取り込む", () => {
    const txt = "13/6/2026, 12:34 - Maria: hola\n14/6/2026, 09:10 - Maria: buenos dias\n";
    const r = parseWhatsAppChat(txt, "WhatsApp Chat with Maria.txt");
    expect(r.interactions.map((i) => i.occurredAt)).toEqual(["2026-06-13", "2026-06-14"]);
  });
});

describe("parseGoogleContactsCsv", () => {
  const GOOGLE_CSV = `First Name,Middle Name,Last Name,Phonetic First Name,Phonetic Last Name,Name,Birthday,E-mail 1 - Value,Phone 1 - Value,Organization Name,Organization Title
太郎,,山本,たろう,やまもと,,1960-04-01,taro.y@example.com,090-0000-1111,山本工務店,代表
John,Q,Public,,,,,jq@example.com,,,`;

  it("姓名を CJK は姓→名で結合し、誕生日・連絡先も拾う", () => {
    const rows = parseGoogleContactsCsv(GOOGLE_CSV);
    expect(rows[0]).toMatchObject({
      name: "山本 太郎",
      furigana: "やまもと たろう",
      email: "taro.y@example.com",
      phone: "090-0000-1111",
      company: "山本工務店",
      title: "代表",
      birthday: "1960-04-01",
      source: "google",
    });
    expect(rows[1]?.name).toBe("John Q Public");
  });

  it("parseContacts の自動判別が LinkedIn より先に Google を見分ける", () => {
    expect(parseContacts(GOOGLE_CSV)[0]?.source).toBe("google");
  });
});

describe("parseLmsExport", () => {
  it("relationship_contacts と relationship_interactions を取り込む", () => {
    const json = JSON.stringify({
      relationship_contacts: [
        { name: "lms山田", distance: "2", email: "lms@example.com", company: "LMS社" },
        { name: "" },
      ],
      relationship_interactions: [
        { person: "lms山田", type: "call", timestamp: "2026-06-20T10:00:00.000Z" },
        { person: "lms山田" }, // 日付なしは捨てる
      ],
    });
    const r = parseLmsExport(json);
    expect(r.contacts).toEqual([
      { name: "lms山田", phone: undefined, email: "lms@example.com", address: undefined, company: "LMS社", title: undefined, birthday: undefined, distance: 2, notes: undefined, source: "lms" },
    ]);
    expect(r.interactions).toEqual([{ name: "lms山田", occurredAt: "2026-06-20", type: "call" }]);
  });

  it("領域エクスポート形式 { contacts: [...] } も受ける", () => {
    const r = parseLmsExport(JSON.stringify({ contacts: [{ name: "領域 花子", distance: 3 }], interactions: [] }));
    expect(r.contacts[0]?.name).toBe("領域 花子");
  });
});

describe("parseImportText (統合判別)", () => {
  it("LINE トークを見分けて接触履歴つきで返す", () => {
    const r = parseImportText(LINE_TALK);
    expect(r.contacts[0]?.source).toBe("line");
    expect(r.interactions.length).toBe(2);
  });

  it("lms エクスポートを見分ける", () => {
    const r = parseImportText(JSON.stringify({ relationship_contacts: [{ name: "A", distance: 1 }] }));
    expect(r.contacts[0]?.source).toBe("lms");
  });

  it("従来 CSV は接触履歴なしで返す", () => {
    const r = parseImportText("氏名,距離\nふつう取込,3");
    expect(r.contacts[0]?.name).toBe("ふつう取込");
    expect(r.interactions).toEqual([]);
  });
});
