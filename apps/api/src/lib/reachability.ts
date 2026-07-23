// 「連絡先がわからない方」を、つながりでたどって解決する — 純粋関数 (AI 不要・毎回無料)。
// 連絡手段 (メール・電話・SNS) の無い方について、連絡手段のある別の登録者の中から
// 「橋渡し役」になれそうな方を、同じ会社・同じ日の同席・同じイベントでの出会い・
// 記録への登場、という決定的な手がかりで探す。押しつけず、実際に頼むかはユーザーが決める。
import { parseSnsField } from "./sns.js";

export type ReachPerson = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  sns: string | null;
  notes: string | null;
  personalProfile: string | null;
  sourceHits: number;
  distance: number;
};

/** 連絡手段 (メール・電話・SNS アカウント) をひとつでも持っているか。 */
export function isReachable(p: Pick<ReachPerson, "email" | "phone" | "sns">): boolean {
  if (p.email && p.email.trim()) return true;
  if (p.phone && p.phone.trim()) return true;
  return parseSnsField(p.sns).length > 0;
}

/** メモから「◯◯で出会う」のイベント名を取り出す (パーティ取込・年賀状などが書き足す)。 */
export function extractMeetEvents(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const out = new Set<string>();
  for (const m of notes.matchAll(/(?:^|\s)(\S{2,30})で出会う/g)) {
    out.add(m[1]!);
  }
  return [...out];
}

// 連絡先の無い方のうち「解決する価値の高い方」から順に選ぶ:
// くり返し登場 (取込で何度も行き当たった) ・やりとりの多さ・近い距離感を重み付け。
export function pickUnreachableTargets(
  people: ReachPerson[],
  interactionCount: Map<string, number>,
  max = 20,
): ReachPerson[] {
  return people
    .filter((p) => !isReachable(p))
    .map((p) => ({
      p,
      score:
        Math.min(p.sourceHits, 5) * 3 +
        Math.min(interactionCount.get(p.id) ?? 0, 10) * 2 +
        (6 - Math.min(p.distance, 5)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.p);
}

export type Bridge = { contactId: string; name: string; email: string | null; reasons: string[]; score: number };

/**
 * 橋渡し役の候補を探す。連絡手段のある方の中から、対象の方とのつながりの手がかりで採点する。
 * meetDays: contactId → その方の meeting 接触の日付 (YYYY-MM-DD) の集合。
 */
export function findBridges(
  target: ReachPerson,
  people: ReachPerson[],
  meetDays: Map<string, Set<string>>,
): Bridge[] {
  const targetDays = meetDays.get(target.id) ?? new Set<string>();
  const targetEvents = new Set(extractMeetEvents(target.notes));
  const targetCompany = (target.company ?? "").trim();
  const nameForMention = target.name.replace(/\s+/g, "");
  const out: Bridge[] = [];
  for (const p of people) {
    if (p.id === target.id || !isReachable(p)) continue;
    const reasons: string[] = [];
    let score = 0;
    if (targetCompany && (p.company ?? "").trim() === targetCompany) {
      reasons.push(`同じ所属 (${targetCompany})`);
      score += 30;
    }
    if (targetDays.size > 0) {
      const days = meetDays.get(p.id);
      if (days) {
        const shared = [...targetDays].filter((d) => days.has(d));
        if (shared.length > 0) {
          reasons.push(`同じ日にお会いしています (${shared[0]})`);
          score += 25 + Math.min(shared.length - 1, 3) * 5;
        }
      }
    }
    if (targetEvents.size > 0) {
      const ev = extractMeetEvents(p.notes).find((e) => targetEvents.has(e));
      if (ev) {
        reasons.push(`同じ場 (${ev}) で出会っています`);
        score += 25;
      }
    }
    // 記録への登場 (橋渡し役のメモ・人物メモに対象の方の名前がある)。短い名前は誤検知するため 3 文字以上
    if (nameForMention.length >= 3) {
      const text = `${p.notes ?? ""}\n${p.personalProfile ?? ""}`.replace(/\s+/g, "");
      if (text.includes(nameForMention)) {
        reasons.push("この方の記録に登場します");
        score += 20;
      }
    }
    if (score > 0) out.push({ contactId: p.id, name: p.name, email: p.email, reasons, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}
