import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildMakeAlertPayload, deliverMakeAlert, dispatchClaimedOutboxItem } from './make_delivery_adapter.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
const item = {idempotency_key:'government:fed:event-1:'+hash('v1'),engine:'government',source:'fed',
  source_event_id:'event-1',fingerprint:hash('v1'),original_name:'Original issuer',
  event_time:'2026-11-01T12:00:00Z',observed_at:'2026-11-01T12:01:00Z',source_url:'https://example.gov/event'};
const qualification = (patch={}) => ({stage:'alert_eligible',alert_eligible:true,engine:item.engine,source:item.source,
  source_event_id:item.source_event_id,fingerprint:item.fingerprint,
  issuer_resolution:{status:'cross_correlated',issuer:{cik:'0000001001',ticker:'FIXT',legal_name:'Fixture Public Co',exchange:'Nasdaq'}},
  parent_relationship:{status:'verified_primary_document',review:{approved:true}},
  impact_assessment:{direction:'positive',rationale:'A primary source reports a material completed event.',assessedAt:'2026-11-01T12:02:00Z'},
  review:{approved:true},supporting_evidence:[
    {sourceName:'SEC',url:'https://www.sec.gov/a',sha256:hash('a'),sourceTimestamp:null,originalName:'SEC filing'},
    {sourceName:'Issuer',url:'https://issuer.example/b',sha256:hash('b'),sourceTimestamp:'2026-11-01T12:00:00Z',originalName:'Release'},
  ],...patch});

test('dry-run is default and emits stable Make webhook envelope without networking',async()=>{
  let called=false;
  const result=await deliverMakeAlert({item,qualification:qualification(),endpoint:'https://hooks.example.test/make',fetchImpl:async()=>{called=true;}});
  assert.equal(called,false); assert.equal(result.mode,'dry_run'); assert.equal(result.delivered,false);
  assert.equal(result.payload.idempotency_key,item.idempotency_key); assert.equal(result.payload.schema_version,'scd.alert.v1');
  assert.equal(result.payload.event.original_name,'Original issuer'); assert.equal(result.payload.evidence.length,2);
});

test('raw and research-qualified items are rejected before delivery',async()=>{
  for (const stage of ['raw_discovery','research_qualified']) {
    await assert.rejects(deliverMakeAlert({item,qualification:qualification({stage,alert_eligible:false}),enabled:true,
      endpoint:'https://hooks.example.test/make',fetchImpl:async()=>{throw new Error('must_not_call');}}),/qualification_not_alert_eligible/);
  }
});

test('event identity mismatch and duplicate evidence block delivery',()=>{
  assert.throws(()=>buildMakeAlertPayload({item,qualification:qualification({source_event_id:'other'})}),/qualification_event_mismatch/);
  const q=qualification(); q.supporting_evidence[1].url=q.supporting_evidence[0].url;
  assert.throws(()=>buildMakeAlertPayload({item,qualification:q}),/independent_evidence_required/);});

test('same publisher URLs are rejected before Make delivery',()=>{
 const q=qualification();
 q.supporting_evidence[0]={...q.supporting_evidence[0],sourceName:'Publisher',url:'https://www.publisher.example/a'};
 q.supporting_evidence[1]={...q.supporting_evidence[1],sourceName:'Publisher',url:'https://publisher.example/b'};
 assert.throws(()=>buildMakeAlertPayload({item,qualification:q}),/independent_evidence_required/);
});



test('live delivery requires separate environment opt-in and HTTPS',async()=>{
  const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;
  try {
    delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;
    await assert.rejects(deliverMakeAlert({item,qualification:qualification(),enabled:true,endpoint:'https://hooks.example.test/make'}),/delivery_environment_opt_in_required/);
    process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';
    await assert.rejects(deliverMakeAlert({item,qualification:qualification(),enabled:true,endpoint:'http://hooks.example.test/make'}),/secure_delivery_endpoint_required/);
  } finally {
    if (prior === undefined) delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;
    else process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior;
  }
});

test('POST carries the outbox idempotency key and reports receiver response only',async()=>{
  const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED; process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';
  try {
    let call;
    const result=await deliverMakeAlert({item,qualification:qualification(),enabled:true,endpoint:'https://hooks.example.test/make',
      fetchImpl:async(...args)=>{call=args;return {ok:true,status:202};}});
    assert.equal(call[0],'https://hooks.example.test/make');
    assert.equal(call[1].headers['idempotency-key'],item.idempotency_key);
    assert.equal(JSON.parse(call[1].body).event.source_event_id,item.source_event_id);
    assert.deepEqual({delivered:result.delivered,status:result.receiverStatus},{delivered:true,status:202});
  } finally { process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior; }
});

test('existing leased outbox item cannot send without a persisted alert-eligible qualification',async()=>{
  let queryText='';
  const client={query:async(sql)=>{queryText=sql;return {rows:[]};}};
  const leased={...item,claim_token:'token',payload:{...item}};
  const result=await dispatchClaimedOutboxItem({client,item:leased,workerToken:'token',endpoint:'https://hooks.example.test/make'});
  assert.equal(result.mode,'dry_run'); assert.equal(queryText,'');
  await assert.rejects(dispatchClaimedOutboxItem({client,item:leased,workerToken:'token',endpoint:'https://hooks.example.test/make',enabled:true}),/delivery_environment_opt_in_required/);
});

test('persisted unqualified candidate is permanently blocked without network delivery',async()=>{
  const calls=[];
  const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED; process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';
  const client={query:async(sql,args)=>{calls.push({sql,args}); if(sql.includes('FROM catalyst_acceptance.notification_outbox')) return {rowCount:1,rows:[{ok:1}]}; if(sql.startsWith('SELECT')) return {rowCount:1,rows:[{...qualification(),stage:'research_qualified',alert_eligible:false}]}; return {rowCount:1,rows:[]};}};
  const leased={...item,claim_token:'123e4567-e89b-42d3-a456-426614174000',lease_expires_at:new Date(Date.now()+60000),payload:{...item}};
  try {
    const result=await dispatchClaimedOutboxItem({client,item:leased,workerToken:leased.claim_token,endpoint:'https://hooks.example.test/make',enabled:true,fetchImpl:async()=>{throw new Error('must_not_send');}});
    assert.deepEqual(result,{delivered:false,mode:'blocked',reason:'qualification_not_alert_eligible'});
    assert.equal(calls.length,3); assert.match(calls[2].sql,/SET state=\$3/); assert.equal(calls[2].args[2],'failed');
  } finally { if(prior===undefined) delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED; else process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior; }
});
