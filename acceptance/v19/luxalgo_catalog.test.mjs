import test from 'node:test';
import assert from 'node:assert/strict';
import { LUXALGO_COMMIT, LUXALGO_DATASETS, LUXALGO_SOURCES, assessLuxAlgoCoverage, normalizeLuxAlgoRows } from './luxalgo_catalog.mjs';
import { LUXALGO_EXPORT_DIRS, buildLuxAlgoEvidenceBatch, luxAlgoDatabaseUrl } from './luxalgo_native_bridge.mjs';

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
    assert.equal(event.source, dataset === 'fed-communications' ? 'luxalgo_federalreserve' : `luxalgo:${sources[0]}:${dataset}`);
    assert.equal(event.engine, 'government');
    assert.deepEqual(event.sourcePayload.record, row);
    assert.equal(event.observedAt, '2026-11-02T01:00:00.000Z');
  }
  const [fec] = normalizeLuxAlgoRows('fec-candidates', [{ id: 'cand:2026', cycle: 2026, name: 'Candidate',
    provenance: { source: 'fec', sourceUrl: 'https://fec.gov/record', retrievedAt: '2026-11-02T01:00:00Z', parser: 'fec@1' } }]);
  assert.equal(fec.eventTime, null, 'election cycle alone is not an event date');
  const [fed] = normalizeLuxAlgoRows('fed-communications', [{ id:'speech/test20261102a', title:'Fed communication',
    provenance:{source:'federalreserve',sourceUrl:'https://www.federalreserve.gov/newsevents/speech/test20261102a.htm',
      retrievedAt:'2026-11-02T01:00:00Z',parser:'fed@1'} }]);
  assert.equal(fed.source,'luxalgo_federalreserve');
  assert.equal(fed.sourceEventId,'speech/test20261102a');
});

test('native evidence bridge inventories every dataset and imports full snapshots without claiming completeness', () => {
  assert.equal(Object.keys(LUXALGO_EXPORT_DIRS).length, 18);
  const syncSummary = { ok: true, results: LUXALGO_SOURCES.map((source) => ({ source, implemented: true })) };
  const dateFields = {
    'congress-trades':['transactedAt'], 'insider-transactions':['filedAt'], 'thirteenf-holdings':['periodEnd'],
    'gov-contracts':['actionDate'], 'gov-grants':['actionDate'], 'lobbying-filings':['filingYear'],
    'short-volume':['date'], 'committee-assignments':['effectiveDate'], patents:['grantDate'],
    'clinical-trials':['lastUpdated'], 'fda-approvals':['statusDate'], 'cot-reports':['reportDate'],
    'wiki-pageviews':['day'], bills:['latestActionDate'], 'fec-candidates':['coverageEndDate'],
    'fec-contributions':['date'], 'congress-hearings':['heldDate'], 'fed-communications':['date'],
  };
  const datasetRows = Object.fromEntries(Object.entries(LUXALGO_DATASETS).map(([dataset, sources]) => [dataset, [{
    id: `row-${dataset}`, title: dataset, provenance: { source: sources[0],
      sourceUrl: 'https://example.gov/record', retrievedAt: '2026-11-02T00:00:00Z', parser: 'fixture@1' },
    ...Object.fromEntries(dateFields[dataset].map((field) => [field,
      ['filingYear','cycle'].includes(field) ? '2026' : '2026-11-02'])) ,
  }]]));
  const batch = buildLuxAlgoEvidenceBatch(syncSummary, datasetRows);
  assert.equal(batch.records.length, 17);
  assert.equal(batch.quarantinedRecords.length, 1, 'year-only lobbying reference must remain undated');
  assert.equal(batch.quarantinedRecords[0].source, 'luxalgo:lda:lobbying-filings');
  assert.equal(batch.coverage.allSourcesSucceeded, false);
  assert.deepEqual(batch.coverage.failedSources, ['lda']);
  assert.equal(batch.coverage.allDatasetsExported, true);
  assert.deepEqual(batch.coverage.missingDatasets, []);
  assert.equal(batch.coverage.sourceComplete, false);
  assert.equal(batch.coverage.coverageComplete, false);
  assert.equal(batch.coverage.failedSources.length, 1);
});

