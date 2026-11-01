import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExaResults, normalizeExaPage, normalizeTickerbotPage } from './discovery_adapters.mjs';

test('Exa normalization is ticker independent and retains provider labels/raw evidence', () => {
  const observed = '2026-11-01T20:00:00.000Z';
  const result = ['Title: Global science briefing','URL: https://example.org/story','Published: N/A','Author: Example Desk','Highlights:','- Research update'].join('\n');
  const rows = normalizeExaResults(result, observed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].engine, 'news');
  assert.equal(rows[0].eventTime, observed);
  assert.equal(rows[0].sourcePayload.published_label, 'N/A');
  assert.match(rows[0].sourcePayload.rendered_result, /Research update/);
  assert.equal(normalizeExaResults(['Title: broken','URL: javascript:alert(1)','Published: today'].join('\n'), observed).length, 0);
});

test('Tickerbot normalization preserves optional coverage metadata and explicit cursor', () => {
  const page = { structuredContent: {
    as_of: '2026-11-01T20:37:25.770Z', count: 1, next_cursor: 'opaque-next',
    query: { q: 'asset_type = CS AND rapid_move_up_5m', limit: 1 },
    _meta: { null_coverage: { in_scope_rows: 16030, columns: { rapid_move_up_5m: { null_rows: 3389, evaluable_rows: 12641 } } } },
    results: [{ ticker: 'ABC', name: 'Example Corp', asset_type: 'CS', rapid_move_up_5m: true }],
  } };
  const out = normalizeTickerbotPage(page);
  assert.equal(out.records[0].engine, 'market');
  assert.equal(out.records[0].sourcePayload.raw_record.ticker, 'ABC');
  assert.equal(out.page.inScopeRows, 16030);
  assert.equal(out.page.signalCoverage.rapid_move_up_5m.null_rows, 3389);
  assert.equal(out.page.nextCursor, 'opaque-next');
  assert.equal(out.page.complete, false);
  assert.equal(normalizeTickerbotPage({ structuredContent: { ...page.structuredContent, next_cursor: null } }).page.complete, true);
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
  assert.equal(terminal.page.complete, true);
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
