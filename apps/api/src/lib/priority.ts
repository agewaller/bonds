// 大切にしたい方のピックアップ — 純粋関数。
// 取り込んだ連絡先リストの大半は「死んだリスト」(一度も動かない名簿) であり、
// 全員を等しく見せてもユーザーは動けない。実際のやりとり・ユーザーの意思 (目標・
// 距離感・手入力)・積み重なった記録から「関係を高める価値がありそうな方」を選び、
// そこに打ち手を集中させる。AI は使わない (毎回無料・決定的)。

export type FocusInput = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  distance: number;
  source: string; // manual / csv / eight / facebook / google / …
  interactionCount: number;
  lastContactDays: number | null;
  giftExchangeCount: number; // 贈り物 + やり取り台帳の件数
  hasFacets: boolean;
  hasDigest: boolean;
  hasGoal: boolean;
  sourceHits: number; // 取込・名寄せで同じ方に行き当たった延べ回数 (くり返し登場)
  focusPreference: string | null; // pinned / excluded / null (ユーザーの意思が最優先)
};

export type FocusPick = {
  contactId: string;
  name: string;
  company: string | null;
  score: number;
  reasons: string[]; // ユーザー向けの平易な理由 (最大3つ)
};

// この点数に満たない方は「静かなリスト」として一覧の外に置く (消しはしない)。
const FOCUS_THRESHOLD = 25;

export function pickFocusContacts(people: FocusInput[], maxItems = 20): FocusPick[] {
  const out: FocusPick[] = [];
  for (const p of people) {
    if (!p.name.trim()) continue;
    // ユーザーが「外す」と決めた方は選ばない (意思が自動判定より常に強い)
    if (p.focusPreference === "excluded") continue;
    let score = 0;
    const reasons: string[] = [];
    if (p.focusPreference === "pinned") {
      score += 100; // 閾値を必ず越え、先頭側に並ぶ
      reasons.push("あなたが大切と印を付けた方");
    }
    // 名簿・SNS・トーク履歴など複数の取込にくり返し登場する = 生活圏で実際に接点が多い
    if (p.sourceHits >= 2) {
      score += Math.min(p.sourceHits - 1, 4) * 8;
      reasons.push("取り込みにくり返し登場");
    }
    // ユーザーの意思がいちばん強い信号: 目標を決めた・距離を近いと置いた・自分で登録した
    if (p.hasGoal) {
      score += 50;
      reasons.push("目標を決めた間柄");
    }
    if (p.distance <= 2) {
      score += 25;
      reasons.push("近しい距離感");
    } else if (p.distance === 3) {
      score += 10;
    }
    if (p.source === "manual") {
      score += 15;
      reasons.push("ご自身で登録した方");
    }
    // 実際のやりとりの積み重ね (死んだリストとの最大の違い)
    score += Math.min(p.interactionCount, 20) * 3;
    if (p.interactionCount >= 3) reasons.push("やりとりが積み重なっている");
    if (p.lastContactDays !== null && p.lastContactDays <= 30) {
      score += 20;
      reasons.push("最近やりとりがあった");
    } else if (p.lastContactDays !== null && p.lastContactDays <= 90) {
      score += 10;
    }
    if (p.giftExchangeCount > 0) {
      score += Math.min(p.giftExchangeCount, 5) * 8;
      reasons.push("贈り物ややり取りの記録がある");
    }
    // 関係を動かす材料の有無 (弱い加点)
    if (p.hasFacets) score += 8;
    if (p.hasDigest) score += 5;
    if (p.company || p.title) score += 5;
    if (p.hasEmail || p.hasPhone) score += 5;

    if (score < FOCUS_THRESHOLD) continue;
    out.push({ contactId: p.id, name: p.name, company: p.company, score, reasons: reasons.slice(0, 3) });
  }
  return out.sort((a, b) => b.score - a.score || (a.contactId < b.contactId ? -1 : 1)).slice(0, maxItems);
}
