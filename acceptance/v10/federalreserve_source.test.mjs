import test from 'node:test';
import assert from 'node:assert/strict';
import { FEEDS, LUXALGO_COMMIT, addQuarantineRetryState, canAdvanceFedCheckpoint, easternTimestampToIso, itemIdFromLink, normalizeFedItem, normalizeBoundedFeeds, feedSnapshotHash, normalizeFeedRange, federalReserveFetchFailureEvidence } from './federalreserve_source.mjs';
test('pins LuxAlgo commit and three public Fed feeds', () => { assert.equal(LUXALGO_COMMIT, '1ecfcca36a224d4758cc6e2e20cca216db43d5ee'); assert.equal(FEEDS.length, 3); });
test('normalizes speech and preserves source title, timestamp, and identity', () => { const raw={d:'8/5/2026 4:05:00 PM',t:'Original title',l:'/newsevents/speech/cook20260805a.htm'}; const n=normalizeFedItem(raw,'speech',FEEDS[0].url,'2026-11-01T00:00:00.000Z'); assert.equal(n.id,'speech/cook20260805a'); assert.equal(n.title,raw.t); assert.equal(n.sourceTimestamp,raw.d); assert.equal(n.eventTime,'2026-08-05T20:05:00.000Z'); });
test('uses IANA DST rules for summer and winter timestamps', () => { assert.equal(easternTimestampToIso('8/5/2026 4:05:00 PM'),'2026-08-05T20:05:00.000Z'); assert.equal(easternTimestampToIso('1/5/2026 4:05:00 PM'),'2026-01-05T21:05:00.000Z'); });
test('matches LuxAlgo link identity and press-category filter', () => { assert.equal(itemIdFromLink('https://www.federalreserve.gov/newsevents/pressreleases/monetary20261007a.htm'),'pressreleases/monetary20261007a'); assert.equal(normalizeFedItem({d:'8/5/2026 4:05:00 PM',t:'Action',l:'/x.htm',pt:'Enforcement Actions'},null,FEEDS[2].url,'x'),null); });
test('normalizes the observed LuxAlgo speech row using its official stub without merging distinct appearances', () => {
  const raw={d:'2/11/2025 3:30:00 PM',t:'Bank Regulation in 2025 and Beyond',s:'Governor Michelle W. Bowman',lo:'At the 2025 Iowa Bankers Association Bank Management and Policy Conference, Des Moines, Iowa (virtual)',l:'',stub:'/newsevents/speech/bowman20250205a.htm',a:'Governor Bowman presented identical remarks to the Kansas Bankers Association Government Relations Conference, Topeka, Kansas, on February 5, 2025.',o:'no',v:''};
  const normalized=normalizeFedItem(raw,'speech',FEEDS[0].url,'2026-11-02T00:00:00.000Z');
  assert.equal(normalized.eventTime,'2025-02-11T20:30:00.000Z');
  assert.equal(normalized.title,raw.t);
  assert.equal(normalized.sourceTimestamp,raw.d);
  assert.equal(normalized.url,'https://www.federalreserve.gov/newsevents/speech/bowman20250205a.htm');
  assert.equal(normalized.linkSource,'stub');
  assert.match(normalized.id,/^speech\/bowman20250205a#stub-[a-f0-9]{16}$/);
  const original=normalizeFedItem({...raw,d:'2/5/2025 3:30:00 PM',l:'/newsevents/speech/bowman20250205a.htm'},'speech',FEEDS[0].url,'2026-11-02T00:00:00.000Z');
  assert.notEqual(normalized.id,original.id);
  assert.equal(new URL(normalized.url).hostname,'www.federalreserve.gov');
});
test('rejects non-Federal-Reserve links even when source records provide a URL', () => {
  assert.throws(()=>normalizeFedItem({d:'8/5/2026 4:05:00 PM',t:'External',l:'https://example.org/source.htm'},'speech',FEEDS[0].url,'x'),/unapproved_source_link/);
  assert.throws(()=>normalizeFedItem({d:'8/5/2026 4:05:00 PM',t:'External',l:'',stub:'https://example.org/source.htm'},'speech',FEEDS[0].url,'x'),/unapproved_source_link/);
});
test('rejects missing required source fields', () => { assert.throws(()=>normalizeFedItem({t:'No date',l:'/a.htm'},'speech',FEEDS[0].url,'x'),/timestamp/); assert.throws(()=>normalizeFedItem({d:'8/5/2026 4:05 PM',l:'/a.htm'},'speech',FEEDS[0].url,'x'),/title/); assert.throws(()=>normalizeFedItem({d:'8/5/2026 4:05 PM',t:'No link'},'speech',FEEDS[0].url,'x'),/link/); });
test('bounds raw processing and identifies malformed records', () => { const feeds=[{url:FEEDS[0].url,items:[{d:'8/5/2026 4:05:00 PM',t:'Bad link',l:''},{d:'8/5/2026 4:06:00 PM',t:'Valid',l:'/newsevents/speech/valid.htm'},{d:'8/5/2026 4:07:00 PM',t:'Tail',l:'/newsevents/speech/tail.htm'}]}]; const r=normalizeBoundedFeeds(feeds,'2026-11-01T00:00:00.000Z',2); assert.equal(r.coverage.recordsProcessed,2); assert.equal(r.coverage.parseFailures,1); assert.equal(r.coverage.complete,false); });
test('continues durable bounded offsets across feed boundaries', () => { const feeds=[{url:FEEDS[0].url,items:[{d:'8/5/2026 4:05:00 PM',t:'One',l:'/newsevents/speech/one.htm'},{d:'8/5/2026 4:06:00 PM',t:'Two',l:'/newsevents/speech/two.htm'}]},{url:FEEDS[1].url,items:[{d:'8/5/2026 4:07:00 PM',t:'Three',l:'/newsevents/testimony/three.htm'}]}]; const hash=feedSnapshotHash(feeds); const a=normalizeFeedRange(feeds,'2026-11-01T00:00:00.000Z',2,0); const b=normalizeFeedRange(feeds,'2026-11-01T00:01:00.000Z',2,a.coverage.nextOffset); assert.equal(hash,feedSnapshotHash(feeds)); assert.equal(a.coverage.nextOffset,2); assert.equal(a.coverage.complete,false); assert.equal(b.records[0].id,'testimony/three'); assert.equal(b.coverage.complete,true); });
test('durable quarantine advances only past the quarantined row and leaves later rows for the next page', () => { const feeds=[{url:FEEDS[0].url,items:[{d:'8/5/2026 4:05:00 PM',t:'Valid',l:'/newsevents/speech/valid.htm'},{d:'8/5/2026 4:06:00 PM',t:'Malformed',l:''},{d:'8/5/2026 4:07:00 PM',t:'After malformed',l:'/newsevents/speech/after.htm'}]}]; const r=normalizeFeedRange(feeds,'2026-11-01T00:00:00.000Z',3,0); assert.equal(r.coverage.blockedOffset,1); assert.equal(r.coverage.nextOffset,2); assert.equal(r.coverage.complete,false); assert.equal(canAdvanceFedCheckpoint(r.coverage,r.quarantineRecords),true); const next=normalizeFeedRange(feeds,'2026-11-01T00:01:00.000Z',3,r.coverage.nextOffset); assert.equal(next.records[0].id,'speech/after'); });

test('preserves malformed source item, identity, reason, and replay evidence', () => {
  const malformed = { d:'bad timestamp',t:'Original malformed item',l:'/newsevents/speech/bad.htm',extra:'preserve-me' };
  const feeds=[{url:FEEDS[0].url,items:[
    {d:'8/5/2026 4:05:00 PM',t:'Valid before failure',l:'/newsevents/speech/valid-before.htm'},
    malformed,
    {d:'8/5/2026 4:07:00 PM',t:'Must not pass the failure',l:'/newsevents/speech/after.htm'},
  ]}];
  const first=normalizeFeedRange(feeds,'2026-11-02T00:00:00.000Z',3,0);
  assert.equal(first.records.length,1);
  assert.equal(first.records[0].title,'Valid before failure');
  assert.equal(first.coverage.blockedOffset,1);
  assert.equal(first.coverage.nextOffset,2);
  assert.deepEqual(first.quarantineRecords[0].rawRecord,malformed);
  assert.equal(first.quarantineRecords[0].sourceEventId,'speech/bad');
  assert.equal(first.quarantineRecords[0].sourceOffset,1);
  assert.equal(first.quarantineRecords[0].failureReason,'invalid_source_timestamp');
  assert.equal(first.quarantineRecords[0].retryStatus,'pending_reprocess');
  assert.equal(first.quarantineRecords[0].checkpointImplication,'advance_only_after_quarantine_is_durable');
  assert.equal(canAdvanceFedCheckpoint(first.coverage,first.quarantineRecords),true);

  const firstAttempt=addQuarantineRetryState(first.quarantineRecords);
  // An explicit quarantine reprocess starts at the quarantined row, distinct
  // from ordinary forward continuation at offset 2.
  const retry=normalizeFeedRange(feeds,'2026-11-02T00:01:00.000Z',1,1);
  const secondAttempt=addQuarantineRetryState(retry.quarantineRecords,firstAttempt);
  assert.equal(retry.records.length,0);
  assert.equal(retry.coverage.nextOffset,2);
  assert.equal(secondAttempt[0].quarantineKey,firstAttempt[0].quarantineKey);
  assert.equal(secondAttempt[0].retryAttempt,2);
  assert.equal(secondAttempt[0].retryStatus,'pending_reprocess');
  assert.deepEqual(secondAttempt[0].rawRecord,malformed);
});

test('checkpoint gate refuses missing quarantine evidence and inconsistent offsets', () => {
  const feeds=[{url:FEEDS[0].url,items:[{d:'bad timestamp',t:'Malformed',l:'/newsevents/speech/bad.htm'}]}];
  const page=normalizeFeedRange(feeds,'2026-11-02T00:00:00Z',1,0);
  assert.equal(canAdvanceFedCheckpoint(page.coverage,[]),false);
  assert.equal(canAdvanceFedCheckpoint({...page.coverage,nextOffset:99},page.quarantineRecords),false);
  assert.equal(canAdvanceFedCheckpoint({...page.coverage,recordsAvailable:0},page.quarantineRecords),false);
  assert.equal(canAdvanceFedCheckpoint({...page.coverage,blockedOffset:1},page.quarantineRecords),false);
  assert.equal(canAdvanceFedCheckpoint({startOffset:3,nextOffset:3,recordsProcessed:0,recordsAvailable:3,parseFailures:0},[]),true);
});

test('source fetch failure evidence identifies feed and preserves checkpoint without exposing exception text', () => {
  const evidence = federalReserveFetchFailureEvidence({ feedUrl: FEEDS[1].url, feedIndex: 1,
    error: new Error('feed_fetch_failed:/json/ne-testimony.json:upstream_http_503'),
    retrievedAt: '2026-11-02T12:00:00.000Z' });
  assert.equal(evidence.sourceKey, 'luxalgo:federalreserve');
  assert.equal(evidence.sourceFeedUrl, FEEDS[1].url);
  assert.equal(evidence.sourceFeedIndex, 1);
  assert.equal(evidence.sourceIdentity, `feed:${FEEDS[1].url}`);
  assert.equal(evidence.failureCode, 'upstream_http_503');
  assert.equal(evidence.retryStatus, 'pending_retry');
  assert.equal(evidence.feedsSucceededBeforeFailure, 1);
  assert.equal(evidence.checkpointImplication, 'existing_checkpoint_unchanged');
  assert.equal(evidence.checkpointAdvanced, false);
  assert.equal(JSON.stringify(evidence).includes('/json/ne-testimony.json:upstream_http_503'), false);
  assert.throws(() => federalReserveFetchFailureEvidence({ feedUrl: 'https://example.org/feed', feedIndex: 0,
    error: new Error('x'), retrievedAt: '2026-11-02T12:00:00Z' }), /invalid_federal_reserve_fetch_failure/);
});
