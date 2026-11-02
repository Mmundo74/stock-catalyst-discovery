# Change Log — 2026-11-01

## Authorized continuation checks

- **Scope:** Continued the existing Stock Catalyst Discovery System. No mission, engine, collector, schedule, or production behavior was changed.
- **Preserved:** Existing repository, manual-only `.github/workflows/luxalgo-postgres-one-shot.yml`, `tests/luxalgo_native_pg.mjs`, LuxAlgo pinned source reference, both Supabase acceptance schemas, and existing data.
- **Repository audit:** Confirmed `Mmundo74/stock-catalyst-discovery` exists and is public. The repository currently contains the existing LuxAlgo one-shot workflow and native harness; the Version 4 additive ZIP was not supplied in this Work session, so its contents were not integrated or retested.
- **Workflow secret:** Read-only inspection of repository Actions secrets showed no repository secrets. `SUPABASE_SESSION_POOLER_URL` is therefore not configured.
- **Credential blocker:** The Supabase dashboard says the database password is not viewable after creation. It was not reset because that would break existing connections. No credential was disclosed in logs, chat, or source.
- **Isolated PostgreSQL checks (executed 2026-11-01):**
  - Two overlapping independent SQL requests processed the same synthetic event: **1 event, 1 revision, 1 outbox row** persisted. This verifies database uniqueness/idempotency for those rows; it does not establish exactly-once external notification delivery.
  - A transaction rollback fixture raised an intentional exception after staging event, revision, outbox, committed-run, and checkpoint changes. The fixture verified that event data rolled back and the checkpoint remained at its prior cursor.
  - A successful fixture verified that a committed run with event/revision/outbox evidence advanced its checkpoint.
  - All rows created by these fixtures were removed. A final lookup found **0** test-specific events, revisions, outbox entries, checkpoints, and pipeline runs. The restore schema was not written by these checks.
- **Test result:** Concurrency/idempotency **PASS for the tested isolated fixture**; rollback/checkpoint behavior **PASS for the tested fixture**; successful durable-processing checkpoint **PASS for the tested fixture**.
- **Not run:** The native Node.js LuxAlgo GitHub Actions acceptance test. It remains blocked by the missing `SUPABASE_SESSION_POOLER_URL` secret and unavailable existing database password. The workflow was not dispatched.
- **Status:** Development and isolated acceptance testing. The system is not deployed or operational. No production collector, recurring workload, alert, or automatic trading was activated.


## Work package follow-up — 2026-11-01

- The additive issuer-acceptance work package was subsequently supplied and reviewed. Its original offline suite reran at **89 passed, 0 failed** on Node.js 24.22.1.
- Review found and corrected a source-normalization mismatch: Nasdaq Trader other-listed code `Z` (BATS) must normalize to the SEC association feed's current `CBOE` label. Added a synthetic end-to-end regression test; corrected suite: **90 passed, 0 failed**. Official references: Nasdaq Trader Symbol Directory Definitions and SEC CIK/ticker/exchange associations.
- New modules remain additive and offline-only: SEC/Nasdaq issuer-source correlation, 2026 session calendar, scan-coverage accounting, and append-only evidence-chain codec. Synthetic tests do not establish live-source compatibility, broad market coverage, immutable raw-source custody, production integration, or safe multiworker behavior.
- The work package and correction remain available as a separate artifact; they are not committed as individual source files because the connected GitHub integration rejected Git writes with `403 Resource not accessible by integration`, and the browser upload surface could not select the local archive. No existing source was replaced.
- No collectors, recurring workloads, production alerts, schema changes, or trading were activated. The native LuxAlgo workflow remains blocked by the missing `SUPABASE_SESSION_POOLER_URL` secret and unavailable existing database password.


## Version 7 review — 2026-11-01

- Inspected the attached Version 7 archive and reran its complete offline suite: **116 passed, 0 failed**.
- Code review found the checkpoint preflight could accept a claimed complete coverage object when page-status arrays were omitted or malformed. Tightened it to require `unsuccessful_pages`, `missing_pages`, and `issues` as arrays; added six regression cases. Updated full-suite result: **122 passed, 0 failed**.
- The transaction model and coverage checks remain synthetic/offline. They do not prove live PostgreSQL transactions, independent-session concurrency, real-source continuity, or external notification delivery.
- The updated package is not yet integrated into this repository. Existing GitHub connector writes were rejected; the browser editor supports text edits but cannot select the local archive for upload.
- **Preserved:** Existing repository files, manual LuxAlgo workflow, Supabase data/schemas, three-engine mission, Make/Brevo/Gmail/ChatGPT alerts. No production activation or database mutation. The existing Actions secret remains unavailable, and the database password was not reset.

## Version 8 review and integration — 2026-11-01

- Recovered the named Version 8 ZIP from the connected Library and independently ran `node --test test/*.test.mjs` on Node.js 24.22.1: **123 passed, 0 failed**. The tests use synthetic SEC/Nasdaq-shaped fixtures and reference models; they do not demonstrate live-source compatibility, live market-wide coverage, independent PostgreSQL-session concurrency, or operational collectors.
- Added the unchanged V8 package archive and its source modules, test files, and synthetic fixtures under `acceptance/v8/`. Kept them isolated from the existing LuxAlgo workflow and `acceptance/v7` helpers. The V8 source is preserved for compatibility review and is not wired into collectors or production.
- Confirmed the existing LuxAlgo workflow is `workflow_dispatch` only on `ubuntu-latest`; it has no recurring trigger. Inspected its native harness: it tests driver parameter conversion, temporary-table insert/upsert/rollback/commit, a reconnect, and a read of `catalyst_acceptance.events`. It does **not** currently test durable application writes, revisions, checkpoints, outbox idempotency, or independent-session concurrency.
- Supabase’s current docs confirm custom `LOGIN` roles work with the shared session pooler and use `[role].[project-ref]` as username; the project Connect dialog provides the exact session endpoint. The documented beta CLI login-role endpoint issues a temporary CLI role and does not provide the verified durable schema-scoped test login needed here.
- Database review confirmed RLS is enabled on all six `catalyst_acceptance` tables and the schema currently has no RLS policies. The harness needs only `USAGE` on `catalyst_acceptance`, `SELECT` on `events`, and a role-specific read policy to read existing acceptance evidence; temporary-table privileges come from the database’s existing PUBLIC TEMP grant. No unrelated application table grants are needed. No role or database ACL has yet been changed.
- **Credential handoff required:** The Supabase role form is staged as `scd_luxalgo_acceptance`, with only `LOGIN` enabled and all create-role, create-database, bypass-RLS, replication, and superuser controls off. The user must create/enter the role password directly in the Supabase page and then enter the session URI in the pre-opened GitHub Actions secret form. The existing database password was not reset.
- **Blocked pending handoff:** `SUPABASE_SESSION_POOLER_URL` remains absent, no custom DB role has been created, and the native Actions workflow has not run. Independent PostgreSQL-session concurrency and the database-backed outbox/checkpoint acceptance remain outstanding. No production collectors, recurring jobs, or alerts were activated.



