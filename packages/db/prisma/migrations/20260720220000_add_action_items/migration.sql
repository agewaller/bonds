-- 実行待ち (受け入れた提案の在庫)
CREATE TABLE "action_items" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "contact_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "note" TEXT,
    "source_kind" TEXT,
    "source_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "action_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "action_items_owner_uid_source_kind_source_key_key" ON "action_items"("owner_uid", "source_kind", "source_key");
CREATE INDEX "action_items_owner_uid_status_idx" ON "action_items"("owner_uid", "status");
