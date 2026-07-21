-- 録音メモの経路 (gmail/zentrack) と本文ハッシュ。経路が違っても同じ文字起こしは一度だけ取り込む
ALTER TABLE "voice_memos" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'gmail';
ALTER TABLE "voice_memos" ADD COLUMN "content_hash" TEXT;
CREATE UNIQUE INDEX "voice_memos_owner_uid_content_hash_key" ON "voice_memos"("owner_uid", "content_hash");
