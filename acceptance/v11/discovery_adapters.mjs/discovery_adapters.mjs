import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');

export function normalizeExaResults(text, observedAt) {
  if (typeof text !== 'string' || !Number.isFinite(Date.parse(observedAt))) throw new TypeError('invalid_exa_input');
  return text.split(/\n(?=Title: )/).filter(x => /^Title: /m.test(x)).map(block => {
    const field = name => block.match(new RegExp('^' + name + ':\\s*(.*)$', 'm'))?.[1]?.trim() ?? '';
    const title = field('Title'), url = field('URL');
    if (!title || !/^https?:\/\//i.test(url)) return null;
    const publishedLabel = field('Published') || 'N/A', parsed = Date.parse(publishedLabel);
    return { engine: 'news', source: 'exa_independent_news', sourceEventId: 'url:' + hash(url),
      originalName: title, sourceUrl: url, eventTime: Number.isFinite(parsed) ? new Date(parsed).toISOString() : observedAt,
      observedAt, fingerprint: hash(block), sourcePayload: { provider: 'Exa', published_label: publishedLabel,
        author_label: field('Author') || 'N/A', rendered_result: block } };
  }).filter(Boolean);
}

export function normalizeTickerbotPage(page) {
  const data = page?.structuredContent;
  if (!data || !Array.isArray(data.results) || !data.query || !data._meta) throw new TypeError('invalid_tickerbot_page');
  const observedAt = data.as_of;
  if (!Number.isFinite(Date.parse(observedAt))) throw new TypeError('invalid_tickerbot_timestamp');
  const coverage = data._meta.null_coverage ?? null;
  const records = data.results.map(row => {
    if (!row || typeof row.ticker !== 'string' || typeof row.name !== 'string') return null;
    const raw = { ...row }, fingerprint = hash(JSON.stringify(row));
    return { engine: 'market', source: 'tickerbot_market_scan',
      sourceEventId: 'ticker:' + row.ticker + ':' + observedAt, originalName: row.name, sourceUrl: null,
      eventTime: observedAt, observedAt, fingerprint,
      sourcePayload: { provider: 'Tickerbot', observed_at: observedAt, query: data.query, raw_record: raw } };
  }).filter(Boolean);
  return { records, page: { observedAt, count: data.count, nextCursor: data.next_cursor ?? null,
    inScopeRows: coverage?.in_scope_rows ?? null, signalCoverage: coverage?.columns ?? null,
    complete: !data.next_cursor && !data.truncated } };
}
