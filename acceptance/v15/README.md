# V15 — Independent ScienceDaily RSS source

This supplements the existing ticker-independent Exa engine. It reads the official ScienceDaily `all.xml` RSS endpoint, preserving article URL identity, original publication timestamp, short RSS summary, attribution, raw item XML, and a SHA-256 snapshot hash. It does not fetch or store full article text.

The bounded one-shot importer stores at most 60 entries in the existing `catalyst_acceptance.events` and `event_revisions` tables, then advances its checkpoint in the same transaction. Raw RSS records create no outbox items. The feed is a rolling snapshot without a page cursor or source-completion signal, so coverage always remains incomplete. Repeated polls use URL-keyed deduplication and append-only revisions.

The manual hosted workflow tests normalization and fetches one bounded live snapshot. Offline fixtures and one live fetch do not establish unattended operation or complete news coverage.

ScienceDaily's official [RSS newsfeeds](https://www.sciencedaily.com/newsfeeds.htm) are free. Its [terms](https://www.sciencedaily.com/terms.htm) require attribution and limit RSS use to headlines and brief summaries with links.


Continuity safeguard: each run compares the durable prior cursor with the current 60-entry window. It records snapshot-hash changes and verifies that the previous newest article remains in the window. If that boundary has rolled out, it still persists the observed entries but marks source health degraded, leaves the checkpoint unchanged, and fails the workflow so a coverage gap is visible instead of silently skipped.
