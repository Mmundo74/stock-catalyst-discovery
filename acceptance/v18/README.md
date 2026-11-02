# V18 — Independent News Central all-section collector

This adds a bounded, ticker-independent collector for News Central Site's public read-only API. The provider documents unauthenticated access, summaries, a 60-request/minute limit, paginated records, permanent story IDs, publication/update timestamps, and attribution requirements. It publishes reports under CC BY 4.0 and requires publisher attribution plus a canonical link. The collector preserves the original record, publisher, any named originating newsroom, title, canonical URL, timestamps, summary, topic/person tags, and content fingerprint. It stores summaries only; it does not request the paid/full-text API scope.

The request is restricted to `newscentral.site`, the unfiltered English edition across sections, ISO time windows, 50 records per page, and at most three provider pages per run. Each page's ordered IDs are read twice; a page-count, scope, link, ID, or replay mismatch prevents checkpoint advancement. Capped or unstable windows still retain returned records and report why they could not checkpoint. Returned section counts expose the mix observed in the bounded window. A stable bounded result is checkpointable as an interval, but `sourceComplete` and `coverageComplete` stay false because the provider cannot prove comprehensive independent-news coverage or expose a snapshot token. The overlap window is 24 hours; older changes can still be missed, so this is not a complete historical archive.

Events and append-only revisions are persisted in the existing acceptance tables within one transaction. No discovery record creates an alert. The existing manual-only workflow runs adapter tests and one bounded live collection. It remains manually invoked; no schedule was added.

The API documents paginated all-edition and per-section queries, permanent IDs, published/updated timestamps, and 60 unauthenticated requests per minute. The publisher documents free API access with per-story attribution and CC BY 4.0 for its text; third-party photographs, videos, logos, and marked material are excluded. This collector stores summaries and metadata only, not full text or images. See [API documentation](https://newscentral.site/api/) and [terms](https://newscentral.site/terms-and-conditions/).

This is supplementary independent reporting, not a replacement for Exa, ScienceDaily, or GDELT. Exa continuation remains unproven and no Exa API requests are made here. ScienceDaily remains a rolling snapshot, and GDELT remains subject to its existing HTTP 429 pause. The bounded business-only query was hosted-tested in run #35; the newly broadened all-section query awaits hosted acceptance.

## Verification status

- Local adapter tests: 9/9 pass; full repository regression on merged `95ce4c4` was 255/255 before the latest edits.
- Hosted live ingestion: manual workflow run #35 succeeded for the former business-only query; 2 raw records and 2 append-only revisions were stored. All-section live ingestion is pending.
- Coverage remains partial: no provider snapshot token, `sourceComplete=false`, `coverageComplete=false`, and `notificationEligible=false`. No alert was queued.
- Unattended execution: not enabled.
- Alert delivery: disabled for raw news records.
