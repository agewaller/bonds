import { defineConfig } from "vitest/config";

// ルートの vitest 設定。cares を踏襲した 2 プロジェクト構成:
//   unit-node   … api / packages の純粋ロジック (node env, 外部依存なし)
//   integration … api ルートを app.request() で叩く (node env + 実テスト DB)
//
// 実行例:
//   pnpm test:unit          → unit-node (DB 不要)
//   pnpm test:integration   → integration (要: bonds-db 起動 + bonds_test migrate)
export default defineConfig({
  test: {
    // フェーズ0 では integration にまだテストが無いため、空でも赤にしない。
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit-node",
          environment: "node",
          include: [
            "apps/api/tests/unit/**/*.test.ts",
            "packages/**/tests/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["apps/api/tests/integration/**/*.test.ts"],
          fileParallelism: false,
          pool: "forks",
          env: {
            NODE_ENV: "test",
            DATABASE_URL:
              process.env.TEST_DATABASE_URL ??
              "postgresql://bonds:bonds@localhost:5432/bonds_test",
            ALLOWED_ORIGINS: "http://localhost:3000",
            DATA_ENCRYPTION_KEY:
              "4e107972818fcee63f3c91de6ed6f7143edab3f4169bcfe9abc95034c5e1996f",
          },
          testTimeout: 20000,
        },
      },
    ],
  },
});
