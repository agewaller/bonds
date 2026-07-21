// セッション Cookie の発行/破棄。ログイン成功時にクライアントが idToken を渡し、
// サーバが httpOnly Cookie (14日) を設定する。サインアウトで破棄。
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  createSessionCookieValue,
  sessionCookieAttributes,
} from "../../../lib/server-session";

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}) as { idToken?: string });
  const idToken = typeof body.idToken === "string" ? body.idToken : "";
  if (!idToken) return Response.json({ error: "id_token_required" }, { status: 400 });
  const value = await createSessionCookieValue(idToken);
  if (!value) return Response.json({ ok: false, reason: "unconfigured" }, { status: 200 });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${SESSION_COOKIE}=${value}; ${sessionCookieAttributes(SESSION_DAYS * 24 * 60 * 60)}`,
    },
  });
}

export async function DELETE(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${SESSION_COOKIE}=; ${sessionCookieAttributes(0)}`,
    },
  });
}