## Repository integration follow-up — 2026-11-01

- Added `acceptance/v7/src/source_recovery_gate.mjs` and its tests, including the six Version 7 fail-closed coverage-shape regressions.
- Added `acceptance/v7/src/transaction_acceptance_model.mjs` and its tests as an offline reference model.
- Updated the README with the test command and explicit limits. These selected files are isolated under `acceptance/v7`; they do not replace or connect to any production collector or database code.
- Downloaded the four committed source/test files through the GitHub read interface into a clean scratch mirror and ran `node --test acceptance/v7/test/*.test.mjs`: **33 passed, 0 failed**.
- The other issuer, session-calendar, coverage-ledger, and evidence-ledger files remain in the Version 7 package pending compatibility review against the unrecovered earlier source package.
- Native LuxAlgo one-shot acceptance remains blocked by the absent session-pooler Actions secret and unavailable existing database password. No password reset or production change.


## Continuation — 2026-11-01 (credential and acceptance follow-up)

- **Verified role:** `scd_luxalgo_acceptance` exists with LOGIN enabled; SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, and BYPASSRLS are off; it is not a member of `postgres`. The role has no schema CREATE privilege.
- **Least-privilege grant applied:** USAGE on `catalyst_acceptance`, SELECT on `catalyst_acceptance.events`, and one role-specific RLS SELECT policy on that table. Verified: no INSERT/UPDATE/DELETE on events and no USAGE/SELECT on `catalyst_acceptance_restore`. No application rows were written or changed.
- **Secret:** GitHub’s Actions settings confirmed `SUPABASE_SESSION_POOLER_URL` exists; its value was never read. Workflow’s nonempty-secret check passed.
- **Native workflow, run 41333420241:** Manual-only `workflow_dispatch`, `ubuntu-latest`; checkout, Node 22 setup, secret-presence check, pinned LuxAlgo source fetch, and `pg@8.16.0` install passed. Harness failed before database operations with TypeError.
- **Diagnostics and retry:** Added credential-safe error code/message reporting in commit `a2825897196c3153238be2a4b101d3da736d9593`; redacts any PostgreSQL URI before logging. Retry run 41333557702 failed at connection setup with `ERR_INVALID_URL` / `Invalid URL`. The Actions secret URI needs correction through GitHub’s secure secret editor; neither password nor URI was exposed. The native persistence test therefore remains unpassed.
- **Issuer regression found and fixed:** V8 mapped Nasdaq Trader other-listed code `Z` to `Cboe`, which fails exact cross-source comparison against SEC `CBOE`. Corrected mapping and added a synthetic SEC/Nasdaq cross-correlation regression in commits `9717dd8a813bbfe337dafe68ca07452e9c1cdc18` and `014f14650e02d14547c2588ca7d85363d549a382`. Combined V7+V8 scratch mirror run: **157 passed, 0 failed**. Separately reran the earlier issuer package: **90 passed, 0 failed**. Tests remain offline/synthetic.
- **Concurrency limitation:** The Supabase SQL connector serialized concurrent requests in the previous probe. Independent PostgreSQL-session overlap, durable DB outbox/recovery acceptance, source continuity, live SEC/Nasdaq compatibility, end-to-end alerts, and all three production collectors remain unverified.
- **Preserved:** The existing repository, manual-only workflow, both isolated schemas and prior rows, all three discovery-engine mission, and existing Make/Brevo/Gmail/ChatGPT notification route. No recurring work, production collection, notification, paid service, or trading was activated.


## Continued role, workflow, and market-source verification — 2026-11-01

- Rechecked the dedicated PostgreSQL login through the Supabase catalog. The role can log in; SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, and BYPASSRLS remain disabled. It has no CREATE on catalyst_acceptance; its only acceptance-schema table access is SELECT on events. It has no USAGE on catalyst_acceptance_restore. No application data was read or changed by this privilege query.
- Confirmed the existing one-shot workflow remains manual workflow_dispatch on ubuntu-latest. GitHub's secret-presence check passes. Retry run 41333557702 failed in native connection setup with ERR_INVALID_URL / Invalid URL, before the database query or temporary-table tests. The URI is malformed; its value was never read or logged. The Actions secret needs correction through GitHub's secure secret editor before another dispatch.
- Executed a one-shot Tickerbot market-wide screen on 2026-11-01 at 2026-11-01T17:54:41.230Z for abs(change_1d_pct) >= 5 OR relative_volume >= 3 OR gap_pct >= 5. The stock-class scope reported 16,030 instruments; 12,783 had change data, 12,840 relative-volume data, and 12,919 gap data. The response returned 100 rows plus a continuation cursor, so it is a partial page, not full result enumeration or complete market coverage. Results include ETFs and warrants as well as common shares. No recurring scan or alert was created.
- Independently reran the supplied offline suites: V8 123 passed, 0 failed; V7 122 passed, 0 failed; earlier issuer package 90 passed, 0 failed. The suites overlap and are reported separately, not summed. Synthetic fixtures do not prove live collection, PostgreSQL concurrency, or alert delivery.
- Preserved the existing repository, both Supabase acceptance schemas and records, restricted role, manual-only workflow, LuxAlgo pin, and existing notification path. No production collectors, recurring workloads, paid services, or trading were activated.
- Remaining: secure correction of the existing Actions secret URI, then repeat the native one-shot test. The harness only exercises temporary-table transactions and a read from events; durable application writes, independent-session concurrency, and end-to-end notification recovery remain unverified. The three engines remain under development, not operational.


## Supabase TLS fix and credential acceptance — 2026-11-01

- **Implemented:** Commit 173cd252c31585e8a31dde7bbdc420f834461507 updated the existing manual-only LuxAlgo workflow to fetch Supabase's published root CA and add it to Node's trusted CA set. Certificate verification remains enabled; the pinned LuxAlgo source and standard runner are preserved.
- **Live workflow:** Runs 41338936107 and 41339155936 both passed CA setup and reached Supabase, then failed before SQL with PostgreSQL 28P01 for the dedicated acceptance role. The second run followed the secret update. The saved credential is rejected or its password encoding is incorrect.
- **Role and data:** The restricted role remains LOGIN-only without elevated flags. No original password was reset. Both failures occurred before database operations; no test SQL ran and no rows changed.
- **Offline tests rerun separately:** V8 123/0, V7 122/0, earlier issuer package 90/0, repository V7 helpers 33/0. Synthetic/offline results do not establish live collection, independent-session concurrency, or alert delivery.
- **Blocker:** The dedicated role password must match the URL-encoded password in the existing GitHub secret. No permissions were broadened to bypass authentication.


## Credential acceptance and workflow preflight — 2026-11-01

