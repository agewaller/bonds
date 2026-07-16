import { describe, it, expect } from "vitest";
import { pickFocusContacts, type FocusInput } from "../../src/lib/priority.js";

function person(over: Partial<FocusInput>): FocusInput {
  return {
    id: "x", name: "名無", company: null, title: null, hasEmail: false, hasPhone: false,
    distance: 4, source: "csv", interactionCount: 0, lastContactDays: null,
    giftExchangeCount: 0, hasFacets: false, hasDigest: false, hasGoal: false,
    sourceHits: 1, focusPreference: null,
    ...over,
  };
}

describe("pickFocusContacts (大切にしたい方々)", () => {
  it("死んだリスト (一括取込でやりとりも材料も無い方) は選ばれない", () => {
    const dead = [
      person({ id: "fb1", source: "facebook" }),
      person({ id: "fb2", source: "facebook", hasEmail: true }),
      person({ id: "e1", source: "eight", company: "会社", hasEmail: true }),
    ];
    expect(pickFocusContacts(dead)).toEqual([]);
  });

  it("目標・やりとり・贈答のある方が理由つきで選ばれ、強い順に並ぶ", () => {
    const people = [
      person({ id: "goal", name: "目標 太郎", hasGoal: true, hasEmail: true }),
      person({ id: "active", name: "交流 花子", interactionCount: 10, lastContactDays: 5, giftExchangeCount: 2 }),
      person({ id: "dead", source: "facebook" }),
    ];
    const picks = pickFocusContacts(people);
    expect(picks.map((p) => p.contactId)).toEqual(["active", "goal"]);
    expect(picks[0]!.reasons).toContain("やりとりが積み重なっている");
    expect(picks[1]!.reasons).toContain("目標を決めた間柄");
  });

  it("ご自身で登録した方は名簿由来より選ばれやすい", () => {
    const picks = pickFocusContacts([
      person({ id: "manual", source: "manual", company: "会社", hasEmail: true }),
      person({ id: "bulk", source: "eight", company: "会社", hasEmail: true }),
    ]);
    expect(picks.map((p) => p.contactId)).toEqual(["manual"]);
  });

  it("件数上限を守り、理由は最大3つ", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      person({ id: `p${i}`, hasGoal: true, distance: 1, source: "manual", interactionCount: 5, lastContactDays: 3, giftExchangeCount: 1 }),
    );
    const picks = pickFocusContacts(many, 20);
    expect(picks).toHaveLength(20);
    expect(picks[0]!.reasons.length).toBeLessThanOrEqual(3);
  });

  it("取り込みにくり返し登場する方は弱い名簿シグナルでも浮かび上がる", () => {
    const picks = pickFocusContacts([
      person({ id: "hits", name: "重複 登", sourceHits: 4, company: "会社", hasEmail: true }),
      person({ id: "once", name: "一度 だけ", sourceHits: 1, company: "会社", hasEmail: true }),
    ]);
    expect(picks.map((p) => p.contactId)).toEqual(["hits"]);
    expect(picks[0]!.reasons).toContain("取り込みにくり返し登場");
  });

  it("pinned は材料が無くても必ず載り、excluded はどれだけ強くても載らない", () => {
    const picks = pickFocusContacts([
      person({ id: "pin", name: "印 太郎", focusPreference: "pinned" }),
      person({
        id: "ex", name: "外 花子", focusPreference: "excluded",
        hasGoal: true, interactionCount: 20, lastContactDays: 1, giftExchangeCount: 5,
      }),
    ]);
    expect(picks.map((p) => p.contactId)).toEqual(["pin"]);
    expect(picks[0]!.reasons).toContain("あなたが大切と印を付けた方");
  });
});
