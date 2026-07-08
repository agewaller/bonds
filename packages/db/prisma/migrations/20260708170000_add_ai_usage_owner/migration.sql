-- 利用者ごとの月次コスト上限のため、AI 使用ログに利用者を記録する
ALTER TABLE "ai_usage_logs" ADD COLUMN "owner_uid" TEXT;
CREATE INDEX "ai_usage_logs_owner_uid_created_at_idx" ON "ai_usage_logs" ("owner_uid", "created_at");
