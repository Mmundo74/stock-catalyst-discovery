// Manual-only bounded ingestion for the pinned LuxAlgo Federal Reserve adapter.
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { FEEDS, addQuarantineRetryState, canAdvanceFedCheckpoint, feedSnapshotHash, normalizeFeedRange, federalReserveFetchFailureEvidence } from './federalreserve_source.mjs';
const { Client } = pg;
const connectionString = process.env.SUPABASE_SESSION_POOLER_URL;
const maxItems = Number(process.env.LUXALGO_MAX_ITEMS ?? 9);
if (!connectionString) throw new Error('Missing SUPABASE_SESSION_POOLER_URL');
if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 30) throw new Error('LUXALGO_MAX_ITEMS must be an integer from 1 to 30');
const retrievedAt = new Date().toISOString(), runId = `scd_fed_once_${randomUUID().replaceAll('-', '')}`, sourceKey = 'luxalgo:federalreserve';
const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchFeed(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await snooze(1100);
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'stock-catalyst-discovery/acceptance (bounded manual source test)', accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`upstream_http_${response.status}`);
      let body = await response.text(); if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);
      const items = JSON.parse(body);
      if (!Array.isArray(items) || items.some(x => !x || typeof x !== 'object' || Array.isArray(x))) throw new Error('upstream_shape_drift');
      return { url, items };
    } catch (error) { lastError = error; if (error?.message === 'upstream_shape_drift') throw error; }
  }
  throw new Error(`feed_fetch_failed:${new URL(url).pathname}:${lastError?.message ?? 'unknown'}`);
}
const client = new Client({ connectionString, connectionTimeoutMillis: 10000, application_name: 'scd-luxalgo-fed-acceptance' });
const feeds = [];
let transactionOpen = false, runRecorded = false, feedFailure = null;
try {
  await client.connect();
  await client.query("insert into catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) values($1,'government','started',$2)", [runId, { source_key: sourceKey, retrieved_at: retrievedAt }]);
  runRecorded = true;
  await client.query("insert into catalyst_acceptance.source_health(source_key,last_attempt_at,state,last_error) values($1,$2,'never_run',null) on conflict(source_key) do update set last_attempt_at=excluded.last_attempt_at", [sourceKey, retrievedAt]);
  for (const [feedIndex, spec] of FEEDS.entries()) {
    if (feeds.length) await snooze(550);
    try { feeds.push(await fetchFeed(spec.url)); }
    catch (error) { feedFailure = federalReserveFetchFailureEvidence({ feedUrl: spec.url, feedIndex, error, retrievedAt }); throw error; }
  }
  await client.query('begin'); transactionOpen = true;
  await client.query('insert into catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run) values($1,$2,$3) on conflict(source_key) do nothing', [sourceKey, JSON.stringify({ version: 1, snapshot_sha256: null, next_offset: 0 }), runId]);
  const cp = await client.query('select cursor_value from catalyst_acceptance.checkpoints where source_key=$1 for update', [sourceKey]);
  const prior = JSON.parse(cp.rows[0].cursor_value), snapshotSha256 = feedSnapshotHash(feeds);
  const startOffset = prior.snapshot_sha256 === snapshotSha256 && Number.isInteger(prior.next_offset) ? prior.next_offset : 0;
  const batch = normalizeFeedRange(feeds, retrievedAt, maxItems, startOffset), selected = batch.records;
  const history = await client.query(`SELECT evidence->'coverage'->'quarantineRecords' AS records
    FROM catalyst_acceptance.pipeline_runs
    WHERE run_id<>$1 AND engine='government' AND evidence->>'source_key'=$2
      AND evidence->'coverage'->>'snapshot_sha256'=$3
    ORDER BY completed_at DESC NULLS LAST LIMIT 100`, [runId, sourceKey, snapshotSha256]);
  const previousQuarantines = history.rows.flatMap(row => Array.isArray(row.records) ? row.records : []);
  const quarantineRecords = addQuarantineRetryState(batch.quarantineRecords, previousQuarantines);
  const checkpointSafe = canAdvanceFedCheckpoint(batch.coverage, quarantineRecords);
  const coverage = { upstream: 'LuxAlgo market-trackers federalreserve source', upstream_commit: '1ecfcca36a224d4758cc6e2e20cca216db43d5ee', feeds_attempted: feeds.length, feeds_succeeded: feeds.length, snapshot_sha256: snapshotSha256, ...batch.coverage, checkpointSafe, checkpointAdvancePolicy: 'advance_only_after_all_page_records_and_any_quarantine_are_durable', quarantineRecords, max_items: maxItems,
    note: batch.coverage.parseFailures ? 'Malformed source item is retained with raw evidence and retry status; cursor advances only through the durably committed quarantine row. Feed coverage remains partial.' : batch.coverage.complete ? 'Fetched snapshot fully processed; archive depth remains undocumented.' : 'Bounded page persisted; durable raw offset committed for restart recovery.' };
  let inserted = 0, revisions = 0;
  for (const record of selected) {
    const payload = { source_record: record.raw, source_feed_url: record.feedUrl, retrieved_at: retrievedAt };
    const fingerprint = createHash('sha256').update(JSON.stringify(record.raw)).digest('hex');
    const event = await client.query("insert into catalyst_acceptance.events(engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload) values('government','luxalgo_federalreserve',$1,$2,$3,$4,$5,$6,$7) on conflict(engine,source,source_event_id) do nothing returning 1", [record.id, record.title, record.eventTime, retrievedAt, record.url, fingerprint, payload]); inserted += event.rowCount;
    const revision = await client.query("insert into catalyst_acceptance.event_revisions(engine,source,source_event_id,fingerprint,original_name,original_payload) values('government','luxalgo_federalreserve',$1,$2,$3,$4) on conflict do nothing returning 1", [record.id, fingerprint, record.title, payload]); revisions += revision.rowCount;
  }
  await client.query("update catalyst_acceptance.pipeline_runs set status='committed',completed_at=now(),evidence=$2 where run_id=$1", [runId, { source_key: sourceKey, retrieved_at: retrievedAt, coverage, inserted, revisions, outbox_created: 0 }]);
  await client.query("insert into catalyst_acceptance.source_health(source_key,last_attempt_at,last_success_at,state,last_error) values($1,$2,$3,$4,$5) on conflict(source_key) do update set last_attempt_at=excluded.last_attempt_at,last_success_at=coalesce(excluded.last_success_at,catalyst_acceptance.source_health.last_success_at),state=excluded.state,last_error=excluded.last_error", [sourceKey, retrievedAt, batch.coverage.parseFailures ? null : retrievedAt, batch.coverage.parseFailures ? 'error' : 'healthy', batch.coverage.parseFailures ? `malformed_records:${batch.coverage.parseFailures}:offset:${batch.coverage.blockedOffset}` : null]);
  if (checkpointSafe) { const cursor = JSON.stringify({ version: 1, snapshot_sha256: snapshotSha256, next_offset: batch.coverage.nextOffset, records_available: batch.coverage.recordsAvailable }); await client.query("insert into catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run) values($1,$2,$3) on conflict(source_key) do update set cursor_value=excluded.cursor_value,last_completed_run=excluded.last_completed_run,advanced_at=now()", [sourceKey, cursor, runId]); }
  await client.query('commit');
  transactionOpen = false;
  const safeCoverage = { ...coverage, quarantineRecords: quarantineRecords.map(({ rawRecord, ...record }) => ({ ...record, rawRecordPreserved: true })) };
  console.log(JSON.stringify({ pass: checkpointSafe, sourceComplete: batch.coverage.complete, run_id: runId,
    checks: { three_feeds: feeds.length === 3, bounded: selected.length <= maxItems, raw_records_preserved: true,
      original_timestamps_preserved: true, malformed_evidence_preserved: quarantineRecords.length === batch.coverage.parseFailures,
      retry_state_recorded: quarantineRecords.every(item => Number.isInteger(item.retryAttempt) && item.retryStatus === 'pending_reprocess'),
      checkpoint_committed_after_durable_page: checkpointSafe, quarantine_committed_before_checkpoint: checkpointSafe,
      raw_discoveries_not_queued_for_alerts: true }, coverage: safeCoverage, inserted, revisions, outbox_created: 0 }));
  if (!checkpointSafe) process.exitCode = 1;
} catch {
  if (transactionOpen) await client.query('rollback').catch(() => {});
  const failureCode = feedFailure?.failureCode ?? 'source_pipeline_failed';
  if (runRecorded) {
    await client.query("update catalyst_acceptance.pipeline_runs set status='failed',completed_at=now(),evidence=$2 where run_id=$1",
      [runId, { source_key: sourceKey, retrieved_at: retrievedAt, failure: feedFailure ?? { failureCode, retryStatus: 'pending_retry', checkpointImplication: 'existing_checkpoint_unchanged', checkpointAdvanced: false } }]).catch(() => {});
    await client.query("insert into catalyst_acceptance.source_health(source_key,last_attempt_at,state,last_error) values($1,$2,'error',$3) on conflict(source_key) do update set last_attempt_at=excluded.last_attempt_at,state='error',last_error=excluded.last_error",
      [sourceKey, retrievedAt, failureCode]).catch(() => {});
  }
  console.error(JSON.stringify({ pass: false, error_code: failureCode, checkpoint_advanced: false, failure: feedFailure }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
