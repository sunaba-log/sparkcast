-- エピソード番号を一度だけ採番して保存する（公開時の件数から毎回計算すると重複していた）。
-- 既存行はタイトル先頭の「#番号 」から補完する。番号の採番はアプリが番組単位のロック内で行う。
ALTER TABLE episodes
  ADD COLUMN IF NOT EXISTS episode_number INT;

UPDATE episodes
SET episode_number = (regexp_match(title, '^#(\d+)\s'))[1]::int
WHERE episode_number IS NULL
  AND title ~ '^#\d+\s';

CREATE INDEX IF NOT EXISTS idx_episodes_podcast_episode_number
  ON episodes (podcast_id, episode_number);
