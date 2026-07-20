-- 公人評価の下ごしらえ (保留・候補) と、SNS 候補 (未確認) の仮登録
CREATE TABLE "dd_suggestions" (
  "id" TEXT NOT NULL,
  "owner_uid" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "candidates" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "subject_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dd_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dd_suggestions_owner_uid_contact_id_key" ON "dd_suggestions"("owner_uid", "contact_id");
CREATE INDEX "dd_suggestions_owner_uid_status_idx" ON "dd_suggestions"("owner_uid", "status");

ALTER TABLE "contacts" ADD COLUMN "sns_candidates" TEXT;
