-- Add lease-based worker claims only to the isolated acceptance outbox.
-- Existing pending rows and idempotency keys are preserved.
ALTER TABLE catalyst_acceptance.notification_outbox
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE catalyst_acceptance.notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_state_check;

ALTER TABLE catalyst_acceptance.notification_outbox
  ADD CONSTRAINT notification_outbox_state_check
  CHECK (state IN ('pending', 'processing', 'sent', 'failed'));

ALTER TABLE catalyst_acceptance.notification_outbox
  ADD CONSTRAINT notification_outbox_claim_shape_check
  CHECK (
    (state = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
  );

ALTER TABLE catalyst_acceptance.notification_outbox
  ADD CONSTRAINT notification_outbox_sent_timestamp_check
  CHECK (state <> 'sent' OR delivered_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS notification_outbox_pending_created_idx
  ON catalyst_acceptance.notification_outbox (created_at, idempotency_key)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS notification_outbox_expired_lease_idx
  ON catalyst_acceptance.notification_outbox (lease_expires_at, idempotency_key)
  WHERE state = 'processing';
