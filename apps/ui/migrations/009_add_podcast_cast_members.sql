-- 番組の登場人物（#166）。文字起こしの話者推定と議事録で使う。
-- 読点・カンマ・改行区切り。番組設定の画面で番組ごとに登録する（初期値は入れない）。
ALTER TABLE podcasts
  ADD COLUMN IF NOT EXISTS cast_members TEXT;
