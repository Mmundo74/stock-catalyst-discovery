# Direct email fallback — 2026-11-02

Authorized by user to bypass failed Gmail event-to-ChatGPT notifications. Existing notification tasks, LuxAlgo collectors, database tables and workflows remain unchanged.

This new workflow is manual-only and does not deliver trading alerts. It can test SMTP once four GitHub Actions secrets are configured: ALERT_SMTP_HOST, ALERT_SMTP_USER, ALERT_SMTP_PASSWORD and ALERT_EMAIL_FROM. Do not commit credentials. The existing SUPABASE_SESSION_POOLER_URL is reused.

The worker queries only recent government LuxAlgo research qualifications that explicitly passed the existing independent-evidence and human-review gates. Existing unqualified outbox rows, historical snapshots, undated evidence and fixtures must never be sent as trading alerts.

**Current blocker:** no qualified rows exist and no durable recipient delivery ledger is implemented. The worker deliberately refuses to send actual qualified alerts until that ledger is implemented and tested. This prevents false claims of production readiness or duplicate sends.

2026-11-02 change log: adds an opt-in manual email transport test; replaces no existing component; preserves all prior infrastructure. User authorized the email fallback, not unattended recurring production.
