// Contract-compatible, bounded adapter for LuxAlgo market-trackers at the pinned commit.
// Original JSON fields remain in the durable source_payload unchanged.
import { createHash } from 'node:crypto';

export const LUXALGO_COMMIT = '1ecfcca36a224d4758cc6e2e20cca216db43d5ee';
export const FEEDS = [
  { url: 'https://www.federalreserve.gov/json/ne-speeches.json', type: 'speech' },
  { url: 'https://www.federalreserve.gov/json/ne-testimony.json', type: 'testimony' },
  { url: 'https://www.federalreserve.gov/json/ne-press.json', type: null },
];

export function itemIdFromLink(link) {
  if (typeof link !== 'string' || !link.trim()) throw new Error('missing_source_link');
  let path = link.trim().replace(/^https?:\/\/www\.federalreserve\.gov/i, '');
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\.html?$/i, '');
  return path.startsWith('/newsevents/') ? path.slice('/newsevents/'.length) : path.slice(1);
}

function zonedParts(epoch) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
  const out = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return [Number(out.year), Number(out.month), Number(out.day), Number(out.hour), Number(out.minute), Number(out.second)];
}

export function easternTimestampToIso(raw) {
  if (typeof raw !== 'string') throw new Error('missing_source_timestamp');
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(raw.trim());
  if (!m) throw new Error('invalid_source_timestamp');
  const month=+m[1], day=+m[2], year=+m[3], hour12=+m[4], minute=+m[5], second=+(m[6]??0);
  if(month<1||month>12||hour12<1||hour12>12||minute>59||second>59) throw new Error('invalid_source_timestamp');
  const hour=(hour12%12)+(/PM/i.test(m[7])?12:0), desired=[year,month,day,hour,minute,second];
  let epoch=Date.UTC(year,month-1,day,hour,minute,second);
  for(let i=0;i<3;i++){const actual=zonedParts(epoch);epoch+=Date.UTC(...desired)-Date.UTC(...actual);}
  if(zonedParts(epoch).some((v,i)=>v!==desired[i])) throw new Error('nonexistent_or_ambiguous_source_timestamp');
  return new Date(epoch).toISOString();
}

export function normalizeFedItem(raw, feedType, feedUrl, retrievedAt) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error('invalid_feed_record');
  if(feedType===null&&raw.pt!=='Monetary Policy') return null;
  const title=typeof raw.t==='string'?raw.t.trim():'';
  if(!title) throw new Error('missing_source_title');
  const link=typeof raw.l==='string'?raw.l.trim():'';
  const id=itemIdFromLink(link);
  const sourceTimestamp=typeof raw.d==='string'?raw.d:'';
  const type=feedType??(title.startsWith('Minutes of the Federal Open Market Committee')?'minutes':title.includes('FOMC statement')?'statement':'pressRelease');
  const url=/^https?:\/\//i.test(link)?link:`https://www.federalreserve.gov${link.startsWith('/')?'':'/'}${link}`;
  return {id,type,title,eventTime:easternTimestampToIso(sourceTimestamp),sourceTimestamp,url,feedUrl,retrievedAt,fingerprint:createHash('sha256').update(JSON.stringify(raw)).digest('hex')};
}


export function normalizeBoundedFeeds(feeds, retrievedAt, maxRecords) {
  const available = feeds.reduce((n, feed) => n + feed.items.length, 0);
  const inScopeAvailable = feeds.reduce((n, feed, i) => n + feed.items.filter(raw => FEEDS[i].type !== null || raw.pt === 'Monetary Policy').length, 0);
  const records = [];
  let processed = 0, parseFailures = 0, outOfScopeProcessed = 0;
  for (let i = 0; i < feeds.length && processed < maxRecords; i++) {
    const feed = feeds[i];
    for (const raw of feed.items) {
      if (processed >= maxRecords) break;
      processed += 1;
      try {
        const normalized = normalizeFedItem(raw, FEEDS[i].type, feed.url, retrievedAt);
        if (normalized) records.push({ raw, feedUrl: feed.url, ...normalized });
        else outOfScopeProcessed += 1;
      } catch {
        parseFailures += 1;
      }
    }
  }
  return { records, coverage: { recordsAvailable: available, recordsInScopeAvailable: inScopeAvailable, recordsProcessed: processed, recordsSelected: records.length, recordsOutOfScopeProcessed: outOfScopeProcessed, parseFailures, complete: processed === available && parseFailures === 0 } };
}


export function feedSnapshotHash(feeds) {
  return createHash('sha256').update(JSON.stringify(feeds.map(feed => feed.items))).digest('hex');
}

