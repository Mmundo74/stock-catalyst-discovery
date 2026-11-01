import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { qualifyDiscovery, persistQualification } from './research_qualification.mjs';

const connectionString = process.env.SUPABASE_SESSION_POOLER_URL;
if (!connectionString) throw new Error('Missing SUPABASE_SESSION_POOLER_URL');
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000, application_name: 'scd-qualification-acceptance' });
const run = randomUUID().replaceAll('-', '');
const sha = value => createHash('sha256').update(value).digest('hex');
try {
  await client.connect();
  await client.query('BEGIN');
  const sourceEventId = `qualification-test-${run}`;
  const fingerprint = sha(`qualification-test:${run}`);
  await client.query(`INSERT INTO catalyst_acceptance.events
    (engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload)
    VALUES ('government','qualification_acceptance',$1,'Qualification acceptance fixture',now(),now(),'https://example.test/event',$2,$3)`,
    [sourceEventId, fingerprint, {raw_fixture: true}]);
  await client.query(`INSERT INTO catalyst_acceptance.event_revisions
    (engine,source,source_event_id,fingerprint,original_name,original_payload)
    VALUES ('government','qualification_acceptance',$1,$2,'Qualification acceptance fixture',$3)`,
    [sourceEventId, fingerprint, {raw_fixture: true}]);
  const qualification = qualifyDiscovery({
    event: {engine:'government',source:'qualification_acceptance',sourceEventId,fingerprint},
    issuerResolution: {status:'cross_correlated',candidates:[{status:'primary_source_cross_correlated',cik:'0000001001',legal_name:'Fixture Public Co',ticker:'FIXT',exchange:'Nasdaq'}]},
    evidence: [{sourceName:'fixture',url:'https://example.test/source',sha256:sha('fixture-source'),retrievedAt:new Date().toISOString(),sourceTimestamp:null,originalName:'Fixture source',rawEvidence:{fixture:true}}],
  });
  const stored = await persistQualification(client, qualification);
  const replay = await persistQualification(client, qualification);
  if (stored.stage !== 'research_qualified' || stored.alert_eligible !== false || replay.qualification_key !== stored.qualification_key) {
    throw new Error('qualification_persistence_or_idempotency_failed');
  }
  const outbox = await client.query(`SELECT count(*)::int AS count FROM catalyst_acceptance.notification_outbox
    WHERE engine='government' AND source='qualification_acceptance' AND source_event_id=$1`, [sourceEventId]);
  if (outbox.rows[0].count !== 0) throw new Error('raw_qualification_created_outbox_item');
  await client.query('SAVEPOINT eligibility_gate');
  let rejected = false;
  try {
    await client.query(`UPDATE catalyst_acceptance.research_qualifications SET stage='alert_eligible', alert_eligible=true WHERE qualification_key=$1`, [stored.qualification_key]);
  } catch (error) {
    rejected = error?.code === '23514';
    await client.query('ROLLBACK TO SAVEPOINT eligibility_gate');
  }
  if (!rejected) throw new Error('database_alert_eligibility_gate_missing');
  await client.query('ROLLBACK');
  console.log(JSON.stringify({pass:true, checks:{event_revision_fk:true, research_candidate_persisted:true, replay_idempotent:true, raw_does_not_create_outbox:true, alert_gate_fail_closed:true, transaction_rolled_back:true}}));
} catch (error) {
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({pass:false,error_code:error?.code??'QUALIFICATION_ACCEPTANCE_FAILED',message:String(error?.message??'unknown').slice(0,200)}));
  process.exitCode=1;
} finally { await client.end().catch(()=>{}); }
