import { createHash } from 'node:crypto';

const MAX_XML_BYTES = 1_000_000;
const MAX_ENTRIES = 100;
const ALLOWED_HOST = 'www.sciencedaily.com';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function decodeXml(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}
function tag(xml, name) {
  const escaped = name.replace(':', '\\:');
  const match = xml.match(new RegExp('<' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + escaped + '\\s*>', 'i'));
  return match ? decodeXml(match[1]) : null;
}
function atomLink(xml) {
  const links = [...xml.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  const link = links.find(m => /\brel\s*=\s*["']alternate["']/i.test(m[1]))
    ?? links.find(m => !/\brel\s*=\s*["'](?:self|hub|edit|related|enclosure)["']/i.test(m[1])) ?? links[0];
  return link?.[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
}
export function normalizeScienceDailyRss(xml, { feedUrl = 'https://www.sciencedaily.com/rss/all.xml', observedAt = new Date().toISOString(), maxEntries = MAX_ENTRIES } = {}) {
  if (typeof xml !== 'string' || !xml.trim() || Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) throw new Error('invalid_or_oversized_feed');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('unsafe_xml_declaration');
  let url; try { url = new URL(feedUrl); } catch { throw new Error('invalid_feed_url'); }
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST || url.username || url.password) throw new Error('unapproved_feed_url');
  const isAtom = /<feed\b/i.test(xml) && !/<rss\b/i.test(xml);
  if (!isAtom && !/<rss\b/i.test(xml)) throw new Error('unsupported_feed_document');
  const element = isAtom ? 'entry' : 'item';
  const blocks = [...xml.matchAll(new RegExp('<' + element + '\\b[^>]*>[\\s\\S]*?</' + element + '\\s*>', 'gi'))];
  if (blocks.length > maxEntries || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES) throw new Error('entry_limit_exceeded');
  const records = []; const seen = new Set();
  for (const [index, match] of blocks.entries()) {
    const raw = match[0]; const title = tag(raw, 'title'); const id = tag(raw, isAtom ? 'id' : 'guid');
    const link = isAtom ? atomLink(raw) : tag(raw, 'link');
    const published = tag(raw, isAtom ? 'published' : 'pubDate') ?? tag(raw, 'updated') ?? tag(raw, 'dc:date');
    const summary = tag(raw, isAtom ? 'summary' : 'description'); const eventTime = published ? new Date(published) : null;
    if (!title || !link || !published || !eventTime || Number.isNaN(eventTime.valueOf())) throw new Error('malformed_entry_' + (index + 1));
    let articleUrl; try { articleUrl = new URL(link, feedUrl); } catch { throw new Error('invalid_link_' + (index + 1)); }
    if (articleUrl.protocol !== 'https:' || articleUrl.hostname !== ALLOWED_HOST) throw new Error('unapproved_link_' + (index + 1));
    // URL identity matches the earlier stored RSS records; raw provider id remains in evidence.
    const sourceEventId = articleUrl.href;
    if (seen.has(sourceEventId)) throw new Error('duplicate_entry_id_' + (index + 1));
    seen.add(sourceEventId);
    records.push({ engine: 'news', source: 'rss.sciencedaily-all', sourceEventId, originalName: title,
      eventTime: eventTime.toISOString(), observedAt, sourceUrl: articleUrl.href, fingerprint: sha256(raw),
      sourcePayload: { provider: 'ScienceDaily RSS', attribution: 'ScienceDaily', feed_url: url.href,
        source_timestamp: published, source_id: id, summary, raw_item_xml: raw } });
  }
  const snapshotHash = sha256(xml);
  const newest = records.reduce((a, b) => !a || b.eventTime > a.eventTime ? b : a, null);
  return { records, page: { sourceKey: 'rss:sciencedaily-all', observedAt, snapshotHash,
    returnedEntries: blocks.length, selectedEntries: records.length,
    nextCursor: newest ? JSON.stringify({ version: 1, newest_event_time: newest.eventTime, newest_source_event_id: newest.sourceEventId, snapshot_sha256: snapshotHash }) : null,
    sourceComplete: false, paginationExposed: false, outboxCreated: 0 } };
}
export async function fetchScienceDailyRss({ feedUrl = 'https://www.sciencedaily.com/rss/all.xml', fetchImpl = fetch, timeoutMs = 10000, observedAt = new Date().toISOString(), maxEntries = 60 } = {}) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(feedUrl, { method: 'GET', headers: { accept: 'application/rss+xml, application/xml, text/xml' }, signal: controller.signal });
    if (!response.ok) throw new Error('feed_http_' + response.status);
    const type = response.headers.get('content-type') ?? '';
    if (!/xml|rss/i.test(type)) throw new Error('unexpected_feed_content_type');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_XML_BYTES) throw new Error('invalid_or_oversized_feed');
    return normalizeScienceDailyRss(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { feedUrl, observedAt, maxEntries });
  } finally { clearTimeout(timeout); }
}
