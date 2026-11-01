import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeOutboxItem, claimOutboxItems, releaseOutboxItem } from './outbox_worker.mjs';

const key = 'government:acceptance:fixture:sha256';
const token = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a';

test('claim requires an explicit bounded idempotency-key allowlist', async () => {
  let called = false;
  const client = { query: async () => { called = true; return { rows: [] }; } };
  await assert.rejects(claimOutboxItems(client, { idempotencyKeys: [] }), /invalid_idempotency_keys/);
  await assert.rejects(claimOutboxItems(client, { idempotencyKeys: [key, key] }), /invalid_idempotency_keys/);
  assert.equal(called, false);
});

test('claim query uses bounded allowlist, lease expiry, and independent row locking', async () => {
  let call;
  const client = { query: async (...args) => { call = args; return { rows: [{ idempotency_key: key }] }; } };
  const result = await claimOutboxItems(client, { idempotencyKeys: [key], workerToken: token, leaseMs: 30_000 });
  assert.match(call[0], /FOR UPDATE SKIP LOCKED/);
  assert.match(call[0], /lease_expires_at <= clock_timestamp\(\)/);
  assert.match(call[0], /ANY\(\$1::text\[\]\)/);
  assert.deepEqual(call[1], [[key], 1, token, 30_000]);
  assert.equal(result.workerToken, token);
  assert.equal(result.items.length, 1);
});

test('claim limits and lease bounds fail before database access', async () => {
  const client = { query: async () => { throw new Error('should_not_query'); } };
  await assert.rejects(claimOutboxItems(client, { idempotencyKeys: [key], limit: 2 }), /invalid_claim_limit/);
  await assert.rejects(claimOutboxItems(client, { idempotencyKeys: [key], leaseMs: 999 }), /invalid_lease_ms/);
});

test('acknowledgement requires a live matching claim and reports lost leases', async () => {
  let call;
  const client = { query: async (...args) => { call = args; return { rowCount: 0 }; } };
  await assert.rejects(acknowledgeOutboxItem(client, { idempotencyKey: key, workerToken: token }), /outbox_claim_lost/);
  assert.match(call[0], /lease_expires_at > clock_timestamp\(\)/);
  assert.match(call[0], /claim_token=\$2::uuid/);
});

test('release stores a safe short error code and fences stale workers', async () => {
  let call;
  const client = { query: async (...args) => { call = args; return { rowCount: 1 }; } };
  await releaseOutboxItem(client, { idempotencyKey: key, workerToken: token, errorCode: 'provider.503:retry' });
  assert.match(call[0], /state='processing'/);
  assert.deepEqual(call[1], [key, token, 'pending', 'provider.503:retry']);
  await assert.rejects(releaseOutboxItem(client, { idempotencyKey: key, workerToken: token, errorCode: 'URI contains secret=abc' }), /invalid_error_code/);
});

test('permanent failures transition to failed without exposing exception text', async () => {
  let call;
  const client = { query: async (...args) => { call = args; return { rowCount: 1 }; } };
  await releaseOutboxItem(client, { idempotencyKey: key, workerToken: token, errorCode: 'payload.invalid', permanent: true });
  assert.equal(call[1][2], 'failed');
  assert.equal(call[1][3], 'payload.invalid');
});
