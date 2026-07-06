-- CreateTable
CREATE TABLE "person_links" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "contact_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_links_owner_uid_contact_id_idx" ON "person_links"("owner_uid", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_links_owner_uid_contact_id_subject_id_key" ON "person_links"("owner_uid", "contact_id", "subject_id");

