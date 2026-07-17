// 空き時間の設定 (曜日別時間窓・余白・最低時間) と選択肢刻みのユニットテスト。
import { describe, it, expect } from "vitest";
import {
  defaultAvailability,
  parseAvailability,
  freeIntervalsByAvailability,
  freeIntervalsWithExplicitSlots,
  startOptions,
  filterValidCandidates,
} from "../../src/lib/availability.js";
import type { Interval } from "../../src/lib/timeslots.js";

// 2026-07-20 は月曜日
const mon9 = new Date(2026, 6, 20, 9, 0);
const iv = (sh: number, sm: number, eh: number, em: number, day = 20): Interval => ({
  start: new Date(2026, 6, day, sh, sm),
  end: new Date(2026, 6, day, eh, em),
});

describe("parseAvailability", () => {
  it("壊れた値は既定に落とし、範囲外はクランプする", () => {
    const a = parseAvailability({ bufferMinutes: 9999, minMinutes: -5, days: { mon: { startHour: "10", endHour: 0 } } });
    expect(a.bufferMinutes).toBe(120);
    expect(a.minMinutes).toBe(15);
    expect(a.days.mon.startHour).toBe(10);
    expect(a.days.tue.startHour).toBe(9); // 触っていない曜日は既定
  });

  it("null / 文字列なら丸ごと既定", () => {
    const a = parseAvailability(null);
    expect(a).toEqual(defaultAvailability());
  });
});

describe("freeIntervalsByAvailability", () => {
  const period = { from: mon9, periodStart: mon9, periodEnd: new Date(2026, 6, 21, 23, 59) };

  it("予定のない日は曜日窓まるごとが空きになる", () => {
    const free = freeIntervalsByAvailability([], period, defaultAvailability());
    // 月・火の 9-18 の 2 区間
    expect(free).toHaveLength(2);
    expect(free[0]!.start.getHours()).toBe(9);
    expect(free[0]!.end.getHours()).toBe(18);
  });

  it("busy を引き、余白ぶん予定の前後が削られる", () => {
    const avail = { ...defaultAvailability(), bufferMinutes: 30 };
    const free = freeIntervalsByAvailability([iv(12, 0, 13, 0)], { ...period, periodEnd: new Date(2026, 6, 20, 23, 0) }, avail);
    // 9:00-11:30 と 13:30-18:00 (余白 30 分が予定の前後に付く。窓の端は削られない)
    expect(free).toHaveLength(2);
    expect(free[0]!.end.getHours()).toBe(11);
    expect(free[0]!.end.getMinutes()).toBe(30);
    expect(free[1]!.start.getHours()).toBe(13);
    expect(free[1]!.start.getMinutes()).toBe(30);
    expect(free[1]!.end.getHours()).toBe(18);
  });

  it("最低時間未満の細切れは出さない", () => {
    const avail = { ...defaultAvailability(), minMinutes: 60 };
    // 9:00-9:30 だけ空く形 (9:30-18:00 が busy)
    const free = freeIntervalsByAvailability([iv(9, 30, 18, 0)], { ...period, periodEnd: new Date(2026, 6, 20, 23, 0) }, avail);
    expect(free).toHaveLength(0);
  });

  it("受け付けない曜日は空きを出さない", () => {
    const avail = defaultAvailability();
    avail.days.tue.enabled = false;
    const free = freeIntervalsByAvailability([], period, avail);
    expect(free).toHaveLength(1); // 月曜だけ
    expect(free[0]!.start.getDay()).toBe(1);
  });

  it("from より前は出さない (当日の途中から)", () => {
    const free = freeIntervalsByAvailability([], { ...period, from: new Date(2026, 6, 20, 15, 0), periodEnd: new Date(2026, 6, 20, 23, 0) }, defaultAvailability());
    expect(free).toHaveLength(1);
    expect(free[0]!.start.getHours()).toBe(15);
  });
});

