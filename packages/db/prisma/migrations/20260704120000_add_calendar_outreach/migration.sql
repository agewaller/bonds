-- CreateTable
CREATE TABLE "calendar_links" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "contact_id" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "busy_slots" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_messages" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "contact_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "purpose" TEXT NOT NULL DEFAULT 'keepup',
    "subject" TEXT,
    "body" TEXT,
    "candidates" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "error_detail" TEXT,
    "provider_message_id" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_links_owner_uid_contact_id_key" ON "calendar_links"("owner_uid", "contact_id");

-- CreateIndex
CREATE INDEX "outreach_messages_owner_uid_contact_id_status_idx" ON "outreach_messages"("owner_uid", "contact_id", "status");

