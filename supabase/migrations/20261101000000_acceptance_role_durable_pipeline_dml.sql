-- Manual acceptance only. Scope DML to the six catalyst_acceptance tables.
-- No restore/application schema access, schema CREATE, or DELETE is granted.
GRANT SELECT, INSERT, UPDATE ON TABLE
  catalyst_acceptance.events,
  catalyst_acceptance.event_revisions,
  catalyst_acceptance.checkpoints,
  catalyst_acceptance.notification_outbox,
  catalyst_acceptance.pipeline_runs,
  catalyst_acceptance.source_health
TO scd_luxalgo_acceptance;