- **Verified failure:** Run #6 (ID `41341446697`, started `19:22:57Z`) failed with PostgreSQL `28P01` during connection authentication, before any SQL or test-table operation. Its head commit was `72edf55dcd71b8593a1d9261706d4dec31cd78fb`.
- **Timing limit:** GitHub shows the Actions secret last updated at `19:22 PM GMT` to minute precision, the same minute as run #6; that metadata cannot establish whether the updated value preceded that run. Run #6 proves a credential mismatch at connection time, but not whether it consumed the prior or updated secret.
- **Correction:** Added a bounded URL and database-authentication preflight to the existing manual-only workflow. It verifies expected session-pooler URL fields without printing the URL or password, then queries only the connected role and database. TLS certificate and hostname verification remain enabled with the published Supabase root CA.
- **Live acceptance PASS:** Run #7 (`41344326171`) on commit `3be60f5ca8b1a3e4288095f0dd8c889e9678e32f`: endpoint, username-format, and SSL checks all true; `role_ok:true`; `database_ok:true`. Pinned LuxAlgo native checks passed: parameter conversion, connection, insert, upsert, rollback, commit, reconnect, and existing-evidence read.
- **Role-state correction:** A fresh catalog query shows `scd_luxalgo_acceptance` currently has LOGIN plus CREATEDB, CREATEROLE, REPLICATION, and BYPASSRLS enabled; SUPERUSER is false. This supersedes earlier changelog statements that these flags were disabled. No role flags, schema ACLs, or data were changed during this continuation.
- **Remaining limits:** The harness uses temporary-table operations and reads `catalyst_acceptance.events`; it does not validate independent-session concurrency, durable application writes to event/revision/checkpoint/outbox tables, schema confinement for a BYPASSRLS role, production collection, or external alert delivery. The three engines are not operational.


- **Offline verification after this continuation:** V8 suite **123 passed, 0 failed**; V7 additive suite **122 passed, 0 failed**; earlier issuer suite **90 passed, 0 failed**; repository V7 helper suite **33 passed, 0 failed**. Each ran independently on the local package/check-out; results are not combined, and all use offline/synthetic fixtures.


## 2026-11-01 continuation — durable source pages and independent engines

- **Implemented:** Added acceptance/v11/discovery_adapters.mjs for ticker-independent Exa news normalization and Tickerbot market-page normalization. The adapters retain source payloads, publication labels, query parameters, scan timestamps, page cursors, and per-signal NULL coverage. Event content fingerprints use SHA-256.
- **Regression tests:** Added acceptance/v11/discovery_adapters.test.mjs. Local Node 24 run: **3 passed, 0 failed**. The V8 acceptance suite was also rerun from the repository checkout: **124 passed, 0 failed** (independent offline run; not combined with historical totals).
- **Workflow change:** Added the v11 test step to the existing manual-only workflow; no workflow or recurring trigger was added. Commit 954451becf6217fc6a7f5f356dba7233b20548c6.
- **Live acceptance PASS:** Workflow run #16 (https://github.com/Mmundo74/stock-catalyst-discovery/actions/runs/41348307106), commit 954451b. Authentication/endpoint/SSL preflight passed; native LuxAlgo driver checks passed; PostgreSQL independent-session persistence checks passed for concurrent deduplication, revision/outbox idempotency, rollback, checkpoint integrity, restart recovery, and interrupted-session rollback. Federal Reserve normalization: **8 passed**. Exa/Tickerbot adapter tests: **3 passed**. Job conclusion: success.
- **Live LuxAlgo ingestion:** Pinned commit 1ecfcca36a224d4758cc6e2e20cca216db43d5ee; bounded page processed 9 raw records with 0 parse failures. The database now has 27 Federal Reserve events, revisions, and pending outbox entries. Checkpoint advanced from offset 18 to 27 of 6,279 available records (2,705 currently in source scope); complete=false, so this is explicitly partial coverage.
- **Independent news sample:** A one-shot Exa query did not require ticker input and returned 6 rendered result blocks. Two records were preserved in catalyst_acceptance with original URLs, rendered text, publication labels, and retrieval time. A missing publication label remains N/A; event ordering uses observed time without rewriting that source label. This validates one query and persistence path, not a continuously operating news collector.
- **Market-wide sample:** Tickerbot scanned common shares across a reported 16,030-row scope without a watchlist. A 10-row page and one continuation page returned no duplicate ticker symbols; the continuation still had a cursor. Signal NULL counts are retained in page coverage, so missing signals are not treated as negative matches. Coverage is incomplete; the scan does not establish full-market enumeration or a sustainable recurring free quota.
- **Shared storage replay:** Four Exa/Tickerbot sample events were written to the isolated acceptance schema with revisions and pending outbox rows. Replaying the same records inserted **0** duplicate events, revisions, or outbox rows. Pipeline audit runs and source-health entries were recorded; no checkpoint advanced for these partial samples.
- **Fingerprint note:** The four direct SQL sample rows carry FNV-1a 32-bit fingerprints, explicitly recorded in their test-run evidence. These are acceptance samples and are not cryptographic integrity proofs. The committed adapter code emits SHA-256 fingerprints for subsequent adapter-based ingestion.
- **Alerts and operations:** All newly created outbox entries remain pending; no Make, Brevo, Gmail, or ChatGPT notification was sent. The existing phone pipeline and alert task remain unchanged. No production or recurring collectors were activated. System status remains **not operational**; tested components are offline-tested or live one-shot accepted only.


## Coverage gate integration — 2026-11-01

- Inspected the current V11 adapters and November 1 changelog. The ZIP and separate integration notes were unavailable in this Work workspace; the module and test source were available individually and used directly.
- Added the coverage gate module and nine fail-closed tests under acceptance/v11. Kept existing Exa and Tickerbot adapter interfaces; added an Exa page assessment helper and explicit Tickerbot page coverage fields. Malformed rows, errors, truncation, duplicate/missing IDs, count mismatch, and cursor loops prevent checkpoint advancement. A missing continuation cursor no longer implies complete coverage; completion requires explicit provider confirmation.
- Preserved existing engines, pinned LuxAlgo source, PostgreSQL acceptance code, Supabase schemas/data, and existing iPhone notification pipeline. Extended the same workflow, which remains manual-only (workflow_dispatch). No production or recurring work, external notifications, or trading were activated.
- Offline verification: coverage gate plus V11 adapters 15 passed, 0 failed; V8 suite 124 passed, 0 failed; Federal Reserve source normalization 9 passed, 0 failed. One old V11 expectation incorrectly inferred completion from an absent cursor; corrected it and reran all three suites successfully.
- The live manual workflow is pending. No live pass is claimed until its logs are inspected.
- Limitations: Exa continuation metadata still must come from its actual provider response; this patch does not implement unattended Exa or Tickerbot collectors or prove complete market coverage. Outbox delivery remains unfinished.



## Live provider-shape correction and follow-up — 2026-11-01

