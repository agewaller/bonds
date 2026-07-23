-- 出力履歴 (something new の構造化・AI-LEVERAGE-DESIGN.md):
-- 生成のたびに出した提案の要旨を残し、次の生成に「既出リスト」として渡して重複を防ぐ。
-- summary はアプリ層で暗号化する (相手に関する評価・示唆そのもののため)。
CREATE TABLE "output_history" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "contact_id" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "output_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "output_history_owner_uid_contact_id_kind_created_at_idx" ON "output_history"("owner_uid", "contact_id", "kind", "created_at");
