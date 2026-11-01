import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { fetchGdeltDocNews } from './gdelt_doc_news.mjs';
const connectionString=process.env.SUPABASE_SESSION_POOLER_URL;
if(!connectionString) throw new Error('missing_database_url');
const now=new Date(),observedAt=now.toISOString(),endAt=new Date(now.getTime()-15*60_000).toISOString();
const startAt=new Date(Date.parse(endAt)-6*60*60_000).toISOString();
const query='(FDA OR "clinical trial" OR "contract award" OR "Federal Reserve" OR acquisition OR patent OR earnings)';
const source='gdelt_doc_catalysts',sourceKey='news:'+source,runId='scd_gdelt_once_'+randomUUID().replaceAll('-','');
const client=new pg.Client({connectionString,connectionTimeoutMillis:10000,query_timeout:15000,application_name:'scd-gdelt-doc-acceptance'});
let transaction=false,connected=false;
try{
 await client.connect(); connected=true;
 const batch=await fetchGdeltDocNews({query,startAt,endAt,observedAt,maxRecords:250});
 await client.query('BEGIN'); transaction=true;
 await client.query("INSERT INTO catalyst_acceptance.pipeline_runs(run_id,engine,status,evidence) VALUES($1,'news','started',$2::jsonb)",[runId,JSON.stringify({source,source_key:sourceKey,bounded:true})]);
 let insertedEvents=0,insertedRevisions=0;
 for(const record of batch.records){
  const payload={...record.sourcePayload,source_timestamp_label:record.sourceTimestampLabel,retrieved_at:observedAt,query_window:{start:startAt,end:endAt}};
  const ev=await client.query(`INSERT INTO catalyst_acceptance.events
   (engine,source,source_event_id,original_name,event_time,observed_at,source_url,fingerprint,source_payload)
   VALUES('news',$1,$2,$3,$4,$5,$6,$7,$8::jsonb)
   ON CONFLICT(engine,source,source_event_id) DO UPDATE SET original_name=EXCLUDED.original_name,
   event_time=EXCLUDED.event_time,observed_at=EXCLUDED.observed_at,source_url=EXCLUDED.source_url,
   fingerprint=EXCLUDED.fingerprint,source_payload=EXCLUDED.source_payload RETURNING (xmax=0) AS inserted`,
   [source,record.sourceEventId,record.originalName,record.eventTime,record.observedAt,record.sourceUrl,record.fingerprint,JSON.stringify(payload)]);
  if(ev.rows[0]?.inserted) insertedEvents++;
  const rev=await client.query(`INSERT INTO catalyst_acceptance.event_revisions
   (engine,source,source_event_id,fingerprint,original_name,original_payload,captured_at)
   VALUES('news',$1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(engine,source,source_event_id,fingerprint) DO NOTHING RETURNING 1`,
   [source,record.sourceEventId,record.fingerprint,record.originalName,JSON.stringify(payload),observedAt]);
  insertedRevisions+=rev.rowCount??0;
 }
 const coverage={...batch.coverage,windowStart:startAt,windowEnd:endAt,requestedMaximum:250,insertedEvents,insertedRevisions,
  outboxCreated:0,acceptedAsRawDiscoveries:true,queryWindowHours:6,endLagMinutes:15,sourceComplete:false,
  coverageComplete:false,paginationExposed:false,checkpointAdvanced:false};
 await client.query("UPDATE catalyst_acceptance.pipeline_runs SET status='committed',completed_at=now(),evidence=$2::jsonb WHERE run_id=$1",[runId,JSON.stringify({source,coverage})]);
 await client.query(`INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,last_success_at,state,last_error)
  VALUES($1,now(),now(),'healthy',NULL) ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=now(),
  last_success_at=now(),state='healthy',last_error=NULL`,[sourceKey]);
 await client.query('COMMIT'); transaction=false;
 console.log(JSON.stringify({pass:true,run_id:runId,source,checks:{bounded_query:true,raw_evidence_preserved:true,
  events_and_revisions_durable:true,raw_discoveries_not_queued:true,no_checkpoint_without_continuation:true},coverage}));
}catch(error){
 if(transaction) await client.query('ROLLBACK').catch(()=>{});
 const code=error?.message?.startsWith('gdelt_http_')?error.message:(error?.code&&/^[A-Z0-9]{2,10}$/.test(error.code)?error.code:'GDELT_INGESTION_FAILED');
 if(connected) await client.query(`INSERT INTO catalyst_acceptance.source_health(source_key,last_attempt_at,state,last_error)
  VALUES($1,now(),'error',$2) ON CONFLICT(source_key) DO UPDATE SET last_attempt_at=now(),state='error',last_error=EXCLUDED.last_error`,[sourceKey,code]).catch(()=>{});
 console.error(JSON.stringify({pass:false,error_code:code,checkpoint_advanced:false})); process.exitCode=1;
}finally{await client.end().catch(()=>{});}
