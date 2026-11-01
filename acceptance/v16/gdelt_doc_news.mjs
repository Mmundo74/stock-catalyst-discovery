import { createHash } from 'node:crypto';

export const GDELT_DOC_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
export const GDELT_MAX_RECORDS = 250;
const hash = value => createHash('sha256').update(value).digest('hex');

function gdeltDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(y + '-' + mo + '-' + d + 'T' + h + ':' + mi + ':' + s + 'Z');
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function buildGdeltDocUrl({ query, startAt, endAt, maxRecords = GDELT_MAX_RECORDS } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new TypeError('invalid_query');
  const start = Date.parse(startAt), end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new TypeError('invalid_time_window');
  if (end - start > 24 * 60 * 60 * 1000) throw new RangeError('time_window_exceeds_24h');
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > GDELT_MAX_RECORDS) throw new RangeError('invalid_max_records');
  const fmt = time => new Date(time).toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const url = new URL(GDELT_DOC_ENDPOINT);
  url.search = new URLSearchParams({ query: query.trim(), mode: 'artlist', format: 'json', sort: 'DateDesc',
    maxrecords: String(maxRecords), startdatetime: fmt(start), enddatetime: fmt(end) }).toString();
  return url;
}

export function normalizeGdeltArticle(article, { observedAt, query } = {}) {
  if (!article || typeof article !== 'object' || Array.isArray(article)) throw new TypeError('invalid_article');
  const url = typeof article.url === 'string' ? article.url.trim() : '';
  const title = typeof article.title === 'string' ? article.title.trim() : '';
  let parsed;
  try { parsed = new URL(url); } catch { throw new TypeError('invalid_article_url'); }
  if (parsed.protocol !== 'https:' || !title || title.length > 2000) throw new TypeError('invalid_article_fields');
  if (!Number.isFinite(Date.parse(observedAt))) throw new TypeError('invalid_observed_at');
  const sourceEventId = hash(url);
  const fingerprint = hash(JSON.stringify(article));
  return Object.freeze({ sourceEventId, originalName: title, sourceUrl: url,
    eventTime: gdeltDate(article.seendate),
    sourceTimestampLabel: typeof article.seendate === 'string' ? article.seendate : null,
    observedAt: new Date(observedAt).toISOString(), fingerprint,
    sourcePayload: Object.freeze({ provider: 'GDELT DOC 2.0', query, article }) });
}

export function normalizeGdeltResponse(body, { observedAt, query, maxRecords = GDELT_MAX_RECORDS } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.articles)) throw new TypeError('invalid_gdelt_response');
  if (body.articles.length > maxRecords) throw new RangeError('provider_exceeded_requested_limit');
  const records = body.articles.map(article => normalizeGdeltArticle(article, { observedAt, query }));
  if (new Set(records.map(record => record.sourceEventId)).size !== records.length) throw new TypeError('duplicate_article_url_in_response');
  return Object.freeze({ records: Object.freeze(records), coverage: Object.freeze({ provider: 'GDELT DOC 2.0', query,
    windowStart: null, windowEnd: null, providerResults: records.length, maxRecords,
    resultCapReached: body.articles.length === maxRecords, paginationExposed: false,
    sourceComplete: false, coverageComplete: false, checkpointPermitted: false,
    observedAt: new Date(observedAt).toISOString() }) });
}

export async function fetchGdeltDocNews({ query, startAt, endAt, observedAt = new Date().toISOString(),
  maxRecords = GDELT_MAX_RECORDS, fetchImpl = fetch, timeoutMs = 12000,
  maxRateLimitRetries = 1, waitImpl = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const url = buildGdeltDocUrl({ query, startAt, endAt, maxRecords });
  if (!Number.isInteger(maxRateLimitRetries) || maxRateLimitRetries < 0 || maxRateLimitRetries > 1) {
    throw new RangeError('invalid_rate_limit_retries');
  }
  let response;
  for (let attempt = 0; attempt <= maxRateLimitRetries; attempt++) {
    response = await fetchImpl(url, { headers: { accept: 'application/json',
      'user-agent': 'stock-catalyst-discovery/acceptance (bounded independent-news source)' },
      signal: AbortSignal.timeout(timeoutMs) });
    if (response?.ok) break;
    if (response?.status !== 429 || attempt === maxRateLimitRetries) {
      throw new Error('gdelt_http_' + (response?.status ?? 'unknown'));
    }
    const retryAfter = response.headers?.get?.('retry-after');
    let waitMs = 15000;
    if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) waitMs = Math.ceil(Number(retryAfter) * 1000);
    else if (retryAfter && Number.isFinite(Date.parse(retryAfter))) waitMs = Math.max(0, Date.parse(retryAfter) - Date.now());
    if (waitMs > 60000) throw new Error('gdelt_http_429_retry_after_exceeds_bound');
    await waitImpl(waitMs);
  }
  const normalized = normalizeGdeltResponse(await response.json(), { observedAt, query, maxRecords });
  return Object.freeze({ ...normalized, coverage: Object.freeze({ ...normalized.coverage,
    windowStart: new Date(startAt).toISOString(), windowEnd: new Date(endAt).toISOString() }) });
}
