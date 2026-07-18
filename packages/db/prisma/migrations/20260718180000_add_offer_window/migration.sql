-- 出品ごとの受付枠 (曜日+時間帯)。null = 空き時間全体を使う (従来どおり)
ALTER TABLE "time_offers" ADD COLUMN "availability_window" TEXT;
