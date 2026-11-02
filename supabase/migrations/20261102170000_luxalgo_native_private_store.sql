-- Private, additive storage for the pinned LuxAlgo collector's native tables.
-- It is deliberately not exposed through Supabase's Data API and grants no
-- access to anon, authenticated, or service_role. The acceptance login uses a
-- per-connection search_path when running the pinned LuxAlgo CLI.
BEGIN;

CREATE SCHEMA luxalgo_native;
REVOKE ALL ON SCHEMA luxalgo_native FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, CREATE ON SCHEMA luxalgo_native TO scd_luxalgo_acceptance;
COMMENT ON SCHEMA luxalgo_native IS
  'Private native LuxAlgo Market Trackers tables and durable source cursors; not exposed through Supabase Data API.';

COMMIT;
