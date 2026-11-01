/** Pure offline reference model. Not a PostgreSQL concurrency or delivery guarantee. */
const key = (x) => [x.engine,x.source,x.sourceEventId].map(v=>`${String(v).length}:${v}`).join('|');
export function newAcceptanceState(){return {events:new Map(),revisions:new Map(),outbox:new Map(),runs:new Map(),checkpoints:new Map()};}
export function applyAcceptedBatch(state,{runId,engine,source,cursor,records,failAt}={}){
 if(!state||!Array.isArray(records)||!runId||!engine||!source||typeof cursor!=='string')throw Error('invalid_batch');
 if(state.runs.has(runId))throw Error('run_id_reused');
 const next={events:new Map(state.events),revisions:new Map(state.revisions),outbox:new Map(state.outbox),runs:new Map(state.runs),checkpoints:new Map(state.checkpoints)};
 next.runs.set(runId,{engine,status:'started'});
 const outcome={inserted:0,duplicates:0,revisions:0,alerts:0};
 for(const [i,record] of records.entries()){
  if(!record||typeof record.sourceEventId!=='string'||!record.sourceEventId||typeof record.fingerprint!=='string'||!record.fingerprint||typeof record.originalName!=='string'||!record.originalName||!record.payload||typeof record.payload!=='object'||Array.isArray(record.payload))throw Error('invalid_record');
  const id=key({engine,source,sourceEventId:record.sourceEventId});
  const rev=`${id}|${record.fingerprint.length}:${record.fingerprint}`;
  if(!next.events.has(id)){next.events.set(id,{engine,source,...record});outcome.inserted++;}else outcome.duplicates++;
  if(!next.revisions.has(rev)){
   next.revisions.set(rev,{engine,source,parentId:id,...record});outcome.revisions++;
   next.outbox.set(rev,{state:'pending',attempts:0});outcome.alerts++;
  }
  if(failAt===i)throw Error('injected_failure');
 }
 next.runs.set(runId,{engine,status:'completed'});
 next.checkpoints.set(`${engine}|${source}`,{cursor,runId});
 if(failAt==='before_commit')throw Error('injected_failure');
 for(const name of ['events','revisions','outbox','runs','checkpoints'])state[name]=next[name];
 return outcome;
}
export function validateAcceptanceState(state){
 const errors=[];
 for(const [revision,record] of state.revisions){const parent=record?.parentId; if(!parent||!state.events.has(parent))errors.push('orphan_revision');}
 for(const [id] of state.outbox)if(!state.revisions.has(id))errors.push('orphan_outbox');
 for(const checkpoint of state.checkpoints.values())if(state.runs.get(checkpoint.runId)?.status!=='completed')errors.push('checkpoint_without_completed_run');
 return [...new Set(errors)];
}
