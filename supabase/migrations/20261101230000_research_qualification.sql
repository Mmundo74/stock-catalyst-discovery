CREATE TABLE IF NOT EXISTS catalyst_acceptance.research_qualifications (
  qualification_key text PRIMARY KEY,
  engine text NOT NULL CHECK (engine IN ('government','news','market')),
  source text NOT NULL,
  source_event_id text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  stage text NOT NULL CHECK (stage IN ('raw_discovery','research_qualified','alert_eligible')),
  alert_eligible boolean NOT NULL DEFAULT false,
  issuer_resolution jsonb NOT NULL,
  parent_relationship jsonb NOT NULL DEFAULT '{"status":"unknown"}'::jsonb,
  impact_assessment jsonb,
  review jsonb,
  supporting_evidence jsonb NOT NULL CHECK (jsonb_typeof(supporting_evidence)='array'),
  eligibility_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(eligibility_reasons)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT research_qualifications_stage_alert_consistent CHECK (alert_eligible = (stage = 'alert_eligible')),
  CONSTRAINT research_qualifications_alert_gate CHECK (
    NOT alert_eligible OR (
      issuer_resolution->>'status' = 'cross_correlated' AND
      issuer_resolution->'issuer'->>'ticker' IS NOT NULL AND
      issuer_resolution->'issuer'->>'cik' IS NOT NULL AND
      parent_relationship->>'status' = 'verified_primary_document' AND
      parent_relationship->'review'->>'approved' = 'true' AND
      impact_assessment IS NOT NULL AND
      review->>'approved' = 'true' AND
      jsonb_array_length(supporting_evidence) >= 2
    )
  ),
  CONSTRAINT research_qualifications_event_fk FOREIGN KEY (engine,source,source_event_id)
    REFERENCES catalyst_acceptance.events(engine,source,source_event_id) ON DELETE RESTRICT,
  CONSTRAINT research_qualifications_revision_fk FOREIGN KEY (engine,source,source_event_id,fingerprint)
    REFERENCES catalyst_acceptance.event_revisions(engine,source,source_event_id,fingerprint) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS research_qualifications_stage_idx ON catalyst_acceptance.research_qualifications(stage,updated_at DESC);
CREATE INDEX IF NOT EXISTS research_qualifications_event_idx ON catalyst_acceptance.research_qualifications(engine,source,source_event_id);
GRANT SELECT, INSERT, UPDATE ON catalyst_acceptance.research_qualifications TO scd_luxalgo_acceptance;
