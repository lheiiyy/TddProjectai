-- 001_extensions_and_helpers.sql
-- SVMI PostgreSQL schema — foundational extensions and shared helpers.
-- No proprietary/cloud-specific extensions — standard PostgreSQL only,
-- so this schema is portable across any PostgreSQL 13+ host (Supabase,
-- Neon, Railway, RDS, a local docker container, ...). See
-- database/docs/01-architecture.md's "Cloud architecture target" section.

-- gen_random_uuid() for surrogate keys on tables that don't already have
-- a natural key from the source system (Store ID is a natural key and
-- does NOT use this — see 003_stores.sql).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Every "*_versions"/"*_configuration_versions" table below repeats the
-- SAME shared "versioning envelope" shape the spreadsheet's own
-- SVMKPI_CONFIG.gs (Phase 1A) already established across every
-- CONFIG_* sheet: version_id, entity FK, version_num, effective_from,
-- effective_to, envelope_status, created_at, created_by, reason. This
-- helper enforces the one universal rule every one of those tables
-- shares: effective_to (if set) must not be before effective_from.
CREATE OR REPLACE FUNCTION svmi_check_effective_range(effective_from date, effective_to date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT effective_to IS NULL OR effective_to >= effective_from;
$$;

COMMENT ON FUNCTION svmi_check_effective_range IS
  'Shared CHECK-constraint helper for every effective-dated versioning table: effective_to, when set, must not precede effective_from. Mirrors the same invariant SVMKPI_CONFIG.gs (Phase 1A) already enforces in the spreadsheet-backed engine.';
