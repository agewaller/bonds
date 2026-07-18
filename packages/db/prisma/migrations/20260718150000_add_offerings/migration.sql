-- あなたが提供できること (申し出カタログ)。gift の貢献の概念を bonds 向けに新規実装
CREATE TABLE "offerings" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "situations" TEXT,
    "logistics" TEXT,
    "max_distance" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offerings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "offerings_owner_uid_active_idx" ON "offerings"("owner_uid", "active");
