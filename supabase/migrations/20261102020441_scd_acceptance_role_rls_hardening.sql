-- Restrict the manual acceptance login to its existing table grants and
-- enforce row policies instead of relying on role-level RLS bypass.
ALTER ROLE scd_luxalgo_acceptance
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

ALTER TABLE catalyst_acceptance.checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalyst_acceptance.event_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalyst_acceptance.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalyst_acceptance.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalyst_acceptance.pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalyst_acceptance.research_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalyst_acceptance.source_health ENABLE ROW LEVEL SECURITY;

-- Match policies to the acceptance role's current SELECT/INSERT/UPDATE grants.
-- No DELETE policy or grant is introduced. The custom schema remains unexposed
-- to anon, authenticated, and service_role.
DROP POLICY IF EXISTS scd_luxalgo_acceptance_events_read ON catalyst_acceptance.events;

DROP POLICY IF EXISTS scd_luxalgo_acceptance_select ON catalyst_acceptance.checkpoints;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_insert ON catalyst_acceptance.checkpoints;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_update ON catalyst_acceptance.checkpoints;
CREATE POLICY scd_luxalgo_acceptance_select ON catalyst_acceptance.checkpoints
  FOR SELECT TO scd_luxalgo_acceptance USING (true);
CREATE POLICY scd_luxalgo_acceptance_insert ON catalyst_acceptance.checkpoints
  FOR INSERT TO scd_luxalgo_acceptance WITH CHECK (true);
CREATE POLICY scd_luxalgo_acceptance_update ON catalyst_acceptance.checkpoints
  FOR UPDATE TO scd_luxalgo_acceptance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS scd_luxalgo_acceptance_select ON catalyst_acceptance.event_revisions;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_insert ON catalyst_acceptance.event_revisions;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_update ON catalyst_acceptance.event_revisions;
CREATE POLICY scd_luxalgo_acceptance_select ON catalyst_acceptance.event_revisions
  FOR SELECT TO scd_luxalgo_acceptance USING (true);
CREATE POLICY scd_luxalgo_acceptance_insert ON catalyst_acceptance.event_revisions
  FOR INSERT TO scd_luxalgo_acceptance WITH CHECK (true);
CREATE POLICY scd_luxalgo_acceptance_update ON catalyst_acceptance.event_revisions
  FOR UPDATE TO scd_luxalgo_acceptance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS scd_luxalgo_acceptance_select ON catalyst_acceptance.events;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_insert ON catalyst_acceptance.events;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_update ON catalyst_acceptance.events;
CREATE POLICY scd_luxalgo_acceptance_select ON catalyst_acceptance.events
  FOR SELECT TO scd_luxalgo_acceptance USING (true);
CREATE POLICY scd_luxalgo_acceptance_insert ON catalyst_acceptance.events
  FOR INSERT TO scd_luxalgo_acceptance WITH CHECK (true);
CREATE POLICY scd_luxalgo_acceptance_update ON catalyst_acceptance.events
  FOR UPDATE TO scd_luxalgo_acceptance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS scd_luxalgo_acceptance_select ON catalyst_acceptance.notification_outbox;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_insert ON catalyst_acceptance.notification_outbox;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_update ON catalyst_acceptance.notification_outbox;
CREATE POLICY scd_luxalgo_acceptance_select ON catalyst_acceptance.notification_outbox
  FOR SELECT TO scd_luxalgo_acceptance USING (true);
CREATE POLICY scd_luxalgo_acceptance_insert ON catalyst_acceptance.notification_outbox
  FOR INSERT TO scd_luxalgo_acceptance WITH CHECK (true);
CREATE POLICY scd_luxalgo_acceptance_update ON catalyst_acceptance.notification_outbox
  FOR UPDATE TO scd_luxalgo_acceptance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS scd_luxalgo_acceptance_select ON catalyst_acceptance.pipeline_runs;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_insert ON catalyst_acceptance.pipeline_runs;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_update ON catalyst_acceptance.pipeline_runs;
CREATE POLICY scd_luxalgo_acceptance_select ON catalyst_acceptance.pipeline_runs
  FOR SELECT TO scd_luxalgo_acceptance USING (true);
CREATE POLICY scd_luxalgo_acceptance_insert ON catalyst_acceptance.pipeline_runs
  FOR INSERT TO scd_luxalgo_acceptance WITH CHECK (true);
CREATE POLICY scd_luxalgo_acceptance_update ON catalyst_acceptance.pipeline_runs
  FOR UPDATE TO scd_luxalgo_acceptance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS scd_luxalgo_acceptance_select ON catalyst_acceptance.research_qualifications;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_insert ON catalyst_acceptance.research_qualifications;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_update ON catalyst_acceptance.research_qualifications;
CREATE POLICY scd_luxalgo_acceptance_select ON catalyst_acceptance.research_qualifications
  FOR SELECT TO scd_luxalgo_acceptance USING (true);
CREATE POLICY scd_luxalgo_acceptance_insert ON catalyst_acceptance.research_qualifications
  FOR INSERT TO scd_luxalgo_acceptance WITH CHECK (true);
CREATE POLICY scd_luxalgo_acceptance_update ON catalyst_acceptance.research_qualifications
  FOR UPDATE TO scd_luxalgo_acceptance USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS scd_luxalgo_acceptance_select ON catalyst_acceptance.source_health;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_insert ON catalyst_acceptance.source_health;
DROP POLICY IF EXISTS scd_luxalgo_acceptance_update ON catalyst_acceptance.source_health;
CREATE POLICY scd_luxalgo_acceptance_select ON catalyst_acceptance.source_health
  FOR SELECT TO scd_luxalgo_acceptance USING (true);
CREATE POLICY scd_luxalgo_acceptance_insert ON catalyst_acceptance.source_health
  FOR INSERT TO scd_luxalgo_acceptance WITH CHECK (true);
CREATE POLICY scd_luxalgo_acceptance_update ON catalyst_acceptance.source_health
  FOR UPDATE TO scd_luxalgo_acceptance USING (true) WITH CHECK (true);
