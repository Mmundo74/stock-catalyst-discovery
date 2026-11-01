/**
 * Independent, offline, primary-source issuer correlation acceptance adapter.
 * Does NOT modify existing src/issuer_candidates.js; does NOT fetch network data.
 * Never upgrades a name match or an announced transaction to verified ownership.
 */
import { createHash } from 'node:crypto';

export const SEC_EXCHANGE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
export const SEC_SUBMISSION_BASE = 'https://data.sec.gov/submissions/CIK';
export const NASDAQ_DIRECTORY_DEFINITIONS = 'https://www.nasdaqtrader.com/Trader.aspx?id=SymbolDirDefs';
const OTHER_LISTED_CODES = Object.freeze({ N: 'NYSE', A: 'NYSE American', P: 'NYSE Arca', Z: 'CBOE', V: 'IEX' });
const iso = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d\d-\d\dT/.test(value);
const timestamp = value => {
  if (!iso(value)) throw new Error('invalid_retrieved_at');
  return new Date(value).toISOString();
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = raw => Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
const clean = s => typeof s === 'string' ? s.trim() : '';
const nameKey = s => clean(s).normalize('NFKC').toLocaleUpperCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const symbolKey = s => clean(s).toUpperCase();
const validTicker = s => /^[A-Z0-9][A-Z0-9.\-^]{0,18}$/.test(s);
const cikKey = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value);
  if (!/^\d{1,10}$/.test(s) || Number(s) === 0) return null;
  return s.padStart(10, '0');
};
const result = ({kind, url, retrievedAt, raw, records, quarantine, ...extra}) => ({
  kind, url, retrieved_at: timestamp(retrievedAt), source_sha256: hash(utf8(raw)),
  raw_byte_length: utf8(raw).byteLength, records, quarantine,
  integrity: quarantine.length ? 'incomplete' : 'parsed', ...extra,
});

export function parseSecTickerExchange(raw, {retrievedAt, url = SEC_EXCHANGE_URL} = {}) {
  const bytes = utf8(raw);
  if (bytes.length > 12_000_000) throw new Error('oversized_sec_snapshot');
  const data = JSON.parse(bytes.toString('utf8'));
  if (!data || !Array.isArray(data.fields) || !Array.isArray(data.data)) throw new Error('invalid_sec_schema');
  if (new Set(data.fields).size !== data.fields.length ||
      !['cik', 'name', 'ticker', 'exchange'].every(f => data.fields.includes(f))) throw new Error('invalid_sec_fields');
  const positions = ['cik', 'name', 'ticker', 'exchange'].map(f => data.fields.indexOf(f));
  const records = [], quarantine = [], identities = new Map();
  for (const [i, row] of data.data.entries()) {
    const [rawCik, rawName, rawTicker, rawExchange] = positions.map(n => Array.isArray(row) ? row[n] : undefined);
    const cik = cikKey(rawCik), name = clean(rawName), ticker = symbolKey(rawTicker), exchange = clean(rawExchange);
    if (!cik || !name || !validTicker(ticker) || !exchange || !Array.isArray(row)) {
      quarantine.push({row_index: i, reason: 'invalid_sec_row'}); continue;
    }
    const record = {cik, legal_name: name, ticker, exchange, name_key: nameKey(name), source_row: i};
    const id = `${cik}|${ticker}|${exchange}`;
    if (identities.has(id)) {
      quarantine.push({row_index: i, reason: 'duplicate_or_conflicting_sec_identity', previous_row_index: identities.get(id)});
      continue;
    }
    identities.set(id, i);
    records.push(record);
  }
  return result({kind: 'sec_exchange', url, retrievedAt, raw: bytes, records, quarantine,
    source_timestamp: null, source_timestamp_note: 'SEC association file does not supply per-row effective timestamps or guarantee accuracy/scope'});
}

