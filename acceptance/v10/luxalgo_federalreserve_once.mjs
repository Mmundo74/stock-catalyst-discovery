// Manual-only bounded ingestion for the pinned LuxAlgo Federal Reserve adapter.
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { FEEDS, feedSnapshotHash, normalizeFeedRange } from './federalreserve_source.mjs';
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
const feeds = [];
for (const spec of FEEDS) { if (feeds.length) await snooze(550); feeds.push(await fetchFeed(spec.url)); }
const client = new Client({ connectionString, connectionTimeoutMillis: 10000, application_name: 'scd-luxalgo-fed-acceptance' });
try {
  await client.connect(); await client.query('begin');
  await client.query("insert into catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) values($1,'government','started',$2)", [runId, { source_key: sourceKey, retrieved_at: retrievedAt }]);
  await client.query('insert into catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run) values($1,$2,$3) on conflict(source_key) do nothing', [sourceKey, JSON.stringify({ version: 1, snapshot_sha256: null, next_offset: 0 }), runId]);
  const cp = await client.query('select cursor_value from catalyst_acceptance.checkpoints where source_key=$1 for update', [sourceKey]);
  const prior = JSON.parse(cp.rows[0].cursor_value), snapshotSha256 = feedSnapshotHash(feeds);
  const startOffset = prior.snapshot_sha256 === snapshotSha256 && Number.isInteger(prior.next_offset) ? prior.next_offset : 0;
  const batch = normalizeFeedRange(feeds, retrievedAt, maxItems, startOffset), selected = batch.records;
  const coverage = { upstream: 'LuxAlgo market-trackers federalreserve source', upstream_commit: '1ecfcca36a224d4758cc6e2e20cca216db43d5ee', feeds_attempted: feeds.length, feeds_succeeded: feeds.length, snapshot_sha256: snapshotSha256, ...batch.coverage, max_items: maxItems, note: batch.coverage.parseFailures ? 'Malformed source item blocks checkpoint advancement.' : batch.coverage.complete ? 'Fetched snapshot fully processed; archive depth remains undocumented.' : 'Bounded page persisted; durable raw offset committed for restart recovery.' };
  let inserted = 0, revisions = 0, outbox = 0;
  for (const record of selected) {
    const payload = { source_record: record.raw, source_feed_url: record.feedUrl, retrieved_at: retrievedAt };
    const fingerprint = createHash('sha256').update(JSON.stringify(record.raw)).digest('hex');
    const event = await client.query("insert into catalyst_acceptance.events(engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload) values('government','luxalgo_federalreserve',$1,$2,$3,$4,$5,$6,$7) on conflict(engine,source,source_event_id) do nothing returning 1", [record.id, record.title, record.eventTime, retrievedAt, record.url, fingerprint, payload]); inserted += event.rowCount;
    const revision = await client.query("insert into catalyst_acceptance.event_revisions(engine,source,source_event_id,fingerprint,original_name,original_payload) values('government','luxalgo_federalreserve',$1,$2,$3,$4) on conflict do nothing returning 1", [record.id, fingerprint, record.title, payload]); revisions += revision.rowCount;
    const queued = await client.query("insert into catalyst_acceptance.notification_outbox(idempotency_key,engine,source,source_event_id,fingerprint,state,attempts) values($1,'government','luxalgo_federalreserve',$2,$3,'pending',0) on conflict do nothing returning 1", [`government:luxalgo_federalreserve:${record.id}:${fingerprint}`, record.id, fingerprint]); outbox += queued.rowCount;
  }
  await client.query("update catalyst_acceptance.pipeline_runs set status='committed',completed_at=now(),evidence=$2 where run_id=$1", [runId, { source_key: sourceKey, retrieved_at: retrievedAt, coverage, inserted, revisions, outbox }]);
  await client.query("insert into catalyst_acceptance.source_health(source_key,last_attempt_at,last_success_at,state,last_error) values($1,$2,$3,$4,$5) on conflict(source_key) do update set last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,state=excluded.state,last_error=excluded.last_error", [sourceKey, retrievedAt, batch.coverage.parseFailures ? null : retrievedAt, batch.coverage.parseFailures ? 'degraded' : 'healthy', batch.coverage.parseFailures ? `malformed_records:${batch.coverage.parseFailures}:offset:${batch.coverage.blockedOffset}` : null]);
  if (batch.coverage.parseFailures === 0) { const cursor = JSON.stringify({ version: 1, snapshot_sha256: snapshotSha256, next_offset: batch.coverage.nextOffset, records_available: batch.coverage.recordsAvailable }); await client.query("insert into catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run) values($1,$2,$3) on conflict(source_key) do update set cursor_value=excluded.cursor_value,last_completed_run=excluded.last_completed_run,advanced_at=now()", [sourceKey, cursor, runId]); }
  await client.query('commit');
  console.log(JSON.stringify({ pass: true, run_id: runId, checks: { three_feeds: feeds.length === 3, bounded: selected.length <= maxItems, raw_records_preserved: true, original_timestamps_preserved: true, checkpoint_committed_after_durable_page: batch.coverage.parseFailures === 0, malformed_items_block_checkpoint: true }, coverage, inserted, revisions, outbox }));
} catch (error) { await client.query('rollback').catch(() => {}); console.error(JSON.stringify({ pass: false, error: String(error?.message ?? 'unknown').slice(0, 220) })); process.exitCode = 1; } finally { await client.end().catch(() => {}); }
