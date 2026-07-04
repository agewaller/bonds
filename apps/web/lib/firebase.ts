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
export function firebaseAuth(): Auth | null {
  if (!firebaseConfigured()) return null;
  if (!app) app = getApps()[0] ?? initializeApp(config);
  return getAuth(app);
}

/** Google でサインイン。モバイルは popup がブロックされるため redirect を使う (cares の鉄則)。 */
export async function signInWithGoogle(): Promise<void> {
  const auth = firebaseAuth();
  if (!auth) throw new Error("firebase_not_configured");
  const provider = new GoogleAuthProvider();
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  if (isMobile) {
    await signInWithRedirect(auth, provider);
  } else {
    await signInWithPopup(auth, provider);
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
  return onAuthStateChanged(auth, cb);
}

/** 現在のユーザーの ID トークン (未ログイン/未設定なら null)。 */
export async function currentIdToken(): Promise<string | null> {
  const auth = firebaseAuth();
  const user = auth?.currentUser;
  return user ? user.getIdToken() : null;
}
