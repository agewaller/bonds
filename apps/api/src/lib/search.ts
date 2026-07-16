// 連絡先の検索 — 純粋関数。名前・ふりがな・ローマ字・メール・電話・会社などを
// ひとつの検索窓から探せるようにする。暗号化列は SQL で検索できないため、
// 復号済みの行に対してアプリ内で照合する (単一オーナー数千件なら十分速い)。

// ローマ字 → ひらがな (ヘボン式・訓令式の両方を許容する最長一致)。
// 英単語などローマ字として読み切れない文字列は null (誤変換で誤ヒットさせない)。
const ROMAJI: Record<string, string> = {
  kya: "きゃ", kyu: "きゅ", kyo: "きょ", gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ",
  sha: "しゃ", shu: "しゅ", sho: "しょ", sya: "しゃ", syu: "しゅ", syo: "しょ",
  ja: "じゃ", ju: "じゅ", jo: "じょ", jya: "じゃ", jyu: "じゅ", jyo: "じょ",
  zya: "じゃ", zyu: "じゅ", zyo: "じょ",
  cha: "ちゃ", chu: "ちゅ", cho: "ちょ", tya: "ちゃ", tyu: "ちゅ", tyo: "ちょ",
  nya: "にゃ", nyu: "にゅ", nyo: "にょ", hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ",
  bya: "びゃ", byu: "びゅ", byo: "びょ", pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ",
  mya: "みゃ", myu: "みゅ", myo: "みょ", rya: "りゃ", ryu: "りゅ", ryo: "りょ",
  shi: "し", chi: "ち", tsu: "つ",
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ",
  sa: "さ", si: "し", su: "す", se: "せ", so: "そ",
  ta: "た", ti: "ち", tu: "つ", te: "て", to: "と",
  na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
  ha: "は", hi: "ひ", hu: "ふ", fu: "ふ", he: "へ", ho: "ほ",
  ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
  ya: "や", yu: "ゆ", yo: "よ",
  ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ",
  wa: "わ", wo: "を",
  ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
  za: "ざ", zi: "じ", ji: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
  ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ",
  pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
  va: "ば", vi: "び", vu: "ぶ", ve: "べ", vo: "ぼ",
  a: "あ", i: "い", u: "う", e: "え", o: "お", n: "ん",
};

export function romajiToHiragana(input: string): string | null {
  const s = input.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  let out = "";
  let i = 0;
  while (i < s.length) {
    // 促音: 子音の重なり (kk → っk。n の重なりは「んな行」なので除く)
    if (
      i + 1 < s.length &&
      s[i] === s[i + 1] &&
      s[i] !== "n" &&
      !"aiueo".includes(s[i]!)
    ) {
      out += "っ";
      i++;
      continue;
    }
    let matched = false;
    for (const len of [3, 2, 1]) {
      const kana = ROMAJI[s.slice(i, i + len)];
      if (kana) {
        out += kana;
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) return null; // ローマ字として読めない (英単語など)
  }
  return out;
}

// 検索用の正規化: 全半角をそろえ (NFKC)、小文字化、カタカナ→ひらがな、
// 空白・中黒・ハイフン・かっこを除く (表記ゆれを吸収)。
export function normalizeForSearch(v: string): string {
  return v
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s・･•\-‐–—ー_/()（）「」『』.,、。]/g, "");
}

export type SearchableContact = {
  name: string;
  furigana?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  sns?: string | null;
};

// 1 件の連絡先が検索語に当たるか。①正規化した本文一致 ②ローマ字→ひらがな変換で
// ふりがな/名前に当てる ③数字だけにした電話番号の部分一致。
export function contactMatches(query: string, ct: SearchableContact): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  const hay = normalizeForSearch(
    [ct.name, ct.furigana, ct.company, ct.title, ct.email, ct.address, ct.notes, ct.sns]
      .filter(Boolean)
      .join(" "),
  );
  if (hay.includes(q)) return true;
  const kana = romajiToHiragana(query);
  if (kana && kana.length >= 2 && hay.includes(kana)) return true;
  const digits = query.replace(/[^0-9]/g, "");
  if (digits.length >= 3 && (ct.phone ?? "").replace(/[^0-9]/g, "").includes(digits)) return true;
  return false;
}
