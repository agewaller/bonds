// BFF プロキシ — ブラウザは API を直接叩かず、この route handler 経由で呼ぶ。
// サインイン済みユーザーの ID トークンをそのまま API へ転送し、API 側で認可・スコープを
// 解決する。**未サインインのリクエストに管理トークンを付けない** (これを付けていたため、
// URL を知る匿名の第三者がオーナーのデータ・管理機能に到達できていた = 重大な穴)。
// 認証が要る経路は、トークンが無ければ API がそのまま 401 を返す。公開経路 (/api/public/*
// や OAuth callback) は認証不要でそのまま通る。
// ローカル開発で Firebase 未設定のときだけ、明示的に ALLOW_DEV_ADMIN_FALLBACK=1 を
// 立てた場合に限り break-glass を付ける (本番では絶対に立てない)。
import type { NextRequest } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:8080";

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const url = new URL(`/api/${path.join("/")}`, API_BASE);
  url.search = req.nextUrl.search;
  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") ?? "application/json",
  };
  const authorization = req.headers.get("authorization");
  if (authorization) {
    headers["authorization"] = authorization;
  } else if (process.env.ALLOW_DEV_ADMIN_FALLBACK === "1" && process.env.ADMIN_TOKEN) {
    // ローカル開発専用の非常口 (本番では未設定 = 付かない)。
    headers["x-admin-token"] = process.env.ADMIN_TOKEN;
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
