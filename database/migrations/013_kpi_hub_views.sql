-- 013_kpi_hub_views.sql
-- Read-only contract for lheiiyy/kpi-monitoring-hub's "Store Visit
-- Compliance" KRA (Actual Store Visits / Target Store Visits x 100%).
-- VIEWS ONLY — no table, no data, no business rule invented. Each view
-- reproduces what the spreadsheet's own "KPI <year>" sheet already counts
-- (SVMKPI_KPI_REBUILD.gs _visitorWeekFormula/_weekRanges):
--   * one visit = one MASTER_LOG row; every visitor named on the row is
--     credited one visit (store_visit_visitors junction row);
--   * ALL purposes count (the formula never filters by Purpose);
--   * weeks are Sun–Sat: W1 = day 1 -> first Saturday, W2..W4 = 7 days,
--     W5 = everything left in the month (folded, never a 6th bucket).
-- Store attributes are resolved AS OF the visit date (store_versions),
-- never copied, matching 008_store_visits.sql.

-- Week-of-month (1..5) exactly as _weekRanges() builds it.
CREATE OR REPLACE FUNCTION svmi_week_of_month(d date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(DAY FROM d) <= w1_end THEN 1
    ELSE LEAST(5, 2 + ((EXTRACT(DAY FROM d)::integer - w1_end - 1) / 7))
  END
  FROM (
    SELECT 1 + (6 - EXTRACT(DOW FROM date_trunc('month', d))::integer) AS w1_end
  ) x;
$$;

COMMENT ON FUNCTION svmi_week_of_month IS
  'Sun–Sat week bucket 1..5 within the month; identical to _weekRanges() in SVMKPI_KPI_REBUILD.gs (W5 absorbs any remainder).';

-- One row per (visit, visitor): the grain the KPI sheet counts at.
CREATE VIEW kpi_hub_visit_credits AS
SELECT
  v.store_visit_id,
  vv.visitor_id,
  vver.visitor_name,
  v.visited_at,
  EXTRACT(YEAR FROM v.visited_at)::integer    AS report_year,
  EXTRACT(QUARTER FROM v.visited_at)::integer AS report_quarter,
  EXTRACT(MONTH FROM v.visited_at)::integer   AS report_month,
  svmi_week_of_month(v.visited_at)            AS week_of_month,
  v.store_id,
  sv.store_name,
  sv.brand,
  sv.region,
  sv.category,
  v.purpose_id
FROM store_visits v
JOIN store_visit_visitors vv ON vv.store_visit_id = v.store_visit_id
LEFT JOIN LATERAL (
  SELECT s.store_name, s.brand, s.region, s.category
  FROM store_versions s
  WHERE s.store_id = v.store_id
    AND s.envelope_status = 'ACTIVE'
    AND s.effective_from <= v.visited_at
    AND (s.effective_to IS NULL OR s.effective_to >= v.visited_at)
  ORDER BY s.effective_from DESC
  LIMIT 1
) sv ON true
LEFT JOIN LATERAL (
  SELECT x.visitor_name
  FROM visitor_versions x
  WHERE x.visitor_id = vv.visitor_id
    AND x.envelope_status = 'ACTIVE'
    AND x.effective_from <= v.visited_at
    AND (x.effective_to IS NULL OR x.effective_to >= v.visited_at)
  ORDER BY x.effective_from DESC
  LIMIT 1
) vver ON true;

COMMENT ON VIEW kpi_hub_visit_credits IS
  'Row-level grain for the hub: one row per visitor credited on a visit. Actual visits = COUNT(*) over any slice of this view.';

-- Actuals per visitor per month/week — the numerator. Mirrors the KPI
-- sheet's W1..W5 + monthly TOT columns.
CREATE VIEW kpi_hub_visitor_weekly AS
SELECT
  visitor_id, report_year, report_month, week_of_month,
  COUNT(*)                     AS visits,
  COUNT(DISTINCT store_id)     AS distinct_stores
FROM kpi_hub_visit_credits
GROUP BY visitor_id, report_year, report_month, week_of_month;

CREATE VIEW kpi_hub_visitor_monthly AS
SELECT
  visitor_id, report_year, report_quarter, report_month,
  COUNT(*)                     AS visits,
  COUNT(DISTINCT store_id)     AS distinct_stores
FROM kpi_hub_visit_credits
GROUP BY visitor_id, report_year, report_quarter, report_month;

-- Team total (the KPI sheet's TEAM TOTAL row): a visit with two visitors
-- counts once per visitor in the rows above but ONCE here.
CREATE VIEW kpi_hub_team_monthly AS
SELECT
  EXTRACT(YEAR FROM visited_at)::integer    AS report_year,
  EXTRACT(QUARTER FROM visited_at)::integer AS report_quarter,
  EXTRACT(MONTH FROM visited_at)::integer   AS report_month,
  COUNT(*)                                  AS visits,
  COUNT(DISTINCT store_id)                  AS distinct_stores
FROM store_visits
GROUP BY 1, 2, 3;

-- Target side (SECURITY DEFINER + pinned search_path: lets the SELECT-only
-- hub role resolve a target without any grant on base tables). The target is a CONFIGURATION value (kpi_configurations),
-- not a constant baked into SQL. Returns the ACTIVE version in force on
-- `as_of`; NULL when no such KPI/version exists (never a silent default).
CREATE OR REPLACE FUNCTION kpi_hub_target(p_kpi_id text, as_of date)
RETURNS TABLE (target_value numeric, target_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.target_value, c.target_type
  FROM kpi_configuration_versions c
  WHERE c.kpi_id = p_kpi_id
    AND c.envelope_status = 'ACTIVE'
    AND c.effective_from <= as_of
    AND (c.effective_to IS NULL OR c.effective_to >= as_of)
  ORDER BY c.effective_from DESC
  LIMIT 1;
$$;

-- Report rows the hub reads: actual, target, compliance % per visitor per
-- month. Target = configured weekly target x number of weeks the month
-- spans in this system's Sun–Sat bucketing (max week_of_month for that
-- month, so 4 or 5). Rows with no configured target expose NULL target
-- and NULL compliance rather than a guessed number.
CREATE OR REPLACE VIEW kpi_hub_store_visit_compliance AS
SELECT
  m.visitor_id,
  m.report_year,
  m.report_quarter,
  m.report_month,
  m.visits                                            AS actual_visits,
  t.target_value                                      AS weekly_target,
  wk.weeks_in_month,
  t.target_value * wk.weeks_in_month                  AS target_visits,
  CASE WHEN t.target_value IS NULL OR t.target_value = 0 THEN NULL
       ELSE ROUND(100.0 * m.visits / (t.target_value * wk.weeks_in_month), 2)
  END                                                 AS compliance_pct
FROM kpi_hub_visitor_monthly m
CROSS JOIN LATERAL (
  SELECT svmi_week_of_month(
           (date_trunc('month', make_date(m.report_year, m.report_month, 1))
            + interval '1 month - 1 day')::date
         ) AS weeks_in_month
) wk
LEFT JOIN LATERAL kpi_hub_target(
  'STORE VISIT COMPLIANCE',
  make_date(m.report_year, m.report_month, 1)
) t ON true;

COMMENT ON VIEW kpi_hub_store_visit_compliance IS
  'Actual / Target x 100 per visitor per month. Needs a kpi_configurations row keyed ''STORE VISIT COMPLIANCE'' (target_type COUNT = visits per WEEK) — none is seeded; see docs/07-kpi-hub-data-contract.md.';

REVOKE ALL ON FUNCTION kpi_hub_target(text, date) FROM PUBLIC;
