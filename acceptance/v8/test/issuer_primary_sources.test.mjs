import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSecTickerExchange,parseNasdaqDirectory,parseSecSubmissions,correlateIssuer,parentRelationshipCandidate} from '../src/issuer_primary_sources.mjs';
const get = f => readFileSync(new URL(`../fixtures/${f}`,import.meta.url));
const at='2026-10-31T12:00:00.000Z';
const s=()=>parseSecTickerExchange(get('synthetic_sec_tickers.json'),{retrievedAt:at});
const nas=()=>parseNasdaqDirectory(get('synthetic_nasdaqlisted.txt'),{retrievedAt:at,directory:'nasdaqlisted',url:'https://nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'});
const other=()=>parseNasdaqDirectory(get('synthetic_otherlisted.txt'),{retrievedAt:at,directory:'otherlisted',url:'https://nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'});
const sub=()=>parseSecSubmissions(get('synthetic_sec_submissions.json'),{retrievedAt:at,cik:1001});
const asOf='2026-11-01T12:00:00.000Z';
const fixtureQuery=(q={})=>correlateIssuer({sec:s(),directory:nas(),submissions:sub(),asOf,...q});

test('SEC columnar schema parsed with exact original legal names and padded CIKs',()=>{
 const v=s();assert.equal(v.records.length,5);assert.equal(v.records[0].cik,'0000001001');assert.equal(v.records[0].legal_name,'Example Alpha, Inc.');assert.match(v.source_sha256,/^[a-f0-9]{64}$/);assert.equal(v.source_timestamp,null);
});
test('SEC original raw byte hashes change on revised snapshots',()=>{
 const raw=get('synthetic_sec_tickers.json'); const altered=Buffer.from(raw.toString().replace('ALPA','ALPZ'));
 assert.notEqual(parseSecTickerExchange(raw,{retrievedAt:at}).source_sha256,parseSecTickerExchange(altered,{retrievedAt:at}).source_sha256);
});
test('SEC malformed schema rejected',()=>assert.throws(()=>parseSecTickerExchange('{"fields":[],"data":[]}',{retrievedAt:at}),/invalid_sec_fields/));
test('SEC invalid row quarantined and snapshot marked incomplete',()=>{
 const input=JSON.stringify({fields:['cik','name','ticker','exchange'],data:[[7,'Fine','FINE','Nasdaq'],[8,'Bad','!!','Nasdaq']]});
 const v=parseSecTickerExchange(input,{retrievedAt:at});assert.equal(v.records.length,1);assert.equal(v.quarantine.length,1);assert.equal(v.integrity,'incomplete');
});
test('SEC duplicate identity is not silently collapsed',()=>{
 const input=JSON.stringify({fields:['cik','name','ticker','exchange'],data:[[7,'One','ONE','Nasdaq'],[7,'Changed','ONE','Nasdaq']]});
 const v=parseSecTickerExchange(input,{retrievedAt:at});assert.equal(v.quarantine[0].reason,'duplicate_or_conflicting_sec_identity');
});
test('reject oversize SEC input without attempting parse',()=>assert.throws(()=>parseSecTickerExchange('x'.repeat(12_000_001),{retrievedAt:at}),/oversized/));
test('ticker feed never invents source timestamp',()=>assert.equal(s().source_timestamp,null));
test('Nasdaq directory source footer correctly converts EDT to UTC',()=>assert.equal(nas().file_creation_time_utc,'2026-10-30T21:03:00.000Z'));test('Nasdaq otherlisted NYSE exchange mapping',()=>assert.equal(other().records[0].exchange,'NYSE'));
test('legacy BATS directory code Z normalizes to SEC CBOE venue',()=>{
 const secRaw=JSON.stringify({fields:['cik','name','ticker','exchange'],data:[[1002,'Example Beta Corporation','BETA','CBOE']]});
 const subRaw=JSON.stringify({cik:'0000001002',name:'Example Beta Corporation',tickers:['BETA'],exchanges:['CBOE']});
 const directoryRaw=get('synthetic_otherlisted.txt').toString().replace('BETA|Example Beta Corporation|N|','BETA|Example Beta Corporation|Z|');
 const sec=parseSecTickerExchange(secRaw,{retrievedAt:at});
 const directory=parseNasdaqDirectory(directoryRaw,{retrievedAt:at,directory:'otherlisted',url:'https://nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'});
 const submissions=parseSecSubmissions(subRaw,{retrievedAt:at,cik:1002});
 const v=correlateIssuer({ticker:'BETA',sec,directory,submissions,asOf});
 assert.equal(directory.records[0].exchange,'CBOE');assert.equal(v.status,'cross_correlated');
});
test('test issues and ETFs retained as non-eligible flags',()=>{
 const n=nas().records;assert.equal(n.find(x=>x.ticker==='TEST').test_issue,true);assert.equal(n.find(x=>x.ticker==='ETF1').etf,true);
});
test('directory malformed rows quarantined, not silently ignored',()=>{
 const altered=get('synthetic_nasdaqlisted.txt').toString().replace('ALPA|Example','ALPA|BROKEN|Example');
 assert.equal(parseNasdaqDirectory(altered,{retrievedAt:at,directory:'nasdaqlisted',url:'https://example.invalid/feed'}).integrity,'incomplete');
});
test('directory missing footer prevents fresh-source claim',()=>{
 const altered=get('synthetic_nasdaqlisted.txt').toString().replace(/File Creation Time:.*/, '');
 const v=parseNasdaqDirectory(altered,{retrievedAt:at,directory:'nasdaqlisted',url:'https://example.invalid/feed'});
 assert.equal(v.file_creation_time_utc,null);assert.equal(v.integrity,'incomplete');
});
test('directory footer impossible date rejected',()=>{
 const altered=get('synthetic_nasdaqlisted.txt').toString().replace('10302026','02312026');
 const v=parseNasdaqDirectory(altered,{retrievedAt:at,directory:'nasdaqlisted',url:'https://example.invalid/feed'});
 assert.equal(v.file_creation_time_utc,null);
});
test('directory footer conversion across winter standard time',()=>{
 const altered=get('synthetic_nasdaqlisted.txt').toString().replace('10302026','11022026');
 const v=parseNasdaqDirectory(altered,{retrievedAt:'2026-11-03T12:00:00Z',directory:'nasdaqlisted',url:'https://example.invalid/feed'});
 assert.equal(v.file_creation_time_utc,'2026-11-02T22:03:00.000Z');
});
test('Sec submissions list ticker, former names separately',()=>{
 const v=sub();assert.equal(v.records[0].ticker,'ALPA');assert.equal(v.former_names[0].name,'Old Example Alpha');
});
test('Reject SEC submission request CIK mismatch',()=>assert.throws(()=>parseSecSubmissions(get('synthetic_sec_submissions.json'),{retrievedAt:at,cik:999}),/mismatched/));
test('correlation requires all distinct independent primary-source observations',()=>{
 const v=fixtureQuery({name:'Example Alpha, Inc.',ticker:'ALPA'});assert.equal(v.status,'cross_correlated');assert.equal(v.candidates[0].status,'primary_source_cross_correlated');assert.equal(v.evidence.length,3);
});
test('corroborated candidate does not become legal owner or verified catalyst',()=>{
 const v=fixtureQuery({ticker:'ALPA'});assert(v.warnings.some(x=>x.includes('NOT verification')));
});
test('SEC-only name match cannot establish an active listing and flags collisions',()=>{
 const v=correlateIssuer({name:'Example Alpha, Inc.',sec:s(),asOf});assert.equal(v.status,'ambiguous');assert(v.candidates.every(x=>x.status==='unverified_candidate'));
});
test('historical name does not implicitly resolve to current issuer',()=>{
 const v=fixtureQuery({name:'Old Example Alpha'});assert.equal(v.status,'not_found');
});
test('same issuer with two active share classes requires class selection',()=>{
 const v=correlateIssuer({name:'Example Multi-Class Inc',sec:s(),directory:other(),asOf});assert.equal(v.status,'ambiguous');assert.equal(v.candidates.length,2);
});
test('punctuation-only name collision between different CIKs remains ambiguous',()=>{
 const v=correlateIssuer({name:'EXAMPLE ALPHA INC',sec:s(),asOf});assert.equal(v.status,'ambiguous');
});
test('ticker and CIK conflicting -> conflicting identity, no fallback',()=>{
 const v=fixtureQuery({ticker:'ALPA',cik:'0000001002'});assert.equal(v.status,'conflicting_identity');
});
test('one-sided ticker matching is not independent source corroboration',()=>{
 const v=correlateIssuer({ticker:'BETA',sec:s(),directory:other(),asOf});assert.equal(v.status,'requires_review');
});
test('stale listing directory cannot corroborate current issuer',()=>{
 const v=fixtureQuery({ticker:'ALPA',asOf:'2026-11-20T12:00:00Z'});assert.equal(v.status,'requires_review');assert(v.candidates[0].issues.includes('directory_incomplete_or_stale'));
});
test('future captured directory cannot corroborate current issuer',()=>{
 const v=fixtureQuery({ticker:'ALPA',asOf:'2026-10-29T12:00:00Z'});assert.equal(v.status,'requires_review');
});
test('Nasdaq directory cannot corroborate an OTC listing',()=>{
 const v=fixtureQuery({ticker:'OLD'});assert.equal(v.status,'requires_review');assert(v.candidates[0].issues.includes('ticker_not_in_directory'));
});
test('exact SEC+directory mapping with mismatched submissions CIK is unverified',()=>{
 const v=fixtureQuery({ticker:'BETA'});assert.equal(v.status,'requires_review');assert(v.candidates[0].issues.includes('submission_cik_mismatch'));
});
test('SEC incomplete snapshot cannot produce cross correlated status',()=>{
 const raw=JSON.stringify({fields:['cik','name','ticker','exchange'],data:[[1001,'Example Alpha, Inc.','ALPA','Nasdaq'],['bad','broken','!','Nasdaq']]});
 const v=correlateIssuer({ticker:'ALPA',sec:parseSecTickerExchange(raw,{retrievedAt:at}),directory:nas(),submissions:sub(),asOf});assert.equal(v.status,'requires_review');
});
test('same-symbol exchange conflict cannot be accepted',()=>{
 const altered=JSON.stringify({fields:['cik','name','ticker','exchange'],data:[[1001,'Example Alpha, Inc.','ALPA','NYSE']]});
 const v=correlateIssuer({ticker:'ALPA',sec:parseSecTickerExchange(altered,{retrievedAt:at}),directory:nas(),submissions:sub(),asOf});assert.equal(v.status,'requires_review');
});
test('ambiguous/announced parent links are never auto verified',()=>{
 const r=parentRelationshipCandidate({child_name:'Example Small Biotech',parent_name:'Example Mega Holdings',source_url:'https://sec.gov/Archives/test',source_document_type:'SEC_filing',transaction_status:'announced'});
 assert.equal(r.status,'requires_primary_document_review');
});
test('even a completed claim requires primary-document review',()=>{
 const r=parentRelationshipCandidate({child_name:'Example Co',parent_name:'Example Parent',source_document_type:'company_release',transaction_status:'completed'});
 assert.equal(r.status,'requires_primary_document_review');
});
test('reject nonexistent query',()=>assert.throws(()=>fixtureQuery({}),/missing_identity_query/));
test('CIK integer and left padded string represent same identifier',()=>assert.equal(fixtureQuery({ticker:'ALPA',cik:1001}).candidates[0].cik,'0000001001'));
test('No ticker-list requirement: name discovery returns all matching candidates',()=>{
 const v=fixtureQuery({name:'Example Alpha, Inc.'});assert.equal(v.candidates.length,2);assert.equal(v.status,'ambiguous');
});

