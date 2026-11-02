import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNewsCentralPageUrl, fetchNewsCentral, normalizeNewsCentralPage } from './news_central_api.mjs';

const observedAt = '2026-11-02T10:00:00.000Z';
const item = (id, extra = {}) => ({ id, url: `https://newscentral.site/story/${id}`, title: `Headline ${id}`,
  published: '2026-11-02T09:00:00Z', updated: '2026-11-02T09:30:00Z', summary: 'Brief summary',
  section: { name: 'Business' }, topics: [{ name: 'markets' }], people: [{ name: 'Example Corp' }],
  attribution: { id, publisher: 'News Central Site', source: 'Example Newsroom', canonicalUrl: `https://newscentral.site/story/${id}` }, ...extra });
const response = (data, { total = data.length, pages = total ? 1 : 0, next = null } = {}) => ({
  data, meta: { total, pages }, links: { next },
});
const mockResponse = body => ({ ok: true, status: 200, headers: { get: () => 'application/json; charset=utf-8' }, json: async () => body });

test('request builder fixes provider, language, sort, bounded page size and time window', () => {
  const url = buildNewsCentralPageUrl({ page: 2, limit: 25, since: '2026-11-01T00:00:00Z', until: observedAt, section: 'business' });
  assert.equal(url.origin, 'https://newscentral.site');
  assert.equal(url.pathname, '/api/v1/articles');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('sort'), '-published');
  assert.equal(url.searchParams.get('section'), 'business');
  assert.throws(() => buildNewsCentralPageUrl({ limit: 51 }), /invalid_news_central_page/);
  assert.throws(() => buildNewsCentralPageUrl({ since: observedAt, until: '2026-11-01T00:00:00Z' }), /invalid_news_central_window/);
});

test('normalization retains publisher, originating source, original timestamps and raw API evidence', () => {
  const record = item('story-1');
  const normalized = normalizeNewsCentralPage(response([record]), { observedAt, requestedLimit: 50 }).records[0];
  assert.equal(normalized.engine, 'news');
  assert.equal(normalized.source, 'news-central-site');
  assert.equal(normalized.sourceEventId, 'story-1');
  assert.equal(normalized.originalName, 'Headline story-1');
  assert.equal(normalized.sourcePayload.attribution, 'News Central Site');
  assert.equal(normalized.sourcePayload.originating_source, 'Example Newsroom');
  assert.equal(normalized.sourcePayload.raw_record, record);
  assert.equal(normalized.eventTime, '2026-11-02T09:00:00.000Z');
});

test('rejects malformed evidence, duplicate IDs, noncanonical hosts and inconsistent page counts', () => {
  assert.throws(() => normalizeNewsCentralPage(response([item('x', { published: 'unknown' })]), { observedAt }), /malformed_news_central_record/);
  assert.throws(() => normalizeNewsCentralPage(response([item('x'), item('x')], { total: 2 }), { observedAt }), /duplicate_news_central_id/);
  assert.throws(() => normalizeNewsCentralPage(response([item('x', { attribution: { id: 'x', publisher: 'News Central Site', canonicalUrl: 'https://evil.example/x' } })]), { observedAt }), /unapproved_story_url/);
  assert.throws(() => normalizeNewsCentralPage(response([item('x')], { total: 60, pages: 1 }), { observedAt }), /news_central_page_count_inconsistent/);
  assert.throws(() => normalizeNewsCentralPage(response([item('x')], { total: 2, pages: 1, next: 'https://evil.example/api/v1/articles?page=2' }), { observedAt }), /invalid_news_central_next_link/);
});

test('one-page window verifies its identity, deduplicates by permanent ID, and stays coverage-partial', async () => {
  let calls = 0;
  const result = await fetchNewsCentral({ observedAt, since: '2026-11-01T00:00:00Z', until: observedAt,
    fetchImpl: async () => { calls++; return mockResponse(response([item('a'), item('b')], { total: 2 })); } });
  assert.equal(calls, 2);
  assert.equal(result.records.length, 2);
  assert.equal(result.coverage.checkpointPermitted, true);
  assert.equal(result.coverage.identitySweepStable, true);
  assert.equal(result.coverage.sourceComplete, false);
  assert.equal(result.coverage.coverageComplete, false);
  assert.equal(result.coverage.snapshotTokenExposed, false);
});

test('unfiltered edition preserves section identities and accounts for returned sections', async () => {
  let requested;
  const result = await fetchNewsCentral({ observedAt, since: '2026-11-01T00:00:00Z', until: observedAt,
    fetchImpl: async url => { requested = new URL(url); return mockResponse(response([
      item('business-1', { section: { name: 'Business' } }),
      item('science-1', { section: { name: 'Science' } }),
    ], { total: 2 })); } });
  assert.equal(requested.searchParams.has('section'), false);
  assert.equal(result.coverage.editionScope.kind, 'all_sections');
  assert.deepEqual(result.coverage.sectionCounts, { Business: 1, Science: 1 });
  assert.equal(result.records[0].sourcePayload.raw_record.section.name, 'Business');
  assert.equal(result.records[1].sourcePayload.raw_record.section.name, 'Science');
  assert.equal(result.coverage.sourceComplete, false);
});

