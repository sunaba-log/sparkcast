-- 'awaiting_publish_confirmation'（29文字）を保存できるよう、episodes.status を広げる。
-- 002 で VARCHAR(20) として作成され、013 で状態を追加したときに長さを変えていなかった。
-- 型の拡張のみで既存の値は変わらない（何度実行しても同じ結果）。
ALTER TABLE episodes
  ALTER COLUMN status TYPE VARCHAR(40);
