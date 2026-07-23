// 宛先の事前検証 (バウンス予防の本丸)。送る前に宛先の実在を検証サービスで確かめ、
// 無効な宛先には送らない。2026-07 の Resend 停止 (公開サイト由来アドレスへの提携連絡で
// バウンス率超過) の再発防止。プロバイダ障害や未設定では unknown を返し、送信全体は
// 止めない (量の規律は日次上限が別に担う)。

export type VerifyResult = "valid" | "invalid" | "unknown";
export type EmailVerifier = (email: string) => Promise<VerifyResult>;

// ZeroBounce の status → 三値。invalid 系 (spamtrap / abuse / do_not_mail) は送らない。
// catch-all / unknown は断定できないため送信は許す (バウンスしても少数に留まる)。
export function classifyZeroBounce(status: unknown): VerifyResult {
  if (typeof status !== "string") return "unknown";
  const s = status.toLowerCase();
  if (s === "valid") return "valid";
  if (s === "invalid" || s === "spamtrap" || s === "abuse" || s === "do_not_mail") return "invalid";
  return "unknown";
}

// NeverBounce の result → 三値
export function classifyNeverBounce(result: unknown): VerifyResult {
  if (typeof result !== "string") return "unknown";
  const s = result.toLowerCase();
  if (s === "valid") return "valid";
  if (s === "invalid" || s === "disposable") return "invalid";
  return "unknown";
}

// env から検証器を組み立てる。EMAIL_VERIFY_API_KEY 未設定なら null (検証なしで従来どおり)。
// EMAIL_VERIFY_PROVIDER: zerobounce (既定) | neverbounce
export function buildEmailVerifier(): EmailVerifier | null {
  const key = process.env.EMAIL_VERIFY_API_KEY;
  if (!key || key === "unset") return null;
  const provider = (process.env.EMAIL_VERIFY_PROVIDER ?? "zerobounce").toLowerCase();
  return async (email: string) => {
    try {
      if (provider === "neverbounce") {
        const res = await fetch(
          `https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`,
          { signal: AbortSignal.timeout(15000) },
        );
        if (!res.ok) return "unknown";
        const body = (await res.json()) as { result?: unknown };
        return classifyNeverBounce(body.result);
      }
      const res = await fetch(
        `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!res.ok) return "unknown";
      const body = (await res.json()) as { status?: unknown };
      return classifyZeroBounce(body.status);
    } catch {
      return "unknown";
    }
  };
}
