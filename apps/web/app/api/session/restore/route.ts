// セッション復元 — クライアントのログイン状態 (IndexedDB) が消えていても、
// サーバ Cookie が生きていればカスタムトークンで静かにサインインし直す。
// 復元のたびに Cookie の寿命も延ばす (来訪し続ける限りログインが切れない)。
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  restoreFromSessionCookie,
  sessionCookieAttributes,
} from "../../../../lib/server-session";

export async function POST(req: NextRequest): Promise<Response> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return Response.json({ ok: false }, { status: 401 });
  const restored = await restoreFromSessionCookie(cookie);
  if (!restored) {
    // 無効 Cookie は掃除する (壊れた状態を残さない)
    return new Response(JSON.stringify({ ok: false }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${SESSION_COOKIE}=; ${sessionCookieAttributes(0)}`,
      },
    });
  }
  return Response.json({ ok: true, customToken: restored.customToken });
}
