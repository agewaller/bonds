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

export type UserAuthResult =
  | { ok: true; ownerUid: string; actor: string; isOwner: boolean }
  | { ok: false; status: 401 | 503; error: string; detail?: string };

/**
 * 一般ユーザーの認可 (関係性ダッシュボード用)。
 * - Firebase ID トークンが有効なら、その uid を ownerUid としてデータを分離する
 * - break-glass トークンは単一オーナー時代の "owner" スコープに入る (互換・非常口)
 * - isOwner: break-glass、または email==OWNER_EMAIL は「オーナー本人」。AI 月次上限を
 *   オーナーは無制限、それ以外は設定値で効かせるために使う (cares の owner 無制限と同思想)。
 * 管理系 (人物DD 書き込み・admin) は authorizeAdmin を使い続ける。
 */
export async function authorizeUser(
  headers: { authorization?: string; adminToken?: string },
  deps: AuthDeps,
): Promise<UserAuthResult> {
  const breakglass = process.env.ADMIN_BREAKGLASS_TOKEN;
  const ownerEmail = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  const verify = deps.verifyIdToken ?? null;

  if (breakglass && headers.adminToken === breakglass) {
    return { ok: true, ownerUid: "owner", actor: "breakglass", isOwner: true };
  }
  const bearer = headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (bearer && verify) {
    try {
      const t = await verify(bearer);
      const email = (t.email ?? "").trim().toLowerCase();
      const isOwner = t.admin === true || (!!ownerEmail && email === ownerEmail);
      return { ok: true, ownerUid: t.uid, actor: `firebase:${t.uid}`, isOwner };
    } catch (e) {
      // 失敗の理由を握りつぶさない。原因 (期待 aud と実際の食い違い＝プロジェクト ID 不一致、
      // トークン期限切れ等) をログに残し、短い理由も返す (切り分け用)。
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
      const msg = e instanceof Error ? e.message : String(e);
      console.error(JSON.stringify({ event: "verify_id_token_failed", scope: "user", code, detail: msg }));
      return {
        ok: false,
        status: 401,
        error: "unauthorized",
        detail: `サインインを確認できませんでした${code ? ` (${code})` : ""}: ${msg.slice(0, 200)}`,
      };
    }
  }
  // ログイン済み (Bearer あり) なのに検証器が無い = サーバの Firebase 設定漏れ。
  // これも黙って「サインインが必要」にせず、原因が分かる文言にする。
  if (bearer && !verify) {
    console.error(JSON.stringify({ event: "verifier_missing", scope: "user" }));
    return {
      ok: false,
      status: 503,
      error: "unavailable",
      detail: "サーバのサインイン検証が未設定です (FIREBASE_PROJECT_ID)",
    };
  }
  if (!breakglass && !verify) {
    return { ok: false, status: 503, error: "unavailable", detail: "認証が未設定です" };
  }
  return { ok: false, status: 401, error: "unauthorized", detail: "サインインが必要です" };
}

/**
 * firebase-admin による実 verifier。
 * - FIREBASE_SERVICE_ACCOUNT_JSON があれば SA JSON で初期化 (ローカル/どこでも)
 * - 無くても FIREBASE_PROJECT_ID があれば ADC で初期化 (Cloud Run では JSON 不要)
 * - どちらも無ければ null (break-glass 経路のみで運用)
 */
export async function buildFirebaseVerifier(): Promise<VerifyIdTokenFn | null> {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!json && !projectId) return null;
  const { initializeApp, cert, applicationDefault, getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const app =
    getApps()[0] ??
    (json
      ? initializeApp({ credential: cert(JSON.parse(json)) })
      : initializeApp({ credential: applicationDefault(), projectId }));
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