- **Discovery / cause:** A live Tickerbot scan response omitted optional _meta while returning the documented count, next_cursor, as_of, query, and results fields. The committed V11 adapter incorrectly required _meta, which would reject a real provider page. Updated the adapter to accept the actual response shape, preserve optional coverage as unknown when absent, check page-local counts, accept the incoming cursor explicitly, and treat a present null next_cursor as provider-confirmed terminal page per the Tickerbot response contract. Missing cursor metadata remains unverified.
- **Regression and commits:** Added a live-shape fixture and cursor/terminal tests. Adapter fix and tests are committed on main (test commit 8b5812cddfe3f3427f5e0416908ddb3d10f8df61; adapter source was committed immediately before it). Local combined coverage-gate/adapter suite: **16 passed, 0 failed**.
- **Live manual acceptance PASS:** Existing workflow_dispatch workflow run #18, run ID 41350144983, commit 8b5812cddfe3f3427f5e0416908ddb3d10f8df61. Native LuxAlgo driver: **PASS**. Independent PostgreSQL-session durability checks: **PASS**, including concurrent deduplication, revision/outbox idempotency, checkpoint integrity, restart recovery, rollback, and interrupted-session rollback. Federal Reserve normalization: **8 passed, 0 failed**. V11 adapters: **7 passed, 0 failed**, including actual Tickerbot response shape. Coverage gate: **9 passed, 0 failed**. Job conclusion: success. Raw logs were inspected.
- **Live Federal Reserve ingestion:** Pinned LuxAlgo commit 1ecfcca36a224d4758cc6e2e20cca216db43d5ee; this bounded run processed and durably persisted 9 of 9 selected raw records, 0 parse failures, with original evidence and timestamps. Offset advanced 36 to 45; 6,279 source records reported available and 2,705 in source scope; complete=false. This is a partial page, not full source coverage.
- **Live Tickerbot pagination:** Two consecutive broad ticker IS NOT NULL, asset_class=stocks pages were fetched with 100 rows each. Page 1's continuation cursor was passed into page 2; both pages passed the adapter's count/record gate, page boundaries advanced from ABUF to ABUS, and page 2 still returned a continuation cursor. No full-market total or signal coverage metadata was supplied, so coverage remains partial/unknown. This was a live two-page probe; no Tickerbot checkpoint or durable event write was made by this probe.
- **Live Exa parsing:** A ticker-independent search returned 20 rendered news records; all 20 were accepted by the V11 parser with source URLs and original publication labels. The connected Exa search response exposed no continuation cursor or has_more field, so this interface cannot verify continuation; the sample was parsed but not persisted by this probe.
- **Preserved / not activated:** Existing Supabase schemas and records, pinned LuxAlgo source, manual-only workflow, three-engine mission, and Make to Brevo to Gmail to ChatGPT notification path remain. The new records produced by bounded Federal Reserve acceptance remain in the isolated acceptance schema/outbox. No phone notification was sent, no recurring collector was enabled, and no trading or paid service was activated.
- **Operational status:** Development and isolated one-shot acceptance only. Government source has a verified bounded ingestion path; Exa has a one-shot search/parse path without connector continuation; Tickerbot has verified two-page pagination but no durable market ingestion/checkpoint. The three engines and end-to-end alerts are **not operational**.


## Durable outbox acceptance — 2026-11-01

- Added bounded lease and claim-token fields to the isolated acceptance outbox; preserved existing event, revision, checkpoint, run, and source-health data. Added a two-session acceptance script and worker tests to the existing manual-only workflow.
- Worker safeguards: scoped idempotency allowlist, `FOR UPDATE SKIP LOCKED`, expiring leases, stale-claim fencing, ack/release paths. The worker does not send notifications; no external delivery was attempted. Database idempotency does not prove exactly-once delivery.
- Offline worker tests: **6 passed, 0 failed**. Coverage gate, V11 adapters, and Federal Reserve normalization remained in the existing workflow.
- Manual workflow run #19, run ID `41350999129`, commit `478e27c266e753a3951a910306242c55bafa2dff`: **PASS**. Native LuxAlgo, independent-session durability/recovery, Federal Reserve bounded ingestion, coverage gate (**9/9**), V11 adapters, and outbox worker tests all passed. Outbox live checks passed for scoped role, concurrent claim exclusion, expired-lease recovery/stale-worker fencing, idempotent acknowledgment exclusion, and retry/permanent failure. Raw workflow logs were inspected.
- Synthetic fixture cleanup was verified by read-only SQL: **0 remaining** run-tagged events, revisions, and outbox rows. Existing backlog was not touched. The nine Federal Reserve source records and their pending outbox items were retained. No phone alerts were sent.
- Preserved the existing repository, single manual workflow, pinned LuxAlgo input, three independent engine mission, Supabase schemas, and Make → Brevo → Gmail → ChatGPT notification route. No recurring workloads, paid service, or production activation.
- **Status:** isolated components are offline-tested and the one-shot database/outbox acceptance is live-tested. Exa still has no connector continuation signal; Tickerbot has only partial paginated scans and no complete universe/coverage total. No discovery engine or end-to-end notification system is operational.


## Live bounded news and market pagination probe — 2026-11-01

- **Independent news:** Exa search ran without ticker input or price-movement filtering and returned a mixed-source set including a direct FDA announcement. Response was rendered as one text block and exposed no `cursor`, `has_more`, or page-completion field; this verifies one-shot search/parsing only. No Exa checkpoint advanced, and no events were persisted from this probe.
- **Market-wide scan:** Tickerbot ran the existing no-watchlist filter `abs(change_1d_pct) >= 5 OR relative_volume >= 3 OR gap_pct >= 5` over `asset_class=stocks`. Page 1 (100 records) returned a continuation cursor; that cursor was passed into page 2, which returned 100 records and another cursor. Page timestamps: 2026-11-01 21:16:41Z and 21:16:55Z. The provider reported 16,030 in-scope rows; NULL coverage: 3,246 change values, 3,190 relative-volume values, and 3,111 gap values. Page 2 remains partial; no full market coverage or checkpoint is claimed. Results include units, rights, warrants, and common shares, requiring security-type handling before research/alerting.
- Both probes are exploratory and were not written to the shared event/outbox store; no alert delivery occurred. This avoids treating raw scan matches as research-qualified catalysts. Existing notification backlog was left untouched.
- Preserved all three engines and existing infrastructures. News continuation capability, issuer verification/research qualification, durable Tickerbot page ingestion, and complete coverage accounting remain unfinished; no collector or recurring job is operational.


## Bounded durable Tickerbot page acceptance — 2026-11-01

- **Implemented in isolated acceptance data:** Persisted one 10-row no-watchlist Tickerbot market-signal page to `catalyst_acceptance.events` and `event_revisions`, preserving original names, raw records, source query, provider timestamp, SHA-256 fingerprints, and page coverage metadata. Added a committed `pipeline_runs` record, source-health success, and an opaque page cursor checkpoint after revision durability. `source_complete=false`; 16,030 rows are in provider scope, with signal NULL counts retained.
- Raw signal matches were not treated as research-qualified catalysts: this page created **0** outbox rows and sent no alerts. Older pending Tickerbot acceptance outbox rows were left untouched. Replaying the same source page inserted **0** duplicate events and **0** duplicate revisions.
- **Issue found and contained:** The first SQL assembly attempted to gate against rows inserted by a sibling data-modifying CTE; PostgreSQL uses one statement snapshot, so the gate could not see those inserts. The first attempt therefore did not advance the checkpoint. A follow-up transaction was also rejected by the `source_health.state` constraint (`never_run`, `healthy`, `error`, `stale`) and rolled back. After inspecting the constraint, a dependent transaction inserted all 10 revisions, advanced the checkpoint once, and updated run evidence. Read-only verification confirmed 10 events, 10 revisions, cursor present, committed run with source_complete=false, and healthy source status. No incomplete state remains for this page.
- **Not operational:** This was one bounded provider-to-database acceptance write, not an unattended scanner. Only 10 of the 100 eligible page rows were persisted in this limited exercise; the next cursor remains for continuation. No production workflows or schedules changed.


