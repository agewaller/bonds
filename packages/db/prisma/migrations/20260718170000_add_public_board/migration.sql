-- 公開掲示板 (/market): 申し出・時間の出品を公開に載せるフラグ + 訪問者の問い合わせ

ALTER TABLE "offerings" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "time_offers" ADD COLUMN "listed" BOOLEAN NOT NULL DEFAULT false;

-- アカウント不要の訪問者からの問い合わせ (下書き→承認で新しい連絡先へ)。PII は暗号化列
CREATE TABLE "offering_interests" (
    "id" TEXT NOT NULL,
    "offering_id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL,
    "guest_name" TEXT NOT NULL,
    "guest_contact" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "contact_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offering_interests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "offering_interests_owner_uid_status_idx" ON "offering_interests"("owner_uid", "status");

ALTER TABLE "offering_interests" ADD CONSTRAINT "offering_interests_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
