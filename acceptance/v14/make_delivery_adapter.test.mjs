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
  parent_relationship:{status:'verified_primary_document',review:{approved:true,reviewedAt:'2026-11-02T00:00:00Z'}},
  impact_assessment:{direction:'positive',rationale:'A primary source reports a material completed event.',assessedAt:'2026-11-02T00:00:00Z'},
  review:{approved:true,reviewerId:'reviewer-1',reviewedAt:'2026-11-02T00:00:00Z',independentEvidenceConfirmed:true},supporting_evidence:[
    {sourceName:'SEC',url:'https://www.sec.gov/a',sha256:hash('a'),sourceTimestamp:'2026-11-02T00:00:00Z',originalName:'SEC filing'},
    {sourceName:'Issuer',url:'https://issuer.example/b',sha256:hash('b'),sourceTimestamp:'2026-11-02T00:00:00Z',originalName:'Release'},
  ],...patch});

test('dry-run is default and emits stable envelope without networking',async()=>{
  let called=false; const result=await deliverMakeAlert({item,qualification:qualification(),endpoint:'https://hooks.example.test/make',fetchImpl:async()=>{called=true;}});
  assert.equal(called,false);assert.equal(result.mode,'dry_run');assert.equal(result.delivered,false);
  assert.equal(result.payload.idempotency_key,item.idempotency_key);assert.equal(result.payload.schema_version,'scd.alert.v1');
  assert.equal(result.payload.event.original_name,'Original issuer');assert.equal(result.payload.evidence.length,2);
});
test('raw and research-qualified items are rejected before delivery',async()=>{
 for(const stage of ['raw_discovery','research_qualified']) await assert.rejects(deliverMakeAlert({item,qualification:qualification({stage,alert_eligible:false}),enabled:true,endpoint:'https://hooks.example.test/make'}),/qualification_not_alert_eligible/);
});
test('event identity mismatch and duplicate evidence block delivery',()=>{
 assert.throws(()=>buildMakeAlertPayload({item,qualification:qualification({source_event_id:'other'})}),/qualification_event_mismatch/);
 const q=qualification();q.supporting_evidence[1].url=q.supporting_evidence[0].url;
 assert.throws(()=>buildMakeAlertPayload({item,qualification:q}),/independent_evidence_required/);
});
test('same publisher URLs are rejected before delivery',()=>{
 const q=qualification();q.supporting_evidence[0]={...q.supporting_evidence[0],sourceName:'Publisher',url:'https://www.publisher.example/a'};
 q.supporting_evidence[1]={...q.supporting_evidence[1],sourceName:'Publisher',url:'https://publisher.example/b'};
 assert.throws(()=>buildMakeAlertPayload({item,qualification:q}),/independent_evidence_required/);
});
test('stale or undated evidence and reviews block Make delivery',()=>{
 const stale=qualification();stale.supporting_evidence=stale.supporting_evidence.map(e=>({...e,sourceTimestamp:'2026-10-01T00:00:00Z'}));
 assert.throws(()=>buildMakeAlertPayload({item,qualification:stale}),/independent_evidence_required/);
 const staleReview=qualification();staleReview.review={approved:true,reviewerId:'reviewer-1',independentEvidenceConfirmed:true,reviewedAt:'2026-10-01T00:00:00Z'};
 assert.throws(()=>buildMakeAlertPayload({item,qualification:staleReview}),/qualification_evidence_stale/);
 const undated=qualification();undated.supporting_evidence[0].sourceTimestamp=null;
 assert.throws(()=>buildMakeAlertPayload({item,qualification:undated}),/independent_evidence_required/);
 const noAttestation=qualification();noAttestation.review.independentEvidenceConfirmed=false;
 assert.throws(()=>buildMakeAlertPayload({item,qualification:noAttestation}),/evidence_independence_review_required/);
});
test('live delivery requires separate environment opt-in and HTTPS',async()=>{
 const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;
 try {delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;
  await assert.rejects(deliverMakeAlert({item,qualification:qualification(),enabled:true,endpoint:'https://hooks.example.test/make'}),/delivery_environment_opt_in_required/);
  process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';
  await assert.rejects(deliverMakeAlert({item,qualification:qualification(),enabled:true,endpoint:'http://hooks.example.test/make'}),/secure_delivery_endpoint_required/);
 } finally {if(prior===undefined)delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;else process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior;}
});
test('POST carries idempotency key and reports receiver response',async()=>{
 const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';
 try {let call;const result=await deliverMakeAlert({item,qualification:qualification(),enabled:true,endpoint:'https://hooks.example.test/make',fetchImpl:async(...args)=>{call=args;return {ok:true,status:202};}});
  assert.equal(call[0],'https://hooks.example.test/make');assert.equal(call[1].headers['idempotency-key'],item.idempotency_key);
  assert.equal(JSON.parse(call[1].body).event.source_event_id,item.source_event_id);assert.deepEqual({delivered:result.delivered,status:result.receiverStatus},{delivered:true,status:202});
 } finally {process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior;}
});
test('one allowlisted leased alert performs mock POST then fenced acknowledgement',async()=>{
 const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';const queries=[];let post;
 const client={query:async(sql,args)=>{queries.push({sql,args});if(sql.includes('FROM catalyst_acceptance.notification_outbox'))return {rowCount:1,rows:[{ok:1}]};if(sql.includes('FROM catalyst_acceptance.research_qualifications'))return {rowCount:1,rows:[qualification()]};if(sql.includes("SET state='sent'"))return {rowCount:1,rows:[]};throw new Error('unexpected_query');}};
 const claimToken='c9bf9e57-1685-4c89-bafb-ff5af830be8a';const leased={...item,claim_token:claimToken,lease_expires_at:new Date(Date.now()+60000),payload:{...item}};
 try {const receipt=await dispatchClaimedOutboxItem({client,item:leased,workerToken:claimToken,endpoint:'https://hooks.example.test/make',enabled:true,fetchImpl:async(url,options)=>{post={url,options};return {ok:true,status:202};}});
  assert.equal(receipt.delivered,true);assert.equal(receipt.receiverStatus,202);assert.equal(post.options.headers['idempotency-key'],item.idempotency_key);
  assert.equal(queries.length,3);assert.equal(queries[0].args[0],item.idempotency_key);assert.match(queries[2].sql,/claim_token=\$2::uuid/);
 } finally {if(prior===undefined)delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;else process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior;}
});
test('existing outbox item cannot send without a persisted qualification',async()=>{
 let queryText='';const client={query:async(sql)=>{queryText=sql;return {rows:[]};}};const leased={...item,claim_token:'token',payload:{...item}};
 const result=await dispatchClaimedOutboxItem({client,item:leased,workerToken:'token',endpoint:'https://hooks.example.test/make'});
 assert.equal(result.mode,'dry_run');assert.equal(queryText,'');
 await assert.rejects(dispatchClaimedOutboxItem({client,item:leased,workerToken:'token',endpoint:'https://hooks.example.test/make',enabled:true}),/delivery_environment_opt_in_required/);
});
test('persisted unqualified candidate is blocked without network delivery',async()=>{
 const calls=[];const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';
 const client={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM catalyst_acceptance.notification_outbox'))return {rowCount:1,rows:[{ok:1}]};if(sql.startsWith('SELECT'))return {rowCount:1,rows:[{...qualification(),stage:'research_qualified',alert_eligible:false}]};return {rowCount:1,rows:[]};}};
 const leased={...item,claim_token:'123e4567-e89b-42d3-a456-426614174000',lease_expires_at:new Date(Date.now()+60000),payload:{...item}};
 try {const result=await dispatchClaimedOutboxItem({client,item:leased,workerToken:leased.claim_token,endpoint:'https://hooks.example.test/make',enabled:true,fetchImpl:async()=>{throw new Error('must_not_send');}});
  assert.deepEqual(result,{delivered:false,mode:'blocked',reason:'qualification_not_alert_eligible'});assert.equal(calls.length,3);assert.match(calls[2].sql,/SET state=\$3/);assert.equal(calls[2].args[2],'failed');
 } finally {if(prior===undefined)delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;else process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior;}
});

test('receiver idempotency survives lost acknowledgement and sender lease retry in isolation',async()=>{
 const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';
 const ledger=new Map();let posts=0;let loseFirstAcknowledgement=true;let sentAcknowledgements=0;
 const receiver=async(_url,options)=>{
  posts++;const key=options.headers['idempotency-key'];const body=JSON.parse(options.body);const digest=hash(options.body);
  const old=ledger.get(key);
  if(old&&old.digest!==digest)return {ok:false,status:409};
  if(!old)ledger.set(key,{digest,body,committedAt:'mock-receiver-commit'});
  if(loseFirstAcknowledgement){loseFirstAcknowledgement=false;throw new Error('receiver_ack_connection_lost');}
  return {ok:true,status:old?200:202};
 };
 const client={query:async(sql)=>{
  if(sql.includes('FROM catalyst_acceptance.notification_outbox'))return {rowCount:1,rows:[{ok:1}]};
  if(sql.includes('FROM catalyst_acceptance.research_qualifications'))return {rowCount:1,rows:[qualification()]};
  if(sql.includes("SET state='sent'")){sentAcknowledgements++;return {rowCount:1,rows:[]};}
  if(sql.includes('SET state=$3'))return {rowCount:1,rows:[]};
  throw new Error('unexpected_query');
 }};
 const token='c9bf9e57-1685-4c89-bafb-ff5af830be8a';
 const leased={...item,claim_token:token,lease_expires_at:new Date(Date.now()+60000),payload:{...item}};
 try{
  await assert.rejects(dispatchClaimedOutboxItem({client,item:leased,workerToken:token,endpoint:'https://receiver.example.test/make',enabled:true,fetchImpl:receiver}),/receiver_ack_connection_lost/);
  assert.equal(ledger.size,1);assert.equal(sentAcknowledgements,0);
  const retry=await dispatchClaimedOutboxItem({client,item:leased,workerToken:token,endpoint:'https://receiver.example.test/make',enabled:true,fetchImpl:receiver});
  assert.equal(retry.delivered,true);assert.equal(retry.receiverStatus,200);assert.equal(posts,2);
  assert.equal(ledger.size,1);assert.equal(sentAcknowledgements,1);
  const changed=JSON.stringify({...ledger.get(item.idempotency_key).body,event:{...ledger.get(item.idempotency_key).body.event,fingerprint:hash('different')}});
  const conflict=await receiver('https://receiver.example.test/make',{headers:{'idempotency-key':item.idempotency_key},body:changed});
  assert.equal(conflict.status,409);assert.equal(ledger.size,1);
 }finally{if(prior===undefined)delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;else process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior;}
});

test('sender waits for a delayed receiver acknowledgement before marking delivery sent',async()=>{
 const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';
 let releaseResponse,receiverCommitted=false,sentAcknowledgements=0;
 const responsePending=new Promise(resolve=>{releaseResponse=resolve;});
 const client={query:async(sql)=>{
  if(sql.includes('FROM catalyst_acceptance.notification_outbox'))return {rowCount:1,rows:[{ok:1}]};
  if(sql.includes('FROM catalyst_acceptance.research_qualifications'))return {rowCount:1,rows:[qualification()]};
  if(sql.includes("SET state='sent'")){sentAcknowledgements++;return {rowCount:1,rows:[]};}
  if(sql.includes('SET state=$3'))return {rowCount:1,rows:[]};
  throw new Error('unexpected_query');
 }};
 const token='c9bf9e57-1685-4c89-bafb-ff5af830be8a';
 const leased={...item,claim_token:token,lease_expires_at:new Date(Date.now()+60000),payload:{...item}};
 try{
  const delivery=dispatchClaimedOutboxItem({client,item:leased,workerToken:token,endpoint:'https://receiver.example.test/make',enabled:true,
    fetchImpl:async()=>{receiverCommitted=true;return responsePending;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(receiverCommitted,true);assert.equal(sentAcknowledgements,0);
  releaseResponse({ok:true,status:202});
  const receipt=await delivery;assert.equal(receipt.delivered,true);assert.equal(sentAcknowledgements,1);
 }finally{if(prior===undefined)delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;else process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior;}
});

test('retries safely after sender-side acknowledgement failure without duplicating receiver work',async()=>{
 const prior=process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;process.env.SCD_NOTIFICATION_DELIVERY_ENABLED='true';
 const ledger=new Map();let acknowledgementAttempts=0,posts=0;
 const receiver=async(_url,options)=>{
  posts++;const key=options.headers['idempotency-key'];const body=options.body;const digest=hash(body);
  const old=ledger.get(key);if(old&&old!==digest)return {ok:false,status:409};
  if(!old)ledger.set(key,digest);
  return {ok:true,status:old?200:202};
 };
 const client={query:async(sql)=>{
  if(sql.includes('FROM catalyst_acceptance.notification_outbox'))return {rowCount:1,rows:[{ok:1}]};
  if(sql.includes('FROM catalyst_acceptance.research_qualifications'))return {rowCount:1,rows:[qualification()]};
  if(sql.includes("SET state='sent'")){acknowledgementAttempts++;return {rowCount:acknowledgementAttempts===1?0:1,rows:[]};}
  if(sql.includes('SET state=$3'))return {rowCount:1,rows:[]};
  throw new Error('unexpected_query');
 }};
 const firstToken='c9bf9e57-1685-4c89-bafb-ff5af830be8a';
 const secondToken='123e4567-e89b-42d3-a456-426614174000';
 const leased=token=>({...item,claim_token:token,lease_expires_at:new Date(Date.now()+60000),payload:{...item}});
 try{
  await assert.rejects(dispatchClaimedOutboxItem({client,item:leased(firstToken),workerToken:firstToken,endpoint:'https://receiver.example.test/make',enabled:true,fetchImpl:receiver}),/outbox_claim_lost/);
  assert.equal(ledger.size,1);assert.equal(acknowledgementAttempts,1);
  const retry=await dispatchClaimedOutboxItem({client,item:leased(secondToken),workerToken:secondToken,endpoint:'https://receiver.example.test/make',enabled:true,fetchImpl:receiver});
  assert.equal(retry.delivered,true);assert.equal(retry.receiverStatus,200);
  assert.equal(posts,2);assert.equal(ledger.size,1);assert.equal(acknowledgementAttempts,2);
 }finally{if(prior===undefined)delete process.env.SCD_NOTIFICATION_DELIVERY_ENABLED;else process.env.SCD_NOTIFICATION_DELIVERY_ENABLED=prior;}
});
