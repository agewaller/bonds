// 統合ハブの純粋ロジック — 他プロダクトからの人物 upsert と、受信メールの
// 送信元 → 連絡先ルーティング。DB / DOM 非依存 (ユニットテスト対象)。
// 連絡先の email は暗号化列で where 検索できないため、突合はアプリ層でこの関数が担う。

export const INTEGRATION_PRODUCTS = ["cares", "vm", "zentrack", "lms"] as const;
export type IntegrationProduct = (typeof INTEGRATION_PRODUCTS)[number];

export function normalizeProduct(v: unknown): IntegrationProduct | null {
  return (INTEGRATION_PRODUCTS as readonly string[]).includes(v as string)
    ? (v as IntegrationProduct)
    : null;
}

// メールアドレスの正規化 (突合キー): トリム + 小文字化。表示名付き "Foo <a@b.com>" からも抽出。
export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const m = raw.match(/<([^>]+)>/); // "山田 <a@b.com>" → a@b.com
  const addr = (m?.[1] ?? raw).trim().toLowerCase();
  return addr;
}

export type EmailBearer = { id: string; email?: string | null };

// 送信元メールに一致する連絡先を返す (先頭一致)。暗号化 email は事前に復号済みで渡す。
export function matchByEmail<T extends EmailBearer>(contacts: readonly T[], from: unknown): T | null {
  const target = normalizeEmail(from);
  if (!target) return null;
  for (const c of contacts) {
    if (c.email && normalizeEmail(c.email) === target) return c;
  }
  return null;
}
