import { createHash } from 'node:crypto';

// Inventory pinned to LuxAlgo market-trackers 1ecfcca36a224d4758cc6e2e20cca216db43d5ee.
// This is the complete implemented source registry and dataset registry at that revision.
export const LUXALGO_COMMIT = '1ecfcca36a224d4758cc6e2e20cca216db43d5ee';
export const LUXALGO_SOURCES = Object.freeze([
  'edgar', 'edgar-bulk', 'senate-efd', 'house-clerk', 'usaspending', 'lda', 'finra',
  'congress-legislators', 'patentsview', 'clinicaltrials', 'openfda', 'cftc', 'wikimedia',
  'govinfo', 'fec', 'govinfo-hearings', 'federalreserve',
]);

// Dataset ids are mapped to every source that can populate them. EDGAR filings here
// mean Forms 3/4/5 and 13F-HR, not every SEC form.
export const LUXALGO_DATASETS = Object.freeze({
  'congress-trades': ['senate-efd', 'house-clerk'],
  'insider-transactions': ['edgar', 'edgar-bulk'],
  'thirteenf-holdings': ['edgar'],
  'gov-contracts': ['usaspending'],
  'gov-grants': ['usaspending'],
  'lobbying-filings': ['lda'],
  'short-volume': ['finra'],
  'committee-assignments': ['congress-legislators'],
  patents: ['patentsview'],
  'clinical-trials': ['clinicaltrials'],
  'fda-approvals': ['openfda'],
  'cot-reports': ['cftc'],
  'wiki-pageviews': ['wikimedia'],
  bills: ['govinfo'],
  'fec-candidates': ['fec'],
  'fec-contributions': ['fec'],
  'congress-hearings': ['govinfo-hearings'],
  'fed-communications': ['federalreserve'],
});

const DATE_FIELDS = Object.freeze({
  'congress-trades': ['transactedAt'], 'insider-transactions': ['transactedAt', 'filedAt'],
  'thirteenf-holdings': ['periodEnd'], 'gov-contracts': ['actionDate'], 'gov-grants': ['actionDate'],
  'lobbying-filings': ['filingYear'], 'short-volume': ['date'], 'committee-assignments': ['effectiveDate'],
  patents: ['grantDate'], 'clinical-trials': ['lastUpdated'], 'fda-approvals': ['statusDate'],
  'cot-reports': ['reportDate'], 'wiki-pageviews': ['day'], bills: ['latestActionDate', 'introducedDate'],
  'fec-candidates': ['coverageEndDate', 'cycle'], 'fec-contributions': ['date', 'cycle'],
  'congress-hearings': ['heldDate'], 'fed-communications': ['date'],
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const eventTitle = (row) => {
  for (const key of ['title', 'name', 'subject', 'description', 'ticker', 'recipientName', 'clientName']) {
    if (typeof row[key] === 'string' && row[key].trim()) return row[key].trim().slice(0, 500);
  }
  return `${row.provenance.source} ${row.id}`.slice(0, 500);
};
const eventTime = (dataset, row) => {
  for (const field of DATE_FIELDS[dataset]) {
    const raw = row[field];
    const year = (field === 'filingYear' || field === 'cycle') && Number.isInteger(raw) ? String(raw) : raw;
    if (typeof year !== 'string' || !year.trim()) continue;
    const normalized = /^\d{4}$/.test(year) ? `${year}-01-01T00:00:00.000Z` :
      /^\d{4}-\d{2}-\d{2}$/.test(year) ? `${year}T00:00:00.000Z` : year;
    const date = new Date(normalized);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
};

/** Convert pinned LuxAlgo normalized rows into the existing append-only evidence contract. */
export function normalizeLuxAlgoRows(dataset, rows) {
  if (!Object.hasOwn(LUXALGO_DATASETS, dataset)) throw new TypeError('unknown_luxalgo_dataset');
  if (!Array.isArray(rows)) throw new TypeError('luxalgo_rows_must_be_array');
  const seen = new Set();
  return rows.map((row) => {
    const p = row?.provenance;
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim() ||
        !p || !LUXALGO_DATASETS[dataset].includes(p.source) ||
        typeof p.sourceUrl !== 'string' || !/^https:\/\//.test(p.sourceUrl) ||
        !Number.isFinite(Date.parse(p.retrievedAt)) || typeof p.parser !== 'string' || !p.parser) {
      throw new TypeError('invalid_luxalgo_row_or_provenance');
    }
    // The repository's bounded Fed adapter already uses this source key and
    // the same upstream IDs; sharing both identity components avoids duplicate
    // Federal Reserve events when the native LuxAlgo collector is also run.
    const source = dataset === 'fed-communications' ? 'luxalgo_federalreserve' : `luxalgo:${p.source}:${dataset}`;
    const sourceEventId = dataset === 'fed-communications' ? row.id : `${dataset}:${row.id}`;
    if (seen.has(sourceEventId)) throw new TypeError('duplicate_luxalgo_row_id');
    seen.add(sourceEventId);
    const originalPayload = { luxalgo_commit: LUXALGO_COMMIT, dataset, record: row };
    const fingerprint = sha256(JSON.stringify(originalPayload));
    return {
      engine: 'government', source, sourceEventId, originalName: eventTitle(row),
      eventTime: eventTime(dataset, row), observedAt: new Date(p.retrievedAt).toISOString(),
      sourceUrl: p.sourceUrl, fingerprint, sourcePayload: originalPayload,
    };
  });
}

/** Never infer complete coverage from rows alone; require the full pinned source inventory. */
export function assessLuxAlgoCoverage(results) {
  if (!Array.isArray(results)) throw new TypeError('luxalgo_source_results_required');
  const byId = new Map();
  for (const result of results) {
    if (!result || !LUXALGO_SOURCES.includes(result.source) || byId.has(result.source)) {
      throw new TypeError('invalid_or_duplicate_luxalgo_source_result');
    }
    byId.set(result.source, result);
  }
  const missingSources = LUXALGO_SOURCES.filter((id) => !byId.has(id));
  const failedSources = LUXALGO_SOURCES.filter((id) => byId.has(id) &&
    (byId.get(id).implemented !== true || byId.get(id).error || byId.get(id).ok !== true));
  const parseCoverageUnknownSources = LUXALGO_SOURCES.filter((id) => byId.has(id) &&
    byId.get(id).parseCoverageKnown !== true);
  const parseFailureCount = LUXALGO_SOURCES.reduce((total, id) => {
    const count = byId.get(id)?.parseFailures;
    return total + (Number.isInteger(count) && count >= 0 ? count : 0);
  }, 0);
  const coverageUnverifiedSources = LUXALGO_SOURCES.filter((id) => byId.has(id) &&
    byId.get(id).coverageComplete !== true);
  const successfulSources = LUXALGO_SOURCES.filter((id) => byId.has(id) && byId.get(id).implemented === true &&
    !byId.get(id).error && byId.get(id).ok === true);
  return {
    luxalgoCommit: LUXALGO_COMMIT, expectedSources: LUXALGO_SOURCES.length,
    observedSources: byId.size, expectedDatasets: Object.keys(LUXALGO_DATASETS).length,
    successfulSourceCount: successfulSources.length,
    parseFailureCount, parseCoverageUnknownSources,
    missingSources, failedSources, coverageUnverifiedSources,
    allSourcesSucceeded: missingSources.length === 0 && failedSources.length === 0,
    // Upstream sync success alone does not prove a complete historical/source scan.
    sourceComplete: missingSources.length === 0 && failedSources.length === 0 && coverageUnverifiedSources.length === 0,
  };
}
