import test from 'node:test';
import assert from 'node:assert/strict';
import { LUXALGO_COMMIT, LUXALGO_DATASETS, LUXALGO_SOURCES, assessLuxAlgoCoverage, normalizeLuxAlgoRows } from './luxalgo_catalog.mjs';

test('inventory covers every implemented source and dataset in the pinned LuxAlgo release', () => {
  assert.equal(LUXALGO_COMMIT, '1ecfcca36a224d4758cc6e2e20cca216db43d5ee');
  assert.equal(LUXALGO_SOURCES.length, 17);
  assert.equal(Object.keys(LUXALGO_DATASETS).length, 18);
  assert.ok(LUXALGO_DATASETS['insider-transactions'].includes('edgar-bulk'));
  assert.ok(LUXALGO_DATASETS['insider-transactions'].includes('edgar'));
  assert.ok(LUXALGO_DATASETS['thirteenf-holdings'].includes('edgar'));
});

test('normalized LuxAlgo evidence retains source, full record, URL, time, and stable identity', () => {
  const row = { id: '0001', ticker: 'ABC', filedAt: '2026-11-01', transactionCode: 'P',
    provenance: { source: 'edgar', sourceUrl: 'https://www.sec.gov/Archives/filing',
      retrievedAt: '2026-11-02T12:00:00.000Z', parser: 'form4@1', confidence: 1, needsReview: false } };
  const [event] = normalizeLuxAlgoRows('insider-transactions', [row]);
  assert.equal(event.engine, 'government');
  assert.equal(event.source, 'luxalgo:edgar:insider-transactions');
  assert.equal(event.sourceEventId, 'insider-transactions:0001');
  assert.equal(event.eventTime, '2026-11-01T00:00:00.000Z');
  assert.equal(event.observedAt, row.provenance.retrievedAt);
  assert.equal(event.sourceUrl, row.provenance.sourceUrl);
  assert.deepEqual(event.sourcePayload.record, row);
  assert.equal(event.sourcePayload.luxalgo_commit, LUXALGO_COMMIT);
});

test('rejects unknown sources, missing provenance, malformed links, and duplicate IDs', () => {
  const base = { id: 'x', provenance: { source: 'edgar', sourceUrl: 'https://www.sec.gov/x',
    retrievedAt: '2026-11-02T00:00:00Z', parser: 'p' } };
  assert.throws(() => normalizeLuxAlgoRows('not-a-dataset', []), /unknown_luxalgo_dataset/);
  assert.throws(() => normalizeLuxAlgoRows('insider-transactions', [{ ...base, provenance: { ...base.provenance, source: 'not-a-source' } }]), /invalid_luxalgo/);
  assert.throws(() => normalizeLuxAlgoRows('insider-transactions', [{ ...base, provenance: { ...base.provenance, sourceUrl: 'http://bad' } }]), /invalid_luxalgo/);
  assert.throws(() => normalizeLuxAlgoRows('insider-transactions', [base, base]), /duplicate_luxalgo_row_id/);
});

test('coverage fails closed for missing, duplicate, unimplemented, or failed sources', () => {
  const successful = LUXALGO_SOURCES.map((source) => ({ source, implemented: true, ok: true, coverageComplete: true }));
  const full = assessLuxAlgoCoverage(successful);
  assert.equal(full.sourceComplete, true);
  assert.equal(full.observedSources, 17);
  assert.equal(full.expectedDatasets, 18);
  assert.equal(assessLuxAlgoCoverage(successful.slice(0, -1)).sourceComplete, false);
  const statusOnly = assessLuxAlgoCoverage(successful.map(({ coverageComplete, ...r }) => r));
  assert.equal(statusOnly.allSourcesSucceeded, true);
  assert.equal(statusOnly.sourceComplete, false, 'a successful sync is not proof of complete provider coverage');
  assert.equal(assessLuxAlgoCoverage(successful.map((r, i) => i ? r : { ...r, error: '429' })).sourceComplete, false);
  assert.equal(assessLuxAlgoCoverage(successful.map((r, i) => i ? r : { ...r, implemented: false })).sourceComplete, false);
  assert.throws(() => assessLuxAlgoCoverage([successful[0], successful[0]]), /invalid_or_duplicate/);
});

test('source inventory maps into exactly the declared dataset families', () => {
  const mapped = new Set(Object.values(LUXALGO_DATASETS).flat());
  assert.ok(LUXALGO_SOURCES.every((id) => mapped.has(id)));
  assert.ok(Object.values(LUXALGO_DATASETS).flat().every((id) => LUXALGO_SOURCES.includes(id)));
});

test('all 18 exported datasets normalize with their declared source provenance', () => {
  for (const [dataset, sources] of Object.entries(LUXALGO_DATASETS)) {
    const row = { id: `row-${dataset}`, title: `Evidence for ${dataset}`, cycle: 2026, filingYear: 2026,
      provenance: { source: sources[0], sourceUrl: 'https://source.gov/record',
        retrievedAt: '2026-11-02T01:00:00Z', parser: 'fixture@1', confidence: 1, needsReview: false } };
    const [event] = normalizeLuxAlgoRows(dataset, [row]);
    assert.equal(event.source, `luxalgo:${sources[0]}:${dataset}`);
    assert.equal(event.engine, 'government');
    assert.deepEqual(event.sourcePayload.record, row);
    assert.equal(event.observedAt, '2026-11-02T01:00:00.000Z');
  }
  const [fec] = normalizeLuxAlgoRows('fec-candidates', [{ id: 'cand:2026', cycle: 2026, name: 'Candidate',
    provenance: { source: 'fec', sourceUrl: 'https://fec.gov/record', retrievedAt: '2026-11-02T01:00:00Z', parser: 'fec@1' } }]);
  assert.equal(fec.eventTime, '2026-01-01T00:00:00.000Z');
});
