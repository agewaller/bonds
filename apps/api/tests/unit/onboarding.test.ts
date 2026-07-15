import { describe, it, expect } from "vitest";
import { firstMoves, type OnboardPerson } from "../../src/lib/onboarding.js";

const NOW = new Date("2026-07-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function person(over: Partial<OnboardPerson>): OnboardPerson {
  return {
    id: "x", name: "名無", company: null, title: null, relationship: "acquaintance",
    source: "csv", createdAt: daysAgo(3), hasEmail: false, interactionCount: 0, facets: null,
    ...over,
  };
}

describe("firstMoves (はじめの一手)", () => {
  it("会社・役職のある方は仕事の一手として先頭に来る", () => {
    const moves = firstMoves([
      person({ id: "a", name: "営業 太郎", company: "商事会社", title: "部長", hasEmail: true }),
      person({ id: "b", name: "無印 花子" }),
    ], NOW);
    expect(moves[0]!.contactId).toBe("a");
    expect(moves[0]!.kind).toBe("work");
    expect(moves[0]!.reason).toContain("商事会社");
  });

  it("論点整理の貢献余地があれば理由に織り込む", () => {
    const moves = firstMoves([
      person({ id: "c", name: "困り 次郎", hasEmail: true, facets: { opportunities: ["場所探しに力になれる"], goals: [] } }),
    ], NOW);
    expect(moves[0]!.kind).toBe("work");
    expect(moves[0]!.reason).toContain("場所探し");
  });

  it("連絡手段はあるが接点情報が無い方は挨拶の一手", () => {
    const moves = firstMoves([person({ id: "d", name: "静か 三郎", hasEmail: true })], NOW);
    expect(moves[0]!.kind).toBe("greeting");
  });

  it("手がかりが無い方は情報を足す提案 (押しつけない言い方)", () => {
    const moves = firstMoves([person({ id: "e", name: "白紙 四子" })], NOW);
    expect(moves[0]!.kind).toBe("enrich");
    expect(moves[0]!.reason).toContain("手がかり");
  });

  it("やりとりが始まっている方・30日より古い取り込みは出さない", () => {
    const moves = firstMoves([
      person({ id: "f", interactionCount: 2, hasEmail: true, company: "会社" }),
      person({ id: "g", createdAt: daysAgo(60), hasEmail: true, company: "会社" }),
    ], NOW);
    expect(moves).toEqual([]);
  });

  it("件数の上限を守る", () => {
    const many = Array.from({ length: 20 }, (_, i) => person({ id: `p${i}`, hasEmail: true, company: "社" }));
    expect(firstMoves(many, NOW, 8)).toHaveLength(8);
  });
});
