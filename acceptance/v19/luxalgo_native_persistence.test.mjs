import test from 'node:test';
import assert from 'node:assert/strict';
import { LUXALGO_SOURCES } from './luxalgo_catalog.mjs';
import { buildLuxAlgoEvidenceBatch } from './luxalgo_native_bridge.mjs';
import { persistLuxAlgoEvidenceBatch } from './luxalgo_native_persistence.mjs';

function makeBatch(summary = { ok: true, results: LUXALGO_SOURCES.map((source) => ({ source, implemented: true })) }) {
  return buildLuxAlgoEvidenceBatch(summary, {
    'insider-transactions': [{ id: 'accession:nd:1', ticker: 'ABC', filedAt: '2026-11-01',
      provenance: { source: 'edgar', sourceUrl: 'https://www.sec.gov/Archives/filing',
        retrievedAt: '2026-11-02T00:00:00Z', parser: 'ownership@1' } }],
  });
}

class MockClient {
  constructor({ failRevision = false, duplicateRevision = false, failQuarantine = false } = {}) {
    this.calls=[]; this.inTransaction=false; this.failRevision=failRevision; this.duplicateRevision=duplicateRevision;
    this.failQuarantine=failQuarantine;
  }
  async query(sql, params=[]) {
    this.calls.push({sql:String(sql).replace(/\s+/g,' ').trim(),params});
    const q=this.calls.at(-1).sql;
    if(q==='BEGIN'){this.inTransaction=true;return {rowCount:0};}
    if(q==='COMMIT'){this.inTransaction=false;return {rowCount:0};}
    if(q==='ROLLBACK'){this.inTransaction=false;return {rowCount:0};}
    if(q.startsWith('INSERT INTO catalyst_acceptance.evidence_quarantine') && this.failQuarantine) throw new Error('injected');
    if(q.startsWith('INSERT INTO catalyst_acceptance.event_revisions') && this.failRevision)
      throw Object.assign(new Error('injected'), { code: '42601', severity: 'ERROR' });
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
  assert.equal(result.evidence.source_results.length,LUXALGO_SOURCES.length);
  assert.ok(result.evidence.source_results.every((source)=>source.parseCoverageKnown===false));
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

test('partial parser failure imports good records but records source health as error', async () => {
  const summary = { ok: true, results: LUXALGO_SOURCES.map((source) => ({ source, implemented: true,
    parseAttempted: source === 'fec' ? 2 : 0, parseSucceeded: source === 'fec' ? 1 : 0 })) };
  const batch = makeBatch(summary);
  const client = new MockClient();
  const result = await persistLuxAlgoEvidenceBatch(client, batch, 'lux_test_partial_parse');
  assert.equal(result.persisted.events, 1, 'valid records remain durable');
  assert.equal(result.evidence.coverage.parseFailureCount, 1);
  assert.equal(result.evidence.source_results.find((source) => source.source === 'fec').parseFailures, 1);
  const fecHealth = client.calls.find((call) => call.sql.includes('INSERT INTO catalyst_acceptance.source_health') &&
    call.params[0] === 'luxalgo:fec');
  assert.ok(fecHealth);
  assert.equal(fecHealth.params[1], 'error');
  assert.equal(fecHealth.params[2], 'source_parse_incomplete');
  assert.ok(client.calls.some((call) => call.sql === 'COMMIT'));
});

test('failed persistence rolls back and does not advance the shared import checkpoint', async () => {
  const client=new MockClient({failRevision:true});
  await assert.rejects(persistLuxAlgoEvidenceBatch(client,makeBatch(),'lux_test_failure'),(error)=>{
    assert.match(error.message,/durable_import_failed_42601/);
    assert.equal(error.persistenceOperation,'insert_revisions');
    return true;
  });
  assert.ok(client.calls.some((c)=>c.sql==='ROLLBACK'));
  assert.equal(client.calls.some((c)=>c.sql.startsWith('INSERT INTO catalyst_acceptance.checkpoints')),false);
  assert.ok(client.calls.some((c)=>c.sql.includes("status='failed'")));
});

test('undated raw rows are durably quarantined while dated records and checkpoints commit', async () => {
  const provenance = (id) => ({ source: 'federalreserve', sourceUrl: `https://www.federalreserve.gov/${id}`,
    retrievedAt: '2026-11-02T00:00:00Z', parser: 'fed-test@1' });
  const summary = { ok: true, results: LUXALGO_SOURCES.map((source) => ({ source, implemented: true,
    ...(source === 'federalreserve' ? { parseAttempted: 2, parseSucceeded: 2 } : {}) })) };
  const batch = buildLuxAlgoEvidenceBatch(summary, { 'fed-communications': [
    { id: 'dated-speech', title: 'Dated speech', date: '2026-11-02', provenance: provenance('dated') },
    { id: 'undated-speech', title: 'Undated speech', provenance: provenance('undated') },
  ] });
  const client = new MockClient();
  const result = await persistLuxAlgoEvidenceBatch(client, batch, 'lux_test_quarantine');
  assert.equal(result.persisted.events, 1);
  assert.equal(result.evidence.quarantined_records, 1);
  const quarantine = client.calls.find((call) => call.sql.startsWith('INSERT INTO catalyst_acceptance.evidence_quarantine'));
  assert.ok(quarantine, 'quarantine write is part of the import transaction');
  assert.equal(JSON.parse(quarantine.params[8]).record.id, 'undated-speech');
  const sourceHealth = client.calls.find((call) => call.sql.includes('INSERT INTO catalyst_acceptance.source_health') &&
    call.params[0] === 'luxalgo:federalreserve');
  assert.equal(sourceHealth.params[1], 'error');
  assert.equal(sourceHealth.params[2], 'source_event_time_missing');
  assert.ok(client.calls.findIndex((call) => call.sql.startsWith('INSERT INTO catalyst_acceptance.evidence_quarantine')) <
    client.calls.findIndex((call) => call.sql.startsWith("INSERT INTO catalyst_acceptance.checkpoints")));
  assert.ok(client.calls.some((call) => call.sql === 'COMMIT'));
});

test('quarantine write failure rolls back the import and leaves its checkpoint unchanged', async () => {
  const summary = { ok: true, results: LUXALGO_SOURCES.map((source) => ({ source, implemented: true })) };
  const batch = buildLuxAlgoEvidenceBatch(summary, { 'fed-communications': [{ id: 'undated-speech', title: 'Undated',
    provenance: { source: 'federalreserve', sourceUrl: 'https://www.federalreserve.gov/undated',
      retrievedAt: '2026-11-02T00:00:00Z', parser: 'fed-test@1' } }] });
  const client = new MockClient({ failQuarantine: true });
  await assert.rejects(persistLuxAlgoEvidenceBatch(client,batch,'lux_test_quarantine_rollback'),/durable_import_failed/);
  assert.ok(client.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(client.calls.some((call) => call.sql.startsWith("INSERT INTO catalyst_acceptance.checkpoints")),false);
});
