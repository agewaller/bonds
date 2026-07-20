// 軸検索 — 純粋関数。連絡帳を「影響力・専門性・価値観・誠実さ/評判」の軸で探す。
// 手がかりは蓄積した記録 (肩書き・所属・論点整理・価値観・相手ノート) と、公人リンク先の
// 評価スコア (意識の七次元 / 社会価値創造)。AI は使わない (毎回無料・決定的)。
// web 検索はしない = 相手の尊厳。手がかりの薄い方は無理に載せない。

export const AXES = ["influence", "expertise", "values", "integrity"] as const;
export type Axis = (typeof AXES)[number];

export const AXIS_LABEL: Record<Axis, string> = {
  influence: "影響力の強い方",
  expertise: "専門性の高い方",
  values: "価値観の合いそうな方",
  integrity: "誠実さ・評判の高い方",
};

export type AxisInput = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  distance: number;
  sourceHits: number;
  valuesProfile: string | null;
  notes: string | null;
  digest: string | null; // profileDigest (相手ノート)
  facetsSkills: string[]; // 論点整理の skills
  facetsValues: string | null; // 論点整理の values
  hasGoal: boolean;
  ddScore7d: number | null; // リンク済み公人の 意識の七次元 スコア (0〜10)
  ddScoreSvc: number | null; // リンク済み公人の 社会価値創造 スコア (0〜10)
};

export type AxisMatch = {
  contactId: string;
  name: string;
  company: string | null;
  title: string | null;
  score: number;
  reasons: string[];
};

const INFLUENCE_TITLE =
  /(社長|代表|会長|CEO|COO|CFO|CTO|頭取|取締役|役員|執行役|理事長|理事|議員|知事|市長|町長|大臣|長官|学長|総長|校長|教授|創業|オーナー|会頭|組合長|団長|理事|パートナー|支社長|支店長|本部長|事業部長|局長|部長|編集長|President|Founder|Chief|Director|Executive|Head|Partner|Chairman|Owner)/i;

const EXPERTISE_TITLE =
  /(博士|教授|准教授|講師|研究|専門|技師|技術士|弁護士|弁理士|司法書士|行政書士|医師|歯科医|獣医|薬剤師|看護|会計士|税理士|中小企業診断士|建築士|設計|エンジニア|プログラマ|データ|アナリスト|コンサルタント|デザイナー|アーキテクト|サイエンティスト|Ph\.?D|Dr\.|Prof|Engineer|Scientist|Analyst|Consultant|Architect)/i;

const INTEGRITY_HINT = /(誠実|実直|信頼|信用|人望|評判が(良い|よい|高い)|義理堅い|約束を守る|丁寧|真摯|正直)/;

/** 1 人を 1 軸で採点し、理由を添える。閾値未満は載せない前提の素点。 */
export function scoreAxis(axis: Axis, p: AxisInput): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const title = p.title ?? "";
  const textPool = [p.notes ?? "", p.digest ?? "", p.valuesProfile ?? ""].join(" ");

  if (axis === "influence") {
    if (INFLUENCE_TITLE.test(title)) {
      score += 50;
      reasons.push(`${title}という立場`);
    }
    if (p.company) score += 10;
    if (p.ddScoreSvc != null) {
      score += Math.round(p.ddScoreSvc * 4); // 公人評価 (社会価値創造) を接地
      reasons.push(`公人評価あり (社会価値創造 10段階で ${p.ddScoreSvc})`);
    }
    if (p.sourceHits >= 2) {
      score += 10;
      reasons.push("いろいろな所で名前が挙がる");
    }
  }

  if (axis === "expertise") {
    if (EXPERTISE_TITLE.test(title)) {
      score += 50;
      reasons.push(`${title}という専門`);
    }
    if (p.facetsSkills.length > 0) {
      score += Math.min(p.facetsSkills.length, 4) * 10;
      reasons.push(`得意なこと: ${p.facetsSkills.slice(0, 3).join("、")}`);
    }
    if (/専門|研究|第一人者|エキスパート/.test(textPool)) {
      score += 10;
      reasons.push("記録に専門性の手がかり");
    }
  }

  if (axis === "values") {
    // 価値観そのものの相性は最後はご本人が判断する。ここでは「価値観がよく見えている方」を
    // 中身の手がかり付きで挙げる (見えているほど、合う合わないを確かめやすい)。
    if (p.valuesProfile && p.valuesProfile.trim().length >= 20) {
      score += 40;
      reasons.push(`大切にしていること: ${p.valuesProfile.trim().slice(0, 60)}`);
    } else if (p.facetsValues) {
      score += 30;
      reasons.push(`価値観の記録: ${p.facetsValues.slice(0, 60)}`);
    }
    if (p.hasGoal) {
      score += 15;
      reasons.push("関係の目標を決めている間柄");
    }
    if (p.ddScore7d != null) {
      score += Math.round(p.ddScore7d * 3);
      reasons.push(`公人評価あり (意識の七次元 10段階で ${p.ddScore7d})`);
    }
  }

  if (axis === "integrity") {
    if (p.ddScore7d != null) {
      score += Math.round(p.ddScore7d * 5); // 意識の七次元 = 内面の成熟の推計
      reasons.push(`公人評価あり (意識の七次元 10段階で ${p.ddScore7d})`);
    }
    if (INTEGRITY_HINT.test(textPool)) {
      score += 40;
      reasons.push("記録に誠実さ・評判の手がかり");
    }
    if (p.distance <= 2) {
      score += 10;
      reasons.push("あなた自身が近くに置いている方");
    }
  }

  return { score, reasons: reasons.slice(0, 3) };
}

const AXIS_THRESHOLD = 30;

export function searchByAxis(axis: Axis, people: AxisInput[], maxItems = 30): AxisMatch[] {
  const out: AxisMatch[] = [];
  for (const p of people) {
    if (!p.name.trim()) continue;
    const { score, reasons } = scoreAxis(axis, p);
    if (score < AXIS_THRESHOLD) continue;
    out.push({ contactId: p.id, name: p.name, company: p.company, title: p.title, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || (a.contactId < b.contactId ? -1 : 1)).slice(0, maxItems);
}

/** 公人評価ができそうな方の判定 (dd-scan の入り口)。肩書きが公人らしい方だけ。 */
export function looksLikePublicFigure(p: { title: string | null; company: string | null }): boolean {
  return !!p.title && INFLUENCE_TITLE.test(p.title);
}
