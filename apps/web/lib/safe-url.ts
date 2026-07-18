// 外部URLを href に出す前のスキーム検証。http/https 以外 (javascript:, data: など) を弾く。
// 弾かれた場合や不正URLは null を返し、呼び出し側はリンクにしない (テキスト表示に落とす)。
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

/** 表示用のホスト名 (不正URLなら元文字列)。 */
export function urlHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}
