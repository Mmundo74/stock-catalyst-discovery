import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScienceDailyRss, fetchScienceDailyRss } from './sciencedaily_rss.mjs';

const sample = '<?xml version="1.0"?><rss version="2.0"><channel><title>ScienceDaily</title><item><title>New &amp; useful discovery</title><link>https://www.sciencedaily.com/releases/2026/11/261101120000.htm</link><guid isPermaLink="false">sd-1</guid><pubDate>Sun, 01 Nov 2026 12:00:00 GMT</pubDate><description><![CDATA[A short <b>summary</b>.]]></description></item></channel></rss>';

test('RSS preserves identity, timestamp, attribution, summary, raw source evidence and incomplete snapshot status', () => {
  const got = normalizeScienceDailyRss(sample, { observedAt: '2026-11-01T12:01:00Z' });
  assert.equal(got.records.length, 1); assert.equal(got.records[0].originalName, 'New & useful discovery');
  assert.equal(got.records[0].sourcePayload.source_timestamp, 'Sun, 01 Nov 2026 12:00:00 GMT');
  assert.equal(got.records[0].sourcePayload.attribution, 'ScienceDaily');
  assert.equal(got.records[0].sourcePayload.summary, 'A short <b>summary</b>.');
  assert.match(got.records[0].sourcePayload.raw_item_xml, /<guid/);
  assert.equal(got.page.sourceComplete, false); assert.equal(got.page.paginationExposed, false); assert.equal(got.page.outboxCreated, 0);
  assert.equal(JSON.parse(got.page.nextCursor).newest_source_event_id, 'https://www.sciencedaily.com/releases/2026/11/261101120000.htm');
});
test('Atom entries normalize without choosing a self link', () => {
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>atom-1</id><title>Atom headline</title><link rel="self" href="https://www.sciencedaily.com/rss/all.xml"/><link rel="alternate" href="https://www.sciencedaily.com/releases/2026/11/261101130000.htm"/><published>2026-11-01T13:00:00Z</published><summary>Atom summary</summary></entry></feed>';
  const got = normalizeScienceDailyRss(atom);
  assert.equal(got.records[0].sourceEventId, 'https://www.sciencedaily.com/releases/2026/11/261101130000.htm');
  assert.equal(got.records[0].sourcePayload.source_id, 'atom-1');
  assert.equal(got.records[0].sourceUrl, 'https://www.sciencedaily.com/releases/2026/11/261101130000.htm');
});
test('malformed, duplicate, unsafe, oversized and non-official inputs fail closed', () => {
  assert.throws(() => normalizeScienceDailyRss(sample.replace('<pubDate>Sun, 01 Nov 2026 12:00:00 GMT</pubDate>', '')), /malformed_entry/);
  const item = sample.match(/<item>[\s\S]*?<\/item>/)[0];
  assert.throws(() => normalizeScienceDailyRss(sample.replace('</channel>', item + '</channel>')), /duplicate_entry/);
  assert.throws(() => normalizeScienceDailyRss('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>'), /unsafe_xml/);
  assert.throws(() => normalizeScienceDailyRss(sample, { feedUrl: 'http://www.sciencedaily.com/rss/all.xml' }), /unapproved_feed_url/);
  assert.throws(() => normalizeScienceDailyRss(sample.replace('www.sciencedaily.com/releases', 'attacker.example/releases')), /unapproved_link/);
  assert.throws(() => normalizeScienceDailyRss('x'.repeat(1000001)), /invalid_or_oversized/);
  assert.throws(() => normalizeScienceDailyRss(sample + sample, { maxEntries: 1 }), /entry_limit_exceeded/);
});
test('bounded fetch checks status and content type with injectable transport', async () => {
  const f = async () => new Response(sample, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  const got = await fetchScienceDailyRss({ fetchImpl: f, observedAt: '2026-11-01T12:02:00Z' });
  assert.equal(got.records.length, 1);
  await assert.rejects(fetchScienceDailyRss({ fetchImpl: async () => new Response('bad', { status: 503 }) }), /feed_http_503/);
  await assert.rejects(fetchScienceDailyRss({ fetchImpl: async () => new Response(sample, { status: 200, headers: { 'content-type': 'text/html' } }) }), /unexpected_feed_content_type/);
});
