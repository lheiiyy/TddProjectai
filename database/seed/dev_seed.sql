-- database/seed/dev_seed.sql
--
-- Minimal DEV baseline seed — NOT sample/demo data (see
-- database/import/fixtures/spreadsheet_fixture.json for that). This
-- seeds ONLY the two "exists without ever needing a configuration row"
-- legacy sets that Phase 1D/1E's own two-tier design already documents:
--   - The 4 APPROVED_PURPOSES (SVMKPI_CORE.gs) as root `purposes` rows,
--     is_legacy = true, with ZERO purpose_versions rows — exactly
--     mirroring purpose_getConfigurationStatus()'s "exists but
--     unconfigured" state. A version row is only added when someone
--     DELIBERATELY configures risk weight for one (see
--     import/fixtures/spreadsheet_fixture.json for that scenario).
--   - The 4 CMP_DEFAULT_RULES categories (SVMKPI_COMPLIANCE_CONFIG.gs) as
--     root `compliance_rules` rows, is_legacy_default = true, likewise
--     with zero compliance_rule_versions rows.
--
-- Safe to run against ANY freshly-migrated DEV database (idempotent via
-- ON CONFLICT DO NOTHING) — including one that will never run the
-- import/ pipeline at all, e.g. a DEV instance used only for exercising
-- the application's own "configure a purpose for the first time" flow.
-- Never run against production by a script in this repository — this
-- file is applied manually, exactly like create_roles.sql/harden_grants.sql.
--
-- Usage:
--   psql -v ON_ERROR_STOP=1 -f database/seed/dev_seed.sql

INSERT INTO purposes (purpose_id, is_legacy) VALUES
  ('STORE VISIT', true),
  ('TLTC', true),
  ('FAILED QA/MS', true),
  ('CURING/SUPPORT', true)
ON CONFLICT (purpose_id) DO NOTHING;

INSERT INTO compliance_rules (category, is_legacy_default) VALUES
  ('NCR', true),
  ('NEAR PROVINCIAL', true),
  ('FAR PROVINCIAL', true),
  ('FLIGHT PROVINCIAL', true)
ON CONFLICT (category) DO NOTHING;
