// 空き時間の設定と設定つき空き計算 — timeshare (Rails) の FreeTimeSetting /
// sync_free_time! の概念だけを引き継ぎ、TypeScript の純粋関数として新規実装。
// コードの移植はしない。DB / API 非依存 = ユニットテスト対象。
//
// 概念 (timeshare 由来):
// 1. 曜日ごとの受け付け時間窓 (例: 平日 9:00-18:00、日曜は受けない)
// 2. 予定の前後の余白 (移動・準備。busy を余白ぶん膨らませてから空きを取る)
// 3. これ未満の細切れは出さない最低連続時間
import { mergeIntervals, type Interval, type IsoInterval } from "./timeslots.js";

export type WeekdayWindow = {
  enabled: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
};

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type Availability = {
  days: Record<WeekdayKey, WeekdayWindow>;
  bufferMinutes: number;
  minMinutes: number;
};

const DEFAULT_WINDOW: WeekdayWindow = { enabled: true, startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 };

/** 既定: 毎日 9:00-18:00・余白なし・最低 30 分 (従来の freeSlots の既定と同じ挙動)。 */
export function defaultAvailability(): Availability {
  const days = {} as Record<WeekdayKey, WeekdayWindow>;
  for (const k of WEEKDAY_KEYS) days[k] = { ...DEFAULT_WINDOW };
  return { days, bufferMinutes: 0, minMinutes: 30 };
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** DB / ユーザー入力の JSON を検証して Availability に整える (壊れた値は既定に落とす)。 */
export function parseAvailability(raw: unknown): Availability {
  const base = defaultAvailability();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as { days?: unknown; bufferMinutes?: unknown; minMinutes?: unknown };
  base.bufferMinutes = clampInt(o.bufferMinutes, 0, 120, 0);
  base.minMinutes = clampInt(o.minMinutes, 15, 480, 30);
  if (o.days && typeof o.days === "object") {
    for (const k of WEEKDAY_KEYS) {
      const d = (o.days as Record<string, unknown>)[k];
      if (!d || typeof d !== "object") continue;
      const w = d as Record<string, unknown>;
      base.days[k] = {
        enabled: w.enabled !== false && w.enabled !== "false",
        startHour: clampInt(w.startHour, 0, 23, DEFAULT_WINDOW.startHour),
        startMinute: clampInt(w.startMinute, 0, 59, 0),
        endHour: clampInt(w.endHour, 0, 24, DEFAULT_WINDOW.endHour),
        endMinute: clampInt(w.endMinute, 0, 59, 0),
      };
    }
  }
  return base;
}

export type AvailabilityPeriod = {
  from: Date; // この時刻より前は出さない (通常 = いま)
  periodStart: Date;
  periodEnd: Date; // この日まで (排他でなく、その日の窓の終わりまで)
};

/**
 * busy と設定から空き区間を計算する (新規実装)。
 * busy を余白ぶん膨らませる → 各日の曜日窓から引く → 最低時間未満を捨てる。
 * 余白を「busy の膨張」で表現すると、予定の前後にだけ余白が効き、窓の端は削られない。
 */
export function freeIntervalsByAvailability(
  busy: Interval[],
  period: AvailabilityPeriod,
  avail: Availability,
): Interval[] {
  const bufferMs = avail.bufferMinutes * 60 * 1000;
  const minMs = avail.minMinutes * 60 * 1000;
  const inflated = mergeIntervals(
    busy.map((b) => ({ start: new Date(b.start.getTime() - bufferMs), end: new Date(b.end.getTime() + bufferMs) })),
  );
  const lower = period.from > period.periodStart ? period.from : period.periodStart;
  const out: Interval[] = [];

  const first = new Date(period.periodStart.getFullYear(), period.periodStart.getMonth(), period.periodStart.getDate());
  for (let day = new Date(first); day <= period.periodEnd; day.setDate(day.getDate() + 1)) {
    const w = avail.days[WEEKDAY_KEYS[day.getDay()]!]!;
    if (!w.enabled) continue;
    let windowStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), w.startHour, w.startMinute, 0, 0);
    let windowEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), w.endHour, w.endMinute, 0, 0);
    if (windowStart < lower) windowStart = new Date(lower);
    if (windowEnd > period.periodEnd) windowEnd = new Date(period.periodEnd);
    if (windowStart >= windowEnd) continue;

    let cursor = windowStart;
    for (const b of inflated) {
      if (b.end <= cursor || b.start >= windowEnd) continue;
      if (b.start > cursor && b.start.getTime() - cursor.getTime() >= minMs) {
        out.push({ start: cursor, end: new Date(b.start) });
      }
      if (b.end > cursor) cursor = new Date(Math.min(b.end.getTime(), windowEnd.getTime()));
    }
    if (windowEnd.getTime() - cursor.getTime() >= minMs) out.push({ start: cursor, end: windowEnd });
  }
  return out;
}

/**
 * 空き区間を「開始時刻の選択肢」に刻む (相手が選べる粒度にする)。
 * slotMinutes の面談が収まる開始時刻を stepMinutes 刻みで列挙し、上限で打ち切る。
 */
export function startOptions(
  free: Interval[],
  slotMinutes: number,
  stepMinutes = 30,
  maxOptions = 200,
): Interval[] {
  const slotMs = slotMinutes * 60 * 1000;
  const stepMs = stepMinutes * 60 * 1000;
  const out: Interval[] = [];
  for (const iv of free) {
    // 開始時刻を step の切りのよい時刻 (毎時 0 分 / 30 分など) に揃える
    let t = Math.ceil(iv.start.getTime() / stepMs) * stepMs;
    if (t > iv.start.getTime() && t - iv.start.getTime() < 60 * 1000) t = iv.start.getTime();
    for (; t + slotMs <= iv.end.getTime(); t += stepMs) {
      out.push({ start: new Date(t), end: new Date(t + slotMs) });
      if (out.length >= maxOptions) return out;
    }
  }
  return out;
}

/** 候補 {start,end} が「いま出せる選択肢」に一致するものだけ残す (サーバ側の最終検証)。 */
export function filterValidCandidates(candidates: Interval[], options: Interval[]): Interval[] {
  const keys = new Set(options.map((o) => `${o.start.getTime()}-${o.end.getTime()}`));
  const seen = new Set<string>();
  const out: Interval[] = [];
  for (const cand of candidates) {
    const k = `${cand.start.getTime()}-${cand.end.getTime()}`;
    if (!keys.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(cand);
  }
  return out;
}

/** JSON 保存用: Availability を DB の Json 列へ渡せる形にする。 */
export function availabilityToJson(a: Availability): { days: Record<WeekdayKey, WeekdayWindow> } {
  return { days: a.days };
}

export function intervalsToIso(intervals: Interval[]): IsoInterval[] {
  return intervals.map((x) => ({ start: x.start.toISOString(), end: x.end.toISOString() }));
}
