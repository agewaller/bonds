-- 関係の目標 (用途・目標距離感・ねらい・設定時距離の JSON)。第三者との関係の意図
-- そのもの (恋活・婚活などの要配慮情報を含みうる) なのでアプリ層暗号化。
ALTER TABLE "contacts" ADD COLUMN "goal" TEXT;
