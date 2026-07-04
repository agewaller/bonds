// 認証 — cares の三段フェイルセーフ (ADR-0011/0014 相当) を bonds に移植。
// 認可される経路は 3 つ (どれか 1 つでも通れば管理操作可 = 管理者をロックアウトしない):
//   1. Firebase ID トークンで custom claim admin:true
//   2. Firebase ID トークンで email == OWNER_EMAIL かつ provider が password
//      (Google ログイン乗っ取り対策: OWNER は email/password のときだけ admin)
//   3. break-glass: x-admin-token == ADMIN_BREAKGLASS_TOKEN
// トークン検証関数は注入可能 (テストでは偽 verifier、実運用は firebase-admin)。

export type VerifiedToken = {
  uid: string;
  email?: string;
  admin?: boolean;
  signInProvider?: string;
};
export type VerifyIdTokenFn = (idToken: string) => Promise<VerifiedToken>;

export type AuthResult =
  | { ok: true; actor: string }
  | { ok: false; status: 401 | 503; error: string; detail?: string };

export type AuthDeps = {
  verifyIdToken?: VerifyIdTokenFn | null;
};

/**
 * リクエストヘッダから三段フェイルセーフで管理者を判定する。
 * どの経路も設定されていない (完全未設定) 場合は fail closed で 503。
 */
export async function authorizeAdmin(
  headers: { authorization?: string; adminToken?: string },
  deps: AuthDeps,
): Promise<AuthResult> {
  const breakglass = process.env.ADMIN_BREAKGLASS_TOKEN;
  const ownerEmail = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  const verify = deps.verifyIdToken ?? null;

  // 経路 3: break-glass (Firebase 障害時の非常口)
  if (breakglass && headers.adminToken === breakglass) {
    return { ok: true, actor: "breakglass" };
  }

  // 経路 1・2: Firebase ID トークン
  const bearer = headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (bearer && verify) {
    try {
      const t = await verify(bearer);
      if (t.admin === true) {
        return { ok: true, actor: `firebase:${t.uid}` };
      }
      const email = (t.email ?? "").trim().toLowerCase();
      if (ownerEmail && email === ownerEmail && t.signInProvider === "password") {
        return { ok: true, actor: `owner:${email}` };
      }
      return { ok: false, status: 401, error: "unauthorized" };
    } catch {
      return { ok: false, status: 401, error: "unauthorized", detail: "トークンを確認できませんでした" };
    }
  }

  // どの経路の資格情報も出されていない
  if (!breakglass && !verify) {
    // 完全未設定 = 構成ミス。fail closed。
    return { ok: false, status: 503, error: "unavailable", detail: "認証が未設定です" };
  }
  return { ok: false, status: 401, error: "unauthorized" };
}

/** firebase-admin による実 verifier。FIREBASE_SERVICE_ACCOUNT_JSON 未設定なら null。 */
export async function buildFirebaseVerifier(): Promise<VerifyIdTokenFn | null> {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const app =
    getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(json)) });
  const auth = getAuth(app);
  return async (idToken: string) => {
    const d = await auth.verifyIdToken(idToken);
    return {
      uid: d.uid,
      email: d.email,
      admin: d.admin === true,
      signInProvider: d.firebase?.sign_in_provider,
    };
  };
}
