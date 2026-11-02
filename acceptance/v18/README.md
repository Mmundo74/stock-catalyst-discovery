# V18 — Independent News Central business-news collector

This adds a bounded, ticker-independent collector for News Central Site's public read-only API. The provider documents unauthenticated access, summaries, a 60-request/minute limit, paginated records, permanent story IDs, publication/update timestamps, and attribution requirements. It publishes reports under CC BY 4.0 and requires publisher attribution plus a canonical link. The collector preserves the original record, publisher, any named originating newsroom, title, canonical URL, timestamps, summary, topic/person tags, and content fingerprint. It stores summaries only; it does not request the paid/full-text API scope.

The request is restricted to `newscentral.site`, English business stories, ISO time windows, 50 records per page, and at most three provider pages per run. Each page's ordered IDs are read twice; a page-count, scope, link, ID, or replay mismatch prevents checkpoint advancement. Capped or unstable windows still retain returned records and report why they could not checkpoint. A stable bounded result is checkpointable as an interval, but `sourceComplete` and `coverageComplete` stay false because the provider cannot prove comprehensive independent-news coverage or expose a snapshot token. The overlap window is 24 hours; older changes can still be missed, so this is not a complete historical archive.

Events and append-only revisions are persisted in the existing acceptance tables within one transaction. No discovery record creates an alert. The existing manual-only workflow runs adapter tests and one bounded live collection. It remains manually invoked; no schedule was added.

This is supplementary independent reporting, not a replacement for Exa, ScienceDaily, or GDELT. Exa continuation remains unproven and no Exa API requests are made here. ScienceDaily remains a rolling snapshot, and GDELT remains subject to its existing HTTP 429 pause. The public feed/API timed out on first browser access; live endpoint reachability and response shape must pass hosted acceptance before this is considered hosted-tested.

## Verification status

- Local adapter tests: 8/8 pass.
- Live ingestion: pending manual workflow run.
- Unattended execution: not enabled.
- Alert delivery: disabled for raw news records.
- Coverage: deliberately partial.
