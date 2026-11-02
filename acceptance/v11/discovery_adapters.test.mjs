import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExaResults, normalizeExaPage, normalizeTickerbotPage } from './discovery_adapters.mjs';

test('Exa normalization is ticker independent and retains provider labels/raw evidence', () => {
  const observed = '2026-11-01T20:00:00.000Z';
  const result = ['Title: Global science briefing','URL: https://example.org/story','Published: N/A','Author: Example Desk','Highlights:','- Research update'].join('\n');
  const rows = normalizeExaResults(result, observed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].engine, 'news');
  assert.equal(rows[0].eventTime, null, 'retrieval time must not be substituted for source publication time');
  assert.equal(rows[0].sourcePayload.published_label, 'N/A');
  assert.equal(rows[0].sourcePayload.source_timestamp_status, 'missing_or_unparseable');
  assert.match(rows[0].sourcePayload.rendered_result, /Research update/);
  assert.equal(normalizeExaResults(['Title: broken','URL: javascript:alert(1)','Published: today'].join('\n'), observed).length, 0);
});

test('Exa preserves a provider publication timestamp and distinguishes it from retrieval time', () => {
  const observed = '2026-11-01T20:00:00.000Z';
  const text = ['Title: Timestamped story','URL: https://example.org/timestamped','Published: 2026-11-01T19:30:00-05:00'].join('\n');
  const [record] = normalizeExaResults(text, observed);
  assert.equal(record.eventTime, '2026-11-02T00:30:00.000Z');
  assert.equal(record.observedAt, observed);
  assert.equal(record.sourcePayload.source_timestamp_status, 'provided');
});

test('Tickerbot normalization preserves optional coverage metadata and explicit cursor', () => {
  const page = { structuredContent: {
    as_of: '2026-11-01T20:37:25.770Z', count: 1, next_cursor: 'opaque-next',
    query: { q: 'asset_type = CS AND rapid_move_up_5m', limit: 1 },
    _meta: { null_coverage: { measured_at:'2026-11-01T20:37:25.700Z', in_scope_rows: 16030, columns: { rapid_move_up_5m: { null_rows: 3389, evaluable_rows: 12641 } } } },
    results: [{ ticker: 'ABC', name: 'Example Corp', asset_type: 'CS', rapid_move_up_5m: true }],
  } };
  const out = normalizeTickerbotPage(page);
  assert.equal(out.records[0].engine, 'market');
  assert.equal(out.records[0].sourcePayload.raw_record.ticker, 'ABC');
  assert.equal(out.page.inScopeRows, 16030);
  assert.equal(out.page.signalCoverage.rapid_move_up_5m.null_rows, 3389);
  assert.equal(out.page.signalCoverageStatus, 'provider_reported');
  assert.equal(out.page.coverageMeasuredAt,'2026-11-01T20:37:25.700Z');
  assert.equal(out.page.nextCursor, 'opaque-next');
  assert.equal(out.page.complete, false);
  const terminal = normalizeTickerbotPage({ structuredContent: { ...page.structuredContent, next_cursor: null } });
  assert.equal(terminal.page.paginationComplete, true);
  assert.equal(terminal.page.sourceComplete, false);
  assert.equal(terminal.page.complete, false);
  assert.equal(normalizeTickerbotPage({ structuredContent: { ...page.structuredContent, next_cursor: undefined } }).page.complete, false);
});

test('actual Tickerbot scan shape without optional _meta is accepted and page checked', () => {
  const actualShape = { structuredContent: {
    as_of: '2026-11-01T21:03:06.160Z', count: 2, next_cursor: 'opaque-cursor',
    query: { q: 'ticker IS NOT NULL', limit: 2, asset_class: ['stocks'] },
    results: [
      { ticker: 'A', name: 'Agilent Technologies Inc.', asset_class: 'stocks', asset_type: 'CS', price: 174.055 },
      { ticker: 'AA', name: 'Alcoa Corporation', asset_class: 'stocks', asset_type: 'CS', price: 39.11 },
    ],
  } };
  const out = normalizeTickerbotPage(actualShape);
  assert.equal(out.records.length, 2);
  assert.equal(out.page.safeToCommitPage, true);
  assert.equal(out.page.checkpointCandidate, 'opaque-cursor');
  assert.equal(out.page.inScopeRows, null);
  assert.equal(out.page.signalCoverageStatus, 'unknown');
  assert.equal(out.page.coverage.countMismatch, false);
});

test('Tickerbot rejects structurally incomplete provider responses', () => {
  assert.throws(() => normalizeTickerbotPage({ structuredContent: { results: [] } }), /invalid_tickerbot_page/);
});

test('Tickerbot page gate advances a valid page and recognizes documented terminal cursor', () => {
  const base = { as_of: '2026-11-01T20:37:25.770Z', count: 1, query: { q: 'broad scan', limit: 1 }, results: [{ ticker: 'ABC', name: 'Example Corp' }] };
  const intermediate = normalizeTickerbotPage({ structuredContent: { ...base, next_cursor: 'c2' } }, { cursorIn: 'c1' });
  assert.equal(intermediate.page.safeToCommitPage, true);
  assert.equal(intermediate.page.checkpointCandidate, 'c2');
  assert.equal(intermediate.page.complete, false);
  const terminal = normalizeTickerbotPage({ structuredContent: { ...base, next_cursor: null } });
  assert.equal(terminal.page.paginationComplete, true);
  assert.equal(terminal.page.complete, false);
  assert.equal(terminal.page.coverage.sourceComplete, false);
  const terminalWithoutCursorField = normalizeTickerbotPage({ structuredContent: base });
  assert.equal(terminalWithoutCursorField.page.complete, false);
});

