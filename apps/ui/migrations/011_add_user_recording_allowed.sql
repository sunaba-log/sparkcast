-- 収録ルームを使えるユーザー（#174）。admin は常に使える。それ以外は管理画面で許可したユーザーだけ。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recording_allowed BOOLEAN NOT NULL DEFAULT false;
