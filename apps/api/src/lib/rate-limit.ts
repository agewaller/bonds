// 公開エンドポイント用の軽量レートリミッタ (インメモリ・固定窓)。
// 目的: 未認証の公開経路 (共有ページの解錠・提案・参加・予約) のスパムやオンライン
// 総当りを鈍らせる。単一インスタンス内のベストエフォート (完全な分散制限ではない)。
// Cloud Run が複数インスタンスに分かれると窓もインスタンスごとになるが、1 台あたりの
// 濫用を確実に抑えられれば実害の桁は十分下げられる。

type Window = { count: number; resetAt: number };

export class RateLimiter {
  private windows = new Map<string, Window>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** key の許否を判定し、許可なら 1 消費する。true=許可 / false=上限超過。 */
  take(key: string): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t >= w.resetAt) {
      this.windows.set(key, { count: 1, resetAt: t + this.windowMs });
      this.sweep(t);
      return true;
    }
    if (w.count >= this.limit) return false;
    w.count++;
    return true;
  }

  // 古い窓を掃除する (メモリ肥大化を防ぐ。呼び出しのたびに軽く)
  private sweep(t: number): void {
    if (this.windows.size < 5000) return;
    for (const [k, w] of this.windows) if (t >= w.resetAt) this.windows.delete(k);
  }
}

/** リクエストから素朴なクライアント識別子を得る (プロキシ配下の Cloud Run 想定)。 */
export function clientKey(headers: {
  get(name: string): string | null | undefined;
}): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
