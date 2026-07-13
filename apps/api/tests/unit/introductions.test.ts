import { describe, it, expect } from "vitest";
import { salientGrams, nominateIntroPairs, type IntroPerson } from "../../src/lib/introductions.js";

describe("salientGrams", () => {
  it("漢字を含む2文字とカタカナ語を手がかりに取り出す", () => {
    const g = salientGrams("資金調達に悩んでいる");
    expect(g.has("資金")).toBe(true);
    expect(g.has("調達")).toBe(true);
    const k = salientGrams("マーケティングが得意");
    expect(k.has("マーケティング")).toBe(true);
  });
});

describe("nominateIntroPairs", () => {
  const people: IntroPerson[] = [
    { id: "a", name: "田中", needs: ["資金調達に悩んでいる"], offers: ["新規事業の立ち上げ経験"] },
    { id: "b", name: "鈴木", needs: [], offers: ["投資家として資金調達を支援できる"] },
    { id: "c", name: "佐藤", needs: ["健康の不安"], offers: ["料理が得意"] },
  ];

  it("一方の困りごとに他方の強みが噛み合う組を挙げる", () => {
    const pairs = nominateIntroPairs(people);
    const tb = pairs.find((p) => (p.aId === "a" && p.bId === "b") || (p.aId === "b" && p.bId === "a"));
    expect(tb).toBeTruthy();
    // 田中の「資金調達」の困りごとに鈴木の「資金調達を支援」が噛み合う
    const hitTerms = [...tb!.aNeedsBOffers, ...tb!.bNeedsAOffers].join(" ");
    expect(hitTerms).toContain("資金調達");
  });

  it("噛み合う手がかりが無い組は候補にしない", () => {
    const pairs = nominateIntroPairs(people);
    const tc = pairs.find((p) => p.aId === "c" || p.bId === "c");
    expect(tc).toBeFalsy(); // 佐藤は誰とも噛み合わない
  });

  it("双方向に噛み合う組はスコアが高く先頭に来る", () => {
    const mutual: IntroPerson[] = [
      { id: "x", name: "X", needs: ["デザインが苦手"], offers: ["営業の人脈が広い"] },
      { id: "y", name: "Y", needs: ["営業の人脈がほしい"], offers: ["デザインが得意"] },
      { id: "z", name: "Z", needs: ["営業の人脈がほしい"], offers: ["経理ができる"] },
    ];
    const pairs = nominateIntroPairs(mutual);
    expect(pairs[0]!.mutual).toBe(true);
    expect(new Set([pairs[0]!.aId, pairs[0]!.bId])).toEqual(new Set(["x", "y"]));
  });

  it("手がかりが乏しければ空", () => {
    expect(nominateIntroPairs([{ id: "1", name: "一人", needs: [], offers: [] }])).toEqual([]);
    expect(nominateIntroPairs([])).toEqual([]);
  });
});
