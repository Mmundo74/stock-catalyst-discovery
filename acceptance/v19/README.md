# LuxAlgo pinned catalog coverage

This acceptance module pins and inventories the implemented LuxAlgo `market-trackers`
catalog at commit `1ecfcca36a224d4758cc6e2e20cca216db43d5ee`. That version has 17
implemented source collectors and 18 datasets. The catalog list is used to detect
omitted source results, preserve provenance when mapping exported rows into the existing
append-only evidence contract, and fail closed on partial source coverage.

Sources: SEC EDGAR daily and bulk (`edgar`, `edgar-bulk`), Senate eFD, House Clerk,
USAspending, Lobbying Disclosure Act, FINRA short volume, Congress legislator data,
PatentsView, ClinicalTrials.gov, openFDA, CFTC, Wikimedia, GovInfo bills, FEC,
GovInfo hearings, and Federal Reserve communications.

Datasets: congressional trades, SEC insider transactions, SEC 13F holdings, federal
contracts, federal grants, lobbying filings, FINRA short volume, committee assignments,
patents, clinical trials, FDA approvals, COT reports, Wikipedia pageviews, bills, FEC
candidates, FEC contributions, congressional hearings, and Federal Reserve
communications.

## Scope and limits

LuxAlgo's SEC collectors cover Forms 3/4/5 and 13F-HR in this pinned release; they do
not represent all SEC filing forms (for example 8-K, 10-K, and 10-Q). The upstream
dataset docs describe best-effort issuer/ticker resolution for several federal records.
PatentsView may require a free API key for normal collection; optional API keys can
improve rate limits for some sources. Missing credentials or an upstream error must be
recorded as a failed source, never counted as full coverage.

The existing manual-only workflow builds this exact upstream revision, runs a bounded
allowlist of 15 non-SEC collectors with durable native cursors in the isolated
`luxalgo_native` schema, exports their datasets, and transactionally replays dated
normalized events into the shared event/revision tables. `edgar` and `edgar-bulk` remain
excluded until SEC collection is authorized; the coverage gate still expects all 17
sources, so coverage remains partial. Federal Reserve communications reuse the existing
collector's source key and native event IDs to avoid duplicate identities. Undated rows
are written to the RLS-protected `catalyst_acceptance.evidence_quarantine` table with
their complete normalized source payload, failure reason, and retry status; they are not
given an invented event date or admitted as catalyst events. Dated evidence, quarantine,
source health, and the import checkpoint commit atomically. No notification outbox rows
are created.

Hosted runs #36–#39 exposed and corrected missing event-time quarantine and a column/value
count error in the quarantine insert. Hosted run #40 (`41402652998`) passed against
development commit `073c39582e7450c4b23507d2a3a89d6b97428e0f`: it committed 2,193
shared-evidence records/revisions, retained 3,895 undated committee-assignment rows in
quarantine, advanced the shared import checkpoint, and created no alerts. Its result
remains partial: SEC collectors were excluded, four of the selected 15 sources reported
errors or missing event timestamps, and only 11 selected sources were healthy.

## FINRA reporting-facility identity

The pinned FINRA parser used the filename market but discarded the row-level `Market`
field. A single symbol can have separate reporting-facility observations, causing two
valid rows to collide on the upstream natural key and fail PostgreSQL's multi-row upsert.
The existing manual workflow applies the small reviewed patch in its ephemeral pinned
checkout, leaves the LuxAlgo source commit unchanged, and runs that upstream parser's
targeted Vitest suite before building. The patch retains both file and reporting-facility
codes in the row identity; it does not aggregate or discard rows. Hosted ingestion of this
correction is pending.

The manual workflow has a `reuse_existing_native_sources` input for an import-only retry.
It accepts only fresh results for all 15 selected sources within 60 minutes, then exports
the durable native store without re-contacting those providers. ScienceDaily, News
Central, and GDELT live probes are independently opt-in; their offline tests still run.

Source results also carry the upstream parser counters. A source with
`parseAttempted != parseSucceeded` is recorded as failed with
`source_parse_incomplete`; malformed or one-sided counter metadata fails as
`invalid_parse_coverage_metadata`. Older result formats that omit both counters are
marked parse-coverage-unknown, not treated as proof of completeness. Successfully parsed
rows from a partial source remain eligible for durable evidence import, with that
source's health marked error. The bridge also recognizes the pinned House Clerk
collector's explicit `malformed index rows skipped` note, which its aggregate parser
counters do not include, and records that count separately as a parse-failure hint.
Sanitized per-source results are retained in the shared pipeline-run evidence, including
parse counts, row counts, and safe failure codes.

LuxAlgo rows preserve normalized source evidence and attribution but do not necessarily
contain the upstream HTTP response body. Its native store remains the durable source
checkpoint. Shared import always replays bounded snapshots idempotently, so retries after
an interrupted bridge do not duplicate revisions or advance the shared import checkpoint
before dated events and quarantined records are committed.
