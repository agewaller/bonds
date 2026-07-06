import { describe, it, expect } from "vitest";
import { calcStreakDays, computeProgress } from "../../src/lib/progress.js";

const NOW = new Date(2026, 6, 6, 12); // 2026-07-06 昼
const day = (offset: number, hour = 9) => new Date(2026, 6, 6 - offset, hour);

describe("calcStreakDays", () => {
  it("今日から連続する日数を数える (同日複数は 1 日)", () => {
    expect(calcStreakDays([day(0), day(0, 20), day(1), day(2)], NOW)).toBe(3);
  });
  it("今日まだ記録が無ければ昨日を起点にする (継続を切らさない猶予)", () => {
    expect(calcStreakDays([day(1), day(2)], NOW)).toBe(2);
  });
  it("一昨日までしか無ければ 0 (途切れ)", () => {
    expect(calcStreakDays([day(2), day(3)], NOW)).toBe(0);
    expect(calcStreakDays([], NOW)).toBe(0);
  });
  it("飛び石は起点側だけ数える", () => {
    expect(calcStreakDays([day(0), day(1), day(3), day(4)], NOW)).toBe(2);
  });
});

describe("computeProgress", () => {
  it("バッジと次の節目 (最も近い未達) を出す", () => {
    const p = computeProgress({
      interactionDates: [day(0), day(1), day(2), day(3), day(4)],
      distinctContacts: 3,
      contactsTotal: 8,
      now: NOW,
    });
    expect(p.streakDays).toBe(5);
    expect(p.badges.find((b) => b.key === "first_step")?.achieved).toBe(true);
    expect(p.badges.find((b) => b.key === "week_streak")?.achieved).toBe(false);
    // 7日連続まであと2 が最短の節目
    expect(p.nextMilestone).toMatchObject({ label: "7日連続の記録", current: 5, target: 7 });
  });
  it("全節目を達成すると nextMilestone は null", () => {
    const dates = Array.from({ length: 120 }, (_, i) => day(i % 31));
    const p = computeProgress({ interactionDates: dates, distinctContacts: 20, contactsTotal: 30, now: NOW });
    expect(p.badges.every((b) => b.achieved)).toBe(true);
    expect(p.nextMilestone).toBeNull();
  });
});
