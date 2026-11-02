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

The existing manual-only workflow now builds this exact upstream revision, runs all 17
implemented collectors with durable native cursors in the isolated `luxalgo_native`
schema, exports their datasets, and transactionally replays normalized evidence into the
existing shared event/revision tables. Federal Reserve communications reuse the existing
collector's source key and native event IDs, preventing the same Fed item from appearing
twice under two source identities. The bridge uses idempotent event identities and
append-only revisions; source-health and import checkpoint updates commit atomically with
the evidence. It creates no notification outbox rows. The manual hosted execution is not
yet verified, so this integration must not be described as operational until that run
passes against the exact published commit.

Source results also carry the upstream parser counters. A source with
`parseAttempted != parseSucceeded` is recorded as failed with
`source_parse_incomplete`; malformed or one-sided counter metadata fails as
`invalid_parse_coverage_metadata`. Older result formats that omit both counters are
marked parse-coverage-unknown, not treated as proof of completeness. Successfully parsed
rows from a partial source remain eligible for durable evidence import, with that
source's health marked partial/error.

LuxAlgo rows preserve normalized source evidence and attribution but do not necessarily
contain the upstream HTTP response body. Its native store remains the durable source
checkpoint. Shared import always replays full bounded snapshots, which makes a retry
after an interrupted bridge safe and avoids advancing the import checkpoint before
evidence is committed.
