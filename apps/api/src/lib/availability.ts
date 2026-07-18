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

const dayKeyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** 窓のリストから、膨らませ済みの busy を引き、最低時間未満の細切れを捨てる。 */
const subtractBusy = (windows: Interval[], inflated: Interval[], minMs: number): Interval[] => {
  const out: Interval[] = [];
  for (const w of windows) {
    let cursor = w.start;
    for (const b of inflated) {
      if (b.end <= cursor || b.start >= w.end) continue;
      if (b.start > cursor && b.start.getTime() - cursor.getTime() >= minMs) {
        out.push({ start: cursor, end: new Date(b.start) });
      }
      if (b.end > cursor) cursor = new Date(Math.min(b.end.getTime(), w.end.getTime()));
    }
    if (w.end.getTime() - cursor.getTime() >= minMs) out.push({ start: cursor, end: w.end });
  }
  return out;
};

/** 期間内の各日について曜日窓を実時刻の区間に展開する (skip に入れた日は飛ばす)。 */
const weekdayWindows = (period: AvailabilityPeriod, avail: Availability, skip?: Set<string>): Interval[] => {
  const lower = period.from > period.periodStart ? period.from : period.periodStart;
  const out: Interval[] = [];
  const first = new Date(period.periodStart.getFullYear(), period.periodStart.getMonth(), period.periodStart.getDate());
  for (let day = new Date(first); day <= period.periodEnd; day.setDate(day.getDate() + 1)) {
    if (skip?.has(dayKeyOf(day))) continue;
    const w = avail.days[WEEKDAY_KEYS[day.getDay()]!]!;
    if (!w.enabled) continue;
    let windowStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), w.startHour, w.startMinute, 0, 0);
    let windowEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), w.endHour, w.endMinute, 0, 0);
    if (windowStart < lower) windowStart = new Date(lower);
    if (windowEnd > period.periodEnd) windowEnd = new Date(period.periodEnd);
    if (windowStart >= windowEnd) continue;
    out.push({ start: windowStart, end: windowEnd });
  }
  return out;
};

const inflate = (busy: Interval[], bufferMinutes: number): Interval[] => {
  const bufferMs = bufferMinutes * 60 * 1000;
  return mergeIntervals(
    busy.map((b) => ({ start: new Date(b.start.getTime() - bufferMs), end: new Date(b.end.getTime() + bufferMs) })),
  );
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
  return subtractBusy(weekdayWindows(period, avail), inflate(busy, avail.bufferMinutes), avail.minMinutes * 60 * 1000);
}

/**
 * カレンダーをドラッグしてなぞった明示の空き枠 (timeshare の free_times の踏襲) を
 * 曜日窓に重ねる。規則は日単位: なぞった日 (枠が 1 つでもある日) はその枠だけが空きの
 * もとになり、なぞっていない日は従来どおり曜日別の受付時間。busy の膨張と最低時間は共通。
 * なぞった枠が過去に流れた日は「その日はもう受けない」であり、曜日窓には戻さない。
 */
export function freeIntervalsWithExplicitSlots(
  busy: Interval[],
  period: AvailabilityPeriod,
  avail: Availability,
  explicit: Interval[],
): Interval[] {
  if (explicit.length === 0) return freeIntervalsByAvailability(busy, period, avail);
  const lower = period.from > period.periodStart ? period.from : period.periodStart;
  const periodStartDay = new Date(
    period.periodStart.getFullYear(),
    period.periodStart.getMonth(),
    period.periodStart.getDate(),
  );

  // 「なぞった日」の集合は、時刻の切り詰め前の枠から日単位で拾う
  // (枠が過去に流れても、その日が曜日窓へ戻ってしまわないように)。
  const explicitDays = new Set<string>();
  const windows: Interval[] = [];
  for (const s of mergeIntervals(explicit)) {
    if (s.end <= periodStartDay || s.start > period.periodEnd) continue;
    for (
      let day = new Date(s.start.getFullYear(), s.start.getMonth(), s.start.getDate());
      day < s.end && day <= period.periodEnd;
      day.setDate(day.getDate() + 1)
    ) {
      if (day >= periodStartDay) explicitDays.add(dayKeyOf(day));
    }
    const start = s.start < lower ? new Date(lower) : new Date(s.start);
    const end = s.end > period.periodEnd ? new Date(period.periodEnd) : new Date(s.end);
    if (start < end) windows.push({ start, end });
  }

  const all = [...weekdayWindows(period, avail, explicitDays), ...windows].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  return subtractBusy(all, inflate(busy, avail.bufferMinutes), avail.minMinutes * 60 * 1000);
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
    // 開始時刻は常に step の切りのよい時刻 (毎時 0 分 / 30 分など) に揃える。
    // 「いま」由来の半端な開始をそのまま出すと、選択肢が呼び出し時刻に依存して
    // 揺れる (重ね合わせの前後で別物になる) ため、グリッドに固定する
    for (let t = Math.ceil(iv.start.getTime() / stepMs) * stepMs; t + slotMs <= iv.end.getTime(); t += stepMs) {
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

/**
 * 参加者 (第三者) の空き計算用: 終日 (0:00-24:00)・余白なしの設定。
 * 参加者は busy (予定表) だけを預かるので、空き = 期間内の busy の補集合とする。
 * 受け付け時間帯の制約は主催者側の空きとの積集合が担ってくれる。
 */
export function fullDayAvailability(minMinutes: number): Availability {
  const days = {} as Record<WeekdayKey, WeekdayWindow>;
  for (const k of WEEKDAY_KEYS) days[k] = { enabled: true, startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 };
  return { days, bufferMinutes: 0, minMinutes };
}

/** JSON 保存用: Availability を DB の Json 列へ渡せる形にする。 */
export function availabilityToJson(a: Availability): { days: Record<WeekdayKey, WeekdayWindow> } {
  return { days: a.days };
}

export function intervalsToIso(intervals: Interval[]): IsoInterval[] {
  return intervals.map((x) => ({ start: x.start.toISOString(), end: x.end.toISOString() }));
}

// 出品ごとの受付枠 — 「この出品はこの曜日・時間帯だけ受ける」。空き時間全体をさらに絞る。
// days: 0(日)〜6(土)、startMin/endMin: 0:00 からの分。空 (null) なら絞らない (従来どおり)。
export type OfferWindow = { days: number[]; startMin: number; endMin: number };

export function parseOfferWindow(raw: unknown): OfferWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const days = Array.isArray(o.days)
    ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort(
        (a, b) => a - b,
      )
    : [];
  const startMin = Math.round(Number(o.startMin));
  const endMin = Math.round(Number(o.endMin));
  if (days.length === 0 || !Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
  const s = Math.max(0, Math.min(1440, startMin));
  const e = Math.max(0, Math.min(1440, endMin));
  if (e <= s) return null;
  return { days, startMin: s, endMin: e };
}

/** 空き時間を、出品の受付枠 (曜日 + 時間帯) の中だけに絞り込む。 */
export function restrictToOfferWindow(intervals: Interval[], w: OfferWindow): Interval[] {
  const out: Interval[] = [];
  for (const iv of intervals) {
    if (!w.days.includes(iv.start.getDay())) continue; // 空きは日内で完結する前提 (start の曜日で判定)
    const base = new Date(iv.start.getFullYear(), iv.start.getMonth(), iv.start.getDate());
    const winStart = new Date(base.getTime() + w.startMin * 60_000);
    const winEnd = new Date(base.getTime() + w.endMin * 60_000);
    const s = iv.start > winStart ? iv.start : winStart;
    const e = iv.end < winEnd ? iv.end : winEnd;
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}
