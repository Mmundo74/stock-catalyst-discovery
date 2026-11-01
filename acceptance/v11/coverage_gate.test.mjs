import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDiscoveryPage as assess } from './coverage_gate.mjs';

const rows = [{ sourceEventId: 'a' }, { sourceEventId: 'b' }];

test('valid intermediate page permits checkpoint but does not claim source completion', () => {
  const result = assess({ sourceKey: 'source', records: rows, cursorIn: '1', cursorOut: '2', expectedCount: 2 });
  assert.equal(result.checkpointCandidate, '2');
  assert.equal(result.safeToCommitPage, true);
  assert.equal(result.sourceComplete, false);
});

test('explicit provider terminal completion is required', () => {
  assert.equal(assess({ sourceKey: 'source', records: rows, providerComplete: true }).sourceComplete, true);
});

test('terminal page without provider completion remains incomplete', () => {
  const result = assess({ sourceKey: 'source', records: rows });
  assert.equal(result.sourceComplete, false);
  assert.equal(result.checkpointCandidate, null);
});

for (const [name, extra] of [
  ['truncated', { truncated: true }],
  ['source errors', { errors: ['timeout'] }],
  ['count mismatch', { expectedCount: 3 }],
  ['cursor loop', { cursorIn: 'x', cursorOut: 'x' }],
  ['duplicate ids', { records: [rows[0], rows[0]] }],
  ['missing ids', { records: [{}] }],
]) {
  test(name + ' blocks checkpoint advancement', () => {
    const result = assess({ sourceKey: 'source', records: rows, cursorOut: 'next', ...extra });
    assert.equal(result.safeToCommitPage, false);
    assert.equal(result.checkpointCandidate, null);
  });
}
