"use client";
// Firebase Auth (GCP Identity Platform) — cares と同じプロジェクトを共用する。
// 設定は NEXT_PUBLIC_FIREBASE_* (public 扱いで問題ない値のみ)。未設定なら
// ログイン機能は出さず、BFF の開発用フォールバック (break-glass) で動く。
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
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
 */
export async function completeGoogleRedirect(): Promise<User | null> {
  const auth = firebaseAuth();
  if (!auth) return null;
  await ensurePersistence(auth);
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch {
    return null; // 取得できない/エラーは未ログイン扱い
  }
}

export async function signOutUser(): Promise<void> {
  const auth = firebaseAuth();
  if (auth) await signOut(auth);
}

export function watchUser(cb: (user: User | null) => void): () => void {
  const auth = firebaseAuth();
  if (!auth) {
    cb(null);
    return () => {};
  }
  void ensurePersistence(auth);
  return onAuthStateChanged(auth, cb);
}

/** 現在のユーザーの ID トークン (未ログイン/未設定なら null)。 */
export async function currentIdToken(): Promise<string | null> {
  const auth = firebaseAuth();
  const user = auth?.currentUser;
  return user ? user.getIdToken() : null;
}
