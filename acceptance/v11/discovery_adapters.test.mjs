import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExaResults, normalizeTickerbotPage } from './discovery_adapters.mjs';

test('Exa normalization is ticker independent and retains provider labels/raw evidence', () => {
  const observed = '2026-11-01T20:00:00.000Z';
  const result = normalizeExaResults(`Title: Global science briefing\nURL: https://example.org/story\nPublished: N/A\nAuthor: Example Desk\nHighlights:\n- Research update`, observed);
  assert.equal(result.length, 1);
  assert.equal(result[0].engine, 'news');
  assert.equal(result[0].eventTime, observed);
  assert.equal(result[0].sourcePayload.published_label, 'N/A');
  assert.match(result[0].sourcePayload.rendered_result, /Research update/);
  assert.equal(normalizeExaResults(`Title: broken\nURL: javascript:alert(1)\nPublished: today`, observed).length, 0);
});

test('Tickerbot normalization preserves query/cursor and explicit null coverage', () => {
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
});

test('Tickerbot rejects structurally incomplete provider responses', () => {
  assert.throws(() => normalizeTickerbotPage({ structuredContent: { results: [] } }), /invalid_tickerbot_page/);
});
