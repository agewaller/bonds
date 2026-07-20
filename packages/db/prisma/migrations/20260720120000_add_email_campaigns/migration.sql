-- 一斉配信 (メールのお便り)
CREATE TABLE "email_campaigns" (
  "id" TEXT NOT NULL,
  "owner_uid" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "segment" JSONB NOT NULL,
  "from_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "daily_limit" INTEGER NOT NULL DEFAULT 200,
  "total" INTEGER NOT NULL DEFAULT 0,
  "sent" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_campaigns_owner_uid_status_idx" ON "email_campaigns"("owner_uid", "status");

CREATE TABLE "email_campaign_recipients" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "error" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_campaign_recipients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_campaign_recipients_campaign_id_contact_id_key" ON "email_campaign_recipients"("campaign_id", "contact_id");
CREATE INDEX "email_campaign_recipients_campaign_id_status_idx" ON "email_campaign_recipients"("campaign_id", "status");
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "email_suppressions" (
  "id" TEXT NOT NULL,
  "owner_uid" TEXT NOT NULL,
  "email_hash" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'unsubscribe',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_suppressions_owner_uid_email_hash_key" ON "email_suppressions"("owner_uid", "email_hash");
