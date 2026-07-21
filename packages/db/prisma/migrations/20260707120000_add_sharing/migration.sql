-- CreateTable
CREATE TABLE "shared_resources" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "availability" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_shares" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "contact_id" TEXT NOT NULL,
    "resource_id" TEXT,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'offer',
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "share_token" TEXT,
    "response_note" TEXT,
    "responded_at" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shared_resources_owner_uid_status_idx" ON "shared_resources"("owner_uid", "status");

-- CreateIndex
CREATE UNIQUE INDEX "resource_shares_share_token_key" ON "resource_shares"("share_token");

-- CreateIndex
CREATE INDEX "resource_shares_owner_uid_contact_id_status_idx" ON "resource_shares"("owner_uid", "contact_id", "status");

-- AddForeignKey
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "shared_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
