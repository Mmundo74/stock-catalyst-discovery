# Change Log — 2026-11-02

## Acceptance database role and RLS hardening

- Verified current main at d621bfc and inspected live Supabase catalogs. The dedicated scd_luxalgo_acceptance login had CREATEDB, CREATEROLE, REPLICATION, and BYPASSRLS enabled. This contradicts earlier log entries claiming these attributes were off; this entry supersedes them. SUPERUSER was already off.
- Removed those four unnecessary attributes and added explicit role-only SELECT, INSERT, and UPDATE policies across the seven catalyst_acceptance tables. Enabled RLS on research_qualifications. No DELETE grant or policy was added.
- Preserved existing table/schema grants, data, checkpoints, pending outbox, restore schema, all three discovery engines, source adapters, and the existing manual-only workflow. This is defense-in-depth for the isolated acceptance schema; it changes no collector or production behavior.
- Applied and registered migration 20261102020441_scd_acceptance_role_rls_hardening. Live catalog readback confirms RLS is enabled and three matching policies exist on every acceptance table; the role retains SELECT/INSERT/UPDATE and lacks DELETE. anon, authenticated, and service_role still have no schema USAGE or table SELECT grants. The remaining RLS-without-policy advisories are limited to the untouched restore schema.
- Offline regression: 243 passed, 0 failed; git diff --check and script syntax check passed. The existing V9 and V13 hosted acceptance steps remain the required database proof that reads/writes still work under RLS; no new hosted run has yet been performed after this change.
- Status remains development/acceptance only. The system is not operational. Tickerbot page drift and partial coverage, Exa continuation, rolling RSS coverage, GDELT rate limiting, and end-to-end receiver acknowledgement/deduplication remain open. No recurring work, external alert, paid service, or trade was started.