export function normalizeFeedRange(feeds, retrievedAt, maxRecords, startOffset = 0) {
  const available = feeds.reduce((n, feed) => n + feed.items.length, 0);
  if (!Number.isInteger(startOffset) || startOffset < 0 || startOffset > available) throw new Error('invalid_feed_offset');
  const inScopeAvailable = feeds.reduce((n, feed, i) => n + feed.items.filter(raw => FEEDS[i].type !== null || raw.pt === 'Monetary Policy').length, 0);
  const records = [];
  let absoluteOffset = 0, processed = 0, parseFailures = 0, outOfScopeProcessed = 0, blockedOffset = null;
  const quarantineRecords = [];
  for (let i = 0; i < feeds.length; i++) {
    for (const raw of feeds[i].items) {
      if (absoluteOffset < startOffset) { absoluteOffset++; continue; }
      if (processed >= maxRecords || blockedOffset !== null) break;
      const itemOffset = absoluteOffset++; processed++;
      try {
        const normalized = normalizeFedItem(raw, FEEDS[i].type, feeds[i].url, retrievedAt);
        if (normalized) records.push({ raw, feedUrl: feeds[i].url, ...normalized });
        else outOfScopeProcessed++;
      } catch (error) {
        parseFailures++;
        blockedOffset = itemOffset;
        const rawFingerprint = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
        let sourceEventId = null;
        try { sourceEventId = itemIdFromLink(raw?.l); } catch {}
        quarantineRecords.push({
          quarantineKey: createHash('sha256').update(`${feeds[i].url}\0${rawFingerprint}`).digest('hex'),
          sourceEventId,
          sourceIdentity: sourceEventId ? `event:${sourceEventId}` : `unresolved:${feeds[i].url}:${itemOffset}:${rawFingerprint}`,
          sourceLink: typeof raw?.l === 'string' ? raw.l : null,
          sourceFeedUrl: feeds[i].url,
          sourceOffset: itemOffset,
          rawFingerprint,
          failureReason: typeof error?.message === 'string' && /^[a-z0-9_]{1,100}$/.test(error.message)
            ? error.message : 'source_item_normalization_failed',
          retryStatus: 'pending_reprocess',
          checkpointImplication: 'held_at_blocked_source_offset',
          rawRecord: raw,
        });
      }
    }
    if (processed >= maxRecords || blockedOffset !== null) break;
  }
  const nextOffset = blockedOffset === null ? startOffset + processed : blockedOffset;
  return { records, quarantineRecords, coverage: { recordsAvailable: available, recordsInScopeAvailable: inScopeAvailable, recordsProcessed: processed, recordsSelected: records.length, recordsOutOfScopeProcessed: outOfScopeProcessed, parseFailures, blockedOffset, startOffset, nextOffset, complete: nextOffset === available && parseFailures === 0 } };
}

export function addQuarantineRetryState(quarantineRecords, previousRecords = []) {
  if (!Array.isArray(quarantineRecords) || !Array.isArray(previousRecords)) throw new TypeError('invalid_quarantine_history');
  const attempts = new Map();
  for (const record of previousRecords) {
    if (record && typeof record.quarantineKey === 'string') {
      attempts.set(record.quarantineKey, (attempts.get(record.quarantineKey) ?? 0) + 1);
    }
  }
  return quarantineRecords.map(record => ({ ...record,
    retryAttempt: (attempts.get(record.quarantineKey) ?? 0) + 1,
    retryStatus: 'pending_reprocess',
  }));
}

export function federalReserveFetchFailureEvidence({ feedUrl, feedIndex, error, retrievedAt }) {
  if (!FEEDS.some(feed => feed.url === feedUrl) || !Number.isInteger(feedIndex) || feedIndex < 0 || feedIndex >= FEEDS.length ||
      typeof retrievedAt !== 'string' || !Number.isFinite(Date.parse(retrievedAt))) {
    throw new TypeError('invalid_federal_reserve_fetch_failure');
  }
  const message = typeof error?.message === 'string' ? error.message : '';
  const http = /(?:^|:)upstream_http_(\d{3})$/.exec(message);
  const failureCode = message === 'upstream_shape_drift' ? message
    : http ? `upstream_http_${http[1]}`
      : message.startsWith('feed_fetch_failed:') ? 'feed_fetch_failed'
        : 'source_fetch_failed';
  return {
    sourceKey: 'luxalgo:federalreserve',
    sourceFeedUrl: feedUrl,
    sourceFeedIndex: feedIndex,
    sourceIdentity: `feed:${feedUrl}`,
    failureCode,
    retryStatus: 'pending_retry',
    attemptedAt: new Date(retrievedAt).toISOString(),
    feedsSucceededBeforeFailure: feedIndex,
    checkpointImplication: 'existing_checkpoint_unchanged',
    checkpointAdvanced: false,
  };
}