test('native bridge records source errors and refuses false completeness on partial exports', () => {
  const summary = { ok: true, results: LUXALGO_SOURCES.map((source, i) => ({ source, implemented: true,
    ...(i === 0 ? { error: 'HTTP 429 https://example.gov/?api_key=do-not-copy' } : {}) })) };
  const batch = buildLuxAlgoEvidenceBatch(summary, {});
  assert.equal(batch.coverage.failedSources.length, 1);
  assert.equal(batch.coverage.failedSources[0], LUXALGO_SOURCES[0]);
  assert.equal(batch.sourceResults[0].error, 'upstream_rate_limited');
  assert.equal(JSON.stringify(batch).includes('do-not-copy'), false);
  assert.equal(batch.coverage.allDatasetsExported, false);
  assert.equal(batch.coverage.missingDatasets.length, 18);
  assert.equal(batch.coverage.sourceComplete, false);
});

test('native bridge marks source partial when upstream skips malformed rows', () => {
  const summary = { ok: true, results: LUXALGO_SOURCES.map((source) => ({
    source, implemented: true, parseAttempted: source === 'fec' ? 2 : 0,
    parseSucceeded: source === 'fec' ? 1 : 0, rowsUpserted: source === 'fec' ? 1 : 0,
  })) };
  const batch = buildLuxAlgoEvidenceBatch(summary, {});
  const fec = batch.sourceResults.find((result) => result.source === 'fec');
  assert.equal(fec.ok, false);
  assert.equal(fec.error, 'source_parse_incomplete');
  assert.equal(fec.parseCoverageKnown, true);
  assert.equal(fec.parseFailures, 1);
  assert.equal(batch.coverage.parseFailureCount, 1);
  assert.deepEqual(batch.coverage.failedSources, ['fec']);
  assert.deepEqual(batch.coverage.parseCoverageUnknownSources, []);
  assert.equal(batch.coverage.sourceComplete, false);
});

test('native bridge flags explicitly reported malformed index-row skips even when parser counters remain zero', () => {
  const summary = { ok: true, results: LUXALGO_SOURCES.map((source) => ({
    source, implemented: true, parseAttempted: 0, parseSucceeded: 0,
    ...(source === 'house-clerk' ? { notes: ['2026: 38 malformed index rows skipped'] } : {}),
  })) };
  const batch = buildLuxAlgoEvidenceBatch(summary, {});
  const house = batch.sourceResults.find((result) => result.source === 'house-clerk');
  assert.equal(house.error, 'source_parse_incomplete');
  assert.equal(house.parseFailures, 0);
  assert.equal(house.parseFailureHintCount, 38);
  assert.equal(batch.coverage.parseFailureCount, 0);
  assert.equal(batch.coverage.parseFailureHintCount, 38);
  assert.ok(batch.coverage.failedSources.includes('house-clerk'));
});

test('native bridge rejects malformed or impossible parse coverage metadata', () => {
  for (const values of [
    { parseAttempted: -1, parseSucceeded: 0 },
    { parseAttempted: 1, parseSucceeded: 2 },
    { parseAttempted: 1 },
  ]) {
    const summary = { ok: true, results: LUXALGO_SOURCES.map((source) => ({
      source, implemented: true, ...(source === 'fec' ? values : { parseAttempted: 0, parseSucceeded: 0 }),
    })) };
    const batch = buildLuxAlgoEvidenceBatch(summary, {});
    const fec = batch.sourceResults.find((result) => result.source === 'fec');
    assert.equal(fec.ok, false);
    assert.equal(fec.error, 'invalid_parse_coverage_metadata');
    assert.deepEqual(batch.coverage.failedSources, ['fec']);
    assert.ok(batch.coverage.parseCoverageUnknownSources.includes('fec'));
    assert.equal(batch.coverage.sourceComplete, false);
  }
});