test('Tickerbot blocks checkpoint after malformed provider rows', () => {
  const result = normalizeTickerbotPage({ structuredContent: {
    as_of: '2026-11-01T20:37:25.770Z', count: 2, next_cursor: 'next',
    query: { q: 'broad scan' }, results: [{ ticker: 'ABC', name: 'Example Corp' }, { ticker: 7, name: 'bad ticker' }],
  } });
  assert.equal(result.records.length, 1);
  assert.equal(result.page.safeToCommitPage, false);
  assert.equal(result.page.checkpointCandidate, null);
});

test('Exa page coverage does not infer continuation or terminal completeness', () => {
  const text = ['Title: Science result','URL: https://example.org/a','Published: N/A'].join('\n');
  const intermediate = normalizeExaPage(text, '2026-11-01T20:00:00.000Z', { cursorIn: '1', cursorOut: '2' });
  assert.equal(intermediate.page.checkpointCandidate, '2');
  assert.equal(intermediate.page.sourceComplete, false);
  const terminal = normalizeExaPage(text, '2026-11-01T20:00:00.000Z', { providerComplete: true });
  assert.equal(terminal.page.sourceComplete, true);
});


test('Tickerbot separates common shares, fund instruments, warrants, rights, and unknown codes', () => {
  const rows = ['CS', 'ETF', 'WARRANT', 'RIGHT', 'UNLISTED'].map((asset_type, i) => ({ ticker:'T'+i, name:'Instrument '+i, asset_class:'stocks', asset_type }));
  const result = normalizeTickerbotPage({ structuredContent: {
    as_of:'2026-11-01T21:03:06.160Z', count:rows.length, next_cursor:null, query:{ q:'ticker IS NOT NULL' }, results:rows,
  } });
  assert.deepEqual(result.records.map(r => r.sourcePayload.instrument_classification.instrumentClass),
    ['common_stock', 'exchange_traded_fund', 'warrant', 'right', null]);
  assert.equal(result.records.at(-1).sourcePayload.instrument_classification.status, 'unknown_asset_type');
  assert.equal(result.page.signalCoverageStatus, 'unknown');
});

test('Tickerbot reports security type coverage across pages without dropping unclassified or non-common rows', () => {
  const makePage = (rows, next_cursor, cursor) => normalizeTickerbotPage({ structuredContent: {
    as_of:'2026-11-02T02:45:51.419Z', count:rows.length, next_cursor,
    query:{q:'asset_class = stocks',asset_class:['stocks'],limit:4},
    _meta:{null_coverage:{in_scope_rows:100,columns:{asset_type:{null_rows:3,evaluable_rows:97}}}},
    results:rows,
  } }, {cursorIn:cursor});
  const first = makePage([
    {ticker:'CS1',name:'Common',asset_class:'stocks',asset_type:'CS'},
    {ticker:'ADR1',name:'ADR common',asset_class:'stocks',asset_type:'ADRC'},
    {ticker:'UNIT1',name:'Acquisition unit',asset_class:'stocks',asset_type:'UNIT'},
    {ticker:'W1',name:'Warrant',asset_class:'stocks',asset_type:'WARRANT'},
  ],'cursor-2','cursor-1');
  const second = makePage([
    {ticker:'R1',name:'Right',asset_class:'stocks',asset_type:'RIGHT'},
    {ticker:'UNK1',name:'Unknown',asset_class:'stocks',asset_type:'NEWTYPE'},
    {ticker:'MISS1',name:'Missing type',asset_class:'stocks'},
    {ticker:'FUND1',name:'Fund',asset_class:'stocks',asset_type:'ETF'},
  ],null,'cursor-2');
  assert.equal(first.records.length,4);
  assert.equal(second.records.length,4);
  assert.equal(first.page.safeToCommitPage,true);
  assert.equal(first.page.checkpointCandidate,'cursor-2');
  assert.equal(second.page.paginationComplete,true);
  assert.equal(second.page.checkpointCandidate,null);
  assert.equal(second.page.complete,false);
  assert.deepEqual(first.page.instrumentCoverage.instrumentClassCounts,{
    common_stock:1,adr_common_stock:1,unit:1,warrant:1,
  });
  assert.deepEqual(second.page.instrumentCoverage.instrumentClassCounts,{
    right:1,'unknown:NEWTYPE':1,'unknown:missing':1,exchange_traded_fund:1,
  });
  assert.equal(second.page.instrumentCoverage.unknownAssetTypeRows,2);
  assert.equal(second.page.instrumentCoverage.missingAssetTypeRows,1);
  assert.deepEqual(second.page.instrumentCoverage.unknownAssetTypeCodes,['NEWTYPE']);
  assert.equal(second.page.instrumentCoverage.classificationComplete,false);
});
