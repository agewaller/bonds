// bonds API サーバ起動 (Node)。ルート定義は app.ts。
import { serve } from "@hono/node-server";
import { createPrismaClient } from "@bonds/db";
import { createApp } from "./app.js";
import { seedDdPrompts } from "./dd/seed-prompts.js";
import { buildFirebaseVerifier } from "./lib/auth.js";
import { buildDatabaseUrl } from "./lib/db-url.js";

// Cloud Run では SQL_CONN + DB_PASSWORD (Secret) から DATABASE_URL を組み立てる
if (!process.env.DATABASE_URL) {
  const url = buildDatabaseUrl(process.env);
  if (url) process.env.DATABASE_URL = url;
}

const prisma = createPrismaClient();
// Firebase 検証は FIREBASE_SERVICE_ACCOUNT_JSON があるときだけ有効
// (無い環境でも break-glass トークン経路で管理操作できる = 三段フェイルセーフ)。
const verifyIdToken = await buildFirebaseVerifier().catch((err) => {
  console.error(
    JSON.stringify({
      event: "firebase_init_failed",
      detail: err instanceof Error ? err.message : String(err),
    }),
  );
  return null;
});
const app = createApp({ prisma, verifyIdToken });
const port = Number(process.env.PORT ?? 8080);

// DB 駆動プロンプトの冪等 seed (person_eval_7d / person_eval_svc)。
// DB 未起動でもサーバ自体は上がるようにし、失敗はログに残す。
seedDdPrompts(prisma)
  .then((created) => {
    if (created.length > 0) {
      console.log(JSON.stringify({ event: "prompt_seeded", keys: created }));
    }
  })
  .catch((err) => {
    console.error(
      JSON.stringify({
        event: "prompt_seed_failed",
        detail: err instanceof Error ? err.message : String(err),
      }),
    );
  });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bonds api listening on :${info.port}`);
});
