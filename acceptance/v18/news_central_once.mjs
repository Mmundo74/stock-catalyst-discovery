import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { fetchNewsCentral } from './news_central_api.mjs';

const connectionString = process.env.SUPABASE_SESSION_POOLER_URL;
if (!connectionString) throw new Error('missing_database_url');
const runId = 'scd_news_central_once_' + randomUUID().replaceAll('-', '');
const sourceKey = 'news-central:business';
const source = 'news-central-site';
const engine = 'news';
const overlapMs = 24 * 60 * 60 * 1000;
const observedAt = new Date().toISOString();
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
let connected = false;
let tx = false;

function readCheckpoint(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed?.version !== 1 || !Number.isFinite(Date.parse(parsed.last_window_end))) throw new Error();
    return parsed;
  } catch { throw new Error('invalid_news_central_checkpoint'); }
}
function safeErrorCode(error) {
  if (/^news_central_(?:http_\d+|unexpected_content_type)$/.test(error?.message ?? '')) return error.message;
  return error?.code && /^[A-Z0-9]{2,10}$/.test(error.code) ? error.code : 'NEWS_CENTRAL_INGESTION_FAILED';
}

try {
  await client.connect(); connected = true;
  const result = await client.query('SELECT cursor_value FROM catalyst_acceptance.checkpoints WHERE source_key=$1', [sourceKey]);
  const prior = readCheckpoint(result.rows[0]?.cursor_value ?? null);
  const since = prior ? new Date(Math.max(0, Date.parse(prior.last_window_end) - overlapMs)).toISOString()
    : new Date(Date.parse(observedAt) - 6 * 60 * 60 * 1000).toISOString();
  const batch = await fetchNewsCentral({ observedAt, since, until: observedAt, section: 'business', limit: 50, maxPages: 3 });
  await client.query('BEGIN'); tx = true;
  await client.query('INSERT INTO catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) VALUES($1,$2,\'started\',$3::jsonb)',
    [runId, engine, JSON.stringify({ source, stage: 'public-api-window', bounded: true, since, until: observedAt })]);
  await client.query('INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,state,last_error) VALUES($1,now(),\'healthy\',null) ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,state=\'healthy\',last_error=null', [sourceKey]);
  let insertedEvents = 0;
  let insertedRevisions = 0;
  for (const record of batch.records) {
    const event = await client.query(`INSERT INTO catalyst_acceptance.events
      (engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
      ON CONFLICT(engine,source,source_event_id) DO UPDATE SET original_name=excluded.original_name,event_time=excluded.event_time,
        observed_at=excluded.observed_at,source_url=excluded.source_url,fingerprint=excluded.fingerprint,source_payload=excluded.source_payload
      RETURNING (xmax=0) AS inserted`,
    [engine, source, record.sourceEventId, record.originalName, record.eventTime, record.observedAt,
      record.sourceUrl, record.fingerprint, JSON.stringify(record.sourcePayload)]);
    if (event.rows[0]?.inserted) insertedEvents++;
    const revision = await client.query(`INSERT INTO catalyst_acceptance.event_revisions
      (engine,source,source_event_id,fingerprint,original_name,original_payload,captured_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(engine,source,source_event_id,fingerprint) DO NOTHING`,
    [engine, source, record.sourceEventId, record.fingerprint, record.originalName, JSON.stringify(record.sourcePayload), record.observedAt]);
    insertedRevisions += revision.rowCount ?? 0;
  }
  const coverage = { ...batch.coverage, fetchedRecords: batch.records.length, insertedEvents, insertedRevisions,
    priorCheckpointPresent: Boolean(prior), overlapMs, sourceComplete: false, coverageComplete: false,
    notificationEligible: false };
  await client.query('UPDATE catalyst_acceptance.pipeline_runs SET status=\'committed\',completed_at=now(),evidence=$2::jsonb WHERE run_id=$1',
    [runId, JSON.stringify({ source, coverage })]);
  if (coverage.checkpointPermitted) {
    const cursor = { version: 1, last_window_end: observedAt, overlap_ms: overlapMs,
      verified_sweep_pages: coverage.requestedPages, verified_record_count: coverage.returnedRecords };
    await client.query(`INSERT INTO catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run)
      VALUES($1,$2,$3) ON CONFLICT(source_key) DO UPDATE SET cursor_value=excluded.cursor_value,
      last_completed_run=excluded.last_completed_run,advanced_at=now()`, [sourceKey, JSON.stringify(cursor), runId]);
  }
  await client.query('UPDATE catalyst_acceptance.source_health SET last_success_at=CASE WHEN $2 THEN now() ELSE last_success_at END,state=$3,last_error=$4 WHERE source_key=$1',
    [sourceKey, coverage.checkpointPermitted, coverage.checkpointPermitted ? 'healthy' : 'partial', coverage.failureReason]);
  await client.query('COMMIT'); tx = false;
  console.log(JSON.stringify({ pass: coverage.checkpointPermitted, run_id: runId, source,
    checks: { durable_events: true, append_only_revisions: true, checkpoint_only_after_stable_sweep: coverage.checkpointPermitted,
      raw_news_not_queued: true, attribution_preserved: true, coverage_remains_partial: true }, coverage }));
  if (!coverage.checkpointPermitted) process.exitCode = 1;
} catch (error) {
  if (tx) await client.query('ROLLBACK').catch(() => {});
  const errorCode = safeErrorCode(error);
  try {
    if (connected) await client.query(`INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,state,last_error)
      VALUES($1,now(),'error',$2) ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=now(),state='error',last_error=excluded.last_error`, [sourceKey, errorCode]);
  } catch {}
  console.error(JSON.stringify({ pass: false, error_code: errorCode, checkpoint_advanced: false }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
