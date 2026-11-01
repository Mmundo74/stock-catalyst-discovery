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
