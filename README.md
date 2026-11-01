# stock-catalyst-discovery
Free, research-only stock catalyst discovery: government, independent news, and market-wide engines.

## Isolated acceptance development

The `acceptance/v7` directory contains offline checkpoint-recovery and transaction reference-model code with synthetic tests. Run with `node --test acceptance/v7/test/*.test.mjs`. These helpers are not connected to production collectors or Supabase and do not prove real PostgreSQL concurrency or external alert delivery. The other issuer, calendar, scan-coverage, and evidence-ledger modules in the Version 7 archive remain under separate compatibility review; they are not silently treated as production integrations.
