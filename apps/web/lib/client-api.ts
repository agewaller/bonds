"use client";
// BFF 呼び出しの共通ヘルパ。サインイン済みなら Firebase ID トークンを付けて送る
// (BFF がそのまま API へ転送し、API 側で uid スコープに解決される)。
// 未サインインでも送る — Firebase 未設定のローカル開発では BFF が開発用
// フォールバック (break-glass) を付けるため、そのまま動く。
import { currentIdToken } from "./firebase";

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await currentIdToken().catch(() => null);
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`/api/bff/${path.replace(/^\//, "")}`, { ...init, headers });
}
