import { describe, it, expect } from "vitest";
import {
  mergeIntervals,
  freeSlots,
  intersectSlots,
  meetingSlotProposals,
  parseIsoIntervals,
  type Interval,
} from "../../src/lib/timeslots.js";

// ローカル時刻でテストする (freeSlots は営業時間をローカル時で解釈する)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 6, day, hour, minute); // 2026-07
const iv = (d1: number, h1: number, d2: number, h2: number): Interval => ({ start: at(d1, h1), end: at(d2, h2) });

describe("parseIsoIntervals / mergeIntervals", () => {
  it("不正・逆転区間を捨てる", () => {
    const parsed = parseIsoIntervals([
      { start: "2026-07-06T01:00:00Z", end: "2026-07-06T02:00:00Z" },
      { start: "bad", end: "2026-07-06T02:00:00Z" },
      { start: "2026-07-06T03:00:00Z", end: "2026-07-06T03:00:00Z" }, // 空区間
      "not-an-object",
    ]);
    expect(parsed).toHaveLength(1);
  });

  it("重なり・隣接を統合して時刻順に返す", () => {
    const merged = mergeIntervals([iv(6, 13, 6, 15), iv(6, 10, 6, 12), iv(6, 12, 6, 13)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(iv(6, 10, 6, 15));
  });
});

describe("freeSlots (lms calculateFreeSlots 相当)", () => {
  it("busy が無ければ営業時間まるごと空き", () => {
    const slots = freeSlots([], { from: at(6, 0), days: 1 });
    expect(slots).toEqual([iv(6, 9, 6, 18)]);
  });

  it("busy を引いた残りが空きになり、細切れ (30 分未満) は捨てる", () => {
    const busy = [iv(6, 10, 6, 12), iv(6, 12, 6, 12, ), iv(6, 17, 6, 17)]; // 12:00-12:00 と 17:00-17:00 は空区間として無視される
    const slots = freeSlots([iv(6, 10, 6, 12), iv(6, 13, 6, 17, )], { from: at(6, 0), days: 1 });
    expect(slots).toEqual([iv(6, 9, 6, 10), iv(6, 12, 6, 13), iv(6, 17, 6, 18)]);
    void busy;
  });

  it("初日は from 時刻から始まり、複数日をまたぐ", () => {
    const slots = freeSlots([], { from: at(6, 16), days: 2 });
    expect(slots).toEqual([iv(6, 16, 6, 18), iv(7, 9, 7, 18)]);
  });

  it("終日 busy の日は空き無し", () => {
    const slots = freeSlots([iv(6, 8, 6, 20)], { from: at(6, 0), days: 1 });
    expect(slots).toEqual([]);
  });

  it("29 分の隙間は捨て、30 分ちょうどは残す", () => {
    const slots = freeSlots([iv(6, 9, 6, 12), iv(6, 12, 6, 12), iv(6, 12, 6, 17, )], {
      from: at(6, 0),
      days: 1,
    });
    // 17:00-18:00 は 60 分で残る
    expect(slots).toEqual([iv(6, 17, 6, 18)]);
    const tight = freeSlots([{ start: at(6, 9), end: at(6, 17, 30) }], { from: at(6, 0), days: 1 });
    expect(tight).toEqual([{ start: at(6, 17, 30), end: at(6, 18) }]);
    const tooTight = freeSlots([{ start: at(6, 9), end: at(6, 17, 31) }], { from: at(6, 0), days: 1 });
    expect(tooTight).toEqual([]);
  });
});

describe("intersectSlots / meetingSlotProposals (二者空き重なり = bonds 新規)", () => {
  it("双方が空いている区間だけを返す", () => {
    const a = [iv(6, 9, 6, 12), iv(6, 14, 6, 18)];
    const b = [iv(6, 11, 6, 15)];
    expect(intersectSlots(a, b)).toEqual([iv(6, 11, 6, 12), iv(6, 14, 6, 15)]);
  });

  it("重なりが minMinutes 未満なら候補にしない", () => {
    const a = [iv(6, 9, 6, 10)];
    const b = [{ start: at(6, 9, 45), end: at(6, 11) }];
    expect(intersectSlots(a, b, 30)).toEqual([]);
    expect(intersectSlots(a, b, 15)).toEqual([{ start: at(6, 9, 45), end: at(6, 10) }]);
  });

  it("busy 2 本から面談候補を上位 N 件提案する", () => {
    // 自分: 6 日は午前 busy / 相手: 6 日は 15 時まで busy → 6 日は 15-18 だけ重なる
    const proposals = meetingSlotProposals(
      [iv(6, 9, 6, 13)],
      [iv(6, 9, 6, 15)],
      { from: at(6, 0), days: 2, maxProposals: 2 },
    );
    expect(proposals).toEqual([iv(6, 15, 6, 18), iv(7, 9, 7, 18)]);
  });

  it("どちらかが終日 busy なら候補なし", () => {
    expect(
      meetingSlotProposals([iv(6, 0, 6, 23)], [], { from: at(6, 0), days: 1 }),
    ).toEqual([]);
  });
});
