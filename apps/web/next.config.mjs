/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // API のベース URL (ブラウザ側)。docker/本番では env で差し替える。
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080",
  },
};
export default nextConfig;
