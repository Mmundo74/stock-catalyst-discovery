# Tickerbot continuation integrity gate

This additive gate evaluates a page before any durable checkpoint update. It
requires the request cursor, committed prior run, query scope, pinned asof,
page count, source coverage metadata, and next-cursor state to match the prior
evidence. It rejects provider cursor errors and changed scope/coverage. A
reported historical correction invalidates the scan only when its timestamp is
newer than the pinned asof; corrections already included by that historical
view do not, by themselves, make continuation unsafe. Rejection leaves the
durable checkpoint unchanged.

For rejected pages, `nextCursor` is returned as `null` even if the provider
included a cursor. This keeps downstream checkpoint code fail-closed if it
forgets to separately inspect `safeToAdvanceCheckpoint`.

sourceComplete remains false and marketCoverage remains
partial_or_unproven, including when a provider returns a terminal cursor.
Signal-column NULLs remain unevaluated and are reported as such; they are not
treated as negative matches.

## Observed continuation probe — 2026-11-02

The stored acceptance cursor was read from catalyst_acceptance.checkpoints
and submitted once with the prior committed run's exact query and asof.
Tickerbot accepted the cursor and returned a 10-row page. The response no longer
matched the durable evidence: its query echoed asset_class=[stocks], but
reported 16,008 in-scope rows instead of the prior 16,030; NULL counts also
changed (change: 3,203 vs 3,246; relative volume: 3,197 vs 3,190; gap: 3,101
vs 3,111). The response also exposed history_revised_at entries. This page
was not persisted and the checkpoint was not advanced because its scope and
NULL coverage differed from the prior committed page. The event data and
coverage snapshot therefore remain explicitly partial.

## Follow-up probe — 2026-11-02

A bounded two-page read using the same explicit asof, query and stock asset
class returned the same 16,008 in-scope rows and the same NULL counts on both
pages; null_coverage.measured_at was also identical. The page rows were
different, as expected. The returned cursor is a keyset boundary (sort value
and ticker), not a snapshot identifier, so it does not prove the underlying
universe is frozen. The provider reported historical corrections with times
before the pinned asof. The guard now distinguishes those from corrections
newer than the pinned instant. This improves continuation within a stable
measured scope, but provider-side snapshot identity and full-universe coverage
remain unproven; source completeness continues to be reported as partial.

Provider cursor contract currently exposes an opaque next_cursor and may
reject an invalid cursor. No cursor expiration period is assumed. Tests use
fixtures; live-provider observation above is a separate bounded read and does
not establish full-market completeness.

## Security-type probe — 2026-11-02

A current bounded scan confirmed that `asset_class=stocks` includes acquisition
units, rights, and warrants in the first ten results. A read-only scan adding
`asset_type = 'CS'` returned common-stock rows only; the provider accepted the
predicate and exposed 683 NULL asset-type rows in its coverage metadata. This
proves a usable classification filter exists, but does not show that `CS` alone
covers ADRs or other desired equity types. The existing stored market page was
not rewritten and its checkpoint was not advanced.
