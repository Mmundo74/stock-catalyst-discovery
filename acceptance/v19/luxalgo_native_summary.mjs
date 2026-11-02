import { LUXALGO_SOURCES } from './luxalgo_catalog.mjs';

export const LUXALGO_NON_SEC_SOURCES = Object.freeze(LUXALGO_SOURCES.filter((source) =>
  source !== 'edgar' && source !== 'edgar-bulk'));

function safeSourceError(value) {
  const text = String(value ?? '').toLowerCase();
  if (/429|rate.limit|too many requests/.test(text)) return 'HTTP 429';
  if (/403|forbidden/.test(text)) return 'HTTP 403';
  if (/401|unauthori[sz]ed/.test(text)) return 'HTTP 401';
  if (/timeout|timed out|abort/.test(text)) return 'Source timeout';
  if (/patentsview.*(key|required)|api.key/.test(text)) return 'PatentsView API key unavailable';
  return 'Source sync failed';
}

function safeNotes(details) {
  let value = details;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value?.notes)) return [];
  return value.notes.filter((note) => typeof note === 'string' &&
    /^(?:\d{4}: )?\d+ malformed index rows skipped$/.test(note));
}

/** Build a freshness-bounded, secret-free summary from durable native source runs. */
export function buildRecentLuxAlgoSyncSummary(rows, {
  expectedSources = LUXALGO_NON_SEC_SOURCES,
  cutoffMs = Date.now() - 60 * 60 * 1000,
} = {}) {
  if (!Array.isArray(rows) || !Array.isArray(expectedSources) || expectedSources.length === 0) {
    throw new TypeError('native_luxalgo_sync_rows_required');
  }
  const latest = new Map();
  for (const row of rows) {
    if (!row || !expectedSources.includes(row.source)) continue;
    const startedAtMs = Date.parse(row.started_at);
    if (!Number.isFinite(startedAtMs) || startedAtMs < cutoffMs) continue;
    const previous = latest.get(row.source);
    if (!previous || startedAtMs > previous.startedAtMs) latest.set(row.source, { row, startedAtMs });
  }
  const missingSources = expectedSources.filter((source) => !latest.has(source));
  if (missingSources.length) throw new Error('recent_luxalgo_native_sync_incomplete');
  const results = expectedSources.map((source) => {
    const row = latest.get(source).row;
    const parseAttempted = Number.isInteger(row.parse_attempted) && row.parse_attempted >= 0 ? row.parse_attempted : null;
    const parseSucceeded = Number.isInteger(row.parse_succeeded) && row.parse_succeeded >= 0 ? row.parse_succeeded : null;
    const error = row.ok === true ? null : safeSourceError(row.error);
    return {
      source, implemented: true, ...(error ? { error } : {}),
      ...(Number.isInteger(row.rows_upserted) && row.rows_upserted >= 0 ? { rowsUpserted: row.rows_upserted } : {}),
      ...(parseAttempted !== null ? { parseAttempted } : {}),
      ...(parseSucceeded !== null ? { parseSucceeded } : {}),
      notes: safeNotes(row.details),
    };
  });
  const ok = results.every((result) => !result.error &&
    (!Object.hasOwn(result, 'parseAttempted') && !Object.hasOwn(result, 'parseSucceeded') ||
      result.parseAttempted === result.parseSucceeded) && result.notes.length === 0);
  return { ok, results };
}
