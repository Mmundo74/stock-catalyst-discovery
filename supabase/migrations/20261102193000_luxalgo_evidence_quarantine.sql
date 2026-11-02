-- Preserve source records that cannot enter the catalyst event table because
-- their provider snapshot has no trustworthy event timestamp. No timestamp is
-- invented; the native LuxAlgo row and this original_payload remain durable.
CREATE TABLE IF NOT EXISTS catalyst_acceptance.evidence_quarantine (
  quarantine_key text PRIMARY KEY CHECK (quarantine_key ~ '^[0-9a-f]{64}$'),
  engine text NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  original_name text NOT NULL,
  source_url text NOT NULL,
  observed_at timestamptz NOT NULL,
  original_payload jsonb NOT NULL,
  failure_reason text NOT NULL,
  retry_status text NOT NULL DEFAULT 'pending_reprocess'
    CHECK (retry_status IN ('pending_reprocess', 'reprocessed', 'permanent')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_attempt_run text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_quarantine_retry_idx
  ON catalyst_acceptance.evidence_quarantine (retry_status, last_seen_at);

ALTER TABLE catalyst_acceptance.evidence_quarantine ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catalyst_acceptance.evidence_quarantine FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE catalyst_acceptance.evidence_quarantine TO scd_luxalgo_acceptance;

DROP POLICY IF EXISTS scd_luxalgo_acceptance_evidence_quarantine_select ON catalyst_acceptance.evidence_quarantine;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_evidence_quarantine_insert ON catalyst_acceptance.evidence_quarantine;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_evidence_quarantine_update ON catalyst_acceptance.evidence_quarantine;
CREATE POLICY scd_luxalgo_acceptance_evidence_quarantine_select ON catalyst_acceptance.evidence_quarantine
  FOR SELECT TO scd_luxalgo_acceptance USING (true);
CREATE POLICY scd_luxalgo_acceptance_evidence_quarantine_insert ON catalyst_acceptance.evidence_quarantine
  FOR INSERT TO scd_luxalgo_acceptance WITH CHECK (true);
CREATE POLICY scd_luxalgo_acceptance_evidence_quarantine_update ON catalyst_acceptance.evidence_quarantine
  FOR UPDATE TO scd_luxalgo_acceptance USING (true) WITH CHECK (true);
