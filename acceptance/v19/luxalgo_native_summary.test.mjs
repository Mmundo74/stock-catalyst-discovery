import test from 'node:test';
import assert from 'node:assert/strict';
import { LUXALGO_NON_SEC_SOURCES, buildRecentLuxAlgoSyncSummary } from './luxalgo_native_summary.mjs';

function rowsFor(sources = LUXALGO_NON_SEC_SOURCES) {
  return sources.map((source) => ({ source, started_at:'2026-11-02T06:30:00Z', ok:true,
    rows_upserted:2, parse_attempted:2, parse_succeeded:2, error:null, details:'{}' }));
}

test('reuses only recent rows for the complete non-SEC source allowlist', () => {
  const summary=buildRecentLuxAlgoSyncSummary(rowsFor(),{cutoffMs:Date.parse('2026-11-02T06:00:00Z')});
  assert.equal(summary.results.length,15);
  assert.equal(summary.ok,true);
  assert.equal(summary.results.some((result)=>result.source==='edgar'||result.source==='edgar-bulk'),false);
});

test('refuses stale or missing native source runs instead of claiming coverage', () => {
  assert.throws(()=>buildRecentLuxAlgoSyncSummary(rowsFor().slice(1),{cutoffMs:Date.parse('2026-11-02T06:00:00Z')}),
    /recent_luxalgo_native_sync_incomplete/);
  assert.throws(()=>buildRecentLuxAlgoSyncSummary(rowsFor(),{cutoffMs:Date.parse('2026-11-02T07:00:00Z')}),
    /recent_luxalgo_native_sync_incomplete/);
});

test('retains sanitized error and parse failures without leaking provider text', () => {
  const rows=rowsFor();
  rows[0]={...rows[0],ok:false,error:'HTTP 403 https://provider.invalid/?api_key=secret'};
  rows[1]={...rows[1],parse_attempted:4,parse_succeeded:3,details:JSON.stringify({notes:['38 malformed index rows skipped','raw token=secret']})};
  const summary=buildRecentLuxAlgoSyncSummary(rows,{cutoffMs:Date.parse('2026-11-02T06:00:00Z')});
  assert.equal(summary.results[0].error,'HTTP 403');
  assert.deepEqual(summary.results[1].notes,['38 malformed index rows skipped']);
  assert.equal(summary.ok,false);
  assert.equal(JSON.stringify(summary).includes('secret'),false);
});

test('chooses the latest row per source within the freshness window', () => {
  const rows=[...rowsFor(),{...rowsFor([LUXALGO_NON_SEC_SOURCES[0]])[0],started_at:'2026-11-02T06:45:00Z',
    ok:false,error:'HTTP 429'}];
  const summary=buildRecentLuxAlgoSyncSummary(rows,{cutoffMs:Date.parse('2026-11-02T06:00:00Z')});
  assert.equal(summary.results[0].error,'HTTP 429');
});
