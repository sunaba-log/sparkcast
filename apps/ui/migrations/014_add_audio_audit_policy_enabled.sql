-- Program-level audio audit enabled toggle option (#217).
ALTER TABLE podcasts
  ALTER COLUMN audio_audit_policy SET DEFAULT
    '{"version":"v1","enabled":true,"confidential_terms":[],"allowed_terms":[]}'::jsonb;

UPDATE podcasts
SET audio_audit_policy = audio_audit_policy || '{"enabled": true}'::jsonb
WHERE NOT (audio_audit_policy ? 'enabled');