test('native bridge records when an older source result omits parse counters without claiming complete coverage', () => {
  const summary = { ok: true, results: LUXALGO_SOURCES.map((source) => ({ source, implemented: true })) };
  const batch = buildLuxAlgoEvidenceBatch(summary, {});
  assert.deepEqual(batch.coverage.failedSources, []);
  assert.deepEqual(batch.coverage.parseCoverageUnknownSources, LUXALGO_SOURCES);
  assert.equal(batch.coverage.sourceComplete, false);
  assert.equal(batch.coverage.coverageComplete, false);
});

test('LuxAlgo Postgres client is scoped to the isolated schema per connection', () => {
  const connection = luxAlgoDatabaseUrl('postgresql://user:pass@localhost:5432/postgres?sslmode=require');
  const url = new URL(connection);
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('options'), '-c search_path=luxalgo_native,catalyst_acceptance,public');
});

test('reporting years never become fictitious January 1 catalysts', () => {
  const provenance = { source:'lda', sourceUrl:'https://lda.gov/filings/public/filing/test/print/',
    retrievedAt:'2026-11-02T07:00:00Z', parser:'lda-filings@1' };
  const lda = { id:'test-filing', filingYear:2026, filingPeriod:'third_quarter', provenance };
  const [normalized] = normalizeLuxAlgoRows('lobbying-filings', [lda]);
  assert.equal(normalized.eventTime, null);
  assert.equal(normalized.sourcePayload.record.filingYear, 2026);
  assert.equal(normalized.sourcePayload.record.filingPeriod, 'third_quarter');
  const batch = buildLuxAlgoEvidenceBatch({ ok:true, results:[{source:'lda', implemented:true, rowsUpserted:1}] },
    { 'lobbying-filings':[lda] });
  assert.equal(batch.records.length, 0);
  assert.equal(batch.quarantinedRecords.length, 1);
  assert.equal(batch.quarantinedRecords[0].failureReason, 'event_time_missing');
  assert.deepEqual(batch.coverage.failedSources, ['lda']);
  assert.equal(batch.sourceResults[0].error, 'source_event_time_missing');
  assert.equal(batch.coverage.coverageComplete, false);
});

test('real FEC reporting end dates remain valid, but cycle-only and invalid dates do not', () => {
  const provenance = { source:'fec', sourceUrl:'https://www.fec.gov/data/candidate/test/',
    retrievedAt:'2026-11-02T07:00:00Z', parser:'fec-bulk@1' };
  const candidate = { id:'test:2026', cycle:2026, coverageEndDate:'2026-10-14', provenance };
  assert.equal(normalizeLuxAlgoRows('fec-candidates', [candidate])[0].eventTime, '2026-10-14T00:00:00.000Z');
  assert.equal(normalizeLuxAlgoRows('fec-candidates', [{...candidate, coverageEndDate:undefined}])[0].eventTime, null);
  assert.equal(normalizeLuxAlgoRows('fec-candidates', [{...candidate, coverageEndDate:'2026-02-30'}])[0].eventTime, null);
});
test('material fingerprint is stable across refetch timestamps and object key order', () => {
  const provenance = { source:'clinicaltrials', sourceUrl:'https://clinicaltrials.gov/study/NCT00000001',
    retrievedAt:'2026-11-02T06:00:00Z', parser:'clinicaltrials@1' };
  const row = { id:'NCT00000001', title:'Original research', lastUpdated:'2026-10-30', provenance };
  const [first] = normalizeLuxAlgoRows('clinical-trials',[row]);
  const secondRow = { provenance:{ ...provenance, retrievedAt:'2026-11-02T07:00:00Z' },
    lastUpdated:'2026-10-30', title:'Original research', id:'NCT00000001' };
  const [second] = normalizeLuxAlgoRows('clinical-trials',[secondRow]);
  const [changed] = normalizeLuxAlgoRows('clinical-trials',[{ ...secondRow, title:'Actual new research' }]);
  assert.equal(first.fingerprint, second.fingerprint, 'refetch time must not create a revision');
  assert.notEqual(first.fingerprint, changed.fingerprint, 'material title update must create a revision');
  assert.notEqual(first.observedAt, second.observedAt);
  assert.equal(second.sourcePayload.record.provenance.retrievedAt,'2026-11-02T07:00:00Z');
});
