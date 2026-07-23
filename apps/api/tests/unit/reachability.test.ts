// 連絡先がわからない方の橋渡し探し (reachability) のユニットテスト。
import { describe, it, expect } from "vitest";
import {
  isReachable,
  extractMeetEvents,
  pickUnreachableTargets,
  findBridges,
  type ReachPerson,
} from "../../src/lib/reachability.js";

const base: ReachPerson = {
  id: "x",
  name: "名無し",
  company: null,
  email: null,
  phone: null,
  sns: null,
  notes: null,
  personalProfile: null,
  sourceHits: 1,
  distance: 4,
};

describe("isReachable", () => {
  it("メール・電話・SNS のどれかがあれば届く。全部無ければ届かない", () => {
    expect(isReachable({ email: "a@example.com", phone: null, sns: null })).toBe(true);
    expect(isReachable({ email: null, phone: "090-1111-2222", sns: null })).toBe(true);
    expect(isReachable({ email: null, phone: null, sns: "https://x.com/foo" })).toBe(true);
    expect(isReachable({ email: "  ", phone: null, sns: "[]" })).toBe(false);
  });
});

describe("extractMeetEvents", () => {
  it("メモから「◯◯で出会う」のイベント名を取り出す", () => {
    expect(extractMeetEvents("2026-07-20 七夕交流会で出会う\nほかのメモ")).toEqual(["七夕交流会"]);
    expect(extractMeetEvents(null)).toEqual([]);
  });
});

describe("pickUnreachableTargets", () => {
  it("連絡手段の無い方だけを、くり返し登場・やりとり・近さの順に選ぶ", () => {
    const hot: ReachPerson = { ...base, id: "hot", sourceHits: 5, distance: 2 };
    const cold: ReachPerson = { ...base, id: "cold", sourceHits: 1, distance: 5 };
    const reachable: ReachPerson = { ...base, id: "ok", email: "ok@example.com" };
    const out = pickUnreachableTargets([cold, hot, reachable], new Map([["cold", 0]]), 10);
    expect(out.map((p) => p.id)).toEqual(["hot", "cold"]);
  });
});

describe("findBridges", () => {
  it("同じ所属・同じ日の同席・同じイベント・記録への登場で橋渡し役を挙げる (連絡手段のある方だけ)", () => {
    const target: ReachPerson = { ...base, id: "t", name: "田中太郎", company: "青空商事", notes: "2026-07-07 七夕会で出会う" };
    const sameCompany: ReachPerson = { ...base, id: "b1", name: "橋渡し一郎", company: "青空商事", email: "b1@example.com" };
    const sameDay: ReachPerson = { ...base, id: "b2", name: "橋渡し二郎", email: "b2@example.com" };
    const sameEvent: ReachPerson = { ...base, id: "b3", name: "橋渡し三郎", email: "b3@example.com", notes: "2026-07-07 七夕会で出会う" };
    const mentions: ReachPerson = { ...base, id: "b4", name: "橋渡し四郎", email: "b4@example.com", notes: "先週、田中太郎さんを紹介してもらった" };
    const unreachableFriend: ReachPerson = { ...base, id: "b5", name: "届かない方", company: "青空商事" };
    const meetDays = new Map([
      ["t", new Set(["2026-07-07"])],
      ["b2", new Set(["2026-07-07"])],
    ]);
    const bridges = findBridges(target, [sameCompany, sameDay, sameEvent, mentions, unreachableFriend], meetDays);
    // 連絡手段の無い方は橋渡し役にならない。上位 3 名まで
    expect(bridges).toHaveLength(3);
    expect(bridges.map((b) => b.contactId)).not.toContain("b5");
    const all = findBridges(target, [sameCompany, sameDay, sameEvent, mentions], meetDays);
    expect(all.map((b) => b.contactId).sort()).toEqual(["b1", "b2", "b3"]); // 上位3 (登場のみの b4 は次点)
    expect(all.find((b) => b.contactId === "b1")!.reasons[0]).toContain("青空商事");
  });
});
