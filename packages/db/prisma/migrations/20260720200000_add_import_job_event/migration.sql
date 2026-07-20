-- パーティ・イベント取込: 取り込みジョブにイベント文脈 (どこで・いつ出会ったか) を添える
ALTER TABLE "import_jobs" ADD COLUMN "event_name" TEXT;
ALTER TABLE "import_jobs" ADD COLUMN "event_date" TEXT;
