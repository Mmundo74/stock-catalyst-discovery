import test from 'node:test';
import assert from 'node:assert/strict';
import { safeLuxAlgoBridgeFailure } from './luxalgo_native_bridge.mjs';

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
