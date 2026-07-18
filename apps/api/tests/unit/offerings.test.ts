import { describe, it, expect } from "vitest";
import {
  parseOfferingInput,
  tokenize,
  matchOfferingToContacts,
  OFFERING_KINDS,
  type OfferingLike,
  type ContactNeed,
} from "../../src/lib/offerings.js";

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
