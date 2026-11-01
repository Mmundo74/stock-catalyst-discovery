import test from 'node:test';
import assert from 'node:assert/strict';
import {decideCheckpoint} from '../src/source_recovery_gate.mjs';
const base=()=>({previousCursor:'opaque-a',proposedCursor:'opaque-b',runId:'r1',sourceKey:'news:feed',coverage:{run_id:'r1',coverage_status:'all_declared_instruments_observed_not_signal_validated',unsuccessful_pages:[],missing_pages:[],issues:[]},commitReceipt:{runId:'r1',sourceKey:'news:feed',durable:true,transactionCommitted:true,outboxCommitted:true,checkpointInSameTransaction:true},quarantined:0});
test('complete durable receipt is eligible',()=>assert.equal(decideCheckpoint(base()).eligible,true));
for(const [name,change,reason] of [
 ['mismatched run',{runId:'r2'},'coverage_run_mismatch'],
 ['unverified coverage',{coverage:{...base().coverage,coverage_status:'incomplete_or_unverified'}},'coverage_unverified'],
 ['missing page',{coverage:{...base().coverage,missing_pages:[2]}},'page_failure'],
 ['failed page',{coverage:{...base().coverage,unsuccessful_pages:[1]}},'page_failure'],
 ['issues',{coverage:{...base().coverage,issues:['duplicate_instrument']}},'page_failure'],
 ['quarantine',{quarantined:1},'quarantine_unresolved'],
 ['no receipt',{commitReceipt:null},'durable_commit_unverified'],
 ['not committed',{commitReceipt:{...base().commitReceipt,transactionCommitted:false}},'durable_commit_unverified'],
 ['outbox omitted',{commitReceipt:{...base().commitReceipt,outboxCommitted:false}},'outbox_unverified'],
 ['checkpoint non atomic',{commitReceipt:{...base().commitReceipt,checkpointInSameTransaction:false}},'checkpoint_atomicity_unverified'],
 ['wrong receipt run',{commitReceipt:{...base().commitReceipt,runId:'other'}},'durable_commit_unverified'],
 ['unchanged cursor',{proposedCursor:'opaque-a'},'no_cursor_progress'],
 ['empty source',{sourceKey:''},'invalid_identity'],
 ['empty cursor',{proposedCursor:''},'invalid_cursor'],
 ...['unsuccessful_pages','missing_pages','issues'].map(key=>[`missing ${key}`,{coverage:(()=>{const c={...base().coverage};delete c[key];return c;})()},'coverage_shape_unverified']),
 ...['unsuccessful_pages','missing_pages','issues'].map(key=>[`malformed ${key}`,{coverage:{...base().coverage,[key]:null}},'coverage_shape_unverified'])
])test(name,()=>{const result=decideCheckpoint({...base(),...change});assert.equal(result.eligible,false);assert.ok(result.reasons.includes(reason));});
