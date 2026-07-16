import { describe, it, expect } from "vitest";
import { recentMeetings, pickDailyQuestion, type DailyPerson, type MetInteraction } from "../../src/lib/capture.js";

const NOW = new Date("2026-07-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("recentMeetings (会った直後のひとこと伺い)", () => {
  const people = [
    { id: "a", name: "田中" },
    { id: "b", name: "鈴木" },
  ];

  it("直近に会った方が挙がり、新しい順に並ぶ", () => {
    const rows: MetInteraction[] = [
      { contactId: "a", type: "meeting", occurredAt: daysAgo(2), hasNote: false },
      { contactId: "b", type: "meeting", occurredAt: daysAgo(1), hasNote: false },
    ];
    const items = recentMeetings(people, rows, NOW);
    expect(items.map((x) => x.name)).toEqual(["鈴木", "田中"]);
  });

  it("会ったあとにメモ付きの記録があれば出さない (もう聞けている)", () => {
    const rows: MetInteraction[] = [
      { contactId: "a", type: "meeting", occurredAt: daysAgo(2), hasNote: false },
      { contactId: "a", type: "note", occurredAt: daysAgo(1), hasNote: true },
    ];
    expect(recentMeetings(people, rows, NOW)).toEqual([]);
  });

  it("古い面会 (既定3日より前) やメッセージだけの方は出さない", () => {
    const rows: MetInteraction[] = [
      { contactId: "a", type: "meeting", occurredAt: daysAgo(7), hasNote: false },
      { contactId: "b", type: "message", occurredAt: daysAgo(1), hasNote: false },
    ];
    expect(recentMeetings(people, rows, NOW)).toEqual([]);
  });
});

function person(over: Partial<DailyPerson>): DailyPerson {
  return {
    id: "x",
    name: "名無",
    distance: 3,
    interactionCount: 0,
    answeredToday: false,
    facets: null,
    ...over,
  };
}

describe("pickDailyQuestion (1日1問)", () => {
  it("まだ知らない論点についての質問が、相手の名前入りで返る", () => {
    const q = pickDailyQuestion([person({ id: "a", name: "田中" })], "2026-07-16");
    expect(q).not.toBeNull();
    expect(q!.contactId).toBe("a");
    expect(q!.question).toContain("田中さん");
  });

  it("同じ日付なら同じ質問 (決定的)、日付が変わると変わりうる", () => {
    const people = Array.from({ length: 12 }, (_, i) => person({ id: `p${i}`, name: `方${i}` }));
    const a = pickDailyQuestion(people, "2026-07-16");
    const b = pickDailyQuestion(people, "2026-07-16");
    expect(a).toEqual(b);
  });

  it("今日すでに答えた相手・全部埋まっている相手は選ばない", () => {
    const full = {
      status: "済", work: "済", family: "済", health: "済",
      goals: ["済"], likes: ["済"], concerns: ["済"],
    };
    const q = pickDailyQuestion(
      [person({ id: "a", answeredToday: true }), person({ id: "b", facets: full })],
      "2026-07-16",
    );
    expect(q).toBeNull();
  });

  it("埋まっている論点は聞かない (足りない話題だけ)", () => {
    const q = pickDailyQuestion(
      [person({ id: "a", name: "田中", facets: { status: "元気", work: "設計", family: "妻子", health: "良好", goals: ["独立"], likes: [], concerns: ["腰"] } })],
      "2026-07-16",
    );
    expect(q!.topic).toBe("likes");
  });

  it("近しい方 (距離が近い・やりとりが多い) を優先し、遠い方は候補から漏れる", () => {
    // 候補は上位 12 名まで。近しい 12 名がいれば、遠い 1 名は選ばれない
    const people = [
      ...Array.from({ length: 12 }, (_, i) => person({ id: `near${i}`, name: `近藤${i}`, distance: 1, interactionCount: 10 })),
      person({ id: "far", distance: 5, interactionCount: 0 }),
    ];
    for (const dateKey of ["2026-07-16", "2026-07-17", "2026-07-18"]) {
      expect(pickDailyQuestion(people, dateKey)!.contactId).not.toBe("far");
    }
  });
});
