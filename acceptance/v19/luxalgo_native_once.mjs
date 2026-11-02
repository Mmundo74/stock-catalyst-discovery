import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';
import { LUXALGO_COMMIT, LUXALGO_DATASETS } from './luxalgo_catalog.mjs';
import { LUXALGO_EXPORT_DIRS, buildLuxAlgoEvidenceBatch, luxAlgoDatabaseUrl, safeLuxAlgoBridgeFailure } from './luxalgo_native_bridge.mjs';
import { persistLuxAlgoEvidenceBatch } from './luxalgo_native_persistence.mjs';

const baseUrl = process.env.SUPABASE_SESSION_POOLER_URL;
const summaryPath = process.env.LUXALGO_SYNC_SUMMARY;
const exportRoot = process.env.LUXALGO_EXPORT_DIR;
if (!baseUrl || !summaryPath || !exportRoot) throw new Error('required_luxalgo_bridge_input_missing');
const runId = `luxalgo_catalog_${randomUUID().replaceAll('-', '')}`;
const MAX_TOTAL_INFLATED_BYTES = 96 * 1024 * 1024;
const MAX_DATASET_ROWS = 50_000;
let totalInflatedBytes = 0;
let failurePhase = 'database_connect';

async function exportedRows(dataset) {
  const dir = join(exportRoot, LUXALGO_EXPORT_DIRS[dataset]);
  let names;
  try { names = await readdir(dir); } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
  const combined = names.includes('snapshot.json.gz') ? ['snapshot.json.gz'] :
    names.filter((name) => /^snapshot-\d{4}\.json\.gz$/.test(name)).sort();
  if (!combined.length) return undefined;
  const rows = [];
  for (const name of combined) {
    const compressed = await readFile(join(dir, name));
    if (compressed.length > 64 * 1024 * 1024) throw new Error('luxalgo_snapshot_compressed_size_limit');
    const inflated = gunzipSync(compressed, { maxOutputLength: 128 * 1024 * 1024 });
    totalInflatedBytes += inflated.length;
    if (totalInflatedBytes > MAX_TOTAL_INFLATED_BYTES) throw new Error('luxalgo_total_snapshot_size_limit');
    const parsed = JSON.parse(inflated.toString('utf8'));
    if (!Array.isArray(parsed)) throw new Error('luxalgo_snapshot_not_array');
    rows.push(...parsed);
    if (rows.length > MAX_DATASET_ROWS) throw new Error('luxalgo_dataset_row_limit');
  }
  return rows;
}

const client = new pg.Client({ connectionString: luxAlgoDatabaseUrl(baseUrl), connectionTimeoutMillis: 10000,
  application_name: 'scd-luxalgo-full-catalog-acceptance' });
let connected = false;
try {
  await client.connect(); connected = true;
  failurePhase = 'record_run_start';
  await client.query("insert into catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) values($1,'government','started',$2)",
    [runId,{source:'luxalgo_market_trackers',luxalgo_commit:LUXALGO_COMMIT,catalog_sync:true}]);
  failurePhase = 'read_native_snapshots';
  const syncSummary = JSON.parse(await readFile(summaryPath, 'utf8'));
  const datasetRows = {};
  for (const dataset of Object.keys(LUXALGO_DATASETS)) {
    const rows = await exportedRows(dataset);
    if (rows !== undefined) datasetRows[dataset] = rows;
  }
  failurePhase = 'build_shared_evidence_batch';
  const batch = buildLuxAlgoEvidenceBatch(syncSummary, datasetRows);
  batch.datasetCounts = Object.fromEntries(Object.entries(datasetRows).map(([k,v])=>[k,v.length]));
  console.log(JSON.stringify({ phase: 'shared_evidence_batch_built', record_count: batch.records.length,
    dataset_count: Object.keys(datasetRows).length, expected_sources: batch.coverage.expectedSources }));
  failurePhase = 'persist_shared_evidence';
  const { evidence } = await persistLuxAlgoEvidenceBatch(client,batch,runId,{runAlreadyStarted:true});
  console.log(JSON.stringify({ pass: true, run_id: runId, upstream_all_sources_succeeded: batch.coverage.allSourcesSucceeded,
    source_complete: false, coverage_complete: false, imported_records: batch.records.length,
    observed_sources: batch.coverage.observedSources, expected_sources: batch.coverage.expectedSources,
    successful_sources: batch.coverage.successfulSourceCount,
    parse_failures: batch.coverage.parseFailureCount,
    parse_failure_hints: batch.coverage.parseFailureHintCount,
    parse_coverage_unknown_sources: batch.coverage.parseCoverageUnknownSources,
    source_results: batch.sourceResults,
    observed_datasets: batch.coverage.datasetsObserved, expected_datasets: batch.coverage.expectedDatasets,
    missing_sources: batch.coverage.missingSources, failed_sources: batch.coverage.failedSources,
    datasets_without_rows: batch.coverage.datasetsWithoutRows, missing_datasets: batch.coverage.missingDatasets }));
  if (batch.coverage.successfulSourceCount === 0) process.exitCode=1;
} catch (error) {
  const failureCode = safeLuxAlgoBridgeFailure(error);
  if (connected) {
    await client.query("UPDATE catalyst_acceptance.pipeline_runs SET status='failed',completed_at=now(),evidence=$2::jsonb WHERE run_id=$1",
      [runId,{source:'luxalgo_market_trackers',luxalgo_commit:LUXALGO_COMMIT,failure_code:failureCode,failure_phase:failurePhase,
        failure_operation:typeof error?.persistenceOperation==='string'?error.persistenceOperation:null,
        database_error_code:error?.severity&&typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code)?error.code:null,
        source_complete:false}]).catch(()=>{});
    await client.query(`INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,state,last_error)
      VALUES('luxalgo:shared-evidence-import',now(),'error','catalog_export_or_import_failed')
      ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,state='error',last_error=excluded.last_error`).catch(()=>{});
  }
  console.error(JSON.stringify({ pass:false, failure_code:failureCode, failure_phase:failurePhase, run_id:runId }));
  process.exitCode=1;
} finally { if (connected) await client.end().catch(()=>{}); }