test('a CIK and ticker disambiguate punctuation-only issuer collisions',()=>{
 const v=fixtureQuery({name:'Example Alpha, Inc.',ticker:'ALPA',cik:1001});assert.equal(v.status,'cross_correlated');
});
test('directory security name mismatch blocks cross corroboration',()=>{
 const raw=get('synthetic_nasdaqlisted.txt').toString().replace('ALPA|Example Alpha, Inc.','ALPA|Unrelated Issuer Inc');
 const d=parseNasdaqDirectory(raw,{retrievedAt:at,directory:'nasdaqlisted',url:'https://example.invalid/feed'});
 const v=correlateIssuer({ticker:'ALPA',sec:s(),directory:d,submissions:sub(),asOf});
 assert.equal(v.status,'requires_review');assert(v.candidates[0].issues.includes('security_name_differs_review_required'));
});
test('ambiguous Eastern DST footer cannot establish freshness',()=>{
 const raw=get('synthetic_nasdaqlisted.txt').toString().replace('1030202617:03','1101202601:30');
 const d=parseNasdaqDirectory(raw,{retrievedAt:'2026-11-02T12:00:00Z',directory:'nasdaqlisted',url:'https://example.invalid/feed'});
 assert.equal(d.file_creation_time_utc,null);assert.equal(d.integrity,'incomplete');
});

test('CIK-only request for a multi-class issuer does not silently choose a share class',()=>{
 const v=correlateIssuer({cik:1003,sec:s(),asOf});assert.equal(v.status,'ambiguous');assert.equal(v.candidates.length,2);
});