describe("freeIntervalsWithExplicitSlots (カレンダーをなぞった明示枠)", () => {
  // 期間: 月曜 7/20 0:00 〜 火曜 7/21 23:00。from は期間の頭 (過去の切り詰めなし)
  const period = {
    from: new Date(2026, 6, 20, 0, 0),
    periodStart: new Date(2026, 6, 20, 0, 0),
    periodEnd: new Date(2026, 6, 21, 23, 0),
  };

  it("なぞった日はその枠だけ・なぞっていない日は曜日窓 (日単位の優先)", () => {
    // 月曜だけ 19:00-21:00 をなぞる → 月曜は夜だけ、火曜は既定の 9-18
    const free = freeIntervalsWithExplicitSlots([], period, defaultAvailability(), [iv(19, 0, 21, 0)]);
    expect(free).toHaveLength(2);
    expect(free[0]!.start.getHours()).toBe(19);
    expect(free[0]!.end.getHours()).toBe(21);
    expect(free[1]!.start.getDate()).toBe(21);
    expect(free[1]!.start.getHours()).toBe(9);
  });

  it("明示枠が無ければ従来の曜日窓と同じ", () => {
    const a = freeIntervalsWithExplicitSlots([], period, defaultAvailability(), []);
    const b = freeIntervalsByAvailability([], period, defaultAvailability());
    expect(a).toEqual(b);
  });

  it("明示枠からも busy は引かれ、最低時間未満は捨てられる", () => {
    // 月曜 19-21 の枠に 19:30-20:45 の予定 → 前 30 分だけ残り、後ろ 15 分は捨てる
    const free = freeIntervalsWithExplicitSlots(
      [iv(19, 30, 20, 45)],
      period,
      defaultAvailability(),
      [iv(19, 0, 21, 0)],
    );
    const mondayParts = free.filter((f) => f.start.getDate() === 20);
    expect(mondayParts).toHaveLength(1);
    expect(mondayParts[0]!.start.getHours()).toBe(19);
    expect(mondayParts[0]!.end.getMinutes()).toBe(30);
  });

  it("なぞった枠が過去に流れた日は曜日窓へ戻さない (その日はもう受けない)", () => {
    // 月曜 9-10 をなぞったが、いまは月曜 12:00 → 月曜の残りは空きにしない。火曜は既定
    const free = freeIntervalsWithExplicitSlots(
      [],
      { ...period, from: new Date(2026, 6, 20, 12, 0) },
      defaultAvailability(),
      [iv(9, 0, 10, 0)],
    );
    expect(free.every((f) => f.start.getDate() === 21)).toBe(true);
  });

  it("受けない曜日でも、なぞればその枠は空きになる", () => {
    const avail = parseAvailability({ days: { mon: { enabled: false } } });
    const free = freeIntervalsWithExplicitSlots([], period, avail, [iv(10, 0, 12, 0)]);
    const monday = free.filter((f) => f.start.getDate() === 20);
    expect(monday).toHaveLength(1);
    expect(monday[0]!.start.getHours()).toBe(10);
  });
});

describe("startOptions", () => {
  it("空き区間を 30 分刻みの開始時刻に刻み、面談が収まるものだけ返す", () => {
    const opts = startOptions([iv(9, 0, 11, 0)], 60);
    // 9:00 / 9:30 / 10:00 (10:30 は 60 分入らない)
    expect(opts.map((o) => `${o.start.getHours()}:${o.start.getMinutes()}`)).toEqual(["9:0", "9:30", "10:0"]);
    expect(opts[0]!.end.getHours()).toBe(10);
  });

  it("半端な開始 (9:10) は次の切りのよい時刻 (9:30) に揃える (常にグリッド固定)", () => {
    const opts = startOptions([iv(9, 10, 11, 0)], 60);
    expect(opts[0]!.start.getMinutes()).toBe(30);
    // 開始 9:00 ちょうどはそのまま 9:00
    expect(startOptions([iv(9, 0, 11, 0)], 60)[0]!.start.getMinutes()).toBe(0);
  });

  it("上限で打ち切る", () => {
    const opts = startOptions([iv(9, 0, 18, 0)], 15, 15, 5);
    expect(opts).toHaveLength(5);
  });
});

describe("filterValidCandidates", () => {
  it("選択肢に一致する候補だけ残し、重複は 1 つにする", () => {
    const options = startOptions([iv(9, 0, 11, 0)], 60);
    const good = { start: new Date(2026, 6, 20, 9, 30), end: new Date(2026, 6, 20, 10, 30) };
    const bad = { start: new Date(2026, 6, 20, 12, 0), end: new Date(2026, 6, 20, 13, 0) };
    const out = filterValidCandidates([good, bad, { ...good }], options);
    expect(out).toHaveLength(1);
    expect(out[0]!.start.getMinutes()).toBe(30);
  });
});
