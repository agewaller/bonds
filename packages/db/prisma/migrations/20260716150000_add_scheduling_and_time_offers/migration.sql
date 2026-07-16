-- 日程調整と時間の出品 (timeshare の概念を新規実装)。
-- availability_settings: 空き時間の設定 (曜日別時間窓・余白・最低時間)。秘密情報でないため平文。
-- schedule_shares / schedule_share_proposals: 共有リンク日程調整。相手 (第三者) の PII はアプリ層暗号化。
-- time_offers / time_bookings: 時間の出品と予約 (Stripe 決済は BMP-LP 方式)。

CREATE TABLE "availability_settings" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL,
    "days" JSONB NOT NULL,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "min_minutes" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "availability_settings_owner_uid_key" ON "availability_settings"("owner_uid");

CREATE TABLE "schedule_shares" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "contact_id" TEXT,
    "share_key" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "display_name" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'meeting',
    "note" TEXT NOT NULL DEFAULT '',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "slot_minutes" INTEGER NOT NULL DEFAULT 60,
    "password_hash" TEXT,
    "expires_at" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_shares_share_key_key" ON "schedule_shares"("share_key");
CREATE INDEX "schedule_shares_owner_uid_state_idx" ON "schedule_shares"("owner_uid", "state");

CREATE TABLE "schedule_share_proposals" (
    "id" TEXT NOT NULL,
    "share_id" TEXT NOT NULL,
    "guest_name" TEXT NOT NULL,
    "guest_contact" TEXT,
    "message" TEXT,
    "candidates" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decided_slot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_share_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedule_share_proposals_share_id_status_idx" ON "schedule_share_proposals"("share_id", "status");

ALTER TABLE "schedule_share_proposals" ADD CONSTRAINT "schedule_share_proposals_share_id_fkey"
    FOREIGN KEY ("share_id") REFERENCES "schedule_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "time_offers" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "offer_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "display_name" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'online',
    "minutes" INTEGER NOT NULL DEFAULT 60,
    "price_jpy" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_offers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "time_offers_offer_key_key" ON "time_offers"("offer_key");
CREATE INDEX "time_offers_owner_uid_active_idx" ON "time_offers"("owner_uid", "active");

CREATE TABLE "time_bookings" (
    "id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL,
    "guest_name" TEXT NOT NULL,
    "guest_contact" TEXT,
    "message" TEXT,
    "slot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "amount_jpy" INTEGER NOT NULL,
    "stripe_session_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_bookings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "time_bookings_stripe_session_id_key" ON "time_bookings"("stripe_session_id");
CREATE INDEX "time_bookings_owner_uid_status_idx" ON "time_bookings"("owner_uid", "status");
CREATE INDEX "time_bookings_offer_id_status_idx" ON "time_bookings"("offer_id", "status");

ALTER TABLE "time_bookings" ADD CONSTRAINT "time_bookings_offer_id_fkey"
    FOREIGN KEY ("offer_id") REFERENCES "time_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
