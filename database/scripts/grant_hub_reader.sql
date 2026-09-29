-- database/scripts/grant_hub_reader.sql
-- A SELECT-only role for KPI Monitoring Hub's export job. It can read the
-- kpi_hub_* views and NOTHING else (no base tables, no writes). Run as
-- svmi_migrator AFTER migration 013. Set the password out-of-band
-- (ALTER ROLE svmi_hub_ro PASSWORD ...) — never in this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svmi_hub_ro') THEN
    CREATE ROLE svmi_hub_ro WITH LOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO svmi_hub_ro;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM svmi_hub_ro;
GRANT SELECT ON
  kpi_hub_visit_credits, kpi_hub_visitor_weekly, kpi_hub_visitor_monthly,
  kpi_hub_team_monthly, kpi_hub_store_visit_compliance
TO svmi_hub_ro;
GRANT EXECUTE ON FUNCTION svmi_week_of_month(date), kpi_hub_target(text, date) TO svmi_hub_ro;
