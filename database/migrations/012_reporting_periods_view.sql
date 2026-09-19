-- 012_reporting_periods_view.sql
-- Mirrors getAvailableReportingYears() (SVMKPI_REPORTING_YEAR.gs,
-- Phase 1C) EXACTLY: a reporting year is DISCOVERED from actual
-- store_visits data, never hardcoded and never a separately-maintained
-- table that a human has to remember to keep in sync (the precise bug
-- class Phase 0-1C existed to eliminate — DATA_YEAR/KPI_YEAR drift).
--
-- Deliberately a VIEW, not a table: a maintained "reporting_periods"
-- table would need application code to insert a new row whenever a new
-- year's first visit is recorded — reintroducing exactly the
-- "someone forgot to update it" risk this project has repeatedly fixed.
-- A view can never drift from store_visits by construction.

CREATE VIEW reporting_periods AS
SELECT DISTINCT EXTRACT(YEAR FROM visited_at)::integer AS reporting_year
FROM store_visits
ORDER BY reporting_year;

COMMENT ON VIEW reporting_periods IS 'Discovered directly from store_visits — never hardcoded, never a maintained lookup table. Adding a new year''s data automatically makes it appear here with zero schema change, mirroring getAvailableReportingYears()''s own contract exactly.';
