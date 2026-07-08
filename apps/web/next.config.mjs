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
};
export default nextConfig;
