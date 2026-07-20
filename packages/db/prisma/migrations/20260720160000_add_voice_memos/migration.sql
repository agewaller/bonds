-- 録音メモ (Plaud のメール添付テキスト) のタスクと課題
CREATE TABLE "voice_memos" (
  "id" TEXT NOT NULL,
  "owner_uid" TEXT NOT NULL,
  "gmail_message_id" TEXT NOT NULL,
  "subject" TEXT,
  "received_at" TIMESTAMP(3),
  "content" TEXT NOT NULL,
  "summary" TEXT,
  "tasks" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "voice_memos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "voice_memos_owner_uid_gmail_message_id_key" ON "voice_memos"("owner_uid", "gmail_message_id");
CREATE INDEX "voice_memos_owner_uid_status_idx" ON "voice_memos"("owner_uid", "status");
