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
