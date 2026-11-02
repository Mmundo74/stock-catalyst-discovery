function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function comparableQuery(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return null;
  return canonical(query);
}

function normalizeCoverage(coverage) {
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) return null;
  const scope = coverage.in_scope_rows;
  const columnsRaw = coverage.columns ?? coverage.null_coverage;
  if (!Number.isSafeInteger(scope) || scope < 0 || !columnsRaw || typeof columnsRaw !== 'object' ||
      Array.isArray(columnsRaw) || Object.keys(columnsRaw).length === 0) return null;
  const columns = Object.fromEntries(Object.entries(columnsRaw).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !Number.isSafeInteger(value.null_rows) || !Number.isSafeInteger(value.evaluable_rows) ||
        value.null_rows < 0 || value.evaluable_rows < 0 ||
        value.null_rows + value.evaluable_rows !== scope) return [key, null];
    return [key, { null_rows: value.null_rows, evaluable_rows: value.evaluable_rows }];
  }));
  if (Object.values(columns).some(value => value === null)) return null;
  const measuredAt = coverage.measured_at;
  if (typeof measuredAt !== 'string' || !Number.isFinite(Date.parse(measuredAt))) return null;
  const snapshotId = coverage.snapshot_id ?? coverage.snapshot_token ?? null;
  if (snapshotId !== null && (typeof snapshotId !== 'string' || !snapshotId)) return null;
  return { in_scope_rows: scope, columns, measured_at: new Date(measuredAt).toISOString(), snapshot_id: snapshotId };
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
  if (data && (typeof data !== 'object' || Array.isArray(data))) reasons.push('page_shape_invalid');

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
  if (data && (!Number.isSafeInteger(data.count) || data.count < 0 || data.count !== data.results?.length)) reasons.push('page_count_mismatch');
  if (data && (typeof data.as_of !== 'string' || !Number.isFinite(Date.parse(data.as_of)))) reasons.push('page_timestamp_invalid');

  const oldQuery = comparableQuery(evidence?.query);
  const newQuery = comparableQuery(data?.query);
  if (!oldQuery || !newQuery || JSON.stringify(oldQuery) !== JSON.stringify(newQuery)) reasons.push('query_scope_changed');

  const anchor = evidence?.as_of;
  if (typeof anchor !== 'string' || requestAsOf !== anchor || data?.as_of !== anchor) reasons.push('snapshot_anchor_changed');

  const oldCoverage = evidence?.coverage?.null_coverage ?? evidence?.page_coverage?.null_coverage ??
    (evidence?.null_coverage ? { in_scope_rows: evidence.in_scope_rows, null_coverage: evidence.null_coverage } : null);
  const oldCoverageShape = normalizeCoverage(oldCoverage);
  const newCoverageShape = normalizeCoverage(data?._meta?.null_coverage);
  if (!oldCoverageShape || !newCoverageShape) {
    reasons.push('coverage_metadata_unavailable');
    if (oldCoverage?.in_scope_rows !== data?._meta?.null_coverage?.in_scope_rows) reasons.push('coverage_snapshot_changed');
  }
  else if (JSON.stringify(oldCoverageShape) !== JSON.stringify(newCoverageShape)) reasons.push('coverage_snapshot_changed');

  // A revision dated after the pinned historical instant can change the values
  // used for the sort and move page boundaries inside this scan epoch. Revisions
  // at or before asof are already part of that historical view and do not, by
  // themselves, make continuation unsafe.
  const revisedRows = data?._meta?.history_revised_at;
  if (revisedRows !== undefined && revisedRows !== null &&
      (typeof revisedRows !== 'object' || Array.isArray(revisedRows))) {
    reasons.push('historical_revision_metadata_invalid');
  } else if (revisedRows && Object.keys(revisedRows).length > 0) {
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

  const safe = reasons.length === 0;
  return Object.freeze({
    safeToAdvanceCheckpoint: safe,
    reasons: [...new Set(reasons)],
    sourceComplete: false,
    marketCoverage: 'partial_or_unproven',
    // Never hand a provider cursor to a caller when the page failed any
    // continuity check. That prevents accidental checkpoint advancement by a
    // caller that forgets to gate on safeToAdvanceCheckpoint.
    nextCursor: safe && typeof next === 'string' ? next : null,
    terminalPage: safe && terminalPage,
  });
}
