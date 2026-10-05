-- 収録ルームの入室の締め切り（#166）。true の間は新しいゲストを入れない（入室済みの人の入り直しは通す）。
ALTER TABLE recording_sessions
  ADD COLUMN IF NOT EXISTS entry_locked BOOLEAN NOT NULL DEFAULT false;
