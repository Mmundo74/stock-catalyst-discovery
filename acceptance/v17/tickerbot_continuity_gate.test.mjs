import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTickerbotContinuation } from './tickerbot_continuity_gate.mjs';

const asOf = '2026-11-01T22:10:53.350Z';
const cursor = 'cursor-before';
const next = 'cursor-after';
const query = { q: 'abs(change_1d_pct) >= 5 OR relative_volume >= 3 OR gap_pct >= 5',
  order: 'change_1d_pct', dir: 'desc', limit: 10, universe: null, asset_class: ['stocks'], full: false };
const coverage = { in_scope_rows: 16030, columns: {
  change_1d_pct: { null_rows: 3246, evaluable_rows: 12784 },
  gap_pct: { null_rows: 3111, evaluable_rows: 12919 },
  relative_volume: { null_rows: 3190, evaluable_rows: 12840 },
} };
const prior = { status: 'committed', evidence: { as_of: asOf, query, in_scope_rows: coverage.in_scope_rows,
  null_coverage: coverage.columns } };
const response = (patch = {}) => ({ structuredContent: {
  as_of: asOf, query, count: 2, next_cursor: next,
  _meta: { null_coverage: coverage }, results: [{ ticker: 'AAA', relative_volume: null }, { ticker: 'BBB' }], ...patch,
} });
const assess = (args = {}) => assessTickerbotContinuation({ checkpointCursor: cursor, requestCursor: cursor,
  requestAsOf: asOf, previousRun: prior, response: response(), ...args });

test('advances a same-snapshot page while retaining partial-coverage status', () => {
  const result = assess();
  assert.equal(result.safeToAdvanceCheckpoint, true);
  assert.equal(result.sourceComplete, false);
  assert.equal(result.marketCoverage, 'partial_or_unproven');
});

test('rejects a provider invalid-cursor response without advancing', () => {
  const result = assess({ response: null, providerError: { status: 400, code: 'invalid_cursor' } });
  assert.equal(result.safeToAdvanceCheckpoint, false);
  assert.ok(result.reasons.includes('provider_rejected_cursor'));
});

test('rejects request cursor mismatch and permits recovery from the durable cursor', () => {
  const result = assess({ requestCursor: 'stale-process-cursor' });
  assert.equal(result.safeToAdvanceCheckpoint, false);
  assert.ok(result.reasons.includes('request_cursor_mismatch'));
});

test('rejects pages fetched at a different as-of snapshot', () => {
  const result = assess({ response: response({ as_of: '2026-11-02T01:10:05.776Z' }), requestAsOf: '2026-11-02T01:10:05.776Z' });
  assert.ok(result.reasons.includes('snapshot_anchor_changed'));
});

test('rejects data or universe changes between pages even when as-of is pinned', () => {
  const changed = structuredClone(coverage);
  changed.in_scope_rows = 16008;
  changed.columns.change_1d_pct = { null_rows: 3203, evaluable_rows: 12805 };
  const result = assess({ response: response({ _meta: { null_coverage: changed } }) });
  assert.ok(result.reasons.includes('coverage_snapshot_changed'));
});

test('rejects the observed stored-cursor page when universe counts and null coverage changed', () => {
  const observed = {
    in_scope_rows: 16008,
    columns: {
      change_1d_pct: { null_rows: 3203, evaluable_rows: 12805 },
      gap_pct: { null_rows: 3101, evaluable_rows: 12907 },
      relative_volume: { null_rows: 3197, evaluable_rows: 12811 },
    },
  };
  const result = assess({ response: response({ _meta: { null_coverage: observed,
    history_revised_at: { 'NPWR.WS': '2026-10-31T08:27:03.156Z' } } }) });
  assert.ok(result.reasons.includes('coverage_snapshot_changed'));
  assert.ok(!result.reasons.includes('historical_rows_revised_after_snapshot'));
  assert.equal(result.safeToAdvanceCheckpoint, false);
});

test('accepts correction metadata dated before the pinned historical view when scope is unchanged', () => {
  const result = assess({ response: response({ _meta: {
    null_coverage: coverage,
    history_revised_at: { AAA: '2026-10-31T08:27:03.156Z' },
  } }) });
  assert.equal(result.safeToAdvanceCheckpoint, true);
});

test('rejects a correction newer than the pinned historical view', () => {
  const result = assess({ response: response({ _meta: {
    null_coverage: coverage,
    history_revised_at: { AAA: '2026-11-02T01:00:00.000Z' },
  } }) });
  assert.ok(result.reasons.includes('historical_rows_revised_after_snapshot'));
  assert.equal(result.safeToAdvanceCheckpoint, false);
});

test('rejects malformed correction timestamps instead of guessing', () => {
  const result = assess({ response: response({ _meta: {
    null_coverage: coverage,
    history_revised_at: { AAA: 'unknown' },
  } }) });
  assert.ok(result.reasons.includes('historical_revision_timestamp_invalid'));
  assert.equal(result.safeToAdvanceCheckpoint, false);
});

test('rejects query or security-scope changes', () => {
  const changedQuery = { ...query, asset_class: null };
  const result = assess({ response: response({ query: changedQuery }) });
  assert.ok(result.reasons.includes('query_scope_changed'));
});

test('rejects count mismatches, missing coverage, and cursor loops', () => {
  assert.ok(assess({ response: response({ count: 3 }) }).reasons.includes('page_count_mismatch'));
  assert.ok(assess({ response: response({ _meta: {} }) }).reasons.includes('coverage_metadata_unavailable'));
  assert.ok(assess({ response: response({ next_cursor: cursor }) }).reasons.includes('cursor_did_not_advance'));
});

test('a terminal page can close pagination but does not imply complete market or signal coverage', () => {
  const result = assess({ response: response({ next_cursor: null }) });
  assert.equal(result.safeToAdvanceCheckpoint, true);
  assert.equal(result.terminalPage, true);
  assert.equal(result.sourceComplete, false);
  assert.equal(result.marketCoverage, 'partial_or_unproven');
});

test('fails closed when a provider explicitly reports that a cursor expired', () => {
  const result = assess({ response: null, providerError: { status: 410, code: 'cursor_expired' } });
  assert.equal(result.safeToAdvanceCheckpoint, false);
  assert.ok(result.reasons.includes('provider_cursor_expired'));
  assert.equal(result.sourceComplete, false);
});
