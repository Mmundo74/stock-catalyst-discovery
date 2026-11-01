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
