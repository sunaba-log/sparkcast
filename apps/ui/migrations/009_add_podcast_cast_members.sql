-- 番組の登場人物（#166）。文字起こしの話者推定と議事録で使う。
-- 読点・カンマ・改行区切り。以前はプロンプトに「小野、数森、高島」と直書きしていたので、
-- 元の番組（podcast_id = 1）にはその値を入れて挙動を保つ。
ALTER TABLE podcasts
  ADD COLUMN IF NOT EXISTS cast_members TEXT;

UPDATE podcasts
SET cast_members = '小野、数森、高島'
WHERE podcast_id = 1 AND cast_members IS NULL;
