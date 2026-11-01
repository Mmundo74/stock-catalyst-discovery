# Version 8 additive acceptance package

The complete submitted Version 8 package is stored beside this file as `stock-catalyst-additive-acceptance-2026-11-01-v8-123-tests.zip`. It contains source modules, synthetic fixtures, and offline tests for issuer corroboration, market coverage accounting, the append-only evidence ledger, session classification, and fail-closed recovery checks.

Independent rerun in Node.js 22 on 2026-11-01: `node --test test/*.test.mjs` — **123 passed, 0 failed**. The V8 tests are offline model/fixture tests. They do not establish live SEC/Nasdaq compatibility, PostgreSQL multi-session concurrency, live API coverage, or production operation. The archive is preserved verbatim for review; modules have not yet been merged into the established collectors.
