-- デバイス連携 (Oura/Withings 等) の共通取り込み基盤: 接続 + 日次健康データ
CREATE TABLE "device_connections" (
  "id" TEXT NOT NULL,
  "owner_uid" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "refresh_token" TEXT NOT NULL,
  "access_token" TEXT,
  "external_user_id" TEXT,
  "scopes" TEXT,
  "last_sync_at" TIMESTAMP(3),
  "last_sync_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "device_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "device_connections_owner_uid_provider_key" ON "device_connections"("owner_uid", "provider");

CREATE TABLE "health_metrics" (
  "id" TEXT NOT NULL,
  "owner_uid" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "payload" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "health_metrics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "health_metrics_owner_uid_provider_kind_day_key" ON "health_metrics"("owner_uid", "provider", "kind", "day");
CREATE INDEX "health_metrics_owner_uid_day_idx" ON "health_metrics"("owner_uid", "day");
