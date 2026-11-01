import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGdeltDocUrl, normalizeGdeltResponse, fetchGdeltDocNews } from './gdelt_doc_news.mjs';
const now='2026-11-01T22:00:00.000Z';
const art=(n,extra={})=>({url:'https://news'+n+'.example/story/'+n,title:'Catalyst '+n,seendate:'20261101T214500Z',domain:'news'+n+'.example',...extra});

test('ticker-independent bounded article-list query',()=>{
 const u=buildGdeltDocUrl({query:'(FDA OR clinical trial)',startAt:'2026-11-01T16:00:00Z',endAt:now});
 assert.equal(u.origin+u.pathname,'https://api.gdeltproject.org/api/v2/doc/doc');
 assert.equal(u.searchParams.get('mode'),'artlist'); assert.equal(u.searchParams.get('format'),'json');
 assert.equal(u.searchParams.get('maxrecords'),'250'); assert.equal(u.searchParams.get('startdatetime'),'20261101160000');
 assert.equal(u.searchParams.get('enddatetime'),'20261101220000'); assert.equal(u.searchParams.has('ticker'),false);
});
test('rejects invalid time windows and record limits',()=>{
 assert.throws(()=>buildGdeltDocUrl({query:'FDA',startAt:now,endAt:now}),/invalid_time_window/);
 assert.throws(()=>buildGdeltDocUrl({query:'FDA',startAt:'2026-10-30T00:00:00Z',endAt:now}),/24h/);
 assert.throws(()=>buildGdeltDocUrl({query:'FDA',startAt:'2026-11-01T16:00:00Z',endAt:now,maxRecords:251}),/max_records/);
});
test('preserves source record, URL, timestamp and stable hashes',()=>{
 const raw=art(1),a=normalizeGdeltResponse({articles:[raw]},{observedAt:now,query:'FDA'}),b=normalizeGdeltResponse({articles:[raw]},{observedAt:now,query:'FDA'});
 assert.equal(a.records[0].originalName,raw.title); assert.equal(a.records[0].sourceUrl,raw.url);
 assert.equal(a.records[0].eventTime,'2026-11-01T21:45:00.000Z'); assert.equal(a.records[0].sourcePayload.article,raw);
 assert.equal(a.records[0].fingerprint,b.records[0].fingerprint); assert.equal(a.records[0].sourceEventId,b.records[0].sourceEventId);
});
test('does not fabricate event time from invalid provider date',()=>{
 const r=normalizeGdeltResponse({articles:[art(2,{seendate:'bad'})]},{observedAt:now,query:'FDA'}).records[0];
 assert.equal(r.eventTime,null); assert.equal(r.sourceTimestampLabel,'bad');
});
test('saturated page remains incomplete and cannot checkpoint',()=>{
 const c=normalizeGdeltResponse({articles:[art(3),art(4)]},{observedAt:now,query:'FDA',maxRecords:2}).coverage;
 assert.equal(c.resultCapReached,true); assert.equal(c.coverageComplete,false); assert.equal(c.sourceComplete,false); assert.equal(c.checkpointPermitted,false);
});
test('fails closed on malformed pages, duplicate records and unsafe URLs',()=>{
 assert.throws(()=>normalizeGdeltResponse({results:[]},{observedAt:now,query:'FDA'}),/invalid_gdelt_response/);
 assert.throws(()=>normalizeGdeltResponse({articles:[art(1),art(1)]},{observedAt:now,query:'FDA'}),/duplicate_article/);
 assert.throws(()=>normalizeGdeltResponse({articles:[art(1,{url:'http://bad.example'})]},{observedAt:now,query:'FDA'}),/invalid_article_fields/);
});
test('bounded fetch parses results and records HTTP failure',async()=>{
 let called;
 const r=await fetchGdeltDocNews({query:'FDA',startAt:'2026-11-01T16:00:00Z',endAt:now,observedAt:now,maxRecords:4,
 fetchImpl:async(url,init)=>{called={url,init};return{ok:true,json:async()=>({articles:[art(5)]})};}});
 assert.equal(called.url.searchParams.get('maxrecords'),'4'); assert.equal(called.init.headers.accept,'application/json'); assert.equal(r.records.length,1);
 await assert.rejects(fetchGdeltDocNews({query:'FDA',startAt:'2026-11-01T16:00:00Z',endAt:now,fetchImpl:async()=>({ok:false,status:503})}),/gdelt_http_503/);
});
