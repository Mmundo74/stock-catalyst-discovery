import { LUXALGO_COMMIT } from './luxalgo_catalog.mjs';

export async function persistLuxAlgoEvidenceBatch(client, batch, runId, { runAlreadyStarted = false } = {}) {
  if (!runAlreadyStarted) {
    await client.query("insert into catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) values($1,'government','started',$2)",
      [runId, { source: 'luxalgo_market_trackers', luxalgo_commit: LUXALGO_COMMIT, catalog_sync: true }]);
  }
  try {
    await client.query('BEGIN');
    const persisted = { events: 0, revisions: 0 };
    for (const record of batch.records) {
      const payload = JSON.stringify(record.sourcePayload);
      await client.query(`INSERT INTO catalyst_acceptance.events
        (engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        ON CONFLICT(engine,source,source_event_id) DO UPDATE SET original_name=excluded.original_name,
          event_time=excluded.event_time,observed_at=excluded.observed_at,source_url=excluded.source_url,
          fingerprint=excluded.fingerprint,source_payload=excluded.source_payload`,
      [record.engine,record.source,record.sourceEventId,record.originalName,record.eventTime,record.observedAt,
        record.sourceUrl,record.fingerprint,payload]);
      persisted.events += 1;
      const revision = await client.query(`INSERT INTO catalyst_acceptance.event_revisions
        (engine,source,source_event_id,fingerprint,original_name,original_payload,captured_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT DO NOTHING RETURNING 1`,
      [record.engine,record.source,record.sourceEventId,record.fingerprint,record.originalName,payload,record.observedAt]);
      persisted.revisions += revision.rowCount ?? 0;
    }
    for (const result of batch.sourceResults) {
      const sourceKey = `luxalgo:${result.source}`;
      const state = result.ok ? 'healthy' : 'error';
      await client.query(`INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,last_success_at,state,last_error)
        VALUES($1,now(),CASE WHEN $2='healthy' THEN now() ELSE NULL END,$2,$3)
        ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,
          last_success_at=coalesce(excluded.last_success_at,catalyst_acceptance.source_health.last_success_at),
          state=excluded.state,last_error=excluded.last_error`, [sourceKey,state,result.error]);
    }
    await client.query(`INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,last_success_at,state,last_error)
      VALUES('luxalgo:shared-evidence-import',now(),now(),'healthy',null)
      ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,
        last_success_at=excluded.last_success_at,state='healthy',last_error=null`);
    const cursor = JSON.stringify({ version: 1, purpose: 'shared_evidence_import', luxalgo_commit: LUXALGO_COMMIT,
      last_run_id: runId, records_imported: batch.records.length, coverage_complete: false });
    await client.query(`INSERT INTO catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run)
      VALUES('luxalgo:shared-evidence-import',$1,$2) ON CONFLICT(source_key) DO UPDATE SET
        cursor_value=excluded.cursor_value,last_completed_run=excluded.last_completed_run,advanced_at=now()`, [cursor,runId]);
    const evidence = { source: 'luxalgo_market_trackers', luxalgo_commit: LUXALGO_COMMIT,
      coverage: batch.coverage, dataset_counts: batch.datasetCounts ?? {},
      source_results: batch.sourceResults,
      imported_records: batch.records.length, upserted_events: persisted.events, new_revisions: persisted.revisions,
      alert_eligible: false, notification_outbox_created: 0, export_mode: 'full_snapshot_replay_idempotent' };
    await client.query("UPDATE catalyst_acceptance.pipeline_runs SET status='committed',completed_at=now(),evidence=$2::jsonb WHERE run_id=$1",
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
    throw failure;
  }
}
