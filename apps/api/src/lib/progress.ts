// ゲーミフィケーション (共通プロダクト原則 2) — 連続記録・到達バッジ・次の節目。
// 射幸性ではなく「前進の実感」。サーバ側で接触記録から算出する純粋関数 (ユニットテスト対象)。

export type ProgressInput = {
  interactionDates: Date[]; // 接触の発生日時 (順不同でよい)
  distinctContacts: number; // 接触したことのある相手の人数
  contactsTotal: number; // 連絡帳の人数
  now?: Date;
};

export type Badge = { key: string; label: string; achieved: boolean };

export type Progress = {
  streakDays: number; // 今日 (または昨日) から遡る連続記録日数
  totalInteractions: number;
  distinctContacts: number;
  badges: Badge[];
  nextMilestone: { label: string; current: number; target: number } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date): number {
  return Math.floor(
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY_MS,
  );
}

/** 今日 (記録がまだ無ければ昨日) を起点に、記録のある日が連続する日数。 */
export function calcStreakDays(dates: Date[], now: Date = new Date()): number {
  if (dates.length === 0) return 0;
  const days = new Set(dates.map(dayKey));
  const today = dayKey(now);
  let cursor = days.has(today) ? today : today - 1;
  if (!days.has(cursor)) return 0;
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor--;
  }
  return streak;
}

export function computeProgress(input: ProgressInput): Progress {
  const now = input.now ?? new Date();
  const streakDays = calcStreakDays(input.interactionDates, now);
  const total = input.interactionDates.length;
  const distinct = input.distinctContacts;

  const badges: Badge[] = [
    { key: "first_step", label: "はじめの一歩 (最初の連絡)", achieved: total >= 1 },
    { key: "week_streak", label: "七日のつながり (7日連続)", achieved: streakDays >= 7 },
    { key: "month_streak", label: "ひと月のつながり (30日連続)", achieved: streakDays >= 30 },
    { key: "ten_people", label: "十人十色 (10人と交流)", achieved: distinct >= 10 },
    { key: "fifty_notes", label: "五十の便り (50回の交流)", achieved: total >= 50 },
    { key: "hundred_bonds", label: "百のきずな (100回の交流)", achieved: total >= 100 },
  ];

  // 次の節目: 未達のうち最も近いもの (現在値/目標つき)
  const candidates: Array<{ label: string; current: number; target: number }> = [
    { label: "7日連続の記録", current: streakDays, target: 7 },
    { label: "30日連続の記録", current: streakDays, target: 30 },
    { label: "10人との交流", current: distinct, target: 10 },
    { label: "50回の交流", current: total, target: 50 },
    { label: "100回の交流", current: total, target: 100 },
  ].filter((c) => c.current < c.target);
  candidates.sort((a, b) => a.target - a.current - (b.target - b.current));
  const nextMilestone = candidates[0] ?? null;

  return { streakDays, totalInteractions: total, distinctContacts: distinct, badges, nextMilestone };
}
