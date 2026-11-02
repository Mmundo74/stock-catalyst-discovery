const queryFields = ['q', 'order', 'dir', 'limit', 'universe', 'asset_class', 'full'];

function comparableQuery(query) {
  if (!query || typeof query !== 'object') return null;
  return Object.fromEntries(queryFields.map(key => [key, query[key] ?? null]));
}

function normalizeCoverage(coverage) {
  if (!coverage || typeof coverage !== 'object') return null;
  const scope = coverage.in_scope_rows;
  const columnsRaw = coverage.columns ?? coverage.null_coverage;
  if (!Number.isSafeInteger(scope) || !columnsRaw || typeof columnsRaw !== 'object') return null;
  const columns = Object.fromEntries(Object.entries(columnsRaw).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    if (!Number.isSafeInteger(value?.null_rows) || !Number.isSafeInteger(value?.evaluable_rows)) return [key, null];
    return [key, { null_rows: value.null_rows, evaluable_rows: value.evaluable_rows }];
  }));
  if (Object.values(columns).some(value => value === null)) return null;
  return { in_scope_rows: coverage.in_scope_rows, columns };
}

/**
 * Check whether a Tickerbot page belongs to the same cursor/query snapshot as
 * its durable checkpoint. This gate never calls the provider or advances SQL.
 */
export function assessTickerbotContinuation({ checkpointCursor, requestCursor, requestAsOf,
  previousRun, response, providerError } = {}) {
  const reasons = [];
  const evidence = previousRun?.evidence;
  const data = response?.structuredContent ?? response;

  if (providerError) {
    const code = providerError.code ?? providerError.status ?? 'unknown';
    const message = providerError.message ?? '';
    if (code === 410 || code === '410' || code === 'cursor_expired' || /cursor.*expired|expired.*cursor/i.test(message)) {
      reasons.push('provider_cursor_expired');
    } else {
      reasons.push(code === 400 || code === '400' || code === 'invalid_cursor' ? 'provider_rejected_cursor' : 'provider_request_failed');
    }
  }
  if (typeof checkpointCursor !== 'string' || !checkpointCursor) reasons.push('checkpoint_cursor_missing');
  if (requestCursor !== checkpointCursor) reasons.push('request_cursor_mismatch');
  if (!evidence || previousRun.status !== 'committed') reasons.push('checkpoint_run_not_committed');
  if (!data || !Array.isArray(data.results)) reasons.push('page_results_missing');
  if (data && (!Number.isSafeInteger(data.count) || data.count !== data.results?.length)) reasons.push('page_count_mismatch');
  if (data && (!Number.isFinite(Date.parse(data.as_of)))) reasons.push('page_timestamp_invalid');

  const oldQuery = comparableQuery(evidence?.query);
  const newQuery = comparableQuery(data?.query);
  if (!oldQuery || !newQuery || JSON.stringify(oldQuery) !== JSON.stringify(newQuery)) reasons.push('query_scope_changed');

  const anchor = evidence?.as_of;
  if (typeof anchor !== 'string' || requestAsOf !== anchor || data?.as_of !== anchor) reasons.push('snapshot_anchor_changed');

  const oldCoverage = evidence?.coverage?.null_coverage ?? evidence?.page_coverage?.null_coverage ??
    (evidence?.null_coverage ? { in_scope_rows: evidence.in_scope_rows, null_coverage: evidence.null_coverage } : null);
  const oldCoverageShape = normalizeCoverage(oldCoverage);
  const newCoverageShape = normalizeCoverage(data?._meta?.null_coverage);
  if (!oldCoverageShape || !newCoverageShape) reasons.push('coverage_metadata_unavailable');
  else if (JSON.stringify(oldCoverageShape) !== JSON.stringify(newCoverageShape)) reasons.push('coverage_snapshot_changed');

  // A revision dated after the pinned historical instant can change the values
  // used for the sort and move page boundaries inside this scan epoch. Revisions
  // at or before asof are already part of that historical view and do not, by
  // themselves, make continuation unsafe.
  const revisedRows = data?._meta?.history_revised_at;
  if (revisedRows && typeof revisedRows === 'object' && Object.keys(revisedRows).length > 0) {
    const asOfMs = Date.parse(requestAsOf);
    if (!Number.isFinite(asOfMs)) {
      reasons.push('historical_revision_anchor_invalid');
    } else {
      const revisionTimes = Object.values(revisedRows).map(value => Date.parse(value));
      if (revisionTimes.some(value => !Number.isFinite(value))) {
        reasons.push('historical_revision_timestamp_invalid');
      } else if (revisionTimes.some(value => value > asOfMs)) {
        reasons.push('historical_rows_revised_after_snapshot');
      }
    }
  }

  const next = data?.next_cursor;
  const terminalPage = data && Object.hasOwn(data, 'next_cursor') && next === null;
  if (!(typeof next === 'string' && next.length > 0) && !terminalPage) reasons.push('next_cursor_unavailable');
  if (typeof next === 'string' && next === requestCursor) reasons.push('cursor_did_not_advance');

  return Object.freeze({
    safeToAdvanceCheckpoint: reasons.length === 0,
    reasons: [...new Set(reasons)],
    sourceComplete: false,
    marketCoverage: 'partial_or_unproven',
    nextCursor: typeof next === 'string' ? next : null,
    terminalPage,
  });
}
