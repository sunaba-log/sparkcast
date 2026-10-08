-- Program-level custom confidential terms and allowlist for the Jev audio audit.
ALTER TABLE podcasts
  ADD COLUMN IF NOT EXISTS audio_audit_policy JSONB NOT NULL DEFAULT
    '{"version":"v1","confidential_terms":[],"allowed_terms":[]}'::jsonb;
