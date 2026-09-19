-- 000_schema_migrations.sql
-- Bookkeeping table for database/scripts/run_migrations.sh — records
-- which migration files have already been applied to THIS database, so
-- re-running the runner is idempotent (already-applied files are
-- skipped, never re-executed) and every apply is logged with a
-- timestamp and checksum. This is the ONLY migration file the runner
-- special-cases (created first, unconditionally, before checking what
-- else has been applied).

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename       text PRIMARY KEY,
  checksum       text NOT NULL,
  applied_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE schema_migrations IS 'Tracks which database/migrations/*.sql files have been applied to this database. Never edited by hand — only database/scripts/run_migrations.sh writes to it.';
