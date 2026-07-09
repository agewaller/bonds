// 距離感スコア・つながりスコア・「今日連絡すべき人」— lms js/relationship-features.js の
// calculateIsolationScore を TS 純粋関数に移植 (DB / DOM 非依存 = ユニットテスト対象)。
// 数式・閾値は lms と同値に保つ (距離別適正間隔 {1:1日, 2:7日, 3:14日} / 加重 0–100)。

export type ContactLike = {
  id: string;
  name: string;
  distance: number; // 1〜5
  birthday: Date | null;
};

export type InteractionLike = {
  contactId: string;
  occurredAt: Date;
  type: string;
};

export type ContactUrgency = {
  contactId: string;
  name: string;
  distance: number;
  daysSince: number; // 最終接触からの日数 (接触なしは 999)
  idealInterval: number;
  overdue: boolean;
  lastType: string | null;
  urgency: number; // 0〜10
};

export type IsolationResult = {
  score: number; // 0 (孤立なし) 〜 100 (深刻な孤立)
  level: "good" | "fair" | "caution" | "warning" | "unknown";
  details: ContactUrgency[]; // urgency 降順
  overdueCount: number;
  total: number;
};

// 距離感に応じた適正間隔 (日)。lms と同値。距離 4〜5 は監視対象外。
export const IDEAL_INTERVAL_DAYS: Record<number, number> = { 1: 1, 2: 7, 3: 14 };

const DAY_MS = 24 * 60 * 60 * 1000;

