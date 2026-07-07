-- 提携先 (成長アウトリーチ) — cares ADR-0022 の移植。
-- 候補の発見 → 個別連絡文の下書き → 承認送信 → 返信 → 提携 (公開ディレクトリ) のファネル。
CREATE TABLE "partner_targets" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "name" TEXT NOT NULL,
    "url" TEXT,
    "handle" TEXT,
    "contact_email" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "notes" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "blurb" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "last_contacted_at" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_targets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_messages" (
    "id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "channel" TEXT NOT NULL DEFAULT 'email',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "provider_message_id" TEXT,
    "error_detail" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partner_targets_status_kind_idx" ON "partner_targets"("status", "kind");
CREATE INDEX "partner_targets_is_public_display_order_idx" ON "partner_targets"("is_public", "display_order");
CREATE INDEX "partner_messages_target_id_created_at_idx" ON "partner_messages"("target_id", "created_at");
CREATE INDEX "partner_messages_status_idx" ON "partner_messages"("status");

ALTER TABLE "partner_messages" ADD CONSTRAINT "partner_messages_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "partner_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
