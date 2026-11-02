import { LUXALGO_SOURCES, LUXALGO_DATASETS, assessLuxAlgoCoverage, normalizeLuxAlgoRows } from './luxalgo_catalog.mjs';

export const LUXALGO_EXPORT_DIRS = Object.freeze({
  'congress-trades': 'congress/trades', 'insider-transactions': 'insider/transactions',
  'thirteenf-holdings': 'thirteenf/holdings', 'gov-contracts': 'contracts/awards',
  'gov-grants': 'grants/awards', 'lobbying-filings': 'lobbying/filings',
  'short-volume': 'short-volume/daily', 'committee-assignments': 'congress/committees',
  patents: 'patents/grants', 'clinical-trials': 'clinical-trials/studies', 'fda-approvals': 'fda/approvals',
  'cot-reports': 'cot/legacy-futures', 'wiki-pageviews': 'wiki/pageviews', 'bills': 'congress/bills',
  'fec-candidates': 'fec/candidates', 'fec-contributions': 'fec/contributions',
  'congress-hearings': 'congress/hearings', 'fed-communications': 'fed/communications',
});

function safeFailureCode(error) {
  const text = String(error ?? '').toLowerCase();
  if (/429|rate.limit|too many requests/.test(text)) return 'upstream_rate_limited';
  if (/403|forbidden/.test(text)) return 'upstream_forbidden';
  if (/401|unauthori[sz]ed/.test(text)) return 'source_authentication_failed';
  if (/timeout|timed out|abort/.test(text)) return 'upstream_timeout';
  if (/contact.*(email|required)|user-agent/.test(text)) return 'sec_contact_not_configured';
  if (/patentsview.*(key|required)|api.key/.test(text)) return 'source_key_not_configured';
  return 'upstream_source_error';
}

const SAFE_BRIDGE_FAILURES = new Set([
  'invalid_luxalgo_sync_summary', 'luxalgo_dataset_rows_required', 'unknown_luxalgo_dataset',
  'luxalgo_rows_must_be_array', 'invalid_luxalgo_row_or_provenance', 'duplicate_luxalgo_row_id',
  'invalid_or_duplicate_luxalgo_source_result', 'durable_import_failed',
]);

/** Return a bounded diagnostic code without copying provider, database, or credential text into evidence. */
export function safeLuxAlgoBridgeFailure(error) {
  if (error instanceof SyntaxError) return 'snapshot_json_invalid';
  if (error?.severity && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return `postgres_sqlstate_${error.code}`;
  }
  const message = typeof error?.message === 'string' ? error.message : '';
  if (SAFE_BRIDGE_FAILURES.has(message) || /^luxalgo_[a-z0-9_]+$/.test(message)) return message;
  if (/^durable_import_failed_[0-9A-Z]{5}$/.test(message)) return message;
  if (error?.code === 'ENOENT') return 'snapshot_file_missing';
  if (error?.code === 'EACCES') return 'snapshot_file_access_denied';
  return 'catalog_step_failed';
}

function knownParseFailureHints(notes) {
  if (!Array.isArray(notes)) return 0;
  let count = 0;
  for (const note of notes) {
    if (typeof note !== 'string') continue;
    const malformedIndexRows = /^(?:\d{4}: )?(\d+) malformed index rows skipped$/.exec(note);
    if (malformedIndexRows) count += Number(malformedIndexRows[1]);
  }
  return count;
}

export function buildLuxAlgoEvidenceBatch(syncSummary, datasetRows) {
  if (!syncSummary || !Array.isArray(syncSummary.results)) throw new TypeError('invalid_luxalgo_sync_summary');
  if (!datasetRows || typeof datasetRows !== 'object' || Array.isArray(datasetRows)) throw new TypeError('luxalgo_dataset_rows_required');
  const results = syncSummary.results.map((result) => {
    const hasAttempted = Object.hasOwn(result, 'parseAttempted');
    const hasSucceeded = Object.hasOwn(result, 'parseSucceeded');
    const parseCoverageKnown = hasAttempted && hasSucceeded &&
      Number.isInteger(result.parseAttempted) && result.parseAttempted >= 0 &&
      Number.isInteger(result.parseSucceeded) && result.parseSucceeded >= 0 &&
      result.parseSucceeded <= result.parseAttempted;
    const parseFailures = parseCoverageKnown ? result.parseAttempted - result.parseSucceeded : null;
    const parseFailureHintCount = knownParseFailureHints(result.notes);
    const error = result.error ? safeFailureCode(result.error)
      : (hasAttempted || hasSucceeded) && !parseCoverageKnown ? 'invalid_parse_coverage_metadata'
        : parseFailures > 0 || parseFailureHintCount > 0 ? 'source_parse_incomplete' : null;
    return {
      source: result.source, implemented: result.implemented === true,
      ok: !error && result.implemented === true,
      error,
      parseCoverageKnown,
      parseAttempted: parseCoverageKnown ? result.parseAttempted : null,
      parseSucceeded: parseCoverageKnown ? result.parseSucceeded : null,
      parseFailures,
      parseFailureHintCount,
      rowsUpserted: Number.isInteger(result.rowsUpserted) && result.rowsUpserted >= 0 ? result.rowsUpserted : null,
      // LuxAlgo sync success does not declare full historical/provider coverage.
      coverageComplete: false,
    };
  });
  const unknownDatasets = Object.keys(datasetRows).filter((id) => !Object.hasOwn(LUXALGO_DATASETS, id));
  if (unknownDatasets.length) throw new TypeError('unknown_luxalgo_export_dataset');
  const records = [];
  const quarantinedRecords = [];
  const eventTimeMissingBySource = new Map();
  const emptyDatasets = [];
  const missingDatasets = [];
  for (const dataset of Object.keys(LUXALGO_DATASETS)) {
    const rows = datasetRows[dataset];
    if (rows === undefined) { missingDatasets.push(dataset); continue; }
    if (!Array.isArray(rows)) throw new TypeError('invalid_luxalgo_dataset_export');
    if (rows.length === 0) emptyDatasets.push(dataset);
    for (const record of normalizeLuxAlgoRows(dataset, rows)) {
      if (record.eventTime === null) {
        const sourceId = record.sourcePayload.record.provenance.source;
        eventTimeMissingBySource.set(sourceId, (eventTimeMissingBySource.get(sourceId) ?? 0) + 1);
        quarantinedRecords.push({ ...record, failureReason: 'event_time_missing', retryStatus: 'pending_reprocess' });
      } else records.push(record);
    }
  }
  for (const result of results) {
    const missingEventTimeCount = eventTimeMissingBySource.get(result.source) ?? 0;
    result.eventTimeMissingCount = missingEventTimeCount;
    if (missingEventTimeCount > 0 && !result.error) {
      result.error = 'source_event_time_missing';
      result.ok = false;
    }
  }
  const coverage = assessLuxAlgoCoverage(results);
  return {
    records, quarantinedRecords, sourceResults: results, coverage: {
      ...coverage,
      datasetsObserved: Object.keys(datasetRows).length,
      datasetsWithoutRows: emptyDatasets,
      missingDatasets,
      allDatasetsExported: Object.keys(datasetRows).length === Object.keys(LUXALGO_DATASETS).length,
      eventTimeMissingRecordCount: quarantinedRecords.length,
      sourceComplete: false,
      coverageComplete: false,
      upstreamSummaryOk: syncSummary.ok === true,
    },
  };
}

export function luxAlgoDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new TypeError('postgres_database_url_required');
  url.searchParams.set('options', '-c search_path=luxalgo_native,catalyst_acceptance,public');
  return url.toString();
}

export { LUXALGO_SOURCES };
