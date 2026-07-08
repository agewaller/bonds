-- Google 連携 (Calendar / Gmail / Drive 読み取り専用) の接続情報。
-- refresh_token はアプリ層 AES-256-GCM で暗号化して保存する。
CREATE TABLE "google_connections" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL,
    "email" TEXT,
    "refresh_token" TEXT NOT NULL,
    "scopes" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_connections_owner_uid_key" ON "google_connections"("owner_uid");
