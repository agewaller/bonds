-- 同姓同名の特定メモ。評価前にユーザーが「どの人物か」を選んだ結果を保持し、
-- 評価プロンプトに接地して別人との混同を防ぐ。
ALTER TABLE "dd_subjects" ADD COLUMN "profile_hint" TEXT;
