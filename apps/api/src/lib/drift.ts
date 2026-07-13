// こじれ・疎遠の検知 (ミッション項目4「人間関係問題の解決」) — 純粋関数。
// やりとりの記録から「そっと気にかけたい関係」を見つける。断定はしない。あくまで気づきの提示。
// 二種類の兆候を見る:
//   faded     … 近しいはずの相手 (距離 1〜3) との連絡が、適正な間合いをかなり過ぎて途絶えている
//   sudden_gap… これまで規則正しくやりとりしていた相手が、いつもの何倍も間があいている (急な途絶え)
// DB/AI 非依存。距離別の適正間隔は relationship.ts と揃える。
import { IDEAL_INTERVAL_DAYS, clampDistance, type ContactLike, type InteractionLike } from "./relationship.js";

export type DriftItem = {
  contactId: string;
  name: string;
  distance: number;
  daysSince: number;
  kind: "faded" | "sudden_gap";
  reason: string; // ユーザー向けの平易な理由 (記号を使わない)
  severity: number; // 並べ替え用 (大きいほど気にかけたい)
};

const DAY_MS = 24 * 60 * 60 * 1000;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function detectDrift(
  contacts: ContactLike[],
  interactions: InteractionLike[],
  now: Date = new Date(),
): DriftItem[] {
  // 相手ごとに、接触のあった「日」を新しい順に集める (同日は1回に畳む)
  const daysByContact = new Map<string, number[]>();
  for (const it of interactions) {
    const day = Math.floor(it.occurredAt.getTime() / DAY_MS);
    const arr = daysByContact.get(it.contactId) ?? [];
    if (!arr.includes(day)) arr.push(day);
    daysByContact.set(it.contactId, arr);
  }
  const today = Math.floor(now.getTime() / DAY_MS);
  const out: DriftItem[] = [];

  for (const c of contacts) {
    const distance = clampDistance(c.distance);
    const days = (daysByContact.get(c.id) ?? []).slice().sort((a, b) => b - a); // 新しい順
    if (days.length === 0) continue; // 一度も記録が無い人はここでは扱わない (別途「今日連絡」で拾う)
    const daysSince = today - days[0]!;

    // sudden_gap: 4 回以上やりとりがあり、いつもの間隔の 3 倍以上あいている
    if (days.length >= 4) {
      const gaps: number[] = [];
      for (let i = 0; i < days.length - 1; i++) gaps.push(days[i]! - days[i + 1]!);
      const med = median(gaps);
      if (med > 0 && daysSince > Math.max(med * 3, med + 14)) {
        out.push({
          contactId: c.id, name: c.name, distance, daysSince, kind: "sudden_gap",
          reason: `これまでは${Math.round(med)}日ほどの間隔でやりとりされていましたが、いまは${daysSince}日ほど間があいています`,
          severity: 100 + daysSince / Math.max(1, med),
        });
        continue; // sudden_gap を優先 (faded と二重に出さない)
      }
    }

    // faded: 近しい相手 (距離 1〜3) なのに、適正な間合いをかなり過ぎて途絶えている
    if (distance <= 3) {
      const ideal = IDEAL_INTERVAL_DAYS[distance] ?? 14;
      if (daysSince > ideal * 4) {
        const closeness = distance <= 2 ? 2 : 1; // 近い相手ほど気にかけたい
        out.push({
          contactId: c.id, name: c.name, distance, daysSince, kind: "faded",
          reason: `近しくされていた方ですが、${daysSince}日ほどご連絡が途絶えています`,
          severity: 50 * closeness + daysSince / Math.max(1, ideal),
        });
      }
    }
  }
  return out.sort((a, b) => b.severity - a.severity);
}
