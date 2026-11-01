import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyDiscovery } from './research_qualification.mjs';

const event = { engine: 'government', source: 'test', sourceEventId: 'evt-1', fingerprint: 'a'.repeat(64) };
const evidence = [1,2].map(n => ({sourceName:`source${n}`,url:`https://example${n}.org/item`,sha256:String(n).repeat(64),retrievedAt:'2026-11-01T10:00:00Z',sourceTimestamp:'2026-11-01T09:00:00Z',originalName:`Original ${n}`,rawEvidence:{n}}));
const resolution = { status:'cross_correlated', candidates:[{status:'primary_source_cross_correlated',cik:'0000001001',ticker:'TEST',exchange:'Nasdaq',legal_name:'Test Public Company'}] };
const parent = {childName:'Test Public Company',parentName:'Test Holdings',status:'verified_primary_document',sourceUrl:'https://sec.gov/Archives/filing',sourceSha256:'b'.repeat(64),transactionStatus:'completed',review:{approved:true,reviewerId:'reviewer-1',reviewedAt:'2026-11-01T10:31:00Z'}};
const impact = {direction:'positive',rationale:'The filing reports completed approval of a material commercial launch.',assessedAt:'2026-11-01T10:30:00Z'};
const humanReview = {approved:true,reviewerId:'reviewer-1',reviewedAt:'2026-11-01T10:31:00Z'};

test('unverified name and ticker remain raw; no automatic alert promotion',()=>{
 const q=qualifyDiscovery({event,issuerResolution:{status:'requires_review',candidates:resolution.candidates},evidence});
 assert.equal(q.stage,'raw_discovery');assert.equal(q.alertEligible,false);assert.equal(q.notificationAction,'none');
 assert(q.alertEligibilityReasons.includes('issuer_not_uniquely_cross_correlated'));
});
test('one uniquely cross-correlated primary issuer qualifies for research, not alerts',()=>{
 const q=qualifyDiscovery({event,issuerResolution:resolution,evidence});
 assert.equal(q.stage,'research_qualified');assert.equal(q.issuer.cik,'0000001001');assert.equal(q.issuer.ticker,'TEST');
 assert.equal(q.alertEligible,false);assert.equal(q.parentRelationship.status,'unknown');
});
test('ambiguous share classes do not silently choose a ticker',()=>{
 const q=qualifyDiscovery({event,issuerResolution:{status:'ambiguous',candidates:[...resolution.candidates,{...resolution.candidates[0],ticker:'TEST.A'}]},evidence});
 assert.equal(q.issuer,null);assert.equal(q.stage,'raw_discovery');
});
test('parent announcement is retained as unresolved instead of inferred ownership',()=>{
 const q=qualifyDiscovery({event,issuerResolution:resolution,parentRelationship:{...parent,status:'requires_primary_document_review'},evidence});
 assert.equal(q.stage,'research_qualified');assert.equal(q.parentRelationship.status,'requires_review');assert.equal(q.alertEligible,false);
});
test('alert eligibility requires issuer, two evidence items, impact, verified parent and explicit review',()=>{
 const q=qualifyDiscovery({event,issuerResolution:resolution,parentRelationship:parent,impactAssessment:impact,humanReview,evidence});
 assert.equal(q.stage,'alert_eligible');assert.equal(q.alertEligible,true);assert.equal(q.notificationAction,'none');
});
test('missing second independent evidence blocks alert eligibility',()=>{
 const q=qualifyDiscovery({event,issuerResolution:resolution,parentRelationship:parent,impactAssessment:impact,humanReview,evidence:evidence.slice(0,1)});
 assert.equal(q.stage,'research_qualified');assert.equal(q.alertEligible,false);});

test('two URLs from the same normalized publisher do not count as independent evidence',()=>{
 const samePublisher=[{...evidence[0],sourceName:'Publisher',url:'https://www.publisher.example/a'},
   {...evidence[1],sourceName:'Publisher',url:'https://publisher.example/b'}];
 const q=qualifyDiscovery({event,issuerResolution:resolution,parentRelationship:parent,impactAssessment:impact,humanReview,evidence:samePublisher});
 assert.equal(q.stage,'research_qualified');assert.equal(q.alertEligible,false);
 assert(q.alertEligibilityReasons.includes('two_independent_evidence_items_required'));
});

test('missing original evidence hash or source time fails closed',()=>{
 assert.throws(()=>qualifyDiscovery({event,issuerResolution:resolution,evidence:[{...evidence[0],sha256:'bad'}]}),/invalid_supporting_evidence/);
});
test('malformed ticker cannot become a qualified issuer',()=>{
 const q=qualifyDiscovery({event,issuerResolution:{status:'cross_correlated',candidates:[{...resolution.candidates[0],ticker:'??'}]},evidence});
 assert.equal(q.stage,'raw_discovery');assert.equal(q.issuer,null);
});
test('future review time is rejected for eligibility',()=>{
 const q=qualifyDiscovery({event,issuerResolution:resolution,parentRelationship:parent,impactAssessment:impact,humanReview:{...humanReview,reviewedAt:'2999-01-01T00:00:00Z'},evidence});
 assert.equal(q.alertEligible,false);
});
test('duplicate evidence URLs and hashes cannot satisfy independent corroboration',()=>{
 assert.throws(()=>qualifyDiscovery({event,issuerResolution:resolution,evidence:[evidence[0],{...evidence[1],url:evidence[0].url}]}),/duplicate_supporting_evidence/);
});
test('parent status alone is insufficient without parent-specific review',()=>{
 const q=qualifyDiscovery({event,issuerResolution:resolution,parentRelationship:{...parent,review:null},impactAssessment:impact,humanReview,evidence});
 assert.equal(q.alertEligible,false);assert.equal(q.parentRelationship.status,'requires_review');
});
