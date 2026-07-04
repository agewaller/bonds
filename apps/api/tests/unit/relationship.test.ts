import { describe, it, expect } from "vitest";
import {
  calculateIsolationScore,
  upcomingBirthdays,
  todaySuggestions,
  clampDistance,
  IDEAL_INTERVAL_DAYS,
  type ContactLike,
  type InteractionLike,
} from "../../src/lib/relationship.js";

const NOW = new Date("2026-07-04T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function contact(id: string, distance: number, birthday: string | null = null): ContactLike {
  return { id, name: `person-${id}`, distance, birthday: birthday ? new Date(birthday) : null };
}
function touch(contactId: string, days: number, type = "call"): InteractionLike {
  return { contactId, occurredAt: daysAgo(days), type };
}

describe("clampDistance / IDEAL_INTERVAL_DAYS (lms と同値)", () => {
  it("適正間隔は 1:1日 / 2:7日 / 3:14日", () => {
    expect(IDEAL_INTERVAL_DAYS).toEqual({ 1: 1, 2: 7, 3: 14 });
  });
  it("距離は 1〜5 にクランプ、不正値は 4", () => {
    expect(clampDistance(0)).toBe(1);
    expect(clampDistance(9)).toBe(5);
    expect(clampDistance("2")).toBe(2);
    expect(clampDistance("abc")).toBe(4);
    expect(clampDistance(null)).toBe(4);
  });
});

describe("calculateIsolationScore", () => {
  it("連絡先ゼロは unknown / 0 点", () => {
    const r = calculateIsolationScore([], [], NOW);
    expect(r).toMatchObject({ score: 0, level: "unknown", total: 0 });
  });

  it("親しい人 (距離1〜3) がいなければ caution / 50 点 (lms と同値)", () => {
    const r = calculateIsolationScore([contact("a", 4), contact("b", 5)], [], NOW);
    expect(r).toMatchObject({ score: 50, level: "caution", total: 0 });
  });

  it("全員が適正間隔内なら good / 0 点", () => {
    const contacts = [contact("a", 1), contact("b", 2), contact("c", 3)];
    const interactions = [touch("a", 0), touch("b", 3), touch("c", 7)];
    const r = calculateIsolationScore(contacts, interactions, NOW);
    expect(r.score).toBe(0);
    expect(r.level).toBe("good");
    expect(r.overdueCount).toBe(0);
  });

  it("接触記録が無い親しい人は daysSince=999 で urgency 最大", () => {
    const r = calculateIsolationScore([contact("a", 2)], [], NOW);
    expect(r.details[0]).toMatchObject({ daysSince: 999, overdue: true, urgency: 10 });
    // overdueRatio 1×40 + avgUrgency 10×4 + weighted 3×3 = 89
    expect(r.score).toBe(89);
    expect(r.level).toBe("warning");
  });

  it("lms の加重式を再現: 距離1-2 の接触不足は距離3 より重い", () => {
    // ケース A: 距離2 が 15 日途絶 (urgency = round(15/7)=2, weighted=3)
    const a = calculateIsolationScore([contact("a", 2)], [touch("a", 15)], NOW);
    // 1×40 + 2×4 + 3×3 = 57
    expect(a.score).toBe(57);
    // ケース B: 距離3 が 30 日途絶 (urgency = round(30/14)=2, weighted=1)
    const b = calculateIsolationScore([contact("b", 3)], [touch("b", 30)], NOW);
    // 1×40 + 2×4 + 1×3 = 51
    expect(b.score).toBe(51);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("最新の接触だけを見る (古い記録に引きずられない)", () => {
    const r = calculateIsolationScore(
      [contact("a", 3)],
      [touch("a", 100, "letter"), touch("a", 2, "meeting")],
      NOW,
    );
    expect(r.details[0]).toMatchObject({ daysSince: 2, overdue: false, lastType: "meeting" });
  });

  it("details は urgency 降順", () => {
    const r = calculateIsolationScore(
      [contact("a", 3), contact("b", 1)],
      [touch("a", 20), touch("b", 10)],
      NOW,
    );
    expect(r.details.map((d) => d.contactId)).toEqual(["b", "a"]); // b: 10/1=10, a: round(20/14)=1
  });
});

describe("upcomingBirthdays", () => {
  it("3 日以内の誕生日を拾い、年跨ぎも扱う", () => {
    const list = upcomingBirthdays(
      [
        contact("today", 4, "1960-07-04"),
        contact("in3", 4, "1970-07-07"),
        contact("far", 4, "1980-12-25"),
        contact("none", 4, null),
      ],
      NOW,
    );
    expect(list.map((b) => b.contactId)).toEqual(["today", "in3"]);
    expect(list[0]?.daysUntil).toBe(0);
    // 年末生まれ + 年始評価の年跨ぎ
    const newYear = upcomingBirthdays([contact("ny", 4, "1990-01-01")], new Date("2026-12-30T00:00:00"), 3);
    expect(newYear).toHaveLength(1);
    expect(newYear[0]?.daysUntil).toBe(2);
  });
});

describe("todaySuggestions", () => {
  it("誕生日が最優先、次に途絶が長い人 (上限 5 件)、重複は除外", () => {
    const contacts = [
      contact("bd", 2, "1960-07-05"),
      ...Array.from({ length: 7 }, (_, i) => contact(`c${i}`, 2)),
    ];
    const interactions = contacts.slice(1).map((c, i) => touch(c.id, 10 + i));
    const s = todaySuggestions(contacts, interactions, NOW);
    expect(s[0]).toMatchObject({ contactId: "bd", kind: "birthday", urgency: 10 });
    const overdue = s.filter((x) => x.kind === "overdue");
    expect(overdue).toHaveLength(5); // 上限
    // 全員適正内なら空
    expect(todaySuggestions([contact("ok", 3)], [touch("ok", 1)], NOW)).toEqual([]);
  });
});
