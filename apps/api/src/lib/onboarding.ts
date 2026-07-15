// 取り込んだばかりの方への「はじめの一手」— 純粋関数。
// 連絡先を取り込んだきり何も起きない空白 (収集→把握→打ち手の断絶) を埋める。
// 取り込み済みの情報 (会社・役職・メモ・論点整理) から「動いたほうがよい方」を理由つきで挙げる。
// AI は使わない (毎回無料で出せる)。深い対応は連絡先詳細の「対応を考える」(playbook) に委ねる。

export type OnboardPerson = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  relationship: string;
  source: string; // manual / csv / eight / google / outlook / line …
  createdAt: Date;
  hasEmail: boolean;
  interactionCount: number;
  // 論点整理 (facets) の要点 (パース済み。無ければ null)
  facets: { work?: string; goals?: string[]; opportunities?: string[]; concerns?: string[] } | null;
};

export type FirstMove = {
  contactId: string;
  name: string;
  kind: "work" | "greeting" | "enrich";
  reason: string; // ユーザー向けの平易な理由 (記号を使わない)
  score: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// 最近 (既定30日) 取り込まれ、まだやりとりの無い方から「はじめの一手」を挙げる。
// 並び: 仕事の接点がありそう > 挨拶がまだ > 情報を足すと動ける、の順。連絡手段が
// ある方を優先する (実行可能性 = ユーザーのリソースの軸)。
export function firstMoves(people: OnboardPerson[], now: Date = new Date(), maxItems = 8): FirstMove[] {
  const out: FirstMove[] = [];
  for (const p of people) {
    const ageDays = Math.floor((now.getTime() - p.createdAt.getTime()) / DAY_MS);
    if (ageDays > 30) continue; // 「新しく迎えた方」の範囲
    if (p.interactionCount > 0) continue; // すでに動き出している方は既存パネル (今日連絡など) に委ねる

    const freshness = Math.max(0, 30 - ageDays); // 新しいほど先に
    const reachable = p.hasEmail ? 20 : 0;

    // 仕事の接点: 会社/役職があるか、論点に仕事・貢献余地・目標の手がかりがある
    const workHints: string[] = [];
    if (p.company) workHints.push(`${p.company}の方`);
    if (p.title) workHints.push(p.title);
    const opp = p.facets?.opportunities?.[0];
    const goal = p.facets?.goals?.[0];
    if (p.facets?.work) workHints.push(p.facets.work);

    if (workHints.length > 0 || opp || goal) {
      const hook = opp
        ? `こちらから力になれそうなこと (${opp}) があります`
        : goal
          ? `目標 (${goal}) に接点がつくれそうです`
          : `お仕事のつながりがつくれそうです`;
      out.push({
        contactId: p.id,
        name: p.name,
        kind: "work",
        reason: `${workHints.slice(0, 2).join("、") || "お仕事関係"}。${hook}。取り込んだきりになる前に、一度ご連絡してみては`,
        score: 100 + freshness + reachable + (opp ? 15 : 0),
      });
      continue;
    }

    // 挨拶がまだ: 連絡手段はあるのにやりとりゼロ
    if (p.hasEmail) {
      out.push({
        contactId: p.id,
        name: p.name,
        kind: "greeting",
        reason: `お迎えしたままご挨拶がまだです。短い顔つなぎの一報だけでも、関係の入り口になります`,
        score: 50 + freshness + reachable,
      });
      continue;
    }

    // 手がかり不足: 情報を足せば打ち手が出せる (押しつけず、招く言い方で)
    out.push({
      contactId: p.id,
      name: p.name,
      kind: "enrich",
      reason: `まだ手がかりが少ない方です。所属やメモをひとこと足すと、こちらから一手をご提案できます`,
      score: 10 + freshness,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, maxItems);
}
