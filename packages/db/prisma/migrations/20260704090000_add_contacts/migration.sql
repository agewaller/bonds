-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "name" TEXT NOT NULL,
    "furigana" TEXT,
    "distance" INTEGER NOT NULL DEFAULT 4,
    "relationship" TEXT NOT NULL DEFAULT 'other',
    "birthday" TIMESTAMP(3),
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "company" TEXT,
    "title" TEXT,
    "sns" TEXT,
    "personal_profile" TEXT,
    "social_position" TEXT,
    "values_profile" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "state" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_interactions" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quality" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_gifts" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "item" TEXT NOT NULL,
    "amount" INTEGER,
    "notes" TEXT,
    "given_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_groups" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "group_name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "members" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_owner_uid_state_idx" ON "contacts"("owner_uid", "state");

-- CreateIndex
CREATE INDEX "contact_interactions_contact_id_occurred_at_idx" ON "contact_interactions"("contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "contact_gifts_contact_id_idx" ON "contact_gifts"("contact_id");

-- CreateIndex
CREATE INDEX "contact_groups_owner_uid_idx" ON "contact_groups"("owner_uid");

-- AddForeignKey
ALTER TABLE "contact_interactions" ADD CONSTRAINT "contact_interactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_gifts" ADD CONSTRAINT "contact_gifts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

