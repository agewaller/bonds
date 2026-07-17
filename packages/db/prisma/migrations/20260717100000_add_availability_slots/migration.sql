-- カレンダーをドラッグしてなぞる明示の空き枠 (timeshare の free_times の踏襲)
CREATE TABLE "availability_slots" (
    "id" TEXT NOT NULL,
    "owner_uid" TEXT NOT NULL DEFAULT 'owner',
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "availability_slots_owner_uid_start_at_idx" ON "availability_slots"("owner_uid", "start_at");
