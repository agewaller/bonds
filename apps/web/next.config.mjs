/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 本番イメージは standalone 出力を node server.js で起動する (cares 方式)。
  // モノレポのため出力ルートを workspace root に合わせる。
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // API のベース URL (ブラウザ側)。docker/本番では env で差し替える。
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080",
  },
  // Firebase 認証ハンドラの第一者化 (docs/login-reliability.md §A)。
  // App Router は _ 始まりのフォルダを無視するため、/__/auth/* は rewrite で
  // app/auth-handler/[...path] に載せる (SDK が期待するパスは /__/auth/*)。
  async rewrites() {
    return [{ source: "/__/auth/:path*", destination: "/auth-handler/:path*" }];
  },
};
export default nextConfig;
