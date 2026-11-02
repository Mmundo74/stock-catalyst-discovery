import test from 'node:test';
import assert from 'node:assert/strict';
import { LUXALGO_SOURCES } from './luxalgo_catalog.mjs';
import { buildLuxAlgoEvidenceBatch, safeLuxAlgoBridgeFailure } from './luxalgo_native_bridge.mjs';

test('bridge diagnostics expose only bounded allowlisted failure codes', () => {
  assert.equal(safeLuxAlgoBridgeFailure(new TypeError('invalid_luxalgo_row_or_provenance')),
    'invalid_luxalgo_row_or_provenance');
  assert.equal(safeLuxAlgoBridgeFailure(new SyntaxError('secret-bearing parse text')),
    'snapshot_json_invalid');
  assert.equal(safeLuxAlgoBridgeFailure(Object.assign(new Error('database detail'), {
    code: '23505', severity: 'ERROR', detail: 'sensitive data',
  })), 'postgres_sqlstate_23505');
  assert.equal(safeLuxAlgoBridgeFailure(new Error('postgres://user:secret@example.invalid')),
    'catalog_step_failed');
});

test('undated source rows are quarantined with raw provenance and fail their source coverage', () => {
  const provenance = (id) => ({ source: 'federalreserve', sourceUrl: `https://www.federalreserve.gov/${id}`,
    retrievedAt: '2026-11-02T00:00:00Z', parser: 'fed-test@1' });
  const rows = [
    { id: 'dated-speech', title: 'Dated speech', date: '2026-11-02', provenance: provenance('dated') },
    { id: 'undated-speech', title: 'Undated speech', provenance: provenance('undated') },
  ];
  const batch = buildLuxAlgoEvidenceBatch({ ok: true, results: LUXALGO_SOURCES.map((source) => ({
    source, implemented: true, ...(source === 'federalreserve' ? { parseAttempted: 2, parseSucceeded: 2 } : {}),
  })) }, { 'fed-communications': rows });
  assert.equal(batch.records.length, 1);
  assert.equal(batch.records[0].sourceEventId, 'dated-speech');
  assert.equal(batch.quarantinedRecords.length, 1);
  assert.equal(batch.quarantinedRecords[0].failureReason, 'event_time_missing');
  assert.equal(batch.quarantinedRecords[0].sourcePayload.record.id, 'undated-speech');
  assert.equal(batch.sourceResults.find((x) => x.source === 'federalreserve').error, 'source_event_time_missing');
  assert.equal(batch.coverage.eventTimeMissingRecordCount, 1);
  assert.equal(batch.coverage.coverageComplete, false);
});
