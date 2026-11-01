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


## Repository integration follow-up — 2026-11-01

- Added `acceptance/v7/src/source_recovery_gate.mjs` and its tests, including the six Version 7 fail-closed coverage-shape regressions.
- Added `acceptance/v7/src/transaction_acceptance_model.mjs` and its tests as an offline reference model.
- Updated the README with the test command and explicit limits. These selected files are isolated under `acceptance/v7`; they do not replace or connect to any production collector or database code.
- Downloaded the four committed source/test files through the GitHub read interface into a clean scratch mirror and ran `node --test acceptance/v7/test/*.test.mjs`: **33 passed, 0 failed**.
- The other issuer, session-calendar, coverage-ledger, and evidence-ledger files remain in the Version 7 package pending compatibility review against the unrecovered earlier source package.
- Native LuxAlgo one-shot acceptance remains blocked by the absent session-pooler Actions secret and unavailable existing database password. No password reset or production change.
