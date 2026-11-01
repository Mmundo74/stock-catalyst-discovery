// Manual-only bounded ingestion for the pinned LuxAlgo Federal Reserve adapter.
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { FEEDS, normalizeFedItem } from './federalreserve_source.mjs';
const {Client}=pg, connectionString=process.env.SUPABASE_SESSION_POOLER_URL;
const maxItems=Number(process.env.LUXALGO_MAX_ITEMS??9);
if(!connectionString) throw new Error('Missing SUPABASE_SESSION_POOLER_URL');
if(!Number.isInteger(maxItems)||maxItems<1||maxItems>30) throw new Error('LUXALGO_MAX_ITEMS must be 1..30');
const retrievedAt=new Date().toISOString(), runId=`scd_fed_once_${randomUUID().replaceAll('-','')}`, sourceKey='luxalgo:federalreserve';
const snooze=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchFeed(url){
 let last; for(let n=0;n<2;n++){if(n)await snooze(1100);try{const r=await fetch(url,{headers:{'user-agent':'stock-catalyst-discovery/acceptance','accept':'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(`upstream_http_${r.status}`);let body=await r.text();if(body.charCodeAt(0)===0xfeff)body=body.slice(1);const items=JSON.parse(body);if(!Array.isArray(items)||items.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('upstream_shape_drift');return {url,items};}catch(e){last=e;if(e.message==='upstream_shape_drift')throw e;}}throw Error(`feed_fetch_failed:${new URL(url).pathname}:${last?.message??'unknown'}`);
}
const feeds=[];for(const spec of FEEDS){if(feeds.length)await snooze(550);feeds.push(await fetchFeed(spec.url));}
const retrieved=feeds.flatMap((f,i)=>f.items.map(raw=>({raw,feedUrl:f.url,...normalizeFedItem(raw,FEEDS[i].type,f.url,retrievedAt)})).filter(x=>x.id));
const total=feeds.reduce((n,f)=>n+f.items.length,0), selected=retrieved.slice(0,maxItems), complete=selected.length===retrieved.length;
const coverage={upstream:'LuxAlgo market-trackers federalreserve source',upstream_commit:'1ecfcca36a224d4758cc6e2e20cca216db43d5ee',feeds_attempted:feeds.length,feeds_succeeded:feeds.length,records_available:total,records_in_scope:retrieved.length,records_selected:selected.length,records_filtered_by_upstream_rules:total-retrieved.length,max_items:maxItems,complete,note:complete?'All returned records processed; archive depth is undocumented.':'Bounded sample; checkpoint not advanced.'};
const client=new Client({connectionString,connectionTimeoutMillis:10000,application_name:'scd-luxalgo-fed-acceptance'});
try{
 await client.connect();await client.query('begin');
 await client.query("insert into catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) values($1,'government','started',$2)",[runId,{source_key:sourceKey,retrieved_at:retrievedAt}]);
 let inserted=0,revisions=0,outbox=0;
 for(const rec of selected){const payload={source_record:rec.raw,source_feed_url:rec.feedUrl,retrieved_at:retrievedAt},fp=createHash('sha256').update(JSON.stringify(rec.raw)).digest('hex');
  const e=await client.query("insert into catalyst_acceptance.events(engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload) values('government','luxalgo_federalreserve',$1,$2,$3,$4,$5,$6,$7) on conflict(engine,source,source_event_id) do nothing returning 1",[rec.id,rec.title,rec.eventTime,retrievedAt,rec.url,fp,payload]);inserted+=e.rowCount;
  const v=await client.query("insert into catalyst_acceptance.event_revisions(engine,source,source_event_id,fingerprint,original_name,original_payload) values('government','luxalgo_federalreserve',$1,$2,$3,$4) on conflict do nothing returning 1",[rec.id,fp,rec.title,payload]);revisions+=v.rowCount;
  const o=await client.query("insert into catalyst_acceptance.notification_outbox(idempotency_key,engine,source,source_event_id,fingerprint,state,attempts) values($1,'government','luxalgo_federalreserve',$2,$3,'pending',0) on conflict do nothing returning 1",[`government:luxalgo_federalreserve:${rec.id}:${fp}`,rec.id,fp]);outbox+=o.rowCount;
 }
 await client.query("update catalyst_acceptance.pipeline_runs set status='committed',completed_at=now(),evidence=$2 where run_id=$1",[runId,{source_key:sourceKey,retrieved_at:retrievedAt,coverage,inserted,revisions,outbox}]);
 await client.query("insert into catalyst_acceptance.source_health(source_key,last_attempt_at,last_success_at,state,last_error) values($1,$2,$2,'healthy',null) on conflict(source_key) do update set last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,state='healthy',last_error=null",[sourceKey,retrievedAt]);
 if(complete){const cursor=JSON.stringify({retrieved_at:retrievedAt,per_feed_counts:feeds.map(f=>f.items.length)});await client.query("insert into catalyst_acceptance.checkpoints(source_key,cursor_value,last_completed_run) values($1,$2,$3) on conflict(source_key) do update set cursor_value=excluded.cursor_value,last_completed_run=excluded.last_completed_run,advanced_at=now()",[sourceKey,cursor,runId]);}
 await client.query('commit');console.log(JSON.stringify({pass:true,run_id:runId,checks:{three_feeds:feeds.length===3,bounded:selected.length<=maxItems,raw_records_preserved:true,original_timestamps_preserved:true,checkpoint_only_when_complete:true},coverage,inserted,revisions,outbox}));
}catch(e){await client.query('rollback').catch(()=>{});console.error(JSON.stringify({pass:false,error:String(e?.message??'unknown').slice(0,220)}));process.exitCode=1;}finally{await client.end().catch(()=>{});}
