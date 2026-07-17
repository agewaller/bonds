-- 共有リンクの参加者 (timeshare の FreeTimeShareUser の概念を新規実装)。
-- 同じ URL に入った相手が自分の予定表を重ねると、全員の共通の空き時間だけが表示される。
-- 名乗り・ICS URL はアプリ層暗号化。busy は枠 (時刻) のみで予定の中身は保存しない。

CREATE TABLE "schedule_share_participants" (
    "id" TEXT NOT NULL,
    "share_id" TEXT NOT NULL,
    "participant_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ics_url" TEXT,
    "busy_slots" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_share_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_share_participants_participant_key_key" ON "schedule_share_participants"("participant_key");
CREATE INDEX "schedule_share_participants_share_id_idx" ON "schedule_share_participants"("share_id");

ALTER TABLE "schedule_share_participants" ADD CONSTRAINT "schedule_share_participants_share_id_fkey"
    FOREIGN KEY ("share_id") REFERENCES "schedule_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;
