-- ブラウザ収録ルーム（#166）。
-- 通話・録音チャンクの台帳は Cloudflare Worker（Durable Object）と R2 が持ち、
-- ここにはセッションの状態遷移・参加者・トラック単位の集計だけを置く。
CREATE TABLE IF NOT EXISTS recording_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id INT NOT NULL REFERENCES podcasts(podcast_id),
  host_user_id VARCHAR(255) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  max_participants INT NOT NULL DEFAULT 6,
  -- サーバー時刻（Durable Object の時計）でのミリ秒。mixer の時間軸の原点になる。
  recording_started_at_ms BIGINT,
  recording_stopped_at_ms BIGINT,
  episode_id INT REFERENCES episodes(episode_id) ON DELETE SET NULL,
  error TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recording_sessions_status_valid
    CHECK (status IN ('waiting', 'recording', 'uploading', 'mixing', 'done', 'failed', 'expired')),
  CONSTRAINT recording_sessions_max_participants_valid
    CHECK (max_participants BETWEEN 2 AND 10)
);

CREATE INDEX IF NOT EXISTS idx_recording_sessions_podcast_created_at
  ON recording_sessions (podcast_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recording_sessions_status_expires_at
  ON recording_sessions (status, expires_at);

CREATE TABLE IF NOT EXISTS recording_participants (
  participant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES recording_sessions(session_id) ON DELETE CASCADE,
  display_name VARCHAR(50) NOT NULL,
  role VARCHAR(10) NOT NULL,
  -- ゲストはアカウントを持たないので NULL
  user_id VARCHAR(255) REFERENCES users(user_id) ON DELETE SET NULL,
  consented_at TIMESTAMPTZ NOT NULL,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recording_participants_role_valid CHECK (role IN ('host', 'guest'))
);

CREATE INDEX IF NOT EXISTS idx_recording_participants_session
  ON recording_participants (session_id, created_at);

-- 1 つのセッションにホストは 1 人（同じユーザーの再入室は同じ行を使う）
CREATE UNIQUE INDEX IF NOT EXISTS uq_recording_participants_host
  ON recording_participants (session_id) WHERE role = 'host';

CREATE TABLE IF NOT EXISTS recording_tracks (
  session_id UUID NOT NULL REFERENCES recording_sessions(session_id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES recording_participants(participant_id) ON DELETE CASCADE,
  -- local: 本人の端末で録った高音質トラック / backup: ホストが受信音声を録った予備
  kind VARCHAR(10) NOT NULL,
  segment_count INT NOT NULL DEFAULT 0,
  chunk_count INT NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  -- mixer が位置合わせした話者別 FLAC（R2 のキー）
  aligned_object_key TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, participant_id, kind),
  CONSTRAINT recording_tracks_kind_valid CHECK (kind IN ('local', 'backup'))
);
