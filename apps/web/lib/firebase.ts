"use client";
// Firebase Auth (GCP Identity Platform) — cares と同じプロジェクトを共用する。
// 設定は NEXT_PUBLIC_FIREBASE_* (public 扱いで問題ない値のみ)。未設定なら
// ログイン機能は出さず、BFF の開発用フォールバック (break-glass) で動く。
//
// ログイン持続の設計 (docs/login-reliability.md):
//   1. ログイン成功時に idToken を /api/session へ渡し、サーバが httpOnly Cookie (14日) を設定
//   2. ブラウザ側の状態 (IndexedDB) が消えていたら (Safari の7日削除など)、
//      /api/session/restore の Cookie からカスタムトークンで静かにサインインし直す
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCustomToken,
  indexedDBLocalPersistence,
  setPersistence,
  onAuthStateChanged,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

export function firebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId);
}

let app: FirebaseApp | null = null;
let persistenceSet = false;
export function firebaseAuth(): Auth | null {
  if (!firebaseConfigured()) return null;
  if (!app) app = getApps()[0] ?? initializeApp(config);
  return getAuth(app);
}

// PII をブラウザに置かない原則に沿い IndexedDB 永続化を使う (cares と同じ)。
// サインイン前に必ず設定する — さもないと再読み込みでセッションが復元されない。
async function ensurePersistence(auth: Auth) {
  if (persistenceSet) return;
  try {
    await setPersistence(auth, indexedDBLocalPersistence);
    persistenceSet = true;
  } catch (err) {
    console.warn("setPersistence failed; falling back to default", err);
  }
}

// popup が使えない環境 (モバイルの WebView・アプリ内ブラウザ等) を表すエラーコード。
// これらは「利用者が閉じた」のではなく「環境が popup を許さない」ので、画面遷移方式
// (signInWithRedirect) へ自動フォールバックする (cares の鉄則)。
const POPUP_UNAVAILABLE_CODES = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-environment",
  "auth/cancelled-popup-request",
  "auth/web-storage-unsupported",
  "auth/popup-closed-by-user",
]);

function errCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
}

// ── サーバセッションとの同期 (docs/login-reliability.md) ──

let sessionSynced = false;

/** ログイン成功後にサーバへセッション Cookie を発行させる (失敗しても致命ではない)。 */
async function syncServerSession(user: User): Promise<void> {
  if (sessionSynced) return;
  try {
    const idToken = await user.getIdToken();
    await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    sessionSynced = true;
  } catch {
    // ネットワーク断など。次のログイン/復元で再試行される
  }
}

let restoreAttempt: Promise<boolean> | null = null;

/**
 * クライアントにログイン状態が無いとき、サーバ Cookie から静かに復元する。
 * 一度だけ試行 (メモ化)。復元できたら true。
 */
export function restoreSession(): Promise<boolean> {
  if (restoreAttempt) return restoreAttempt;
  restoreAttempt = (async () => {
    const auth = firebaseAuth();
    if (!auth) return false;
    await auth.authStateReady();
    if (auth.currentUser) return true;
    try {
      const res = await fetch("/api/session/restore", { method: "POST" });
      if (!res.ok) return false;
      const body = (await res.json()) as { customToken?: string };
      if (!body.customToken) return false;
      await signInWithCustomToken(auth, body.customToken);
      return true;
    } catch {
      return false;
    }
  })();
  return restoreAttempt;
}

/**
 * Google でサインイン。まず popup を試し、popup が塞がれている環境 (多くのスマホ) では
 * 画面遷移方式 (redirect) へ自動フォールバックする。redirect に切り替えた場合はページが
 * 遷移するのでここでは戻らない。戻ってきた後は completeGoogleRedirect が拾う。
 * 返り値: popup で成立したら true、redirect に切り替えたら false (遷移する)。
 */
export async function signInWithGoogle(): Promise<boolean> {
  const auth = firebaseAuth();
  if (!auth) throw new Error("firebase_not_configured");
  await ensurePersistence(auth);
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    return true;
  } catch (e) {
    if (POPUP_UNAVAILABLE_CODES.has(errCode(e))) {
      await signInWithRedirect(auth, provider); // ここでページが遷移する
      return false;
    }
    throw e;
  }
}

/**
 * 画面遷移方式の Google ログインから戻ってきた直後に呼ぶ。ログインが成立していれば
 * その User を、そうでなければ (通常の初回表示など) null を返す。これを呼ばないと
 * スマホの redirect ログインが完了扱いにならない (今回のスマホ不具合の根因)。
 * 失敗したときは errorCode を返す (原因を握りつぶさず画面に出せるように)。
 * 例: auth/unauthorized-domain = この画面のドメインが Firebase の承認済みドメイン未登録。
 */
export async function completeGoogleRedirect(): Promise<{ user: User | null; errorCode?: string }> {
  const auth = firebaseAuth();
  if (!auth) return { user: null };
  await ensurePersistence(auth);
  try {
    const result = await getRedirectResult(auth);
    return { user: result?.user ?? null };
  } catch (e) {
    return { user: null, errorCode: errCode(e) || "unknown" };
  }
}

/** Firebase の auth エラーコードを人にわかる日本語に直す (未知はコードをそのまま添える)。 */
export function authErrorMessage(code: string): string {
  switch (code) {
    case "auth/unauthorized-domain":
      return "この画面のアドレスがサインインを許可されていません（管理者がドメインを承認すると直ります）。";
    case "auth/popup-blocked":
    case "auth/operation-not-supported-in-environment":
      return "この環境ではうまく開けませんでした。別のブラウザでお試しください。";
    case "auth/network-request-failed":
      return "通信が不安定なようです。電波の良い場所でもう一度お試しください。";
    default:
      return `サインインを完了できませんでした（${code}）。もう一度お試しください。`;
  }
}

export async function signOutUser(): Promise<void> {
  const auth = firebaseAuth();
  if (auth) await signOut(auth);
  sessionSynced = false;
  try {
    await fetch("/api/session", { method: "DELETE" });
  } catch {
    // Cookie 破棄失敗は無害 (期限で消える)
  }
}

export function watchUser(cb: (user: User | null) => void): () => void {
  const auth = firebaseAuth();
  if (!auth) {
    cb(null);
    return () => {};
  }
  void ensurePersistence(auth);
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      void syncServerSession(user); // redirect 復帰・popup 成功のどちらもここを通る
    } else {
      void restoreSession(); // 消えたクライアント状態を Cookie から復元 (成功すれば再度発火)
    }
    cb(user);
  });
}

/** 現在のユーザーの ID トークン (未ログイン/未設定なら null)。 */
export async function currentIdToken(): Promise<string | null> {
  const auth = firebaseAuth();
  if (!auth) return null;
  if (!auth.currentUser) await restoreSession();
  const user = auth.currentUser;
  return user ? user.getIdToken() : null;
}
