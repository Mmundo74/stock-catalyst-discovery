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

export function buildLuxAlgoEvidenceBatch(syncSummary, datasetRows) {
  if (!syncSummary || !Array.isArray(syncSummary.results)) throw new TypeError('invalid_luxalgo_sync_summary');
  if (!datasetRows || typeof datasetRows !== 'object' || Array.isArray(datasetRows)) throw new TypeError('luxalgo_dataset_rows_required');
  const results = syncSummary.results.map((result) => ({
    source: result.source, implemented: result.implemented === true,
    ok: !result.error && result.implemented === true,
    error: result.error ? safeFailureCode(result.error) : null,
    // LuxAlgo sync success does not declare full historical/provider coverage.
    coverageComplete: false,
  }));
  const coverage = assessLuxAlgoCoverage(results);
  const unknownDatasets = Object.keys(datasetRows).filter((id) => !Object.hasOwn(LUXALGO_DATASETS, id));
  if (unknownDatasets.length) throw new TypeError('unknown_luxalgo_export_dataset');
  const records = [];
  const emptyDatasets = [];
  const missingDatasets = [];
  for (const dataset of Object.keys(LUXALGO_DATASETS)) {
    const rows = datasetRows[dataset];
    if (rows === undefined) { missingDatasets.push(dataset); continue; }
    if (!Array.isArray(rows)) throw new TypeError('invalid_luxalgo_dataset_export');
    if (rows.length === 0) emptyDatasets.push(dataset);
    records.push(...normalizeLuxAlgoRows(dataset, rows));
  }
  return {
    records, sourceResults: results, coverage: {
      ...coverage,
      datasetsObserved: Object.keys(datasetRows).length,
      datasetsWithoutRows: emptyDatasets,
      missingDatasets,
      allDatasetsExported: Object.keys(datasetRows).length === Object.keys(LUXALGO_DATASETS).length,
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
