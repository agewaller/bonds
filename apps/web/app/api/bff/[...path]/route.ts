// BFF プロキシ — ブラウザは API を直接叩かず、この route handler 経由で呼ぶ。
// 管理トークン (ADMIN_TOKEN) は web サーバ側 env にのみ置き、ブラウザへ出さない
// (鍵・トークンをブラウザに置かない原則)。SSE (text/event-stream) はそのまま素通しする。
import type { NextRequest } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:8080";

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const url = new URL(`/api/${path.join("/")}`, API_BASE);
  url.search = req.nextUrl.search;
  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") ?? "application/json",
  };
  // サインイン済みユーザーの ID トークンはそのまま API へ転送する (uid スコープ)。
  // トークンが無いときだけ開発用フォールバック (break-glass = "owner" スコープ) を付ける。
  const authorization = req.headers.get("authorization");
  if (authorization) {
    headers["authorization"] = authorization;
  } else {
    const adminToken = process.env.ADMIN_TOKEN;
    if (adminToken) headers["x-admin-token"] = adminToken;
  }
  const res = await fetch(url, {
    method: req.method,
    headers,
    // arrayBuffer で転送する (text() だと ZIP 等のバイナリ取込ファイルが壊れる)
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    // Next の fetch キャッシュを無効化 (常に最新)
    cache: "no-store",
  });
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
