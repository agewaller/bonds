// 引き合わせエンジン (「気づかない一手」の核) — 純粋関数。
// 連絡帳の各人の「困りごと・目標 (needs)」と「強み・貢献できること (offers)」を突き合わせ、
// 一方の needs にもう一方の offers が噛み合いそうなお二人を候補として挙げる。
// ここは候補の指名 (nomination) までを安く行い、実際の引き合わせ文面・是非の判断は AI に委ねる
// (partner_discover → outreach と同じ二段構え)。DB/AI 非依存 = ユニットテスト対象。

export type IntroPerson = {
  id: string;
  name: string;
  needs: string[]; // 困りごと・課題・目標 (facets の concerns + goals)
  offers: string[]; // 強み・貢献できること (facets の skills + opportunities)
};

export type IntroPair = {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  // 噛み合った手がかり (A の needs ↔ B の offers、および逆向き)。表示・AI 接地用。
  aNeedsBOffers: string[]; // A の困りごとに B の強みが効きそう
  bNeedsAOffers: string[]; // B の困りごとに A の強みが効きそう
  mutual: boolean; // 双方向に噛み合う (引き合わせの価値が高い)
  score: number;
};

// 日本語の素朴な重なり検出: 空白・記号を除いた文字列から、漢字を含む 2-gram と
// カタカナ語 (2 文字以上) を「手がかり語」として取り出す。意味解析まではしないが、
// 候補を挙げるには十分 (是非は AI が判断する)。
export function salientGrams(s: string): Set<string> {
  const out = new Set<string>();
  // 長音符 (ー) はカタカナ語の一部なので消さない。ASCII ハイフン等の区切りだけ除く。
  const cleaned = s.replace(/[\s、。，．・,.（）()「」『』\[\]{}!！?？"'’”:：;；\/\\|~〜-]+/g, "");
  // 漢字を含む隣接 2 文字
  for (let i = 0; i + 1 < cleaned.length; i++) {
    const pair = cleaned.slice(i, i + 2);
    if (/[぀-鿿㐀-䶵]/.test(pair)) out.add(pair);
  }
  // カタカナの連なり (2 文字以上・長音符を含む) をまるごと 1 語として
  for (const m of cleaned.matchAll(/[ァ-ヴヵヶー]{2,}/g)) out.add(m[0]);
  return out;
}

function overlapTerms(needs: string[], offers: string[]): string[] {
  const offerGrams = new Set<string>();
  for (const o of offers) for (const g of salientGrams(o)) offerGrams.add(g);
  const hits: string[] = [];
  for (const n of needs) {
    const nGrams = salientGrams(n);
    let matched = false;
    for (const g of nGrams) {
      if (offerGrams.has(g)) { matched = true; break; }
    }
    if (matched) hits.push(n);
  }
  return hits;
}

// 全員から、needs ↔ offers が噛み合うお二人を候補として挙げ、スコア順に返す。
// 双方向に噛み合う組は加点 (引き合わせの価値が高い)。自分同士・同名は除外。
export function nominateIntroPairs(people: IntroPerson[], maxPairs = 8): IntroPair[] {
  const usable = people.filter((p) => p.name && (p.needs.length > 0 || p.offers.length > 0));
  const pairs: IntroPair[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i]!;
      const b = usable[j]!;
      if (a.id === b.id) continue;
      const aNeedsBOffers = overlapTerms(a.needs, b.offers);
      const bNeedsAOffers = overlapTerms(b.needs, a.offers);
      const total = aNeedsBOffers.length + bNeedsAOffers.length;
      if (total === 0) continue;
      const mutual = aNeedsBOffers.length > 0 && bNeedsAOffers.length > 0;
      pairs.push({
        aId: a.id, bId: b.id, aName: a.name, bName: b.name,
        aNeedsBOffers, bNeedsAOffers, mutual,
        score: total + (mutual ? 2 : 0),
      });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, maxPairs);
}
