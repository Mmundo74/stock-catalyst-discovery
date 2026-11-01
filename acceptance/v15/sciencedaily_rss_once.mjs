import pg from 'pg';
import { randomUUID } from 'node:crypto';import { assessScienceDailyContinuity, fetchScienceDailyRss } from './sciencedaily_rss.mjs';

const connectionString = process.env.SUPABASE_SESSION_POOLER_URL;
if (!connectionString) throw new Error('missing_database_url');
const runId = 'scd_sciencedaily_once_' + randomUUID().replaceAll('-', '');
const sourceKey = 'rss:sciencedaily-all';
const source = 'rss.sciencedaily-all';
const engine = 'news';
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 15000 });
let tx = false; let connected = false;
function safeErrorCode(error) {
  if (/^feed_http_\d+$/.test(error?.message ?? '')) return error.message;
  return error?.code && /^[A-Z0-9]{2,10}$/.test(error.code) ? error.code : 'RSS_INGESTION_FAILED';
}
try {
  await client.connect(); connected = true;
  const checkpointResult = await client.query('select cursor_value from catalyst_acceptance.checkpoints where source_key=$1', [sourceKey]);
  const priorCursor = checkpointResult.rows[0]?.cursor_value ?? null;
  const batch = await fetchScienceDailyRss({ observedAt: new Date().toISOString(), maxEntries: 60 });
  if (!batch.records.length || batch.records.length > 60) throw new Error('invalid_feed_snapshot_size');
  const continuity = assessScienceDailyContinuity(batch.records, priorCursor, batch.page.snapshotHash);
  await client.query('BEGIN'); tx = true;
  await client.query('insert into catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) values($1,$2,\'started\',$3::jsonb)',
    [runId, engine, JSON.stringify({ source, stage: 'rss-snapshot', bounded: true })]);
  await client.query('insert into catalyst_acceptance.source_health(source_key,last_attempt_at,state,last_error) values($1,now(),\'healthy\',null) on conflict(source_key) do update set last_attempt_at=excluded.last_attempt_at,state=\'healthy\',last_error=null', [sourceKey]);
  let insertedEvents = 0; let insertedRevisions = 0;
  for (const record of batch.records) {
    const event = await client.query('insert into catalyst_acceptance.events (engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) on conflict(engine,source,source_event_id) do update set original_name=excluded.original_name,event_time=excluded.event_time,observed_at=excluded.observed_at,source_url=excluded.source_url,fingerprint=excluded.fingerprint,source_payload=excluded.source_payload returning (xmax=0) as inserted',
      [engine,source,record.sourceEventId,record.originalName,record.eventTime,record.observedAt,record.sourceUrl,record.fingerprint,JSON.stringify(record.sourcePayload)]);
    if (event.rows[0]?.inserted) insertedEvents++;
    const revision = await client.query('insert into catalyst_acceptance.event_revisions (engine,source,source_event_id,fingerprint,original_name,original_payload,captured_at) values($1,$2,$3,$4,$5,$6::jsonb,$7) on conflict(engine,source,source_event_id,fingerprint) do nothing',
      [engine,source,record.sourceEventId,record.fingerprint,record.originalName,JSON.stringify(record.sourcePayload),record.observedAt]);
    insertedRevisions += revision.rowCount ?? 0;
  }
  const coverage = { ...batch.page, fetchedRecords: batch.records.length, insertedEvents, insertedRevisions,
    ...continuity, checkpointAdvancedAfterDurability: !continuity.continuityGap, sourceComplete: false, paginationExposed: false, notificationEligible: false };
  await client.query('update catalyst_acceptance.pipeline_runs set status=\'committed\',completed_at=now(),evidence=$2::jsonb where run_id=$1', [runId,JSON.stringify({ source, coverage })]);
  if (!continuity.continuityGap) {
    await client.query('insert into catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run) values($1,$2,$3) on conflict(source_key) do update set cursor_value=excluded.cursor_value,last_completed_run=excluded.last_completed_run,advanced_at=now()', [sourceKey,batch.page.nextCursor,runId]);  }
  await client.query('update catalyst_acceptance.source_health set last_success_at=now(),state=$2,last_error=$3 where source_key=$1', [sourceKey, continuity.continuityGap ? 'degraded' : 'healthy', continuity.continuityGap ? 'RSS_CHECKPOINT_GAP' : null]);
  await client.query('COMMIT'); tx = false;
  console.log(JSON.stringify({ pass:!continuity.continuityGap,run_id:runId,source,checks:{ durable_events:true,durable_revisions:true,checkpoint_after_durability:!continuity.continuityGap,raw_not_queued:true,source_health_recorded:true },coverage }));if (continuity.continuityGap) process.exitCode = 1;
} catch (error) {
  if (tx) await client.query('ROLLBACK').catch(() => {});
  const errorCode = safeErrorCode(error);
  try { if (connected) await client.query('insert into catalyst_acceptance.source_health(source_key,last_attempt_at,state,last_error) values($1,now(),\'error\',$2) on conflict(source_key) do update set last_attempt_at=now(),state=\'error\',last_error=excluded.last_error', [sourceKey,errorCode]); } catch {}
  console.error(JSON.stringify({ pass:false,error_code:errorCode,checkpoint_advanced:false })); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
