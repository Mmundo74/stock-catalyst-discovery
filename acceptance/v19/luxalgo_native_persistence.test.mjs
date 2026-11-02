import test from 'node:test';
import assert from 'node:assert/strict';
import { LUXALGO_SOURCES } from './luxalgo_catalog.mjs';
import { buildLuxAlgoEvidenceBatch } from './luxalgo_native_bridge.mjs';
import { persistLuxAlgoEvidenceBatch } from './luxalgo_native_persistence.mjs';

function makeBatch() {
  return buildLuxAlgoEvidenceBatch({ ok: true, results: LUXALGO_SOURCES.map((source) => ({ source, implemented: true })) }, {
    'insider-transactions': [{ id: 'accession:nd:1', ticker: 'ABC', filedAt: '2026-11-01',
      provenance: { source: 'edgar', sourceUrl: 'https://www.sec.gov/Archives/filing',
        retrievedAt: '2026-11-02T00:00:00Z', parser: 'ownership@1' } }],
  });
}

class MockClient {
  constructor({ failRevision = false, duplicateRevision = false } = {}) {
    this.calls=[]; this.inTransaction=false; this.failRevision=failRevision; this.duplicateRevision=duplicateRevision;
  }
  async query(sql, params=[]) {
    this.calls.push({sql:String(sql).replace(/\s+/g,' ').trim(),params});
    const q=this.calls.at(-1).sql;
    if(q==='BEGIN'){this.inTransaction=true;return {rowCount:0};}
    if(q==='COMMIT'){this.inTransaction=false;return {rowCount:0};}
    if(q==='ROLLBACK'){this.inTransaction=false;return {rowCount:0};}
    if(q.startsWith('INSERT INTO catalyst_acceptance.event_revisions') && this.failRevision) throw new Error('injected');
    if(q.startsWith('INSERT INTO catalyst_acceptance.event_revisions')) return {rowCount:this.duplicateRevision?0:1};
    return {rowCount:1};
  }
}

test('shared evidence is committed with revisions, source health, and import checkpoint', async () => {
  const client=new MockClient();
  const result=await persistLuxAlgoEvidenceBatch(client,makeBatch(),'lux_test_1');
  assert.equal(result.persisted.events,1);
  assert.equal(result.persisted.revisions,1);
  assert.equal(client.inTransaction,false);
  const checkpoint=client.calls.findIndex((c)=>c.sql.includes("VALUES('luxalgo:shared-evidence-import'"));
  const committed=client.calls.findIndex((c)=>c.sql==='COMMIT');
  assert.ok(checkpoint>0 && committed>checkpoint);
  assert.equal(result.evidence.coverage.coverageComplete,false);
  assert.equal(result.evidence.notification_outbox_created,0);
  assert.equal(client.calls.some((c)=>c.sql.includes('notification_outbox')),false);
});

test('replay safely upserts events and does not duplicate an existing revision', async () => {
  const client=new MockClient({duplicateRevision:true});
  const result=await persistLuxAlgoEvidenceBatch(client,makeBatch(),'lux_test_replay');
  assert.equal(result.persisted.events,1,'event identity is replayed through an idempotent upsert');
  assert.equal(result.persisted.revisions,0,'ON CONFLICT DO NOTHING suppresses a duplicate revision');
  assert.ok(client.calls.some((c)=>c.sql.includes('ON CONFLICT(engine,source,source_event_id) DO UPDATE')));
  assert.ok(client.calls.some((c)=>c.sql==='COMMIT'));
});

test('failed persistence rolls back and does not advance the shared import checkpoint', async () => {
  const client=new MockClient({failRevision:true});
  await assert.rejects(persistLuxAlgoEvidenceBatch(client,makeBatch(),'lux_test_failure'),/durable_import_failed/);
  assert.ok(client.calls.some((c)=>c.sql==='ROLLBACK'));
  assert.equal(client.calls.some((c)=>c.sql.startsWith('INSERT INTO catalyst_acceptance.checkpoints')),false);
  assert.ok(client.calls.some((c)=>c.sql.includes("status='failed'")));
});
