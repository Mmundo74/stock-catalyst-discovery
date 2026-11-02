import { createHash } from 'node:crypto';

export const NEWS_CENTRAL_API = 'https://newscentral.site/api/v1/articles';
const ALLOWED_HOST = 'newscentral.site';
const MAX_PAGE_SIZE = 50;
const MAX_PAGES = 5;
const sha256 = value => createHash('sha256').update(value).digest('hex');

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function canonicalUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid_story_url'); }
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST || url.username || url.password || url.port) {
    throw new Error('unapproved_story_url');
  }
  return url.href;
}

export function buildNewsCentralPageUrl({ page = 1, limit = MAX_PAGE_SIZE, since, until, section } = {}) {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new TypeError('invalid_news_central_page');
  }
  if (since !== undefined && !validDate(since)) throw new TypeError('invalid_news_central_since');
  if (until !== undefined && !validDate(until)) throw new TypeError('invalid_news_central_until');
  if (since && until && Date.parse(since) >= Date.parse(until)) throw new TypeError('invalid_news_central_window');
  const url = new URL(NEWS_CENTRAL_API);
  url.searchParams.set('lang', 'en');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('page', String(page));
  url.searchParams.set('sort', '-published');
  if (since) url.searchParams.set('since', new Date(since).toISOString());
  if (until) url.searchParams.set('until', new Date(until).toISOString());
  if (section) {
    if (!/^[a-z0-9-]{1,40}$/.test(section)) throw new TypeError('invalid_news_central_section');
    url.searchParams.set('section', section);
  }
  return url;
}

function pageIdentity(page) {
  return page.data.map(record => record.id).join('\n');
}

export function normalizeNewsCentralPage(body, { observedAt = new Date().toISOString(), requestedPage = 1, requestedLimit = MAX_PAGE_SIZE } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.data) ||
      !body.meta || !Number.isSafeInteger(body.meta.total) || body.meta.total < 0 ||
      !Number.isSafeInteger(body.meta.pages) || body.meta.pages < 0 || !body.links ||
      !Number.isFinite(Date.parse(observedAt))) throw new TypeError('invalid_news_central_response');
  const records = [];
  const seen = new Set();
  for (const [index, raw] of body.data.entries()) {
    const id = raw?.attribution?.id ?? raw?.id;
    const title = raw?.title;
    const published = raw?.published;
    const updated = raw?.updated ?? null;
    if (typeof id !== 'string' || !id || typeof title !== 'string' || !title.trim() ||
        !validDate(published) || (updated !== null && !validDate(updated)) || typeof raw?.attribution?.publisher !== 'string') {
      throw new Error('malformed_news_central_record_' + (index + 1));
    }
    if (seen.has(id)) throw new Error('duplicate_news_central_id_' + (index + 1));
    seen.add(id);
    const url = canonicalUrl(raw.attribution.canonicalUrl ?? raw.url);
    const sourceName = raw.attribution.publisher.trim();
    records.push({ engine: 'news', source: 'news-central-site', sourceEventId: id,
      originalName: title.trim(), sourceUrl: url, eventTime: new Date(published).toISOString(), observedAt,
      fingerprint: sha256(JSON.stringify(raw)),
      sourcePayload: { provider: 'News Central Site API', attribution: sourceName,
        originating_source: typeof raw.attribution.source === 'string' ? raw.attribution.source : null,
        section: raw.section?.name ?? raw.section ?? null, topics: raw.topics ?? [], people: raw.people ?? [],
        published, updated, summary: raw.summary ?? null, raw_record: raw } });
  }
  if (records.length !== body.data.length) throw new Error('news_central_record_count_mismatch');
  const expectedPages = body.meta.total === 0 ? 0 : Math.ceil(body.meta.total / requestedLimit);
  if (body.meta.pages !== expectedPages && body.meta.total !== 0) throw new Error('news_central_page_count_inconsistent');
  const next = body.links.next ?? null;
  if (next !== null) {
    let nextUrl;
    try { nextUrl = new URL(next, NEWS_CENTRAL_API); } catch { throw new Error('invalid_news_central_next_link'); }
    if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== ALLOWED_HOST || nextUrl.pathname !== '/api/v1/articles' ||
        Number(nextUrl.searchParams.get('page')) !== requestedPage + 1) throw new Error('invalid_news_central_next_link');
  }
  return { records, page: { page: requestedPage, total: body.meta.total, pages: body.meta.pages,
    nextLink: next, rawResponse: body, pageIdentity: pageIdentity({ data: body.data }) } };
}

