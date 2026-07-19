-- 取り込む/表示する Google カレンダーの id 配列。null = primary のみ (従来どおり)
ALTER TABLE "google_connections" ADD COLUMN "sync_calendar_ids" JSONB;
