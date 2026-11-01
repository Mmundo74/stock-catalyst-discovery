import { createHash } from 'node:crypto';
import { assessDiscoveryPage } from './coverage_gate.mjs';
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

// Exa's rendered result text does not itself prove the search was complete.
// Callers tracking pagination pass provider-supplied cursor/completion metadata.
export function normalizeExaPage(text, observedAt, metadata = {}) {
  const records = normalizeExaResults(text, observedAt);
  const page = assessDiscoveryPage({
    sourceKey: 'exa:independent-news', records,
    cursorIn: metadata.cursorIn ?? null, cursorOut: metadata.cursorOut ?? null,
    expectedCount: metadata.expectedCount ?? null,
    truncated: metadata.truncated === true,
    errors: Array.isArray(metadata.errors) ? metadata.errors : [],
    providerComplete: metadata.providerComplete === true,
  });
  return { records, page };
}

function classifyTickerbotInstrument(row) {
  const assetClass = typeof row.asset_class === 'string' ? row.asset_class.toLowerCase() : null;
  const code = typeof row.asset_type === 'string' ? row.asset_type.toUpperCase() : null;
  if (assetClass && assetClass !== 'stocks') return { status: 'non_stock_asset_class', assetClass, assetType: code };
  const classes = { CS:'common_stock', ADRC:'adr_common_stock', PFD:'preferred_stock', ETF:'exchange_traded_fund', FUND:'fund', ETN:'exchange_traded_note', ETV:'exchange_traded_vehicle', UNIT:'unit', SP:'special_product', WARRANT:'warrant', RIGHT:'right', ETS:'exchange_traded_security' };
  return { status: code && classes[code] ? 'classified' : 'unknown_asset_type', assetClass, assetType: code, instrumentClass: classes[code] ?? null };
}



export function normalizeTickerbotPage(page, { cursorIn: suppliedCursorIn = null } = {}) {
  const data = page?.structuredContent;
  if (!data || !Array.isArray(data.results) || !data.query) throw new TypeError('invalid_tickerbot_page');
  const observedAt = data.as_of;
  if (!Number.isFinite(Date.parse(observedAt))) throw new TypeError('invalid_tickerbot_timestamp');
  const coverage = data._meta?.null_coverage ?? null;
  const records = data.results.map(row => {
    if (!row || typeof row.ticker !== 'string' || typeof row.name !== 'string') return null;
    const raw = { ...row }, fingerprint = hash(JSON.stringify(row));
    return { engine: 'market', source: 'tickerbot_market_scan',
      sourceEventId: 'ticker:' + row.ticker + ':' + observedAt, originalName: row.name, sourceUrl: null,
      eventTime: observedAt, observedAt, fingerprint,
      sourcePayload: { provider: 'Tickerbot', observed_at: observedAt, query: data.query, instrument_classification: classifyTickerbotInstrument(row), raw_record: raw } };
  }).filter(Boolean);
  const invalidRows = data.results.length - records.length;
  const providerErrors = Array.isArray(data.errors) ? data.errors.slice() : [];
  if (invalidRows) providerErrors.push('invalid_records:' + invalidRows);
  const cursorIn = suppliedCursorIn ?? data.cursor_in ?? data.query?.cursor ?? null;
  const cursorOut = data.next_cursor ?? null;
  const pageCount = Number.isSafeInteger(data.count) ? data.count : null;
  const assessment = assessDiscoveryPage({
    sourceKey: 'tickerbot:market-scan', records, cursorIn, cursorOut,
    expectedCount: pageCount,
    truncated: data.truncated === true,
    errors: providerErrors,
    // Tickerbot documents an explicit null next_cursor as the final page.
    // An absent field remains unverified and does not claim full coverage.
    providerComplete: data.complete === true ||
      (Object.hasOwn(data, 'next_cursor') && data.next_cursor === null),
  });
  return { records, page: { observedAt, count: data.count, nextCursor: cursorOut,
    inScopeRows: coverage?.in_scope_rows ?? null, signalCoverage: coverage?.columns ?? null,
    signalCoverageStatus: coverage?.columns && typeof coverage.columns === 'object' ? 'provider_reported' : 'unknown',
    safeToCommitPage: assessment.safeToCommitPage,
    checkpointCandidate: assessment.checkpointCandidate,
    coverage: assessment, complete: assessment.sourceComplete } };
}