## Bounded durable Exa news acceptance — 2026-11-01

- Ran a ticker-independent Exa search with no stock-price filter. The response contained 20 rendered article blocks from varied sources, including a direct FDA announcement; selected 10 valid records for this bounded acceptance write. Preserved source URLs, original titles, provider publication labels, author labels, rendered evidence, retrieval time, and SHA-256 fingerprints in catalyst_acceptance.events and event_revisions.
- PostgreSQL acceptance verification: **10 events, 10 revisions**; replay inserted **0** duplicate events and **0** duplicate revisions. The pipeline_runs record is committed with source_complete=false and pagination_exposed=false. There is **no Exa checkpoint**, because the connector response did not expose a cursor or end-of-source signal. This is a one-shot durable sample, not full news coverage.
- Raw articles remain unreviewed evidence: **0** outbox rows were created for this sample and no alert was sent. This is not exactly-once delivery verification.
- **Issue handled:** As with the market-page write, a first statement could not count sibling-CTE inserts under PostgreSQL statement snapshot rules, so only the event insert took effect. A second dependent statement inserted revisions and committed the run and source-health result; final readback verified both event and revision counts. No checkpoint or notification side effect occurred in the initial statement.
- Preserved existing Supabase acceptance schemas and records, the current repository workflow and three-engine mission, and the existing phone-alert path. Production and recurring collection remain inactive.


## Acceptance record correction — 2026-11-01

- Clarification to the bounded durable Tickerbot page entry: the persisted database page was requested separately with `limit=10` and all 10 returned rows were stored. The adjacent live pagination probe used `limit=100` for each of two exploratory pages; those 200 exploratory rows were not written. The persisted 10-row page was separate from those 100-row pages.
## Research qualification and alert boundary — 2026-11-01

- Added `acceptance/v13/research_qualification.mjs` as an additive stage on top of the existing SEC/Nasdaq issuer correlator. It preserves the event identity, original issuer name, company CIK, ticker, exchange, evidence URLs, source hashes, source timestamps, and raw evidence. Ambiguous or non-cross-correlated issuer matches stay raw; a uniquely cross-correlated public issuer can become research-qualified.
- Parent ownership remains unresolved unless a completed relationship is supported by a primary-document URL/hash and a separate explicit review. Alert eligibility additionally requires a catalyst impact assessment, a separate explicit review, and two distinct evidence URLs/hashes. Qualification does not send notifications.
- Added `catalyst_acceptance.research_qualifications` only to the existing isolated acceptance schema, with foreign keys to events and revisions, status constraints, and a database-level alert eligibility check. No production schema was changed. No existing event, revision, checkpoint, or outbox row was updated or promoted.
- Corrected the bounded Federal Reserve ingestion path: raw newly discovered Fed events and revisions no longer create outbox entries directly. They remain durably stored with the existing source snapshot hash and offset checkpoint. This keeps the collector intact while separating raw discoveries from later research/alert decisions.
- Added the qualification unit and transaction-rollback acceptance checks to the same existing `workflow_dispatch`-only workflow. The acceptance fixture verifies event/revision linkage, idempotent replay, no raw-to-outbox promotion, database rejection of an ineligible alert, and transaction rollback.
- Supabase live schema change: applied the additive migration to `catalyst_acceptance`; the pre-existing `catalyst_acceptance_restore` schema was untouched. Read-only pre-change audit showed 54 Fed events at offset 54; pending outbox counts were 80 government, 4 market, and 6 news. Those pending entries were not delivered or changed.
- Offline verification: qualification module `11 passed, 0 failed`; related Fed, V11 adapter, coverage-gate, and outbox-worker regressions `41 passed, 0 failed`; V8 issuer/evidence/session/coverage suite rerun `124 passed, 0 failed`. These fixture tests are not live-source or operational proof.
- Status: implemented and offline-tested; the new PostgreSQL qualification acceptance and the manual hosted workflow remain to be run and inspected. No Make, Brevo, Gmail, or ChatGPT notifications were sent. No recurring collector or production workload was activated.


## Controlled outbox delivery adapter and regression — 2026-11-02

- Added an additive Make-compatible delivery adapter under `acceptance/v14`. It accepts only persisted, alert-eligible records with matching event identity and evidence, requires a valid live outbox claim, and defaults to dry-run. Live sending requires explicit caller and environment opt-in, HTTPS, and a bounded timeout; the idempotency key is forwarded to the receiver. Lost acknowledgments can still cause a retry, so receiver-side deduplication remains necessary.
- The adapter was tested only with mock transport. No Make endpoint was called and no acceptance backlog was broadcast. The existing Make → Brevo → Gmail → ChatGPT route is preserved, but its actual endpoint/payload contract remains unverified; V14 is not operational delivery.
- Clean-checkout offline regression on current head `cef814983e23d6a7a5ad106239098dbdad3dd0ae`: **205 passed, 0 failed** across all repository `*.test.mjs` files, including seven V14 delivery-adapter tests. These fixture tests do not establish live delivery.
- Updated the existing `workflow_dispatch`-only workflow to run the V14 mock-only test; no triggers, schedules, workflows, or production behavior were added. Latest workflow run #20 on commit `124459f1b83122e1676e57602980419c63257b27` passed before V14 was added. A hosted run on the current head remains pending.
- Run #20 verified PostgreSQL independent-session durability, deduplication, rollback, checkpoint/restart recovery, outbox idempotency, qualification persistence, and bounded Federal Reserve ingestion from offset 54 to 63. The Fed run processed 9 records across 3 feeds with 0 parse failures, but reported `complete:false`; this is not source completion.
- Read-only audit after run #20 showed 63 Federal Reserve events and checkpoint offset 63. Pending outbox counts were government 82, news 6, market 4. Acceptance workflows create isolated test outbox fixtures; none were delivered or promoted by this continuation. Existing pending records remain untouched.
- Preserved the three independent engine architecture, existing database schemas/data, pinned LuxAlgo source, and iPhone notification path. No paid service, production collector, recurring workflow, or automatic trading was activated. Exa continuation and complete Tickerbot coverage remain unresolved; the overall system is not operational.


## Hosted acceptance and durable checkpoint continuation — 2026-11-02

