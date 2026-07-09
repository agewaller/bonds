CREATE TABLE "import_jobs" (
  "id" TEXT NOT NULL,
  "owner_uid" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "filename" TEXT,
  "payload" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'ja',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "imported" INTEGER NOT NULL DEFAULT 0,
  "enriched" INTEGER NOT NULL DEFAULT 0,
  "interactions_added" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "import_jobs_owner_uid_status_idx" ON "import_jobs" ("owner_uid", "status");
CREATE INDEX "import_jobs_owner_uid_created_at_idx" ON "import_jobs" ("owner_uid", "created_at");
