# Tickerbot continuation integrity gate

This additive gate evaluates a page before any durable checkpoint update. It
requires the request cursor, committed prior run, query scope, pinned `asof`,
page count, source coverage metadata, and next-cursor state to match the prior
evidence. It rejects provider cursor errors, changed scope/coverage, and
provider-reported revisions to historical rows. Rejection leaves the durable
checkpoint unchanged so a later attempt can restart from the stored cursor.

`sourceComplete` remains false and `marketCoverage` remains
`partial_or_unproven`, including when a provider returns a terminal cursor.
Signal-column NULLs remain unevaluated and are reported as such; they are not
treated as negative matches.

## Observed continuation probe — 2026-11-02

The stored acceptance cursor was read from `catalyst_acceptance.checkpoints`
and submitted once with the prior committed run's exact query and `asof`.
Tickerbot accepted the cursor and returned a 10-row page. The response no longer
matched the durable evidence: its query echoed `asset_class=["stocks"]`, but
reported 16,008 in-scope rows instead of the prior 16,030; NULL counts also
changed (change: 3,203 vs 3,246; relative volume: 3,197 vs 3,190; gap: 3,101
vs 3,111). The response also exposed `history_revised_at` entries. This page
was not persisted and the checkpoint was not advanced. The event data and
coverage snapshot therefore remain explicitly partial pending provider-side
snapshot/cursor semantics or a safe restart strategy.

Provider cursor contract currently exposes an opaque `next_cursor` and may
reject an invalid cursor. No cursor expiration period is assumed. Tests use
fixtures; live-provider observation above is a separate bounded read and does
not establish full-market completeness.
