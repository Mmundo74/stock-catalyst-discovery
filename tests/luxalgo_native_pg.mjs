/**
 * MANUAL ONE-SHOT ACCEPTANCE HARNESS - NO COLLECTOR, SCHEDULER, OR ALERT.
 * Imports the pinned, unmodified LuxAlgo SQL driver at the workflow's pinned commit.
 * No credentials are logged, and only TEMP tables are modified.
 */
import assert from 'node:assert/strict';
import { createPostgresDriver, toPositionalParams } from '../vendor/luxalgo/packages/core/src/store/sql-driver.ts';

const databaseUrl = process.env.SUPABASE_SESSION_POOLER_URL;
if (!databaseUrl) {
  console.error('BLOCKED: SUPABASE_SESSION_POOLER_URL GitHub Actions secret is missing.');
  process.exit(2);
}
const report = { runtime: process.version, source_commit: '1ecfcca36a224d4758cc6e2e20cca216db43d5ee', environment: 'github_actions_native_node', checks: {} };
let connection;
try {
  assert.equal(toPositionalParams('SELECT ?::int + ?::int'), 'SELECT $1::int + $2::int');
  report.checks.placeholder_conversion = true;
  connection = await createPostgresDriver(databaseUrl);
  assert.equal(connection.dialect, 'postgres');
  assert.equal(connection.maxParams, 60000);
  report.checks.connection = true;
  await connection.exec('CREATE TEMP TABLE scd_luxalgo_node_acceptance (id text PRIMARY KEY, value text NOT NULL) ON COMMIT PRESERVE ROWS');
  const initial = await connection.run('INSERT INTO scd_luxalgo_node_acceptance (id,value) VALUES (?,?)', ['test', 'original']);
  assert.equal(initial.changes, 1);
  report.checks.insert = true;
  const revised = await connection.run('INSERT INTO scd_luxalgo_node_acceptance (id,value) VALUES (?,?) ON CONFLICT (id) DO UPDATE SET value=excluded.value', ['test', 'revised']);
  assert.equal(revised.changes, 1);
  assert.equal((await connection.get('SELECT value FROM scd_luxalgo_node_acceptance WHERE id=?', ['test']))?.value, 'revised');
  report.checks.upsert = true;
  let caught = false;
  try {
    await connection.transaction(async () => {
      await connection.run('INSERT INTO scd_luxalgo_node_acceptance (id,value) VALUES (?,?)', ['rollback', 'must_not_survive']);
      throw Error('synthetic_rollback');
    });
  } catch (err) { caught = err instanceof Error && err.message === 'synthetic_rollback'; }
  assert.equal(caught, true);
  assert.equal(await connection.get('SELECT value FROM scd_luxalgo_node_acceptance WHERE id=?', ['rollback']), undefined);
  report.checks.rollback = true;
  await connection.transaction(async () => {
    await connection.run('INSERT INTO scd_luxalgo_node_acceptance (id,value) VALUES (?,?)', ['commit', 'persist_in_session']);
  });
  assert.equal((await connection.get('SELECT value FROM scd_luxalgo_node_acceptance WHERE id=?', ['commit']))?.value, 'persist_in_session');
  report.checks.commit = true;
  await connection.close();
  connection = undefined;
  const otherConnection = await createPostgresDriver(databaseUrl);
  try {
    const row = await otherConnection.get('SELECT count(*)::integer AS n FROM catalyst_acceptance.events');
    assert.ok(Number.isInteger(row?.n) && row.n >= 4, 'prior acceptance evidence not readable');
    report.checks.reconnect_and_existing_evidence = true;
  } finally { await otherConnection.close(); }
  report.pass = Object.values(report.checks).every(Boolean);
  console.log(JSON.stringify(report));
  process.exitCode = report.pass ? 0 : 1;
} catch (err) {
  console.error(JSON.stringify({ pass: false, checks: report.checks, error_kind: err instanceof Error ? err.name : 'unknown', error_code: typeof err?.code === 'string' && /^[A-Z0-9_]+$/i.test(err.code) ? err.code : undefined, error_message: err instanceof Error ? err.message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[redacted]').slice(0, 240) : 'unknown', phase: 'native_pg_acceptance' }));
  process.exitCode = 1;
} finally {
  if (connection) await connection.close().catch(() => {});
}
