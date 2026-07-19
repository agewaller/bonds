import { describe, it, expect } from "vitest";
import {
  parseOfferingInput,
  tokenize,
  matchOfferingToContacts,
  classifyOffering,
  parseOfferingsBulk,
  OFFERING_KINDS,
  type OfferingLike,
  type ContactNeed,
} from "../../src/lib/offerings.js";

describe("classifyOffering / parseOfferingsBulk (一括取込の自動分類)", () => {
  it("キーワードから種類を判定する", () => {
    expect(classifyOffering("英語のレッスン")).toBe("teach");
    expect(classifyOffering("起業の相談にのれます")).toBe("advise");
    expect(classifyOffering("工具をお貸しします")).toBe("lend");
    expect(classifyOffering("使わない子ども用品を譲ります")).toBe("give");
    expect(classifyOffering("引っ越しの手伝い")).toBe("help");
    expect(classifyOffering("よくわからないもの")).toBe("other");
  });

  it("貼り付けを 1 行 1 件に分解し、分類・重複除去・ヘッダ行スキップする", () => {
    const text = "タイトル\n英語のレッスン,平日夜\n英語のレッスン\n工具を貸します\n\n・引っ越しの手伝い";
    const rows = parseOfferingsBulk(text);
    expect(rows.map((r) => r.title)).toEqual(["英語のレッスン", "工具を貸します", "引っ越しの手伝い"]);
    expect(rows[0]!.kind).toBe("teach");
    expect(rows[0]!.description).toBe("平日夜"); // 2 列目が説明
    expect(rows[1]!.kind).toBe("lend");
    expect(rows[2]!.kind).toBe("help");
  });

  it("タブ区切り (表計算コピー) も列として読む", () => {
    const rows = parseOfferingsBulk("ピアノ指導\t月2回まで");
    expect(rows[0]!.title).toBe("ピアノ指導");
    expect(rows[0]!.description).toBe("月2回まで");
    expect(rows[0]!.kind).toBe("teach");
  });
});

describe("parseOfferingInput", () => {
  it("title 必須", () => {
    const r = parseOfferingInput({ title: "  " });
    expect("error" in r && r.error).toBe("title_required");
  });

  it("既定の kind は help、不正な kind も help に丸める", () => {
    const a = parseOfferingInput({ title: "英語を教えられる" });
    expect("kind" in a && a.kind).toBe("help");
    const b = parseOfferingInput({ title: "英語を教えられる", kind: "sell" });
    expect("kind" in b && b.kind).toBe("help");
  });

  it("既知の kind はそのまま通す", () => {
    for (const k of OFFERING_KINDS) {
      const r = parseOfferingInput({ title: "x", kind: k });
      expect("kind" in r && r.kind).toBe(k);
    }
  });

  it("maxDistance は 1〜5 のみ、範囲外は null", () => {
    expect((parseOfferingInput({ title: "x", maxDistance: 3 }) as { maxDistance: number }).maxDistance).toBe(3);
    expect((parseOfferingInput({ title: "x", maxDistance: 0 }) as { maxDistance: number | null }).maxDistance).toBeNull();
    expect((parseOfferingInput({ title: "x", maxDistance: 9 }) as { maxDistance: number | null }).maxDistance).toBeNull();
  });

  it("logistics は許可値だけ残す・situations は最大 12 件", () => {
    const r = parseOfferingInput({
      title: "x",
      logistics: ["対面", "テレパシー", "オンライン"],
      situations: Array.from({ length: 20 }, (_, i) => `s${i}`),
    }) as { logistics: string[]; situations: string[] };
    expect(r.logistics).toEqual(["対面", "オンライン"]);
    expect(r.situations.length).toBe(12);
  });
});

describe("tokenize", () => {
  it("ASCII 語と CJK の 2-gram を出す", () => {
    const t = tokenize("English 転職 したい");
    expect(t.has("english")).toBe(true);
    expect(t.has("転職")).toBe(true);
  });
});

describe("matchOfferingToContacts", () => {
  const offering: OfferingLike = {
    id: "o1",
    kind: "teach",
    title: "英語の学習をお手伝いできます",
    description: "英会話やビジネス英語の練習相手になれます",
    category: "語学",
    situations: ["転職で英語が要る方"],
    maxDistance: null,
  };

  it("ニーズが重なる相手を根拠つきで挙げる", () => {
    const contacts: ContactNeed[] = [
      { id: "a", name: "田中", distance: 3, needTexts: ["転職に向けて英語の勉強をやり直したい"] },
      { id: "b", name: "鈴木", distance: 3, needTexts: ["家庭菜園を広げたい"] },
    ];
    const m = matchOfferingToContacts(offering, contacts);
    expect(m.map((x) => x.contactId)).toContain("a");
    expect(m.map((x) => x.contactId)).not.toContain("b");
    expect(m[0].reason).toContain("英語");
  });

  it("距離ゲート (maxDistance) を尊重する", () => {
    const near: OfferingLike = { ...offering, maxDistance: 2 };
    const contacts: ContactNeed[] = [
      { id: "a", name: "田中", distance: 4, needTexts: ["英語の勉強をやり直したい"] },
    ];
    expect(matchOfferingToContacts(near, contacts)).toEqual([]);
  });

  it("重なりが 1 語以下なら挙げない", () => {
    const contacts: ContactNeed[] = [
      { id: "a", name: "田中", distance: 3, needTexts: ["犬を飼っている"] },
    ];
    expect(matchOfferingToContacts(offering, contacts)).toEqual([]);
  });

  it("スコア順に並び、上限件数で切る", () => {
    const contacts: ContactNeed[] = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      name: `n${i}`,
      distance: 3,
      needTexts: ["英語の学習を英会話でやりたい"],
    }));
    const m = matchOfferingToContacts(offering, contacts, 5);
    expect(m.length).toBe(5);
  });
});