export function clampDistance(v: unknown): number {
  const n = typeof v === "string" ? parseInt(v, 10) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return 4;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function calculateIsolationScore(
  contacts: ContactLike[],
  interactions: InteractionLike[],
  now: Date = new Date(),
): IsolationResult {
  if (contacts.length === 0) {
    return { score: 0, level: "unknown", details: [], overdueCount: 0, total: 0 };
  }

  // 親しい人 (距離 1〜3) ごとに最後の接触からの日数を計算
  const lastByContact = new Map<string, InteractionLike>();
  for (const i of interactions) {
    const cur = lastByContact.get(i.contactId);
    if (!cur || i.occurredAt > cur.occurredAt) lastByContact.set(i.contactId, i);
  }

  const details: ContactUrgency[] = [];
  for (const c of contacts) {
    const distance = clampDistance(c.distance);
    if (distance > 3) continue;
    const last = lastByContact.get(c.id);
    const daysSince = last
      ? Math.floor((now.getTime() - last.occurredAt.getTime()) / DAY_MS)
      : 999;
    const idealInterval = IDEAL_INTERVAL_DAYS[distance] ?? 14;
    const overdue = daysSince > idealInterval;
    details.push({
      contactId: c.id,
      name: c.name,
      distance,
      daysSince,
      idealInterval,
      overdue,
      lastType: last?.type ?? null,
      urgency: overdue ? Math.min(10, Math.round(daysSince / idealInterval)) : 0,
    });
  }

  // 親しい人が一人もいない = 状態不明の注意水準 (lms と同じ 50 点)
  if (details.length === 0) {
    return { score: 50, level: "caution", details: [], overdueCount: 0, total: 0 };
  }

  const overdueList = details.filter((d) => d.overdue);
  const overdueRatio = overdueList.length / details.length;
  const avgUrgency = details.reduce((s, d) => s + d.urgency, 0) / details.length;
  // 加重: 距離 1–2 の人との接触不足は重い
  const weightedOverdue = overdueList.reduce((s, d) => s + (d.distance <= 2 ? 3 : 1), 0);

  const score = Math.min(
    100,
    Math.round(overdueRatio * 40 + avgUrgency * 4 + weightedOverdue * 3),
  );
  const level = score <= 20 ? "good" : score <= 40 ? "fair" : score <= 60 ? "caution" : "warning";

  return {
    score,
    level,
    details: [...details].sort((a, b) => b.urgency - a.urgency),
    overdueCount: overdueList.length,
    total: details.length,
  };
}

// 距離感 (1=毎日会う親しさ 〜 5=年に一度) を、やりとりの多さ・新しさ・贈り物の有無から
// 推し量る。純粋関数。ユーザーの手入力を消さないため「提案」に留め、適用は明示操作で行う。
export type DistanceSignals = {
  interactionCount: number; // 記録された接触の総数
  distinctDays: number; // 接触のあった「日」の数 (同日重複は 1)
  daysSinceLast: number | null; // 最終接触からの日数 (接触なしは null)
  giftCount: number; // 贈り物のやりとりの件数 (双方向とも)
};

export type DistanceSuggestion = {
  suggested: number; // 1〜5
  closeness: number; // 0〜8 (内部指標。デバッグ・説明用)
  reason: string; // ユーザー向けの平易な理由 (記号を使わない)
  confident: boolean; // 手がかりが乏しいときは false (勝手に上書きしない判断材料)
};

export function suggestDistance(s: DistanceSignals): DistanceSuggestion {
  // やりとりの多さ (延べ日数を主、総数を従に見る)
  const freqPoints =
    s.distinctDays >= 24 || s.interactionCount >= 40
      ? 4
      : s.distinctDays >= 12 || s.interactionCount >= 20
        ? 3
        : s.distinctDays >= 5 || s.interactionCount >= 8
          ? 2
          : s.distinctDays >= 2 || s.interactionCount >= 2
            ? 1
            : 0;
  // やりとりの新しさ (途絶えているほど遠い)
  const recencyPoints =
    s.daysSinceLast === null
      ? 0
      : s.daysSinceLast <= 7
        ? 3
        : s.daysSinceLast <= 30
          ? 2
          : s.daysSinceLast <= 90
            ? 1
            : s.daysSinceLast <= 365
              ? 0
              : -1;
  const giftPoints = s.giftCount >= 1 ? 1 : 0;
  const closeness = Math.max(0, Math.min(8, freqPoints + recencyPoints + giftPoints));
  // closeness 0→5, 2→4, 4→3, 6→2, 8→1
  const suggested = Math.min(5, Math.max(1, 5 - Math.round(closeness / 2)));
  // 手がかりが乏しい (接触がほとんどない) ときは自信なし = 勝手に上書きしない
  const confident = s.interactionCount >= 2 || s.giftCount >= 1;

  const parts: string[] = [];
  if (s.distinctDays >= 2) parts.push(`これまで${s.distinctDays}日やりとりがあり`);
  if (s.daysSinceLast !== null) {
    parts.push(
      s.daysSinceLast <= 7
        ? "つい最近も連絡があり"
        : s.daysSinceLast <= 30
          ? "この1か月内に連絡があり"
          : s.daysSinceLast <= 365
            ? `最後の連絡から${s.daysSinceLast}日ほどで`
            : "しばらく連絡が途絶えていて",
    );
  }
  if (s.giftCount >= 1) parts.push("贈り物のやりとりもあり");
  const label =
    suggested === 1
      ? "とても近いお付き合い"
      : suggested === 2
        ? "近いお付き合い"
        : suggested === 3
          ? "ほどよいお付き合い"
          : suggested === 4
            ? "ときどきのお付き合い"
            : "たまのお付き合い";
  const reason =
    parts.length > 0
      ? `${parts.join("、")}、${label}（${suggested}）とみています`
      : `やりとりの記録がまだ少ないため、${label}（${suggested}）を仮に置いています`;
  return { suggested, closeness, reason, confident };
}

// 誕生日が now から maxDays 日以内 (今日含む) の連絡先。
export function upcomingBirthdays(
  contacts: ContactLike[],
  now: Date = new Date(),
  maxDays = 3,
): Array<{ contactId: string; name: string; daysUntil: number; birthday: Date }> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: Array<{ contactId: string; name: string; daysUntil: number; birthday: Date }> = [];
  for (const c of contacts) {
    if (!c.birthday) continue;
    const bd = c.birthday;
    let next = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
    if (next < startOfToday) next = new Date(now.getFullYear() + 1, bd.getMonth(), bd.getDate());
    const daysUntil = Math.round((next.getTime() - startOfToday.getTime()) / DAY_MS);
    if (daysUntil <= maxDays) out.push({ contactId: c.id, name: c.name, daysUntil, birthday: bd });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

// 「今日連絡してみませんか」= 誕生日最優先 + 連絡が途絶えている人 urgency 上位 (lms と同じ構成)。
export type TodaySuggestion = {
  contactId: string;
  name: string;
  kind: "birthday" | "overdue";
  reason: string;
  urgency: number;
};

export function todaySuggestions(
  contacts: ContactLike[],
  interactions: InteractionLike[],
  now: Date = new Date(),
  maxOverdue = 5,
): TodaySuggestion[] {
  const out: TodaySuggestion[] = [];
  for (const b of upcomingBirthdays(contacts, now)) {
    const md = `${b.birthday.getMonth() + 1}月${b.birthday.getDate()}日`;
    out.push({
      contactId: b.contactId,
      name: b.name,
      kind: "birthday",
      reason:
        b.daysUntil === 0
          ? `今日がお誕生日です。おめでとうの気持ちを伝えましょう`
          : `お誕生日が${md}に近づいています`,
      urgency: 10,
    });
  }
  const birthdayIds = new Set(out.map((o) => o.contactId));
  const iso = calculateIsolationScore(contacts, interactions, now);
  for (const d of iso.details
    .filter((x) => x.overdue && !birthdayIds.has(x.contactId))
    .slice(0, maxOverdue)) {
    out.push({
      contactId: d.contactId,
      name: d.name,
      kind: "overdue",
      reason:
        d.daysSince >= 999
          ? "まだ一度も連絡の記録がありません"
          : `${d.daysSince}日間ご連絡していません`,
      urgency: d.urgency,
    });
  }
  return out;
}
