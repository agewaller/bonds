-- 提案の見送り (✖️)。消した提案を記録して再表示しない (記録そのものは消さない)
CREATE TABLE "suggestion_dismissals" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestion_dismissals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suggestion_dismissals_owner_uid_kind_key_key" ON "suggestion_dismissals"("owner_uid", "kind", "key");