test('bounded multipage sweep verifies every page identity before checkpoint', async () => {
  const calls = [];
  const pages = new Map([
    [1, response([item('a'), item('b')], { total: 3, pages: 2, next: 'https://newscentral.site/api/v1/articles?lang=en&limit=2&page=2&sort=-published&until=2026-11-02T10%3A00%3A00.000Z' })],
    [2, response([item('c')], { total: 3, pages: 2 })],
  ]);
  const result = await fetchNewsCentral({ observedAt, limit: 2, maxPages: 2, fetchImpl: async url => {
    const page = Number(new URL(url).searchParams.get('page')); calls.push(page); return mockResponse(pages.get(page));
  } });
  assert.deepEqual(calls, [1, 2, 1, 2]);
  assert.equal(result.records.length, 3);
  assert.equal(result.coverage.checkpointPermitted, true);
  assert.equal(result.coverage.requests, 4);
});

test('provider drift blocks checkpoint while retaining the bounded first sweep', async () => {
  let firstPageReads = 0;
  const fetchImpl = async url => {
    const page = Number(new URL(url).searchParams.get('page'));
    if (page === 2) return mockResponse(response([item('b')], { total: 2, pages: 2 }));
    firstPageReads++;
    return mockResponse(response([item(firstPageReads === 1 ? 'a' : 'a2')], { total: 2, pages: 2, next: 'https://newscentral.site/api/v1/articles?lang=en&limit=1&page=2&sort=-published&until=2026-11-02T10%3A00%3A00.000Z' }));
  };
  const result = await fetchNewsCentral({ observedAt, limit: 1, maxPages: 2, fetchImpl });
  assert.equal(firstPageReads, 2);
  assert.equal(result.records.length, 2);
  assert.equal(result.coverage.checkpointPermitted, false);
  assert.equal(result.coverage.failureReason, 'provider_page_changed_during_verification');
});

test('scope changes, duplicate cross-page rows and page-cap overflow prevent checkpoint advancement', async () => {
  let p1 = 0;
  const changed = await fetchNewsCentral({ observedAt, limit: 1, maxPages: 2, fetchImpl: async url => {
    const page = Number(new URL(url).searchParams.get('page'));
    if (page === 2) return mockResponse(response([item('b')], { total: 3, pages: 3 }));
    p1++;
    return mockResponse(response([item(p1 === 1 ? 'a' : 'a2')], { total: 2, pages: 2,
      next: 'https://newscentral.site/api/v1/articles?lang=en&limit=1&page=2&sort=-published&until=2026-11-02T10%3A00%3A00.000Z' }));
  } });
  assert.equal(changed.coverage.checkpointPermitted, false);

  const duplicate = await fetchNewsCentral({ observedAt, limit: 1, maxPages: 2, fetchImpl: async url => {
    const page = Number(new URL(url).searchParams.get('page'));
    return mockResponse(page === 1
      ? response([item('same')], { total: 2, pages: 2, next: 'https://newscentral.site/api/v1/articles?lang=en&limit=1&page=2&sort=-published&until=2026-11-02T10%3A00%3A00.000Z' })
      : response([item('same')], { total: 2, pages: 2 }));
  } });
  assert.equal(duplicate.coverage.checkpointPermitted, false);
  assert.equal(duplicate.coverage.failureReason, 'duplicate_ids_across_pages');

  const overCap = await fetchNewsCentral({ observedAt, limit: 1, maxPages: 1,
    fetchImpl: async () => mockResponse(response([item('first')], { total: 4, pages: 4,
      next: 'https://newscentral.site/api/v1/articles?page=2' })) });
  assert.equal(overCap.records.length, 1);
  assert.equal(overCap.coverage.checkpointPermitted, false);
  assert.equal(overCap.coverage.failureReason, 'provider_page_count_exceeds_run_cap');
});

test('HTTP, content-type, fetch cap and malformed provider errors fail closed', async () => {
  await assert.rejects(fetchNewsCentral({ observedAt, fetchImpl: async () => ({ ok: false, status: 429 }) }), /news_central_http_429/);
  await assert.rejects(fetchNewsCentral({ observedAt, fetchImpl: async () => ({ ok: true, headers: { get: () => 'text/html' } }) }), /unexpected_content_type/);
  await assert.rejects(fetchNewsCentral({ observedAt, maxPages: 6, fetchImpl: async () => mockResponse(response([])) }), /invalid_news_central_options/);
});
