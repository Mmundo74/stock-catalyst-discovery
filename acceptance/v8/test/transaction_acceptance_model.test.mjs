import test from 'node:test';import assert from 'node:assert/strict';
import {newAcceptanceState,applyAcceptedBatch,validateAcceptanceState} from '../src/transaction_acceptance_model.mjs';
const rec=(id='1',fp='a')=>({sourceEventId:id,fingerprint:fp,originalName:'Original issuer',payload:{id}});
const batch=(runId,records=[rec()],extra={})=>({runId,engine:'news',source:'feed',cursor:runId,records,...extra});
test('commit creates event revision outbox run checkpoint',()=>{const s=newAcceptanceState();assert.deepEqual(applyAcceptedBatch(s,batch('r1')),{inserted:1,duplicates:0,revisions:1,alerts:1});assert.deepEqual([...Object.values(s).slice(0,3).map(x=>x.size)],[1,1,1]);assert.deepEqual(validateAcceptanceState(s),[]);});
test('replayed event does not duplicate revision or alert',()=>{const s=newAcceptanceState();applyAcceptedBatch(s,batch('r1'));const r=applyAcceptedBatch(s,batch('r2'));assert.equal(r.duplicates,1);assert.equal(r.alerts,0);assert.equal(s.outbox.size,1);});
test('new fingerprint adds revision but not event',()=>{const s=newAcceptanceState();applyAcceptedBatch(s,batch('r1'));const r=applyAcceptedBatch(s,batch('r2',[rec('1','b')]));assert.equal(r.inserted,0);assert.equal(r.revisions,1);assert.equal(s.outbox.size,2);});
test('failure after first record rolls back all five tables',()=>{const s=newAcceptanceState();assert.throws(()=>applyAcceptedBatch(s,batch('r1',[rec('1'),rec('2')],{failAt:0})),/injected/);for(const m of Object.values(s))assert.equal(m.size,0);});
test('failure before commit preserves old checkpoint',()=>{const s=newAcceptanceState();applyAcceptedBatch(s,batch('r1'));assert.throws(()=>applyAcceptedBatch(s,batch('r2',[rec('2')],{failAt:'before_commit'})));assert.equal(s.checkpoints.get('news|feed').cursor,'r1');assert.equal(s.events.size,1);});
test('duplicate run ID rejected',()=>{const s=newAcceptanceState();applyAcceptedBatch(s,batch('r1'));assert.throws(()=>applyAcceptedBatch(s,batch('r1')),/run_id_reused/);});
test('invalid second record rolls back batch',()=>{const s=newAcceptanceState();assert.throws(()=>applyAcceptedBatch(s,batch('r1',[rec(),{sourceEventId:'bad'}])),/invalid_record/);assert.equal(s.events.size,0);});
test('orphan revision detected',()=>{const s=newAcceptanceState();s.revisions.set('missing|1:a',{});assert.deepEqual(validateAcceptanceState(s),['orphan_revision']);});
test('orphan outbox detected',()=>{const s=newAcceptanceState();s.outbox.set('missing',{});assert.deepEqual(validateAcceptanceState(s),['orphan_outbox']);});
test('checkpoint without completed run detected',()=>{const s=newAcceptanceState();s.checkpoints.set('news|feed',{runId:'unknown'});assert.deepEqual(validateAcceptanceState(s),['checkpoint_without_completed_run']);});

test('fingerprint containing pipe retains correct parent identity',()=>{const s=newAcceptanceState();applyAcceptedBatch(s,batch('r1',[rec('1','sha|256|value')]));assert.deepEqual(validateAcceptanceState(s),[]);});
test('revision parent missing even when key looks valid is rejected',()=>{const s=newAcceptanceState();s.events.set('4:news|4:feed|1:1',{});s.revisions.set('4:news|4:feed|1:1|1:a',{parentId:'not-present'});assert.deepEqual(validateAcceptanceState(s),['orphan_revision']);});

test('rejects array payload and preserves atomic state', () => {
 const state=newAcceptanceState();
 assert.throws(()=>applyAcceptedBatch(state,{runId:'array-run',engine:'news',source:'feed',cursor:'cursor-1',records:[{sourceEventId:'e',fingerprint:'f',originalName:'item',payload:[]}]}),/invalid_record/);
 assert.equal(state.events.size,0);
 assert.equal(state.runs.size,0);
 assert.equal(state.checkpoints.size,0);
});
