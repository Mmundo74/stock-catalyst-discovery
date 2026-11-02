import { createHash } from 'node:crypto';
import { LUXALGO_COMMIT } from './luxalgo_catalog.mjs';

function valuesClause(rows, width, jsonColumns = []) {
  return rows.map((_, rowIndex) => `(${Array.from({ length: width }, (_, columnIndex) => {
    const placeholder = `$${rowIndex * width + columnIndex + 1}`;
    return jsonColumns.includes(columnIndex) ? `${placeholder}::jsonb` : placeholder;
  }).join(',')})`).join(',');
}

function chunks(values, size = 200) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function persistQuery(client, operation, sql, values) {
  try { return await client.query(sql, values); }
  catch (error) {
    // Keep diagnostics to a stable operation label. PostgreSQL's message can
    // contain provider-derived values, so never copy it into durable evidence.
    if (error && typeof error === 'object') error.persistenceOperation = operation;
    throw error;
  }
}

export async function persistLuxAlgoEvidenceBatch(client, batch, runId, { runAlreadyStarted = false } = {}) {
  if (!runAlreadyStarted) {
    await client.query("insert into catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) values($1,'government','started',$2)",
      [runId, { source: 'luxalgo_market_trackers', luxalgo_commit: LUXALGO_COMMIT, catalog_sync: true }]);
  }
  try {
    await client.query('BEGIN');
    const persisted = { events: 0, revisions: 0 };
    const records = batch.records.map((record) => {
      if (typeof record.eventTime !== 'string' || !Number.isFinite(Date.parse(record.eventTime))) {
        throw new Error('luxalgo_event_time_required_for_shared_event');
      }
      return { ...record, payload: JSON.stringify(record.sourcePayload) };
    });
    for (const group of chunks(records)) {
      const values = group.map((record) => [record.engine,record.source,record.sourceEventId,record.originalName,
        record.eventTime,record.observedAt,record.sourceUrl,record.fingerprint,record.payload]).flat();
      const events = await persistQuery(client, 'upsert_events', `INSERT INTO catalyst_acceptance.events
        (engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload)
        VALUES ${valuesClause(group,9,[8])}
        ON CONFLICT(engine,source,source_event_id) DO UPDATE SET original_name=excluded.original_name,
          event_time=excluded.event_time,observed_at=excluded.observed_at,source_url=excluded.source_url,
          fingerprint=excluded.fingerprint,source_payload=excluded.source_payload RETURNING 1`, values);
      persisted.events += events.rowCount ?? group.length;
      const revisionValues = group.map((record) => [record.engine,record.source,record.sourceEventId,
        record.fingerprint,record.originalName,record.payload,record.observedAt]).flat();
      const revision = await persistQuery(client, 'insert_revisions', `INSERT INTO catalyst_acceptance.event_revisions
        (engine,source,source_event_id,fingerprint,original_name,original_payload,captured_at)
        VALUES ${valuesClause(group,7,[5])} ON CONFLICT DO NOTHING RETURNING 1`, revisionValues);
      persisted.revisions += revision.rowCount ?? 0;
    }
    const retryGroups = new Map();
    for (const record of records) {
      const key = `${record.engine}\u0000${record.source}`;
      const group = retryGroups.get(key) ?? { engine: record.engine, source: record.source, ids: [] };
      group.ids.push(record.sourceEventId);
      retryGroups.set(key, group);
    }
    for (const group of retryGroups.values()) {
      for (const ids of chunks([...new Set(group.ids)],500)) {
        await persistQuery(client, 'mark_quarantine_reprocessed', `UPDATE catalyst_acceptance.evidence_quarantine SET retry_status='reprocessed',last_seen_at=now(),last_attempt_run=$4
          WHERE engine=$1 AND source=$2 AND source_event_id=ANY($3::text[]) AND failure_reason='event_time_missing'`,
        [group.engine,group.source,ids,runId]);
      }
    }
    const quarantineRecords = (batch.quarantinedRecords ?? []).map((record) => {
      const payload = JSON.stringify(record.sourcePayload);
      const quarantineKey = createHash('sha256').update(JSON.stringify([
        record.engine,record.source,record.sourceEventId,record.fingerprint,record.failureReason,
      ])).digest('hex');
      return [quarantineKey,record.engine,record.source,record.sourceEventId,record.fingerprint,
        record.originalName,record.sourceUrl,record.observedAt,payload,record.failureReason,record.retryStatus,runId];
    });
    for (const group of chunks(quarantineRecords)) {
      const values = group.flat();
      await persistQuery(client, 'upsert_quarantine', `INSERT INTO catalyst_acceptance.evidence_quarantine
        (quarantine_key,engine,source,source_event_id,fingerprint,original_name,source_url,observed_at,original_payload,
         failure_reason,retry_status,last_attempt_run)
        VALUES ${valuesClause(group,12,[8])}
        ON CONFLICT(quarantine_key) DO UPDATE SET
          retry_status='pending_reprocess',attempt_count=catalyst_acceptance.evidence_quarantine.attempt_count+1,
          last_seen_at=now(),last_attempt_run=excluded.last_attempt_run`,
      values);
    }
    for (const result of batch.sourceResults) {
      const sourceKey = `luxalgo:${result.source}`;
      const state = result.ok ? 'healthy' : 'error';
      await persistQuery(client, 'upsert_source_health', `INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,last_success_at,state,last_error)
        VALUES($1,now(),CASE WHEN $2='healthy' THEN now() ELSE NULL END,$2,$3)
        ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,
          last_success_at=coalesce(excluded.last_success_at,catalyst_acceptance.source_health.last_success_at),
          state=excluded.state,last_error=excluded.last_error`, [sourceKey,state,result.error]);
    }
    await persistQuery(client, 'upsert_bridge_health', `INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,last_success_at,state,last_error)
      VALUES('luxalgo:shared-evidence-import',now(),now(),'healthy',null)
      ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,
        last_success_at=excluded.last_success_at,state='healthy',last_error=null`);
    const cursor = JSON.stringify({ version: 1, purpose: 'shared_evidence_import', luxalgo_commit: LUXALGO_COMMIT,
      last_run_id: runId, records_imported: batch.records.length, coverage_complete: false });
    await persistQuery(client, 'advance_import_checkpoint', `INSERT INTO catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run)
      VALUES('luxalgo:shared-evidence-import',$1,$2) ON CONFLICT(source_key) DO UPDATE SET
        cursor_value=excluded.cursor_value,last_completed_run=excluded.last_completed_run,advanced_at=now()`, [cursor,runId]);
    const evidence = { source: 'luxalgo_market_trackers', luxalgo_commit: LUXALGO_COMMIT,
      coverage: batch.coverage, dataset_counts: batch.datasetCounts ?? {},
      source_results: batch.sourceResults,
      imported_records: batch.records.length, upserted_events: persisted.events, new_revisions: persisted.revisions,
      quarantined_records: batch.quarantinedRecords?.length ?? 0,
      alert_eligible: false, notification_outbox_created: 0, export_mode: 'full_snapshot_replay_idempotent' };
    await persistQuery(client, 'commit_pipeline_run_evidence', "UPDATE catalyst_acceptance.pipeline_runs SET status='committed',completed_at=now(),evidence=$2::jsonb WHERE run_id=$1",
      [runId,evidence]);
    await client.query('COMMIT');
    return { persisted, evidence };
  } catch (error) {
    const pgCode = error?.severity && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
    await client.query('ROLLBACK').catch(() => {});
    await client.query("UPDATE catalyst_acceptance.pipeline_runs SET status='failed',completed_at=now(),evidence=$2::jsonb WHERE run_id=$1",
      [runId,{ source:'luxalgo_market_trackers',luxalgo_commit:LUXALGO_COMMIT,failure_code:'durable_import_failed',database_error_code:pgCode,source_complete:false }]).catch(()=>{});
    await client.query(`INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,state,last_error)
      VALUES('luxalgo:shared-evidence-import',now(),'error','durable_import_failed')
      ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,state='error',last_error=excluded.last_error`).catch(()=>{});
    const failure = new Error(pgCode ? `durable_import_failed_${pgCode}` : 'durable_import_failed');
    if (pgCode) { failure.code = pgCode; failure.severity = error.severity; }
    if (typeof error?.persistenceOperation === 'string') failure.persistenceOperation = error.persistenceOperation;
    throw failure;
  }
}
