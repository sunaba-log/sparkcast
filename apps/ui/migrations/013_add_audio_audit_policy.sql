-- Program-level custom confidential terms and allowlist for the Jev audio audit.
ALTER TABLE podcasts
  ADD COLUMN IF NOT EXISTS audio_audit_policy JSONB NOT NULL DEFAULT
    '{"version":"v1","confidential_terms":[],"allowed_terms":[]}'::jsonb;

ALTER TABLE episodes
  DROP CONSTRAINT IF EXISTS episodes_status_valid;

ALTER TABLE episodes
  ADD CONSTRAINT episodes_status_valid
    CHECK (status IN (
      'upload_pending',
      'uploaded',
      'processing',
      'auditing',
      'awaiting_approval',
      'awaiting_publish_confirmation',
      'editing',
      'completed',
      'failed'
    ));
