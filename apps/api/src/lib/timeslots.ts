// 空き時間計算 — lms js/time-marketplace.js の calculateFreeSlots の考え方を TS 純粋関数に移植し、
// bonds の新規要件「二者カレンダー空き重なり」(DESIGN-HANDOVER.md §4.3: lms は自分の空きだけ。
// 相手の busy との積集合 → 面談打診) を追加する。DB / API 非依存 = ユニットテスト対象。

export type Interval = { start: Date; end: Date };
export type IsoInterval = { start: string; end: string };

export function parseIsoIntervals(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  const out: Interval[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const start = new Date(String((r as IsoInterval).start));
    const end = new Date(String((r as IsoInterval).end));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end <= start) continue;
    out.push({ start, end });
  }
  return out;
}

/** 重なり・隣接する busy 区間を統合し、開始時刻順に整列する。 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start.getTime() <= last.end.getTime()) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push({ start: new Date(cur.start), end: new Date(cur.end) });
    }
  }
  return out;
}

export type FreeSlotOptions = {
  from: Date; // この時刻以降 (当日はこの時刻から)
  days: number; // 何日先まで
  dayStartHour?: number; // 営業時間 (ローカル時) 既定 9
  dayEndHour?: number; // 既定 18
  minMinutes?: number; // これ未満の細切れは捨てる。既定 30
};

/**
 * busy 区間から自分の空きスロットを計算する (lms calculateFreeSlots 相当)。
 * 各日の [dayStartHour, dayEndHour) から busy を引き、minMinutes 以上の区間を返す。
 */
export function freeSlots(busy: Interval[], opts: FreeSlotOptions): Interval[] {
  const dayStart = opts.dayStartHour ?? 9;
  const dayEnd = opts.dayEndHour ?? 18;
  const minMs = (opts.minMinutes ?? 30) * 60 * 1000;
  const merged = mergeIntervals(busy);
  const out: Interval[] = [];

  for (let d = 0; d < opts.days; d++) {
    const day = new Date(opts.from.getFullYear(), opts.from.getMonth(), opts.from.getDate() + d);
    let windowStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), dayStart, 0, 0, 0);
    const windowEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), dayEnd, 0, 0, 0);
    if (d === 0 && opts.from > windowStart) windowStart = new Date(opts.from);
    if (windowStart >= windowEnd) continue;

    let cursor = windowStart;
    for (const b of merged) {
      if (b.end <= cursor || b.start >= windowEnd) continue;
      if (b.start > cursor) {
        const slotEnd = b.start < windowEnd ? b.start : windowEnd;
        if (slotEnd.getTime() - cursor.getTime() >= minMs) out.push({ start: cursor, end: slotEnd });
      }
      if (b.end > cursor) cursor = new Date(Math.min(b.end.getTime(), windowEnd.getTime()));
    }
    if (windowEnd.getTime() - cursor.getTime() >= minMs) out.push({ start: cursor, end: windowEnd });
  }
  return out;
}

/**
 * 二者の空きスロットの積集合 (bonds 新規)。双方が空いている minMinutes 以上の区間を返す。
 */
export function intersectSlots(a: Interval[], b: Interval[], minMinutes = 30): Interval[] {
  const minMs = minMinutes * 60 * 1000;
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  const sa = [...a].sort((x, y) => x.start.getTime() - y.start.getTime());
  const sb = [...b].sort((x, y) => x.start.getTime() - y.start.getTime());
  while (i < sa.length && j < sb.length) {
    const start = Math.max(sa[i]!.start.getTime(), sb[j]!.start.getTime());
    const end = Math.min(sa[i]!.end.getTime(), sb[j]!.end.getTime());
    if (end - start >= minMs) out.push({ start: new Date(start), end: new Date(end) });
    if (sa[i]!.end.getTime() < sb[j]!.end.getTime()) i++;
    else j++;
  }
  return out;
}

/**
 * 面談候補: 自分と相手の busy から、双方が空いている枠を先頭 maxProposals 件。
 * 「二者カレンダー空き重なり」の中核 (busy → 各自の free → 積集合)。
 */
export function meetingSlotProposals(
  myBusy: Interval[],
  theirBusy: Interval[],
  opts: FreeSlotOptions & { maxProposals?: number },
): Interval[] {
  const mine = freeSlots(myBusy, opts);
  const theirs = freeSlots(theirBusy, opts);
  return intersectSlots(mine, theirs, opts.minMinutes ?? 30).slice(0, opts.maxProposals ?? 5);
}

export function toIso(intervals: Interval[]): IsoInterval[] {
  return intervals.map((x) => ({ start: x.start.toISOString(), end: x.end.toISOString() }));
}

const JP_WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

// 空きスロットを、メール本文にそのまま貼れる日本語テキストにする。
// BR-09: 箇条書き記号や絵文字を使わず、1 行 1 枠のふつうの文章で並べる。
// 分が 0 のときは「10時」、そうでなければ「10時30分」と読みやすく整える。
export function formatFreeSlotText(intervals: Interval[]): string {
  const hm = (d: Date) => (d.getMinutes() === 0 ? `${d.getHours()}時` : `${d.getHours()}時${d.getMinutes()}分`);
  return intervals
    .map((iv) => {
      const s = iv.start;
      return `${s.getMonth() + 1}月${s.getDate()}日(${JP_WEEKDAY[s.getDay()]}) ${hm(iv.start)}から${hm(iv.end)}`;
    })
    .join("\n");
}