// Parses the official Nasdaq Trader Nasdaq-listed and other-listed pipe-separated snapshots.
// A footer gives a local Eastern file-creation time; do not substitute retrieval time.
export function parseNasdaqDirectory(raw, {retrievedAt, directory, url} = {}) {
  if (!['nasdaqlisted', 'otherlisted'].includes(directory)) throw new Error('invalid_directory');
  if (!url || !/^https:\/\//.test(url)) throw new Error('missing_source_url');
  const bytes = utf8(raw);
  if (bytes.length > 30_000_000) throw new Error('oversized_directory');
  const rows = bytes.toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (rows.length < 2) throw new Error('empty_directory');
  const header = rows[0].split('|');
  const required = directory === 'nasdaqlisted' ? ['Symbol', 'Security Name', 'Test Issue', 'ETF'] : ['ACT Symbol', 'Security Name', 'Exchange', 'Test Issue', 'ETF'];
  if (new Set(header).size !== header.length || !required.every(k => header.includes(k))) throw new Error('invalid_directory_header');
  const fileCreation = rows.filter(line => /^File Creation Time:/i.test(line))[0];
  const footerMatch = /^File Creation Time:\s*(\d{2})(\d{2})(\d{4})(\d{2}):(\d{2})(?:\||$)/i.exec(fileCreation || '');
  const footer = footerMatch ? `${footerMatch[3]}-${footerMatch[1]}-${footerMatch[2]}T${footerMatch[4]}:${footerMatch[5]}:00` : null;
  const malformedFooter = !footer || !isRealLocalTime(footer) || !easternToUTC(footer);
  const records = [], quarantine = [];
  for (let i=1; i<rows.length; i++) {
    if (/^File Creation Time:/i.test(rows[i]) || !rows[i].trim()) continue;
    const cells = rows[i].split('|');
    if (cells.length !== header.length) { quarantine.push({row_index: i, reason: 'invalid_directory_columns'}); continue; }
    const item = Object.fromEntries(header.map((h, j) => [h, cells[j]]));
    const ticker = symbolKey(directory === 'nasdaqlisted' ? item.Symbol : item['ACT Symbol']);
    const name = clean(item['Security Name']);
    const exchange = directory === 'nasdaqlisted' ? 'Nasdaq' : OTHER_LISTED_CODES[clean(item.Exchange)];
    if (!validTicker(ticker) || !name || !exchange || !['Y','N'].includes(item['Test Issue']) || !['Y','N'].includes(item.ETF)) {
      quarantine.push({row_index: i, reason: 'invalid_directory_record'}); continue;
    }
    records.push({ticker, security_name: name, security_name_key: nameKey(name), exchange,
      test_issue: item['Test Issue'] === 'Y', etf: item.ETF === 'Y', source_row: i});
  }
  if (malformedFooter) quarantine.push({row_index: rows.length - 1, reason: 'missing_or_invalid_file_creation_time'});
  return result({kind: 'nasdaq_' + directory, url, retrievedAt, raw: bytes, records, quarantine,
    file_creation_time_eastern: malformedFooter ? null : footer,
    file_creation_time_utc: malformedFooter ? null : easternToUTC(footer),
    source_timestamp_note: 'Nasdaq Trader directory footer timestamp is the source file-creation time (Eastern)'});
}
function isRealLocalTime(local) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):00$/.exec(local);
  if (!m) return false;
  const v = m.slice(1).map(Number);
  const d = new Date(Date.UTC(v[0],v[1]-1,v[2],v[3],v[4]));
  return d.getUTCFullYear() === v[0] && d.getUTCMonth()+1 === v[1] && d.getUTCDate() === v[2] && d.getUTCHours() === v[3] && d.getUTCMinutes() === v[4];
}
function easternToUTC(local) {
  const base = Date.parse(local + 'Z');
  const fmt = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const matches=[];
  for (const hours of [4,5]) {
    const utc=new Date(base+hours*3600000);
    const parts=Object.fromEntries(fmt.formatToParts(utc).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const wall=`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`;
    if(wall===local) matches.push(utc.toISOString());
  }
  return matches.length===1 ? matches[0] : null; // ambiguous DST hour must not be silently guessed
}

export function parseSecSubmissions(raw, {retrievedAt, cik, url} = {}) {
  const bytes=utf8(raw);
  if(bytes.length>15_000_000) throw new Error('oversized_submissions');
  const data=JSON.parse(bytes.toString('utf8'));
  const actual=cikKey(data?.cik), wanted=cikKey(cik);
  if (!actual || (wanted && actual !== wanted) || !Array.isArray(data.tickers) || !Array.isArray(data.exchanges)) throw new Error('invalid_or_mismatched_submissions');
  if(data.tickers.length !== data.exchanges.length) throw new Error('ticker_exchange_length_mismatch');
  const current=[];
  const quarantine=[];
  for(let i=0;i<data.tickers.length;i++) {
    const ticker=symbolKey(data.tickers[i]), exchange=clean(data.exchanges[i]);
    if (!validTicker(ticker) || !exchange) { quarantine.push({row_index:i,reason:'bad_submission_listing'}); continue; }
    current.push({ticker,exchange});
  }
  const formerNames=Array.isArray(data.formerNames) ? data.formerNames.filter(x=>x && typeof x.name==='string').map(x=>({name:x.name,from:x.from??null,to:x.to??null})) : [];
  return result({kind:'sec_submissions',url:url??`${SEC_SUBMISSION_BASE}${actual}.json`,retrievedAt,raw:bytes,records:current,quarantine,
    cik:actual, current_legal_name:clean(data.name), former_names:formerNames,
    source_timestamp:null, source_timestamp_note:'Submission metadata may be updated; no effective date for current ticker association is guaranteed'});
}

function ageHours(asOf, then) {return (Date.parse(asOf)-Date.parse(then))/3600000;}
const evidence = s => ({kind:s.kind,url:s.url,sha256:s.source_sha256,retrieved_at:s.retrieved_at,
  source_created_at:s.file_creation_time_utc??s.source_timestamp??null, integrity:s.integrity});
export function correlateIssuer({name, ticker, cik, sec, directory, submissions, asOf, maxDirectoryAgeHours=96} = {}) {
  if(!sec || sec.kind!=='sec_exchange') throw new Error('missing_sec_exchange');
  const now=timestamp(asOf), key=nameKey(name), tk=symbolKey(ticker), ck=cik===undefined?null:cikKey(cik);
  if(cik!==undefined && !ck) throw new Error('invalid_query_cik');
  if(!key && !tk && !ck) throw new Error('missing_identity_query');
  if(directory && !directory.kind?.startsWith('nasdaq_')) throw new Error('invalid_listing_directory');
  if(submissions && (submissions.kind!=='sec_submissions')) throw new Error('invalid_submissions');
  const allCandidates=sec.records.filter(r=>(!ck||r.cik===ck) && (!tk||r.ticker===tk) && (!key||r.name_key===key));
  const singleDimensionCandidates=sec.records.filter(r=>(ck&&r.cik===ck)||(tk&&r.ticker===tk)||(key&&r.name_key===key));
  const sourceEvidence=[evidence(sec),...(directory?[evidence(directory)]:[]),...(submissions?[evidence(submissions)]:[])];
  if (!allCandidates.length) return {status:singleDimensionCandidates.length?'conflicting_identity':'not_found',candidates:[],evidence:sourceEvidence, warnings:['No verified CIK, security, or parent-company relationship can be inferred']};
  const ambiguous=allCandidates.length>1; // never silently choose between share classes, CIKs or exchange associations
  const dirAges=directory ? {capture:ageHours(now,directory.retrieved_at),source:directory.file_creation_time_utc?ageHours(now,directory.file_creation_time_utc):Infinity} : null;
  const dirFresh=directory && directory.integrity==='parsed' && dirAges.capture>=0 && dirAges.capture<=maxDirectoryAgeHours && dirAges.source>=0 && dirAges.source<=maxDirectoryAgeHours;
  const candidates=allCandidates.map(r=>{
    const listing=directory?.records.filter(v=>v.ticker===r.ticker)??[];
    const exact=listing.filter(v=>v.exchange===r.exchange && !v.test_issue && !v.etf);
    const submissionOK=submissions && submissions.cik===r.cik && submissions.integrity==='parsed' && submissions.records.some(x=>x.ticker===r.ticker && x.exchange===r.exchange);
    const crossSource=Boolean(dirFresh && exact.length===1 && exact[0].security_name_key===r.name_key && submissionOK && sec.integrity==='parsed' && submissions?.integrity==='parsed');
    const issues=[];
    if(!directory) issues.push('missing_independent_exchange_directory');
    else {
      if(!dirFresh) issues.push('directory_incomplete_or_stale');
      if(!listing.length) issues.push('ticker_not_in_directory');
      else if(!exact.length) issues.push('directory_exchange_or_security_type_conflict');
      else if(exact.length>1) issues.push('duplicate_directory_listing');
      if(exact.length && exact[0].security_name_key !== r.name_key) issues.push('security_name_differs_review_required');
    }
    if(!submissionOK) issues.push('sec_submissions_not_correlated');
    if(sec.integrity!=='parsed') issues.push('sec_snapshot_incomplete');
    if(submissions && submissions.cik!==r.cik) issues.push('submission_cik_mismatch');
    return {cik:r.cik,legal_name:r.legal_name,ticker:r.ticker,exchange:r.exchange,
      status:crossSource?'primary_source_cross_correlated':'unverified_candidate',
      issues, source_row:r.source_row};
  });
  return {status:ambiguous?'ambiguous':candidates.every(x=>x.status==='primary_source_cross_correlated')?'cross_correlated':'requires_review',
    candidates,evidence:sourceEvidence,
    warnings:['SEC cautions that its ticker association files do not guarantee accuracy or scope',
      'Cross-correlation is NOT verification of beneficial ownership, corporate parentage, active trading, or a catalyst']};
}

export function parentRelationshipCandidate({child_name,parent_name,source_url,source_document_type,transaction_status}={}) {
  if(!clean(child_name)||!clean(parent_name)) throw new Error('missing_parties');
  const type=['SEC_filing','regulatory_order','company_release'].includes(source_document_type) ? source_document_type : 'unknown';
  return {child_name,parent_name,source_url:clean(source_url)||null,source_document_type:type,
    transaction_status:transaction_status??'unknown',status:'requires_primary_document_review',
    reason:'An announcement, alias match, press release, or user-supplied claim cannot establish completed legal ownership without validating its primary evidence'};
}
