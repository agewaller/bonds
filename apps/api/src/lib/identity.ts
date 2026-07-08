// 名寄せ (identity resolution) の純粋ロジック。DB/ネットワーク非依存 = ユニットテスト対象。
// 「同じ人が違う書き方で複数登録される」を防ぐ・まとめるための正規化と一致判定。
import { stripHonorific } from "./contact-parsers.js";

// メールは前後空白除去 + 小文字化 (大文字小文字は同一メール)。
export function normalizeEmail(v?: string | null): string {
  return (v ?? "").trim().toLowerCase();
}

// 電話は数字だけにそろえる (ハイフン・空白・国番号記号の揺れを吸収)。
// 日本の国番号 +81 は先頭 0 に寄せて国内表記とそろえる。
export function normalizePhone(v?: string | null): string {
  let d = (v ?? "").replace(/[^0-9]/g, "");
  if (d.startsWith("81") && d.length >= 11) d = "0" + d.slice(2);
  return d;
}

// 名前は敬称を外し、全角/半角スペースを詰めて小文字化 (「田中 一郎」「田中一郎」を同一に)。
export function normalizeName(v?: string | null): string {
  return stripHonorific((v ?? "").trim())
    .replace(/[　\s]+/g, "")
    .toLowerCase();
}

export type IdentityInput = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type IdentityKeys = { email?: string; phone?: string; name?: string };

// 同一人物判定に使うキー。email/phone は強い一致、name は弱い一致 (同姓同名の別人がいる)。
// 短すぎる電話番号 (内線など) はキーにしない (誤結合を避ける)。
export function identityKeys(c: IdentityInput): IdentityKeys {
  const email = normalizeEmail(c.email);
  const phone = normalizePhone(c.phone);
  const name = normalizeName(c.name);
  return {
    email: email || undefined,
    phone: phone.length >= 10 ? phone : undefined,
    name: name || undefined,
  };
}

// 強い一致 (email か phone) だけで同一人物とみなす。名前は「候補」止まり (自動結合しない)。
export function strongMatch(a: IdentityInput, b: IdentityInput): boolean {
  const ka = identityKeys(a);
  const kb = identityKeys(b);
  if (ka.email && ka.email === kb.email) return true;
  if (ka.phone && ka.phone === kb.phone) return true;
  return false;
}
