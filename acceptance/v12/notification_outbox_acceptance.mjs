// One-shot DB lease acceptance only. No external notification is sent.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { acknowledgeOutboxItem, claimOutboxItems, releaseOutboxItem } from './outbox_worker.mjs';
const { Client } = pg;
const url = process.env.SUPABASE_SESSION_POOLER_URL;
if (!url) throw new Error('missing_database_url');
const tag = 'scd_outbox_it_' + randomUUID().replaceAll('-', '');
const source = 'scd_outbox_acceptance';
const fingerprint = 'sha256:' + createHash('sha256').update(tag).digest('hex');
const report = { fixture_tag: tag, checks: {} };
let a, b;
const open = async () => { const c = new Client({connectionString:url,connectionTimeoutMillis:10000,application_name:'scd-outbox-lease-acceptance'}); await c.connect(); return c; };
async function insertFixture(c, key, suffix) {
 const eventId = tag + ':event:' + suffix, observed = new Date().toISOString();
 const raw = {fixture:'isolated_outbox_lease_acceptance',event_id:eventId,source_timestamp:observed};
 await c.query('BEGIN');
 try {
  await c.query(`INSERT INTO catalyst_acceptance.events (engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload) VALUES ('government',$1,$2,'Synthetic outbox lease fixture',$3,$3,NULL,$4,$5::jsonb)`,[source,eventId,observed,fingerprint,JSON.stringify(raw)]);
  await c.query(`INSERT INTO catalyst_acceptance.event_revisions (engine,source,source_event_id,fingerprint,original_name,original_payload) VALUES ('government',$1,$2,$3,'Synthetic outbox lease fixture',$4::jsonb)`,[source,eventId,fingerprint,JSON.stringify(raw)]);
  await c.query(`INSERT INTO catalyst_acceptance.notification_outbox (idempotency_key,engine,source,source_event_id,fingerprint,state,attempts) VALUES ($1,'government',$2,$3,$4,'pending',0)`,[key,source,eventId,fingerprint]);
  await c.query('COMMIT'); return eventId;
 } catch(e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
}
const read = async (c,key) => (await c.query('SELECT state,attempts,claim_token,lease_expires_at,delivered_at,last_error FROM catalyst_acceptance.notification_outbox WHERE idempotency_key=$1',[key])).rows[0];
try {
 [a,b]=await Promise.all([open(),open()]);
 const role=(await a.query(`SELECT current_user AS role,has_schema_privilege(current_user,'catalyst_acceptance','USAGE') AS acceptance,has_schema_privilege(current_user,'catalyst_acceptance_restore','USAGE') AS restore`)).rows[0];
 assert.deepEqual(role,{role:'scd_luxalgo_acceptance',acceptance:true,restore:false}); report.checks.scoped_acceptance_role=true;
 const k1=tag+':lease', k2=tag+':retry', eventId=await insertFixture(a,k1,'lease'); await insertFixture(a,k2,'retry');
 const ta=randomUUID(),tb=randomUUID();
 const [ca,cb]=await Promise.all([claimOutboxItems(a,{idempotencyKeys:[k1],workerToken:ta,leaseMs:60000}),claimOutboxItems(b,{idempotencyKeys:[k1],workerToken:tb,leaseMs:60000})]);
 assert.equal(ca.items.length+cb.items.length,1); const win=ca.items.length?ca:cb, wc=ca.items.length?a:b, other=ca.items.length?b:a;
 assert.equal(win.items[0].payload.source_event_id,eventId); assert.equal(win.items[0].payload.original_name,'Synthetic outbox lease fixture'); report.checks.concurrent_claim_exclusion_and_evidence=true;
 await wc.query(`UPDATE catalyst_acceptance.notification_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE idempotency_key=$1 AND state='processing' AND claim_token=$2::uuid`,[k1,win.workerToken]);
 const recovered=await claimOutboxItems(other,{idempotencyKeys:[k1],workerToken:randomUUID(),leaseMs:60000}); assert.equal(recovered.items.length,1); assert.equal(recovered.items[0].attempts,2);
 await assert.rejects(acknowledgeOutboxItem(wc,{idempotencyKey:k1,workerToken:win.workerToken}),/outbox_claim_lost/); report.checks.expired_lease_recovery_and_stale_worker_fencing=true;
 await acknowledgeOutboxItem(other,{idempotencyKey:k1,workerToken:recovered.workerToken}); const sent=await read(a,k1);
 assert.equal(sent.state,'sent'); assert.ok(sent.delivered_at); assert.equal(sent.claim_token,null); assert.equal((await claimOutboxItems(a,{idempotencyKeys:[k1]})).items.length,0); report.checks.idempotent_ack_and_sent_exclusion=true;
 const first=await claimOutboxItems(a,{idempotencyKeys:[k2],leaseMs:60000}); assert.equal(first.items.length,1); await releaseOutboxItem(a,{idempotencyKey:k2,workerToken:first.workerToken,errorCode:'provider.503'});
 assert.equal((await read(a,k2)).state,'pending'); const second=await claimOutboxItems(b,{idempotencyKeys:[k2],leaseMs:60000}); assert.equal(second.items.length,1);
 await releaseOutboxItem(b,{idempotencyKey:k2,workerToken:second.workerToken,errorCode:'payload.invalid',permanent:true}); const failed=await read(a,k2);
 assert.equal(failed.state,'failed'); assert.equal(failed.attempts,2); report.checks.retry_and_permanent_failure=true;
 report.pass=Object.values(report.checks).every(Boolean); console.log(JSON.stringify(report));
} catch(e) { console.error(JSON.stringify({fixture_tag:tag,pass:false,checks:report.checks,error_code:e?.code??null,error_name:e?.name??'Error'})); process.exitCode=1; }
finally { await Promise.all([a?.end().catch(()=>{}),b?.end().catch(()=>{})]); }
