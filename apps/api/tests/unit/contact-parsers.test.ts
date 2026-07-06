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
