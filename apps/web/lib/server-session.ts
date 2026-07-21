// サーバ発行セッション (httpOnly Cookie) — 「ログインしっぱなし」の要。
// Firebase クライアントの永続化 (IndexedDB) は Safari が7日で消すため、
// 大手サイトと同じく「サーバが設定する第一者 Cookie」(この削除の対象外) に永続を持たせ、
// クライアント状態が消えていたら Cookie から静かに復元する。
// FIREBASE_SERVICE_ACCOUNT_JSON 未設定 (ローカル開発) では全機能が null に縮退し、
// 従来どおり break-glass フォールバックで動く。
import "server-only";

export const SESSION_COOKIE = "__session";
export const SESSION_DAYS = 14;

type AdminAuth = {
  createSessionCookie: (idToken: string, opts: { expiresIn: number }) => Promise<string>;
  verifySessionCookie: (cookie: string, checkRevoked?: boolean) => Promise<{ uid: string }>;
  createCustomToken: (uid: string) => Promise<string>;
};

let cached: AdminAuth | null | undefined;

async function adminAuth(): Promise<AdminAuth | null> {
  if (cached !== undefined) return cached;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    cached = null;
    return null;
  }
  try {
    const { initializeApp, cert, getApps } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(raw)) });
    cached = getAuth(app) as unknown as AdminAuth;
  } catch (err) {
    console.error(
      JSON.stringify({ event: "session_admin_init_failed", detail: err instanceof Error ? err.message : String(err) }),
    );
    cached = null;
  }
  return cached;
}

/** ID トークンからセッション Cookie 値を作る (14日)。未設定/失敗は null。 */
export async function createSessionCookieValue(idToken: string): Promise<string | null> {
  const auth = await adminAuth();
  if (!auth) return null;
  try {
    return await auth.createSessionCookie(idToken, { expiresIn: SESSION_DAYS * 24 * 60 * 60 * 1000 });
  } catch {
    return null;
  }
}

/** セッション Cookie を検証して復元用カスタムトークンを返す。無効なら null。 */
export async function restoreFromSessionCookie(
  cookie: string,
): Promise<{ uid: string; customToken: string } | null> {
  const auth = await adminAuth();
  if (!auth) return null;
  try {
    const decoded = await auth.verifySessionCookie(cookie, true);
    const customToken = await auth.createCustomToken(decoded.uid);
    return { uid: decoded.uid, customToken };
  } catch {
    return null;
  }
}

/** Set-Cookie 用の属性。サーバ設定の第一者 Cookie (httpOnly)。 */
export function sessionCookieAttributes(maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}
