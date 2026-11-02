import pg from 'pg';
import { LUXALGO_NON_SEC_SOURCES, LUXALGO_NON_SEC_ACTIVE_SOURCES, buildRecentLuxAlgoSyncSummary } from './luxalgo_native_summary.mjs';
import { luxAlgoDatabaseUrl } from './luxalgo_native_bridge.mjs';

const baseUrl = process.env.SUPABASE_SESSION_POOLER_URL;
if (!baseUrl) throw new Error('required_supabase_pooler_url_missing');
const maxAgeMinutes = Number(process.env.LUXALGO_NATIVE_SUMMARY_MAX_AGE_MINUTES ?? 60);
if (!Number.isInteger(maxAgeMinutes) || maxAgeMinutes < 1 || maxAgeMinutes > 1440) {
  throw new Error('invalid_luxalgo_native_summary_age');
}
const selectedSources = process.env.LUXALGO_PROBE_SENATE_EFD_LIVE === 'true'
  ? LUXALGO_NON_SEC_SOURCES : LUXALGO_NON_SEC_ACTIVE_SOURCES;
const client = new pg.Client({ connectionString: luxAlgoDatabaseUrl(baseUrl), connectionTimeoutMillis: 10000,
  application_name: 'scd-luxalgo-native-summary-reuse' });
try {
  await client.connect();
  const { rows } = await client.query(`SELECT DISTINCT ON (source) source,started_at,ok,rows_upserted,
      parse_attempted,parse_succeeded,error,details
    FROM luxalgo_native.sync_runs
    WHERE source = ANY($1::text[]) AND started_at::timestamptz >= now() - ($2 * interval '1 minute')
    ORDER BY source,started_at::timestamptz DESC`, [selectedSources,maxAgeMinutes]);
  const cutoffMs = Date.now() - maxAgeMinutes * 60 * 1000;
  const summary = buildRecentLuxAlgoSyncSummary(rows,{cutoffMs,expectedSources:selectedSources});
  process.stdout.write(JSON.stringify(summary));
} catch (error) {
  const message = error?.message === 'recent_luxalgo_native_sync_incomplete'
    ? 'recent_luxalgo_native_sync_incomplete' : 'luxalgo_native_summary_reuse_failed';
  console.error(JSON.stringify({ pass:false, failure_code:message }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
