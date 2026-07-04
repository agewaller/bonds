import { describe, it, expect } from "vitest";
import {
  splitCsvLine,
  parseCsvContacts,
  parseVCardContacts,
  parseContacts,
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
