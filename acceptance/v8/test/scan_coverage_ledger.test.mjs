import test from 'node:test';import assert from 'node:assert/strict';
import {auditScanPages} from '../src/scan_coverage_ledger.mjs';
const base={runId:'r1',requestedAt:'2026-11-02T15:00:00Z',expectedPages:2,universeSize:2,pages:[{page:1,httpStatus:200,rows:[{symbol:'AAA',signal:true,priceAsOf:'2026-11-02T14:59:00Z'}]},{page:2,httpStatus:200,rows:[{symbol:'BBB',signal:false,priceAsOf:'2026-11-02T14:59:00Z'}]}]};
for(const [label,modify,check] of [
 ['complete declared pages',x=>x,x=>x.coverage_status.startsWith('all_declared')],
 ['missing page',x=>({...x,pages:x.pages.slice(0,1)}),x=>x.missing_pages.includes(2)],
 ['null signal',x=>({...x,pages:[{...x.pages[0],rows:[{...x.pages[0].rows[0],signal:null}]},x.pages[1]]}),x=>x.null_signal_rows===1],
 ['stale price',x=>({...x,pages:[{...x.pages[0],rows:[{...x.pages[0].rows[0],priceAsOf:'2026-10-30T20:00:00Z'}]},x.pages[1]]}),x=>x.stale_or_invalid_price_rows===1],
 ['unknown universe',x=>({...x,universeSize:null}),x=>x.coverage_status==='incomplete_or_unverified'],
 ['failed page',x=>({...x,pages:[{...x.pages[0],httpStatus:500},x.pages[1]]}),x=>x.issues.includes('failed_page')],
 ['duplicate page',x=>({...x,pages:[...x.pages,x.pages[0]]}),x=>x.issues.includes('duplicate_page')],
 ['bad symbol',x=>({...x,pages:[{...x.pages[0],rows:[{signal:true}]},x.pages[1]]}),x=>x.issues.includes('invalid_instrument')],
 ['universe conflict',x=>({...x,universeSize:1}),x=>x.issues.includes('universe_count_conflict')],
])test(label,()=>{const r=auditScanPages(modify(base));assert.ok(check(r));assert.equal(r.checkpoint_eligible,false)});
test('reject invalid run',()=>assert.throws(()=>auditScanPages({...base,expectedPages:0}),/invalid_run/));
test('failed page is explicitly unsuccessful even when received',()=>{const r=auditScanPages({...base,pages:[{...base.pages[0],httpStatus:503},base.pages[1]]});assert.deepEqual(r.unsuccessful_pages,[1]);assert.equal(r.successful_page_count,1)});
test('duplicate symbol across pages is not silently accepted',()=>{const r=auditScanPages({...base,pages:[base.pages[0],{...base.pages[1],rows:[{...base.pages[1].rows[0],symbol:'AAA'}]}]});assert.equal(r.duplicate_instrument_rows,1);assert.ok(r.issues.includes('duplicate_instrument'));assert.equal(r.coverage_status,'incomplete_or_unverified')});
test('invalid request timestamp rejected',()=>assert.throws(()=>auditScanPages({...base,requestedAt:'not-a-time'}),/invalid_requested_at/));
test('missing row and null page are accounted for without crashing',()=>{const r=auditScanPages({...base,pages:[null,{...base.pages[1],rows:[null]}]});assert.ok(r.issues.includes('invalid_page'));assert.equal(r.invalid_instrument_rows,1);assert.deepEqual(r.unsuccessful_pages,[1])});
test('duplicate symbol on same page is flagged',()=>{const r=auditScanPages({...base,pages:[{...base.pages[0],rows:[...base.pages[0].rows,...base.pages[0].rows]},base.pages[1]]});assert.equal(r.duplicate_instrument_rows,1)});