- Committed the V14 changelog and adapter verification at `e5437287c996cf479814b39fcb518effbbc4b0f4`. Fresh-checkout offline regression remains **205 passed, 0 failed**.
- Existing manual workflow run #21 (ID `41353326366`) on that commit completed **PASS**. All 22 job steps succeeded, including secure auth preflight, pinned native LuxAlgo acceptance, independent-session PostgreSQL durability/recovery, V11/V13 persistence, and V14 mock-only delivery tests (**7 passed, 0 failed**). Logs were inspected; the workflow remains `workflow_dispatch` only.
- Bounded live LuxAlgo Fed ingestion resumed from the database checkpoint at offset **63** and committed through offset **72**: 9 records across 3 successful feeds, 0 parse failures, 9 events/revisions inserted, and 0 outbox rows. Source hash stayed `fa8e2828cc8f1fba01a3bc3983dd9cf51b03fbc94b82bbd1e17786cf98dca268`; provider inventory is 6,279 with 2,705 in-scope; completion remains false.
- Read-only database audit verified checkpoint offset 72 and 72 `luxalgo_federalreserve` events. Current pending counts: government 84, market 4, news 6; separate outbox acceptance fixtures show 2 sent and 2 failed test rows. No actual Make/Brevo/Gmail/ChatGPT messages were sent, and no pending discovery backlog was claimed or broadcast.
- The test runner created no visible coverage for a complete Fed snapshot, Exa continuation, or full Tickerbot universe. Three engines and shared processing remain under development; none is operational. No production/recurring activation, paid service, duplicate workflow, or trading was introduced.


## Independent RSS ingestion and checkpoint continuity — 2026-11-01

- Added the V15 ScienceDaily official RSS adapter and bounded persistence path under `acceptance/v15`, preserving feed/article identity, original timestamps, short attributed summary, raw RSS item, and snapshot SHA-256. It writes raw discoveries to the existing event and revision tables, advances the existing source checkpoint transactionally, and creates no outbox entries. The feed exposes no continuation or complete-snapshot proof; coverage remains explicitly partial. Exa remains intact as the other independent news source.
- Added checkpoint comparison for rolling RSS snapshots: record snapshot-hash changes and require the previous newest article to remain inside the current 60-entry window. A missing boundary persists the observed entries, marks `source_health` as `error` with `RSS_CHECKPOINT_GAP`, retains the previous checkpoint, and fails the workflow. Schema inspection confirmed the supported health states and led to using `error`. The missing-boundary branch is fixture-tested; live hosted run observed the boundary present.
- Offline full-repository regression on the clean V15 checkout: **212 passed, 0 failed**. Hosted V15 continuity tests: **7 passed, 0 failed**. No historical suites were added to this count.
- Existing manual-only workflow run #22 (`41353992287`) passed on V15 initial integration. Follow-up run #23 (`41354278576`) passed on commit `1ee69532e7cd9cb5d068d57ec5d90c3a230caf4c`; inspected logs confirm native driver and independent-session persistence acceptance passed, all existing adapter/coverage/outbox/qualification tests passed, and the RSS snapshot persisted successfully. The RSS replay found its previous boundary, same snapshot hash, zero duplicate events/revisions, and advanced the durable checkpoint only after persistence. The workflow still runs only by `workflow_dispatch`.
- Bounded pinned LuxAlgo Federal Reserve ingestion resumed from durable offset **81** to **90**, processing 9 selected records across 3 successful feeds, 0 parse failures, 9 events/revisions, and 0 outbox entries. Source inventory remained 6,279 total and 2,705 in scope; `complete:false`.
- Read-only DB audit confirmed 60 ScienceDaily events, 62 revisions, 0 ScienceDaily outbox entries; RSS source health `healthy`; Fed checkpoint offset 90. Current pending outbox counts: government 88, market 4, news 6. Acceptance claim tests also leave fixture states (4 sent, 4 failed); these were database test rows, not actual Make/Brevo/Gmail/ChatGPT delivery. No backlog was broadcast or external notification attempted.
- Preserved all three engines, existing schemas/data, LuxAlgo pin, Exa and Tickerbot integrations, existing manual workflow and phone notification configuration. No recurring collection, production activation, paid service, new workflow, or trading was enabled.
- Remaining limitations: ScienceDaily provides only a rolling 60-entry snapshot; the gap branch blocks advancement but needs a supported historical backfill source to clear a real gap. Exa still lacks provider continuation metadata. Tickerbot remains paginated/partial, not full-universe coverage. Existing Make endpoint/payload compatibility and external idempotent receipt are not verified; outbox remains undelivered. The system is not operational.


## Research evidence and delivery safety — 2026-11-01

- Tightened research qualification and the Make delivery adapter so two evidence records must have different case-normalized source labels and different normalized hostnames (a leading `www.` is ignored). This rejects repeated URLs under `www.publisher.example` and `publisher.example`; same-publisher evidence can no longer alone satisfy the two-source gate. Raw and research-qualified events remain ineligible for delivery.
- Added one regression test to qualification and one to the notification adapter. The V13 and V14 focused suites passed **19/19**; the full offline suite passed **213/213** in the scratch checkout, including the V15 continuity tests. These are offline results; this specific change has not yet run in hosted Actions.
- Committed through the existing GitHub browser editor after the GitHub contents API returned 403: `f1bc936` qualification logic, `9c49074` qualification regression, `cd4c5f0` delivery guard, and `a5333b3` delivery regression. Existing repository files, schema, and workflow were preserved.
- Read-only database audit: Federal Reserve checkpoint remains at offset **90**; ScienceDaily retains **60 events / 62 revisions**, with its checkpoint boundary still present. Pending outbox items remain **88 government, 4 market, and 6 news**. Acceptance fixtures include four `sent` and four `failed` database states; they are not external deliveries. No webhook was called and no backlog was broadcast.
- The existing Make adapter remains mock-tested only. The Make scenario’s webhook contract and receiver-side idempotency are unverified. Host/source-label checks catch common `www` aliases but do not independently resolve every publisher’s registrable domain; human review and stronger publisher identity verification remain required before alerts. Workflow run on the updated head remains pending; the workflow stays manual-only. Overall system remains non-operational.


## Hosted qualification verification — 2026-11-01

