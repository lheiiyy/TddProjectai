-- database/scripts/create_roles.sql
-- Step 1 of 2 (run BEFORE any migration, since it only touches roles and
-- default-privilege policy, not actual tables — see harden_grants.sql
-- for step 2, which runs AFTER migrations because it references tables
-- that don't exist yet at this point).
--
-- Two roles per environment (run once per DEV/PROD database, never
-- shared between environments — see docs/05-environments.md):
--   svmi_migrator — owns the schema; the ONLY role that runs
--     database/scripts/run_migrations.sh. Has full DDL rights.
--   svmi_app      — the role the application actually connects as.
--     DML only, and (after harden_grants.sql runs) explicitly WITHOUT
--     UPDATE/DELETE on audit_logs or any report_snapshot_*/*_versions
--     table beyond one narrow allowed column — enforcing "append-only"/
--     "immutable except the one allowed status transition" at the
--     database level, not just by application convention.
--
-- Run as a superuser (e.g. `postgres`), once per environment:
--   psql -v ON_ERROR_STOP=1 -f database/scripts/create_roles.sql
-- Passwords are intentionally NOT set here — see
-- database/.env.dev.example / .env.prod.example and set them with
-- ALTER ROLE ... WITH PASSWORD '...' out of band (never committed).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svmi_migrator') THEN
    CREATE ROLE svmi_migrator WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svmi_app') THEN
    CREATE ROLE svmi_app WITH LOGIN;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON SCHEMA public TO svmi_migrator;
GRANT USAGE ON SCHEMA public TO svmi_app;

-- Broad DML default for every table svmi_migrator creates from now on —
-- narrowed per-table for the append-only/immutable tables by
-- harden_grants.sql, run once those tables exist.
ALTER DEFAULT PRIVILEGES FOR ROLE svmi_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svmi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE svmi_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO svmi_app;
