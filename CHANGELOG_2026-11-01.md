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
