// 贈り物 (Gift) の行事計算・お返し判定のユニットテスト。
import { describe, it, expect } from "vitest";
import { computeGiftOccasions, summarizeGiftLedger } from "../../src/lib/gifts.js";

const today = new Date("2026-07-08T12:00:00Z");

describe("computeGiftOccasions", () => {
  it("誕生日・記念日を lookahead 以内で拾い、日数を出す", () => {
    const occ = computeGiftOccasions(
      {
        today,
        contacts: [
          { id: "a", name: "山田", birthday: new Date("1960-07-20T00:00:00Z"), anniversary: null, distance: 3 },
          { id: "b", name: "鈴木", birthday: new Date("1970-12-01T00:00:00Z"), anniversary: new Date("2000-07-15T00:00:00Z"), distance: 2 },
        ],
        gifts: [],
      },
      45,
    );
    const yamada = occ.find((o) => o.kind === "birthday" && o.contactName === "山田");
    expect(yamada?.daysUntil).toBe(12);
    // 鈴木の誕生日 12/1 は 45 日より先 → 出ない。記念日 7/15 は出る
    expect(occ.some((o) => o.kind === "birthday" && o.contactName === "鈴木")).toBe(false);
    expect(occ.some((o) => o.kind === "anniversary" && o.contactName === "鈴木")).toBe(true);
  });

  it("季節の贈答 (お中元) が近ければ出す", () => {
    const occ = computeGiftOccasions({ today, contacts: [], gifts: [] }, 45);
    expect(occ.some((o) => o.kind === "seasonal" && o.label.includes("お中元"))).toBe(true);
  });

  it("いただいたのに未返礼なら督促を先頭に出す", () => {
    const occ = computeGiftOccasions(
      {
        today,
        contacts: [{ id: "a", name: "佐藤", birthday: null, anniversary: null, distance: 3 }],
        gifts: [{ contactId: "a", direction: "inbound", occasion: "other", givenAt: new Date("2026-05-01T00:00:00Z") }],
      },
      45,
    );
    expect(occ[0]!.kind).toBe("return");
    expect(occ[0]!.contactName).toBe("佐藤");
  });

  it("いただいた後にお返し済みなら督促しない", () => {
    const occ = computeGiftOccasions(
      {
        today,
        contacts: [{ id: "a", name: "佐藤", birthday: null, anniversary: null, distance: 3 }],
        gifts: [
          { contactId: "a", direction: "inbound", occasion: "other", givenAt: new Date("2026-05-01T00:00:00Z") },
          { contactId: "a", direction: "outbound", occasion: "thanks", givenAt: new Date("2026-05-20T00:00:00Z") },
        ],
      },
      45,
    );
    expect(occ.some((o) => o.kind === "return")).toBe(false);
  });

  it("いただいて日が浅ければ (30日未満) まだ督促しない", () => {
    const occ = computeGiftOccasions(
      {
        today,
        contacts: [{ id: "a", name: "佐藤", birthday: null, anniversary: null, distance: 3 }],
        gifts: [{ contactId: "a", direction: "inbound", occasion: "other", givenAt: new Date("2026-07-01T00:00:00Z") }],
      },
      45,
    );
    expect(occ.some((o) => o.kind === "return")).toBe(false);
  });
});

describe("summarizeGiftLedger", () => {
  it("贈った/いただいたの件数・金額と、未返礼かを集計する", () => {
    const l = summarizeGiftLedger([
      { contactId: "a", direction: "inbound", occasion: "other", givenAt: new Date("2026-05-01T00:00:00Z"), amount: 3000 },
      { contactId: "a", direction: "outbound", occasion: "birthday", givenAt: new Date("2026-03-01T00:00:00Z"), amount: 5000 },
    ]);
    expect(l.inboundCount).toBe(1);
    expect(l.outboundCount).toBe(1);
    expect(l.inboundTotal).toBe(3000);
    expect(l.outboundTotal).toBe(5000);
    // 最後にいただいた (5/1) 方が最後に贈った (3/1) より新しい → 未返礼
    expect(l.needsReturn).toBe(true);
  });
});
