// bonds API (Hono) — フェーズ0 骨格。
// ルート定義は app.ts に集約し、index.ts はサーバ起動のみ担う
// (テストは app.request() で app を直接叩けるようにするため)。
import { Hono } from "hono";
import { cors } from "hono/cors";

export function createApp() {
  const app = new Hono();

  // CORS: 許可 Origin は env で制御 (cares/DESIGN-HANDOVER.md の Origin 限定方針)。
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    "/api/*",
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  // ヘルスチェック。Cloud Run frontend が /healthz を 404 で intercept する既知挙動を
  // 避けるため /api/healthz を正本とし、/healthz も残す (cares 運用メモに準拠)。
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/api/healthz", (c) => c.json({ status: "ok" }));

  return app;
}

export type AppType = ReturnType<typeof createApp>;