- Correction to the previous entry: the research-evidence and Make-delivery safety changes have now run in hosted Actions; run #24 was not pending.
- Existing manual-only workflow run [#24](https://github.com/Mmundo74/stock-catalyst-discovery/actions/runs/41354794309), ID 41354794309, completed PASS on commit e5cf91a52686d746bb82f4fcbfc1ae6f39b35cda (workflow_dispatch). Native LuxAlgo driver and independent PostgreSQL-session persistence/recovery checks passed. The bounded Federal Reserve ingestion and ScienceDaily RSS replay passed. V13 qualification tests passed 12/12; V14 mock delivery tests passed 7/7. No external notification was sent.
- Federal Reserve ingestion resumed from durable offset 90 and advanced to 99: 9 records persisted from 3 successful feeds, 0 parse failures, 0 outbox entries, source complete=false. ScienceDaily replay returned 60 records with unchanged snapshot hash and prior boundary present; 0 events and 0 revisions were inserted; no continuity gap was detected.
- Read-only post-run audit: 99 LuxAlgo Federal Reserve events, 60 ScienceDaily events, 12 Exa news events, and 12 Tickerbot market events plus prior fixtures. Federal Reserve checkpoint is 99. Outbox database states: government 90 pending, 5 sent, 5 failed; market 4 pending; news 6 pending. Sent/failed are test database states, not external deliveries. The backlog was not broadcast.
- All three discovery engines and end-to-end phone alerts remain under development. Exa has no reliable continuation metadata; Tickerbot has partial pages without full-universe coverage proof; Make endpoint compatibility and receiver-side idempotency remain unverified. No production or recurring collection, paid service, new workflow, or trading was activated.


## Tickerbot classification and hosted continuation — 2026-11-01

- **Implemented:** Extended the existing V11 market adapter to classify documented provider instrument codes (common shares, ADR common shares, preferred shares, ETFs/funds, notes/vehicles, units, warrants, rights, and other listed security types), preserve unknown codes as unclassified, and retain each provider row unchanged. Signal NULL coverage is labeled provider-reported only when supplied; otherwise its state remains unknown.
- **Regression:** Added a test covering common shares, ETFs, warrants, rights, unknown instrument codes, and optional signal coverage. Local V11 adapter plus coverage-gate tests: **17 passed, 0 failed**. Full local repository test suite: **214 passed, 0 failed**. These are offline adapter/unit tests.
- **Commits:** Adapter change `bd01ba45f1c1ebf33a38eaac524c65289a2e123c`; regression test `e16f8658492eebac5541faff08b23946bd5c697f`. Existing adapter contracts and engine architecture were preserved.
- **Hosted manual acceptance PASS:** Existing `workflow_dispatch`-only run #25 (run ID `41355184376`) on `e16f865`; completed successfully on the standard GitHub-hosted runner. Native pinned LuxAlgo acceptance and independent-session PostgreSQL persistence, deduplication, rollback, recovery, checkpoint, revision, and outbox checks passed. V11 adapter tests: **8 passed, 0 failed**; coverage gate: **9 passed, 0 failed**; research qualification and persisted rollback checks passed; Make adapter tests passed in mock-only mode. No external delivery was attempted.
- **Bounded source results:** Federal Reserve ingestion resumed at durable offset 99 and advanced to 108: 9 selected records from 3 successful feeds, 0 parse failures, 9 events/revisions, 0 outbox rows. Source snapshot hash matched the prior run; source coverage remains `complete=false` (6,279 available records; 2,705 in scope). ScienceDaily RSS fetched 60 entries; prior boundary remained present, snapshot hash unchanged, no gap, 0 duplicate inserts, 0 outbox rows, and no pagination/completion metadata.
- **Safety and limits:** No pending acceptance backlog was broadcast. Tickerbot classification is implemented and regression-tested, but full-universe pagination/checkpoint continuation and market coverage are still partial. Exa still exposes no reliable continuation metadata. The actual Make webhook payload/receiver deduplication has not been verified; no notification was sent. All three engines remain development/isolated-acceptance components, not operational. No recurring production work, paid service, duplicate workflow, schema replacement, or trading was activated.


## Post-run database audit — 2026-11-01

- Read-only audit after workflow #25 confirmed the Federal Reserve source checkpoint at offset 108 and 108 persisted Fed events; the ScienceDaily checkpoint remains on the previously verified snapshot boundary with 60 stored events. Existing Exa and Tickerbot source counts are 12 each, including acceptance samples. No Tickerbot checkpoint was advanced by run #25.
- Current outbox database states: government 92 pending, 6 sent, 6 failed; market 4 pending; news 6 pending. Sent/failed values are acceptance/test rows, not proof of external delivery. No Make webhook, Brevo, Gmail, or ChatGPT alert was sent; the acceptance backlog remains unbroadcast.


## Bounded Tickerbot continuation and security audit — 2026-11-01

- **Verified latest repository:** Fast-forwarded the clean checkout to remote `main` (`39adbcdf0c49c50bb40adf7af3aa0492669a85bb`). The additive V11 instrument classification, V13 independent-evidence rule, V14 Make delivery guard, and V15 RSS checkpoint continuity changes were already present in that remote tree; no duplicate implementation or source commit was made.
- **Offline regression:** Re-ran the full latest repository suite: **215 passed, 0 failed**. `git diff --check` passed. This is the current clean-checkout result, not a combined historical test count.
- **Hosted workflow verification:** Existing manual-only run #25 (ID `41355184376`) is recorded by GitHub as `workflow_dispatch`, `completed/success`, on commit `e16f8658492eebac5541faff08b23946bd5c697f`. All job steps succeeded, including native LuxAlgo PostgreSQL acceptance, independent-session persistence/recovery, V11/V13/V14 tests, and bounded Federal Reserve and ScienceDaily ingestion. No new code changes were made after the tested commit that would require another workflow run.
- **Bounded Tickerbot continuation:** Resumed from the existing isolated checkpoint using its stored cursor and the same broad signal query (`abs(change_1d_pct) >= 5 OR relative_volume >= 3 OR gap_pct >= 5`, asset class `stocks`). One 10-row page was durably committed with 10 events and 10 revisions; a transaction checked the prior cursor, verified durable event/revision counts, confirmed the page created no outbox rows, and only then advanced the checkpoint. The existing source/health and pipeline-run records were updated; no qualification or notification was created.
- **Coverage remains partial:** Tickerbot reported 16,030 in-scope rows; this continuation persisted 10 signal-matching rows (3 common stocks, 6 rights, 1 warrant). NULLs were recorded as unavailable data: change `3,246`, relative volume `3,190`, gap `3,111`; evaluable counts were retained separately. A further cursor remains. This is neither a complete market enumeration nor a claim that every ticker/signal was covered.
- **Failure and recovery evidence:** The first database block failed on an ambiguous `fingerprint` join in its verification query and rolled back. The join was corrected to explicit event/revision keys; the retry passed and the checkpoint advanced once. The temporary failed transaction left no partial writes.
- **Security advisory:** Supabase table inspection reports `catalyst_acceptance.research_qualifications` with RLS disabled. The table is in the isolated acceptance schema; public Data API exposure was not established. No policy or schema change was made. Recommended hardening SQL for review: `ALTER TABLE catalyst_acceptance.research_qualifications ENABLE ROW LEVEL SECURITY;` Policies and intended role access should be decided before applying it, since enabling RLS without policies blocks non-owner access.
- **Post-run state:** The Fed source remains at 108 events and offset 108. Tickerbot now has 22 persisted scan events total and a continuation cursor; its 10-row page added no alert/outbox items. Existing outbox pending total remains 102 in the read audit. No pending backlog was delivered, no Make/Brevo/Gmail/ChatGPT message was sent, and no recurring production collector was activated.
- **Status:** Implemented/hosted-tested components remain isolated acceptance and bounded one-shot ingestion. Tickerbot still needs an unattended authorized fetch path and complete coverage accounting; Exa still has no reliable continuation metadata; the independent RSS path remains a rolling partial snapshot; Make receiver compatibility and external deduplication remain unverified. The system is not operational.


## GDELT integration hosted result — 2026-11-01

- Commits: bounded adapter `c819c3b`, adapter tests `b7e301f`, database runner `381ce05`, and existing manual workflow extension `81e9f1e`. Changes were additive; Exa, ScienceDaily, all other collectors, schemas, and workflow were preserved.
- Offline regression on the integrated local checkout: **222 passed, 0 failed**.
- Existing workflow run [#26](https://github.com/Mmundo74/stock-catalyst-discovery/actions/runs/41356462923), ID `41356462923`, ran via `workflow_dispatch` on standard `ubuntu-latest`. Native LuxAlgo and independent-session PostgreSQL acceptance, durable Fed ingestion, previous news/market, coverage, outbox, qualification, Make mock, and ScienceDaily tests/ingestion passed. GDELT unit tests passed **7/7**.
- GDELT live retrieval failed with HTTP 429 (run step 23). `source_health` durably records `news:gdelt_doc_catalysts` as `error`, `last_error=gdelt_http_429`; no GDELT event or outbox records were written and no checkpoint advanced. This is a provider request-limit result, not a database failure. GDELT’s official guidance describes DOC API rate limiting and points high-volume users to bulk Web NGrams data, which does not provide raw article evidence for this use. The GDELT article adapter remains available but is not live-verified.
- No alert backlog or external notifications were sent. No schedule, paid service, or production collection was activated.


## GDELT bounded retry update — 2026-11-01

- Added a single retry only for HTTP 429, honors `Retry-After`, and caps wait at 60 seconds; all other errors still fail closed and retain the error source-health state. Regression tests cover retry success and exceeding the time bound.
- Commits: retry logic `3511336`; regression tests `4ebb9f7`. Local full test suite: **224 passed, 0 failed**.
- The hosted retry change has not yet been run. GDELT DOC remains rate-limited in hosted use and is not operational; Exa and ScienceDaily remain independent news sources.


## GDELT bounded request retry follow-up — 2026-11-01

- Run #27 passed all steps preceding the live GDELT call; the live request ended in a runtime timeout. Node exposed a numeric timeout code (`23`), which the prior runner reported as though it were a provider/database error. No GDELT records or checkpoint were committed, and the existing raw-only path created no notifications.
- Updated the adapter timeout to 30 seconds and map timeout/network exceptions to stable non-sensitive codes. Preserved the single Retry-After retry and its 60-second ceiling. Updated the runner to accept only known adapter codes and string PostgreSQL codes.
- Added regression tests for Node timeout normalization and sanitized generic network failures. Local GDELT tests: 11 passed, 0 failed. Full `node --test $(find acceptance tests -name '*.test.mjs' -print | sort)`: 226 passed, 0 failed. `git diff --check`: passed.
- Hosted rerun is pending. This does not establish that GDELT is currently reachable. Existing Exa/ScienceDaily, three discovery engines, acceptance schemas, and notification infrastructure are preserved; no alert delivery, recurring scan, or production activation occurred.


## Hosted GDELT retry result — 2026-11-01

- Existing manual-only workflow run #28 (`41357276765`) ran on commit `c5998650dd6ce0b9467761f1415a79e7a02ee534`. Native LuxAlgo, independent-session PostgreSQL, Fed ingestion, news/market and coverage tests, outbox/research safeguards, mock-only Make, ScienceDaily ingestion, and all 11 GDELT adapter tests passed. The bounded live GDELT call failed after its one retry with `gdelt_http_429`.
- Read-only Supabase audit confirms source health `error/gdelt_http_429`, 0 GDELT events, 0 revisions, 0 outbox rows, and 0 GDELT checkpoints. This confirms the rate limit persisted; there was no silent checkpoint advance or notification. Fed is healthy at 135 records / next offset 135; ScienceDaily remains healthy with its bounded snapshot.
- Timeout normalization and retry changes are implemented and covered by 226 local tests (0 failures), and the hosted GDELT unit suite passed 11/11. The external GDELT source remains not live-verified because of provider rate limiting. No further GDELT retry was issued. Production and recurring workloads remain inactive.


## Independent news source licensing review — 2026-11-01

- Investigated additional RSS paths because Exa’s connected search response has no reliable continuation metadata. The BBC’s published metadata/RSS terms require permission and may charge for business use; The Guardian RSS help describes use as personal and non-commercial. These are not established as genuinely free for this system’s intended investment-alert use, so no new collector was added and no existing historical records were altered.
- Preserved Exa as an independent ticker-free discovery path and ScienceDaily RSS as the verified bounded feed. ScienceDaily’s terms and collector constraints remain documented in `acceptance/v15/README.md`; its rolling snapshot is incomplete and cannot prove full news coverage. A future provider must have an explicit reusable free path, original source attribution, and a supported collection/continuity contract before integration.
- Sources checked: BBC terms https://www.bbc.com/usingthebbc/terms-of-use ; Guardian RSS help https://www.theguardian.com/help/feeds ; official SEC RSS directory https://www.sec.gov/files/about/secrss.shtml (regulatory source, not a substitute for independent news). No paid services or feed calls were initiated by this research.


## Qualification safeguards and hosted acceptance — 2026-11-02

- Added seven-day freshness checks for supporting source evidence, catalyst impact assessment, and issuer/parent/human review. Missing, future, or stale source times block alerts while preserving raw/research records. Alert eligibility also requires explicit reviewer attestation that evidence sources are independent; host differences remain only a duplicate heuristic.
- Rechecked freshness and independence in the existing Make adapter at send time. Tests now cover stale/undated evidence, missing attestations, and one synthetic allowlisted outbox item through mock POST and lease-fenced acknowledgement. No live Make call or backlog delivery occurred.
- Commits: research gate 347b716; delivery guard 9b9efc1; delivery tests 14b3d81; manual GDELT guard 48773a8. Existing manual-only workflow remains the sole workflow; its bounded GDELT request defaults off after run #28 returned HTTP 429.
- Existing manual workflow run #29 (41370392151) on 48773a8: PASS, standard GitHub-hosted Ubuntu runner. URL/TLS preflight passed; pinned LuxAlgo native driver tests passed (insert/upsert/rollback/commit/reconnect); PostgreSQL session acceptance passed (scoped role, independent concurrent deduplication, evidence/checkpoint/coverage durability, restart recovery, revision/outbox idempotency, rollback and interrupted-session rollback). Federal Reserve bounded ingestion passed. ScienceDaily 60-entry snapshot was persisted/replayed with incomplete coverage marked. Qualification and mock-only Make suites passed; GDELT live ingestion skipped. No production notification was delivered.
- Preserved existing collectors, schemas/data, pending outbox, Make → Brevo → Gmail → ChatGPT route, pinned LuxAlgo source, and three discovery engines. No paid service, recurring run, production activation, schema change, or trading was introduced. Exa pagination and Tickerbot complete-market coverage remain unresolved; system is not operational.
