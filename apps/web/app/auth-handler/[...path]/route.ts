// Firebase 認証ハンドラの第一者プロキシ。
// signInWithRedirect は既定だと <project>.firebaseapp.com (第三者ドメイン) を経由し、
// Safari 等のストレージ分離で静かに失敗する (cares で実際に起きた障害)。
// このルートで /__/auth/* を自オリジンに載せ、NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN を
// アプリ自身のドメインにすることで、認証フロー全体が第一者になり redirect が安定する。
// (Firebase 公式のベストプラクティス「Proxy auth requests」を Next.js で実装したもの)
import type { NextRequest } from "next/server";

function upstreamBase(): string | null {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  return project ? `https://${project}.firebaseapp.com` : null;
}

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const base = upstreamBase();
  if (!base) return new Response("auth handler not configured", { status: 503 });
  const url = new URL(`/__/auth/${path.join("/")}`, base);
  url.search = req.nextUrl.search;
  const res = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/x-www-form-urlencoded",
      // 上流が Host を見るため明示しない (fetch が正しい Host を付ける)
    },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    redirect: "manual",
    cache: "no-store",
  });
  const headers = new Headers();
  for (const key of ["content-type", "cache-control", "location"]) {
    const v = res.headers.get(key);
    if (v) headers.set(key, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
