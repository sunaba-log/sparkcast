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
      'editing',
      'completed',
      'failed'
    ));
