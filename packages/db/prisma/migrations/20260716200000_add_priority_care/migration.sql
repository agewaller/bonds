-- 関係性強化のプライオリティと自動ケア。
-- contacts.source_hits: 取込・名寄せで同じ方に行き当たった延べ回数 (くり返し登場 = 重要の弱いシグナル)。
-- contacts.focus_preference: 優先リストへのユーザーの意思 (pinned / excluded。null = 自動判定)。
-- care_suggestions: 優先度に基づく「あなたへの提案」の受け箱 (本文はアプリ層暗号化)。

ALTER TABLE "contacts" ADD COLUMN "source_hits" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "contacts" ADD COLUMN "focus_preference" TEXT;

CREATE TABLE "care_suggestions" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "care_suggestions_owner_uid_status_idx" ON "care_suggestions"("owner_uid", "status");
CREATE INDEX "care_suggestions_contact_id_kind_status_idx" ON "care_suggestions"("contact_id", "kind", "status");
