// 関係を育てるとよい方のピックアップと、距離の縮め方の提示 — 純粋関数。
// 「大切にしたい方々」(priority) が“いま既に強い関係”を選ぶのに対し、こちらは
// “これから関係を作る・近づける価値がある方”を選び、それぞれに距離の縮め方
// (キャッチアップ・モノやサービスの提示・空いた時間で会う など) を具体的に添える。
// AI は使わない (毎回無料・決定的)。実行はユーザーが選ぶ (押しつけない)。

export type GrowthInput = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  distance: number;
  hasEmail: boolean;
  hasPhone: boolean;
  interactionCount: number;
  lastContactDays: number | null;
  hasFacets: boolean;
  hasDigest: boolean;
  hasGoal: boolean;
  goalTargetDistance: number | null; // 目標の距離 (現在 > 目標 なら「近づけたい」)
  sourceHits: number;
  focusPreference: string | null; // pinned / excluded / null
  offeringTitle: string | null; // この方のニーズに刺さる、あなたの申し出 (無ければ null)
};

export type GrowthMoveKind = "catchup" | "offer" | "meet" | "enrich";
export type GrowthMove = { kind: GrowthMoveKind; label: string; offeringTitle?: string };

export type GrowthPick = {
  contactId: string;
  name: string;
  company: string | null;
  distance: number;
  score: number;
  reason: string; // ユーザー向けの平易な理由 (記号を使わない)
  moves: GrowthMove[];
};

const GROWTH_THRESHOLD = 30;

/** 1 人ぶんの「距離の縮め方」を、実行可能な順に並べて返す。 */
export function planGrowthMoves(p: GrowthInput): GrowthMove[] {
  const moves: GrowthMove[] = [];
  // 1. キャッチアップ (近況伺い・ご無沙汰の一報・はじめのご挨拶)
  if (p.hasEmail || p.hasPhone) {
    const never = p.lastContactDays == null;
    const overdue = p.lastContactDays != null && p.lastContactDays >= 60;
    moves.push({
      kind: "catchup",
      label: never ? "はじめのご挨拶を送る" : overdue ? "ご無沙汰のキャッチアップを送る" : "近況を伺う一報を送る",
    });
  }
  // 2. モノ・サービスの提示 (あなたの申し出がこの方のニーズに刺さる)
  if (p.offeringTitle) {
    moves.push({ kind: "offer", label: `「${p.offeringTitle}」を申し出る`, offeringTitle: p.offeringTitle });
  }
  // 3. 会う (空いた時間で日程調整)
  moves.push({ kind: "meet", label: "空いた時間で会う約束をつくる" });
  // 4. 手がかりが薄いなら、まず情報を足す (打ち手が増える)
  if (!p.hasFacets && !p.hasDigest && !p.company) {
    moves.push({ kind: "enrich", label: "近況やメモを足して打ち手を増やす" });
  }
  return moves;
}

/**
 * 「関係を作った・近づけた方がよい方」を、伸びしろ (距離を縮める余地) と手がかりの
 * 厚み・機会 (目標・申し出の一致・間合い) から選ぶ。既に十分近い方 (距離 1〜2) は
 * 加点を抑え、育てる余地のある方 (距離 3〜5) を前に出す。
 */
export function pickGrowthContacts(people: GrowthInput[], maxItems = 16): GrowthPick[] {
  const out: GrowthPick[] = [];
  for (const p of people) {
    if (!p.name.trim()) continue;
    if (p.focusPreference === "excluded") continue; // 外した方は選ばない
    let score = 0;
    const reasons: string[] = [];

    // 近づけたい目標がある = はっきり育てたい相手
    const wantsCloser = p.hasGoal && p.goalTargetDistance != null && p.goalTargetDistance < p.distance;
    if (wantsCloser) {
      score += 45;
      reasons.push("もっと近づきたい目標がある");
    } else if (p.hasGoal) {
      score += 18;
      reasons.push("関係の目標を決めている");
    }
    // あなたが力になれる (申し出がニーズに刺さる)
    if (p.offeringTitle) {
      score += 35;
      reasons.push("あなたが力になれそう");
    }
    // 仕事の接点
    if (p.company || p.title) {
      score += 18;
      reasons.push(p.company ? `${p.company}の方` : "お仕事のつながり");
    }
    // くり返し登場 = 生活圏で実際に接点が多い
    if (p.sourceHits >= 2) {
      score += 14;
      reasons.push("いろいろな所で名前が挙がる");
    }
    // 芽はある (少しやりとりした) が、まだ浅い
    if (p.interactionCount >= 1 && p.interactionCount <= 5) {
      score += 12;
      reasons.push("やりとりが始まっている");
    }
    // 間合い: 距離を縮める余地がある (近すぎない)
    if (p.distance === 3 || p.distance === 4) score += 15;
    else if (p.distance === 5) score += 6;
    // 機会が滑りかけ: しばらく間が空いている / まだ一度も
    if (p.lastContactDays == null) {
      score += 8;
      reasons.push("ご挨拶はこれから");
    } else if (p.lastContactDays >= 60) {
      score += 16;
      reasons.push("しばらく間が空いている");
    }
    // 把握できている = 打ち手を出せる
    if (p.hasFacets) score += 10;
    if (p.hasDigest) score += 5;
    // 連絡できる
    if (p.hasEmail || p.hasPhone) score += 8;

    if (score < GROWTH_THRESHOLD) continue;
    out.push({
      contactId: p.id,
      name: p.name,
      company: p.company,
      distance: p.distance,
      score,
      reason: reasons.slice(0, 3).join("・"),
      moves: planGrowthMoves(p),
    });
  }
  return out
    .sort((a, b) => b.score - a.score || (a.contactId < b.contactId ? -1 : 1))
    .slice(0, maxItems);
}
