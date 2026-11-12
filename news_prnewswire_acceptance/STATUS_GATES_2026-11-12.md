# Stock News Discovery — independent financial-news source audit

As of 2026-11-12 UTC. **TESTED, not OPERATIONAL.** Collection only. No analysis, ticker gate, price triggers, trading, new recurring schedule, ntfy delivery, or SEC changes.

## Gate 0 / existing live delivery
- Two existing hourly news delivery workflows: News Central Site (GitHub issue #2; workflow \`news-central-delivery-once.yml\`) and Phys.org (issue #3; workflow \`news-physorg-delivery.yml\`). Their GitHub/ntfy delivery is not equivalent to independent financial-news coverage.
- Existing ChatGPT automation "Stock News in ChatGPT" explicitly selects only those two sources. It was not changed in this audit.
- GlobeNewswire public-company feed source candidate \`news-globenewswire-public\`: GitHub Actions #43152441878 passed 54 tests but live source returned HTTP 403. Issue #4 says BLOCKED, no schedule or checkpoint. Do not bypass source access restrictions.
- PR Newswire publishes an official RSS index at https://www.prnewswire.com/rss/ with the all-releases feed https://www.prnewswire.com/rss/news-releases-list.rss. Its RSS page explicitly supports feed-reading, but its general Terms of Use https://www.prnewswire.com/terms-of-use/ includes broad anti-automated-retrieval / redistribution restrictions. Permitted scope for this private hosted polling and durable archiving remains **UNRESOLVED**; do not deploy recurrence until source rights are resolved.
- GitHub says standard hosted runners for public repositories are free (https://docs.github.com/en/actions/concepts/billing-and-usage), but Actions artifact storage has plan-specific caps. No billing activation.

## Gate 1 — isolated RSS hosted evidence
Branch \`news-prnewswire-gate1-2026-11-12\`, additive only. No scheduled or push trigger as of commit 36b85e9; explicit manual workflow dispatch only. Initial acceptance on push produced verified bounded probes; further source reads cannot be accidentally triggered by normal branch pushes.
- Hosted first successful test: GitHub Actions run #43261621435, source run \`20261112T164247Z--2a731f3fac57\`, 20 source occurrences, 20 JSONL records, zero duplicates, RSS SHA-256 \`7514a2f6a7043c292a3716b67b429a606181d86289cc7fb45a63e74d4a314fa8\`. GitHub artifact #13963378633, uploaded ZIP SHA256 \`daa7f159de7eeed4265f24f3dd9792955a713f9910cf0d0a7cedd7b520f52e20\`.
- Expanded test: GitHub Actions run #43262291922, source run \`20261112T164628Z--1409a4a25945\`, 13 collector self-checks + 37 unit regressions PASS; 20 source occurrences and 20 distinct JSONL rows; RSS SHA256 \`09ded038e516491ebee5e05cf6e8a72dce0513c62759409af3d6124e880c14dd\`. GitHub artifact #13963653966; ZIP SHA256 \`27a4deac7401243e43ed5c9ab33ecb3ff4c8cdd805ae86c1d614e771196e63f2\`.
- Third bounded hosted probe triggered before disabling the acceptance workflow's push trigger: GitHub Actions #43263174967; unit suite and RSS fetch steps succeeded. It is separate from the two independently re-downloaded and SHA-verified artifacts above.
- Each verified test artifact holds 16 files: top-level \`run-manifest.json\`, 13 source manifests (12 NOT_RUN, PR Newswire VERIFIED_PARTIAL), one exact raw RSS snapshot and one mechanically extracted \`records.jsonl\`.
- Each artifact downloaded independently from GitHub and all source manifest/file SHA256 digests, per-row JSON syntax, original source occurrence count, and duplicates reconciled. This was independent readback, *not* an internal GitHub runner-only check.
- All source checkpoints remain UNCOMMITTED. PR Newswire is \`VERIFIED_PARTIAL\` because its feed exposes only rolling latest 20; unexposed items, possible skipped stories, source history and pagination remain unknown. RSS summaries are NOT full article text.
- Artifact retention 7 days. The GitHub ZIP is not permanent archival storage. This is a bounded source test rather than a durably complete collector.
- Second source test demonstrated no silent zero, source origin fidelity, GUID revision retention, malformed/truncated XML, HTTP 403/429, timeout propagation, empty valid RSS, file overwrite refusal.
- No separate PR Newswire recurring delivery or notification was added.

## Gate 3 — read-only Tickerbot NEWS verification (not a run artifact)
- Connected Tickerbot \`tickerbot_search_news\` accepted explicit \`from=2026-11-12T15:00:00Z\` and \`to=2026-11-12T16:00:00Z\` with **no ticker/universe** restriction.
- 20 row-mode records returned on page 1, with non-null \`next_cursor\`; page 2 returned 20 new rows and another cursor. This confirms pagination and real news content, NOT exhaustive hour coverage. Returned provider metadata includes ticker/sentiment values; those are not source-publisher-original labels and must not be interpreted or propagated as issuer inference.
- Current automated hosted Tickerbot access, license, free API quota, full page walk, raw storage, readback, source checkpoint: **NOT IMPLEMENTED**.

## Deployment acceptance gaps
1. Confirm precise publisher/feed usage rights and rolling source-window truncation risk. An hourly latest-20 feed cannot guarantee complete capture at high publishing volume.
2. Gate 2 hosted repeat/replay, failure-manifest durability, interruption and safe checkpoint tests beyond existing stateless regression suite.
3. Gate 3 independent source activation and evidence for all registered required sources. Exa pricing/entitlement unknown; GlobeNewswire runner blocked; issuer dynamic discovery not established.
4. Gate 4 only on **separate explicit approval**: schedule recurring hosted work, validate no-charge limits, independent durable retention, and prove three consecutive real scheduled run receipts.
5. No global news coverage claim, automatic analysis handoff, or COMPLETE marker.

## Non-interference
No Supabase schema/Edge Function writes, no modifications to SEC ingestion/alerts, Gmail labels, existing ntfy channels, existing ChatGPT automations, protected Tickerbot branch, or current scheduled GitHub workflows. This code exists only on an additive unmerged PR Newswire acceptance branch. Rollback is to discard that isolated branch; no existing scheduled behavior changes.
