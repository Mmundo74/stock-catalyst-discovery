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

This module provides an inventory, an evidence-row adapter, and a fail-closed coverage
gate. It does not itself run LuxAlgo's collectors or establish hosted ingestion. The
existing manual workflow currently runs only the Federal Reserve one-shot collector;
the other LuxAlgo sources still need a hosted collection and shared-database integration
before they can be described as active in this project.
