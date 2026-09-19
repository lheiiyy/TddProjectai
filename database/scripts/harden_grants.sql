-- database/scripts/harden_grants.sql
-- Step 2 of 2 — run AFTER database/scripts/run_migrations.sh (this file
-- references tables that migrations create). Safe/idempotent to re-run
-- any time, including after a new migration re-creates one of these
-- tables (ALTER DEFAULT PRIVILEGES in create_roles.sql only applies
-- going forward, so a freshly-created table always starts broad until
-- this file narrows it again).
--
-- Run as a superuser or as svmi_migrator (the table owner):
--   psql -v ON_ERROR_STOP=1 -f database/scripts/harden_grants.sql

GRANT SELECT, INSERT ON audit_logs TO svmi_app;
REVOKE UPDATE, DELETE ON audit_logs FROM svmi_app;

GRANT SELECT, INSERT ON report_snapshots TO svmi_app;
REVOKE UPDATE, DELETE ON report_snapshots FROM svmi_app;
-- The supersession flow's ONLY allowed mutation on an existing snapshot
-- row is flipping status FINALIZED->SUPERSEDED on the PREVIOUS row —
-- PostgreSQL's column-level GRANT enforces exactly that at the database
-- level (result_json and every other column remain un-updatable by
-- svmi_app after the blanket UPDATE revoke above).
GRANT UPDATE (status) ON report_snapshots TO svmi_app;

GRANT SELECT, INSERT ON report_snapshot_store_results TO svmi_app;
REVOKE UPDATE, DELETE ON report_snapshot_store_results FROM svmi_app;
GRANT SELECT, INSERT ON report_snapshot_compliance_gaps TO svmi_app;
REVOKE UPDATE, DELETE ON report_snapshot_compliance_gaps FROM svmi_app;
GRANT SELECT, INSERT ON report_snapshot_compliance_provenance TO svmi_app;
REVOKE UPDATE, DELETE ON report_snapshot_compliance_provenance FROM svmi_app;

-- Every *_versions table is append-only in exactly the same sense (a
-- correction always INSERTs a new version row); envelope_status IS
-- allowed to flip (mirrors cfg_activateConfiguration()/
-- cfg_deactivateConfiguration()), so UPDATE is narrowed to that one
-- column only, never a blanket grant.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'store_versions', 'visitor_versions', 'purpose_versions',
    'risk_rule_versions', 'compliance_rule_versions',
    'kpi_configuration_versions', 'system_configuration_versions'
  ]
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM svmi_app', t);
    EXECUTE format('GRANT UPDATE (envelope_status) ON %I TO svmi_app', t);
  END LOOP;
END
$$;