function assertNextPageScope(nextLink, expectedUrl, expectedPage) {
  let nextUrl;
  try { nextUrl = new URL(nextLink, NEWS_CENTRAL_API); } catch { throw new Error('invalid_news_central_next_link'); }
  const expected = new URL(expectedUrl);
  if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== ALLOWED_HOST || nextUrl.pathname !== '/api/v1/articles' ||
      Number(nextUrl.searchParams.get('page')) !== expectedPage) throw new Error('invalid_news_central_next_link');
  const nextScope = new URL(nextUrl); nextScope.searchParams.delete('page');
  const expectedScope = new URL(expected); expectedScope.searchParams.delete('page');
  const sortParams = url => [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  if (JSON.stringify(sortParams(nextScope)) !== JSON.stringify(sortParams(expectedScope))) throw new Error('news_central_next_link_scope_mismatch');
  return nextUrl;
}

/**
 * Free public API; collection is deliberately bounded and uses two identity sweeps.
 * The provider exposes page counts, but no snapshot token. A changed sweep blocks the
 * checkpoint. A stable sweep still reports partial source coverage because the API
 * does not prove that all relevant news or independent publishers are represented.
 */
export async function fetchNewsCentral({ fetchImpl = fetch, observedAt = new Date().toISOString(),
  since, until = observedAt, section, limit = MAX_PAGE_SIZE, maxPages = 3, timeoutMs = 10_000 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000) throw new TypeError('invalid_news_central_options');
  const firstUrl = buildNewsCentralPageUrl({ page: 1, limit, since, until, section });
  const calls = [];
  async function get(url) {
    if (calls.length >= maxPages * 2 + 1) throw new Error('news_central_request_cap_exceeded');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response?.ok) throw new Error('news_central_http_' + (Number(response?.status) || 'unknown'));
      const type = response.headers?.get?.('content-type') ?? '';
      if (!/application\/json/i.test(type)) throw new Error('news_central_unexpected_content_type');
      const body = await response.json();
      const pageNumber = Number(new URL(url).searchParams.get('page'));
      const normalized = normalizeNewsCentralPage(body, { observedAt, requestedPage: pageNumber, requestedLimit: limit });
      calls.push({ page: pageNumber, total: normalized.page.total, pages: normalized.page.pages,
        identity: normalized.page.pageIdentity, nextLink: normalized.page.nextLink });
      return normalized;
    } finally { clearTimeout(timer); }
  }

  const first = await get(firstUrl);
  const countPages = first.page.pages;
  const initial = [first];
  let reason = null;
  if (countPages > maxPages) reason = 'provider_page_count_exceeds_run_cap';
  else {
    for (let page = 2; page <= countPages; page++) {
      const previous = initial.at(-1);
      if (!previous.page.nextLink) { reason = 'provider_next_link_missing'; break; }
      const nextUrl = assertNextPageScope(previous.page.nextLink, firstUrl, page);
      const next = await get(nextUrl);
      if (next.page.total !== first.page.total || next.page.pages !== countPages) reason = 'provider_scope_changed_during_sweep';
      initial.push(next);
    }
  }
  if (reason === null && countPages > 0) {
    for (let page = 1; page <= countPages; page++) {
      const verification = await get(page === 1 ? firstUrl : assertNextPageScope(initial[page - 2].page.nextLink, firstUrl, page));
      const original = initial[page - 1];
      if (verification.page.total !== first.page.total || verification.page.pages !== countPages ||
          verification.page.pageIdentity !== original.page.pageIdentity) {
        reason = 'provider_page_changed_during_verification';
        break;
      }
    }
  }
  const allIds = initial.flatMap(page => page.records.map(record => record.sourceEventId));
  if (new Set(allIds).size !== allIds.length) reason ??= 'duplicate_ids_across_pages';
  const records = initial.flatMap(page => page.records);
  const sectionCounts = {};
  for (const record of records) {
    const section = typeof record.sourcePayload.section === 'string' && record.sourcePayload.section.trim()
      ? record.sourcePayload.section.trim() : 'unknown';
    sectionCounts[section] = (sectionCounts[section] ?? 0) + 1;
  }
  const completeWindow = reason === null && records.length === first.page.total && initial.length === countPages;
  return { records, coverage: { provider: 'News Central Site API', section: section ?? null,
    editionScope: section ? { kind: 'section', section } : { kind: 'all_sections' }, sectionCounts,
    since: since ? new Date(since).toISOString() : null, until: new Date(until).toISOString(),
    requests: calls.length, requestedPages: initial.length, providerTotal: first.page.total,
    providerPages: countPages, returnedRecords: records.length, paginationExposed: true,
    snapshotTokenExposed: false, identitySweepStable: reason === null,
    sourceComplete: false, coverageComplete: false, checkpointPermitted: completeWindow,
    failureReason: reason, observedAt } };
}
