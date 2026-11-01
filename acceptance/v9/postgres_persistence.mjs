// Manual-only durable acceptance. Writes unique fixtures only to catalyst_acceptance.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const {Client}=pg, url=process.env.SUPABASE_SESSION_POOLER_URL;
if(!url) throw Error('Missing SUPABASE_SESSION_POOLER_URL');
const tag='scd_pg_it_'+randomUUID().replaceAll('-',''), src='luxalgo_acceptance', sk=tag+'_source';
const ts='2026-10-31T18:21:07.123Z', raw={fixture:'manual acceptance',source_timestamp:ts,raw:['unchanged',17]};
const report={checks:{}};
const open=async()=>{const c=new Client({connectionString:url,connectionTimeoutMillis:10000,application_name:'scd-manual-pg-acceptance'});await c.connect();return c};
async function write(c,run,id,cursor,fp='sha256:v1',fail=false){
 await c.query('begin');
 try {
  await c.query("insert into catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) values($1,'government','started',$2)",[run,{fixture:tag}]);
  await c.query(`insert into catalyst_acceptance.events(engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload)
   values('government',$1,$2,'Original LuxAlgo Name',$3,$3,'https://example.invalid/evidence',$4,$5) on conflict(engine,source,source_event_id) do nothing`,[src,id,ts,fp,raw]);
  await c.query(`insert into catalyst_acceptance.event_revisions(engine,source,source_event_id,fingerprint,original_name,original_payload)
   values('government',$1,$2,$3,'Original LuxAlgo Name',$4) on conflict do nothing`,[src,id,fp,raw]);
  await c.query(`insert into catalyst_acceptance.notification_outbox(idempotency_key,engine,source,source_event_id,fingerprint,state,attempts)
   values($1,'government',$2,$3,$4,'pending',0) on conflict do nothing`,[`government:${src}:${id}:${fp}`,src,id,fp]);
  if(fail) throw Error('injected_rollback');
  await c.query("update catalyst_acceptance.pipeline_runs set status='committed',completed_at=now(),evidence=$2 where run_id=$1",
   [run,{fixture:tag,coverage:{pages_attempted:2,pages_succeeded:2,pages_failed:0,records_seen:1,records_stored:1,complete:true}}]);
  await c.query(`insert into catalyst_acceptance.source_health(source_key,last_attempt_at,last_success_at,state,last_error) values($1,now(),now(),'healthy',null)
   on conflict(source_key) do update set last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,state='healthy',last_error=null`,[sk]);
  await c.query(`insert into catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run) values($1,$2,$3)
   on conflict(source_key) do update set cursor_value=excluded.cursor_value,last_completed_run=excluded.last_completed_run,advanced_at=now()`,[sk,cursor,run]);
  await c.query('commit');
 } catch(e){await c.query('rollback').catch(()=>{});throw e;}
}
let a,b;
try {
 a=await open(); b=await open();
 const who=(await a.query(`select current_user role,current_database() db,has_schema_privilege(current_user,'catalyst_acceptance','USAGE') acc,
  has_schema_privilege(current_user,'catalyst_acceptance_restore','USAGE') restore,has_schema_privilege(current_user,'catalyst_acceptance','CREATE') create_schema`)).rows[0];
 assert.deepEqual(who,{role:'scd_luxalgo_acceptance',db:'postgres',acc:true,restore:false,create_schema:false}); report.checks.scoped_role=true;
 const id=tag+'_event',r1=tag+'_run1',r2=tag+'_run2';
 await Promise.all([write(a,r1,id,'opaque-1'),write(b,r2,id,'opaque-1')]);
 let q=await a.query(`select (select count(*)::int from catalyst_acceptance.events where source=$1 and source_event_id=$2) e,
 (select count(*)::int from catalyst_acceptance.event_revisions where source=$1 and source_event_id=$2) r,
 (select count(*)::int from catalyst_acceptance.notification_outbox where source=$1 and source_event_id=$2) o`,[src,id]);
 assert.deepEqual(q.rows[0],{e:1,r:1,o:1});report.checks.concurrent_dedup=true;
 q=await a.query(`select e.original_name,e.event_time,e.observed_at,e.source_payload,r.original_payload,o.state,o.attempts,
 p.evidence->'coverage' coverage,cp.cursor_value,pr.status,sh.state health from catalyst_acceptance.events e
 join catalyst_acceptance.event_revisions r on r.engine=e.engine and r.source=e.source and r.source_event_id=e.source_event_id join catalyst_acceptance.notification_outbox o on o.engine=r.engine and o.source=r.source and o.source_event_id=r.source_event_id and o.fingerprint=r.fingerprint
 join catalyst_acceptance.checkpoints cp on cp.source_key=$3 join catalyst_acceptance.pipeline_runs pr on pr.run_id=cp.last_completed_run
 join catalyst_acceptance.pipeline_runs p on p.run_id=cp.last_completed_run join catalyst_acceptance.source_health sh on sh.source_key=$3
 where e.source=$1 and e.source_event_id=$2`,[src,id,sk]);
 assert.equal(q.rowCount,1);let x=q.rows[0];assert.equal(x.original_name,'Original LuxAlgo Name');assert.equal(new Date(x.event_time).toISOString(),ts);
 assert.equal(new Date(x.observed_at).toISOString(),ts);assert.deepEqual(x.source_payload,raw);assert.deepEqual(x.original_payload,raw);
 assert.equal(x.state,'pending');assert.equal(x.attempts,0);assert.deepEqual(x.coverage,{pages_attempted:2,pages_succeeded:2,pages_failed:0,records_seen:1,records_stored:1,complete:true});
 assert.equal(x.status,'committed');assert.equal(x.health,'healthy');report.checks.evidence_checkpoint_coverage=true;
 let restart=await open();q=await restart.query(`select e.source_event_id,pr.status from catalyst_acceptance.events e join catalyst_acceptance.checkpoints cp on cp.source_key=$2
 join catalyst_acceptance.pipeline_runs pr on pr.run_id=cp.last_completed_run where e.source=$1 and e.source_event_id=$3`,[src,sk,id]);
 assert.equal(q.rowCount,1);assert.equal(q.rows[0].status,'committed');await restart.end();report.checks.restart_recovery=true;
 await write(a,tag+'_revision',id,'opaque-2','sha256:v2');q=await a.query(`select
 (select count(*)::int from catalyst_acceptance.event_revisions where source=$1 and source_event_id=$2) r,
 (select count(*)::int from catalyst_acceptance.notification_outbox where source=$1 and source_event_id=$2) o`,[src,id]);
 assert.deepEqual(q.rows[0],{r:2,o:2});report.checks.revision_and_outbox_idempotency=true;
 const prior=(await a.query('select cursor_value from catalyst_acceptance.checkpoints where source_key=$1',[sk])).rows[0].cursor_value;
 await assert.rejects(write(a,tag+'_failed',tag+'_failed_event','never', 'sha256:fail',true),/injected_rollback/);
 q=await a.query(`select (select count(*)::int from catalyst_acceptance.events where source=$1 and source_event_id=$2) e,
 (select count(*)::int from catalyst_acceptance.pipeline_runs where run_id=$3) r,(select cursor_value from catalyst_acceptance.checkpoints where source_key=$4) c`,[src,tag+'_failed_event',tag+'_failed',sk]);
 assert.deepEqual(q.rows[0],{e:0,r:0,c:prior});report.checks.rollback_and_checkpoint_integrity=true;
 const crash=await open(),cr=tag+'_crash',ci=tag+'_crash_event';await crash.query('begin');
 await crash.query("insert into catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) values($1,'government','started',$2)",[cr,{fixture:tag}]);
 await crash.query(`insert into catalyst_acceptance.events(engine,source,source_event_id,original_name,event_time,observed_at,fingerprint,source_payload)
  values('government',$1,$2,'interrupted',$3,$3,'sha256:crash',$4)`,[src,ci,ts,raw]);crash.on('error',()=>{});crash.connection.stream.destroy();
 await new Promise(r=>setTimeout(r,300));const recovered=await open();q=await recovered.query(`select
 (select count(*)::int from catalyst_acceptance.events where source=$1 and source_event_id=$2) e,
 (select count(*)::int from catalyst_acceptance.pipeline_runs where run_id=$3) r,(select cursor_value from catalyst_acceptance.checkpoints where source_key=$4) c`,[src,ci,cr,sk]);
 assert.deepEqual(q.rows[0],{e:0,r:0,c:prior});await recovered.end();report.checks.interrupted_session_rollback=true;
 report.fixture_prefix=tag;report.pass=Object.values(report.checks).every(Boolean);console.log(JSON.stringify(report));
} catch(e){console.error(JSON.stringify({pass:false,checks:report.checks,error_code:e?.code??null,error:e?.message?.slice(0,150)??'unknown'}));process.exitCode=1;}
finally{await Promise.all([a?.end().catch(()=>{}),b?.end().catch(()=>{})]);}
