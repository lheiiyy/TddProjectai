# KPI Monitoring Hub — Store Visit Compliance data contract

Consumer: [`lheiiyy/kpi-monitoring-hub`](https://github.com/lheiiyy/kpi-monitoring-hub),
KRA **Store Visit Compliance (25%)** = Actual Store Visits / Target Store
Visits × 100%. Target on the hub page: **8 stores/week (≈32/month)**.

The hub is static (GitHub Pages) — it cannot query PostgreSQL. Path:
`store_visits` → `kpi_hub_*` views (migration `013`) → `export/hub_export.js`
→ `data/store-visits.json` committed in the hub repo.

## What validates the KPI (data needed → where it lives)

| Need | Source in schema | Notes |
|---|---|---|
| Actual visits | `store_visits` ⨝ `store_visit_visitors` → `kpi_hub_visit_credits` | One credit per visitor named on a visit; **all Purposes count** (matches `_visitorWeekFormula`, which never filters Purpose). |
| Who | `visitor_id` / `visitor_versions.visitor_name` | See gap 1. |
| When / bucket | `visited_at` → year, quarter, month, Sun–Sat `week_of_month` 1..5 | `svmi_week_of_month()` verified equal to `_weekRanges()` for every day 2024–2027. |
| Store context | `store_versions` resolved as-of visit date | Brand / Region / Category. |
| Target | `kpi_configuration_versions` (`kpi_id = 'STORE VISIT COMPLIANCE'`, `target_type = 'COUNT'`, weekly) | **Not seeded** — see gap 2. |
| Compliance % | `kpi_hub_store_visit_compliance` | `actual / (weekly_target × weeks_in_month) × 100`; NULL when no target configured. |
| Team total | `kpi_hub_team_monthly` | Counts each visit once (not once per visitor). |

Views: `kpi_hub_visit_credits`, `kpi_hub_visitor_weekly`,
`kpi_hub_visitor_monthly`, `kpi_hub_team_monthly`,
`kpi_hub_store_visit_compliance`. Role `svmi_hub_ro`
(`scripts/grant_hub_reader.sql`) is SELECT-only on those views and cannot
read any base table.

## Open gaps (need a decision — nothing here was guessed)

1. **Identity mismatch.** The hub lists 12 facilitators by full name (e.g.
   "Leo Fernandez", "Alliana (Yana) Papa"); SVMI visitors are normalized
   short names (`LEO`, `YANA`, `RICE`…). No mapping exists in either
   system. Needs a `visitor_id → facilitator` table or an agreed rule.
2. **Target is unconfigured.** The 8/week figure exists only as hub page
   text. Insert it as configuration (versioned), e.g.
   `kpi_configurations('STORE VISIT COMPLIANCE')` +
   `kpi_configuration_versions(target_value 8, target_type 'COUNT',
   effective_from …)`. `013` documents but does not seed this.
3. **Target semantics.** The formula says "stores/week", but the KPI sheet
   counts visits (rows), not distinct stores. Views expose both
   `visits` and `distinct_stores`; the hub must pick one. Current
   `compliance_pct` uses `visits` (what the spreadsheet counts).
4. **Monthly target base.** `weeks_in_month` is 4 or 5 (Sun–Sat buckets),
   so target is 32 or 40, not a flat 32. Say if a flat 32 is wanted.
5. **Sheet contents not inspected.** The Drive connector returned only the
   tab/column structure of `[sys] STORE VISIT 2026`, not cell values, so
   no live-data reconciliation (sheet vs. views) was done. Tabs of
   interest: `MASTER_LOG` (A1:J1137), `KPI 2026`, `CONFIG_STORES`,
   `CONFIG_VISITORS`, `Q1–Q4_REPORT`. The 12 facilitators/hub figures
   (71.88 %, 17.97 weighted) are unverified against it.
6. **Database is DEV-only.** No production DB exists; real data still has to
   be imported (Phase 2 dry-run tooling) before the export returns anything
   real.

## Verified locally

Migrations 000–013 applied to a scratch PostgreSQL 16; fixture imported;
views return expected per-visitor/week/month rows; with a target row of 8
the compliance view yields 40 (5-week month) / 32 (4-week month) targets;
`svmi_hub_ro` reads the views and export runs, but `SELECT` on
`store_visits` is denied; rollback `013` runs clean.

## Hub-side usage

```
PGUSER=svmi_hub_ro PGHOST=… PGDATABASE=… PGPASSWORD=… \
  node database/export/hub_export.js 2026 store-visits.json
# commit as kpi-monitoring-hub/data/store-visits.json
```
Shape: `{generated_at, report_year, monthly[], weekly[], team[]}`.
