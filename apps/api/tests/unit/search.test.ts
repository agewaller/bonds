import { describe, it, expect } from "vitest";
import { romajiToHiragana, normalizeForSearch, contactMatches } from "../../src/lib/search.js";

describe("romajiToHiragana", () => {
  it("ヘボン式・訓令式・促音・拗音・ん を読める", () => {
    expect(romajiToHiragana("tanaka")).toBe("たなか");
    expect(romajiToHiragana("shibusawa")).toBe("しぶさわ");
    expect(romajiToHiragana("sibusawa")).toBe("しぶさわ");
    expect(romajiToHiragana("kyoko")).toBe("きょこ");
    expect(romajiToHiragana("hokkaido")).toBe("ほっかいど");
    expect(romajiToHiragana("shinbashi")).toBe("しんばし");
    expect(romajiToHiragana("Fujita")).toBe("ふじた");
  });

  it("ローマ字として読めない英単語は null (誤変換で誤ヒットさせない)", () => {
    expect(romajiToHiragana("smith")).toBeNull();
    expect(romajiToHiragana("xyz")).toBeNull();
    expect(romajiToHiragana("")).toBeNull();
  });
});

describe("normalizeForSearch", () => {
  it("カタカナ→ひらがな・全半角・空白/記号を吸収する", () => {
    expect(normalizeForSearch("タナカ　タロウ")).toBe("たなかたろう");
    expect(normalizeForSearch("ｅｉｇｈｔ商事")).toBe("eight商事");
    expect(normalizeForSearch("山田・太郎")).toBe("山田太郎");
  });
});

describe("contactMatches", () => {
  const ct = {
    name: "田中 太郎",
    furigana: "たなか たろう",
    company: "エイト商事株式会社",
    title: "部長",
    email: "taro.tanaka@example.co.jp",
    phone: "090-1234-5678",
    address: "東京都港区1-2-3",
    notes: "登山が好き。7月に引っ越し予定",
    sns: JSON.stringify([{ platform: "x", handle: "@taro_t" }]),
  };

  it("名前・ふりがな (かな/カナ)・会社・役職で当たる", () => {
    expect(contactMatches("田中", ct)).toBe(true);
    expect(contactMatches("たなか", ct)).toBe(true);
    expect(contactMatches("タナカ", ct)).toBe(true);
    expect(contactMatches("エイト商事", ct)).toBe(true);
    expect(contactMatches("部長", ct)).toBe(true);
  });

  it("ローマ字でふりがなに当たる (tanaka → たなか)", () => {
    expect(contactMatches("tanaka", ct)).toBe(true);
    expect(contactMatches("TANAKA", ct)).toBe(true);
    expect(contactMatches("suzuki", ct)).toBe(false);
    // メール等の英字が無い方でも、ふりがなさえあればローマ字で見つかる
    const kanaOnly = { name: "渋沢 栄一", furigana: "しぶさわ えいいち" };
    expect(contactMatches("shibusawa", kanaOnly)).toBe(true);
    expect(contactMatches("sibusawa", kanaOnly)).toBe(true);
    expect(contactMatches("tanaka", kanaOnly)).toBe(false);
  });

  it("メール・電話 (数字だけでも)・住所・メモ・SNS ハンドルで当たる", () => {
    expect(contactMatches("taro.tanaka", ct)).toBe(true);
    expect(contactMatches("example.co.jp", ct)).toBe(true);
    expect(contactMatches("090-1234", ct)).toBe(true);
    expect(contactMatches("12345678", ct)).toBe(true);
    expect(contactMatches("港区", ct)).toBe(true);
    expect(contactMatches("登山", ct)).toBe(true);
    expect(contactMatches("taro_t", ct)).toBe(true);
  });

  it("当たらない語は false、空の検索語はすべて当たる", () => {
    expect(contactMatches("鈴木", ct)).toBe(false);
    expect(contactMatches("  ", ct)).toBe(true);
  });
});
