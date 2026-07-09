CREATE TABLE "exchanges" (
  "id" TEXT NOT NULL,
  "owner_uid" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'gift',
  "direction" TEXT NOT NULL DEFAULT 'outbound',
  "title" TEXT NOT NULL,
  "value" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'open',
  "due_at" TIMESTAMP(3),
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "prev_hash" TEXT,
  "hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exchanges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "exchanges_owner_uid_status_idx" ON "exchanges" ("owner_uid", "status");
CREATE INDEX "exchanges_contact_id_idx" ON "exchanges" ("contact_id");
CREATE INDEX "exchanges_owner_uid_created_at_idx" ON "exchanges" ("owner_uid", "created_at");
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
