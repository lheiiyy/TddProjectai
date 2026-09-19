# SVMI Current-State Spreadsheet Data Inventory

Every sheet the live Apps Script system reads or writes, as discovered by
inspecting `SVMI_Project/Apps Script/*.gs` directly (constants, column
indices, and read/write call sites — not guessed). This is the source-of-
truth inventory `03-migration-mapping.md` maps into the PostgreSQL schema.

## MASTER_LOG (transactional, event source)

Columns (1-based, `SVMKPI_CORE.gs` `COL` + the Store ID column added by
Phase 1B, `INPUT_PORTAL.gs`):

| Col | Name | Type | Notes |
|---|---|---|---|
| A | Timestamp | datetime | row-submission time |
| B | Date Visited | date | the actual visit date |
| C | Store | text | store NAME (display), duplicated onto every row |
| D | Brand | text | one of `APPROVED_BRANDS`, duplicated onto every row |
| E | Region | text | one of `APPROVED_REGIONS`, duplicated onto every row |
| F | Visited By | text | **pipe-delimited multi-visitor string**, e.g. `"LEO \| YANA"` |
| G | Purpose | text | one of `APPROVED_PURPOSES` |
| H | Remarks | text | free text |
| I | Store ID | text | added Phase 1B; blank for pre-migration legacy rows |

- **Historical/transactional**: transactional (append-only event log; the
  permanent source of truth every report/risk calculation reads from).
- **Uniqueness**: no native uniqueness constraint; Phase 0.5's duplicate
  rule (same Store + same Visitor + same Date) is enforced in
  `processSubmissionAsync()`'s `LockService` section at write time, not by
  the sheet itself.
- **Denormalization to fix**: Brand/Region are copied onto every row
  instead of being resolved from the store's own (effective-dated) record
  — drifts if a store's brand/region changes and old rows aren't (and
  shouldn't be) rewritten. The Postgres schema resolves these historically
  via `store_id → store_versions` instead of duplicating them
  (`008_store_visits.sql`).
- **Consumers/writers**: written by `INPUT_PORTAL.gs` (`processSubmission
  Async`); read by `SVMKPI_RISK.gs` (`_computeStoreRisk`), `SVMKPI_STORE_
  LOOKUP.gs` (`sl_getComplianceGaps`), `SVMKPI_REPORT_SNAPSHOT.gs`, and
  (formula-based) `SVMKPI_LAYOUT.gs`.

## SETTINGS (store/brand/region roster — being superseded by CONFIG_STORES)

| Col | Name |
|---|---|
| A | Store |
| B | Brand |
| C | Region |
| D | (validation formula helper column) |
| E | Category |

- **Source vs. derived**: source (manually maintained roster), though
  Phase 1B's `CONFIG_STORES` + Store ID is now the authoritative identity;
  `SETTINGS` remains the legacy store-lookup path some read-only tools
  (`SVMKPI_STORE_LOOKUP.gs`) still use directly.
- **Migration**: mapped into `stores`/`store_versions` (see
  `03-migration-mapping.md`) using Store ID as the real identity, per
  Phase 1B's own migration precedent.

## CONFIG_STORES / CONFIG_VISITORS / CONFIG_PURPOSES / CONFIG_RISK /
## CONFIG_COMPLIANCE / CONFIG_KPI / CONFIG_SYSTEM (configuration, versioned)

All seven share the exact versioning envelope columns established by
`SVMKPI_CONFIG.gs` (Phase 1A): `Version ID | Entity ID | Version Num |
Effective From | Effective To | Envelope Status | Created At | Created By |
Reason`, plus typed domain fields appended per area (`CFG_AREA_SCHEMAS`,
`SVMKPI_CONFIG.gs`):

| Area | Entity ID identity | Domain fields (Phase 1D additions in *italics*) |
|---|---|---|
| STORES | Store ID | Store Name, Brand, Region, Category, Status |
| VISITORS | normalized visitor name | Visitor Name |
| PURPOSES | normalized purpose name | *Risk Weight* |
| RISK | `GLOBAL` (singleton) | Low/Medium/High Threshold, per-purpose legacy weights |
| COMPLIANCE | Category (NCR/NEAR PROVINCIAL/FAR PROVINCIAL/FLIGHT PROVINCIAL) | *Cadence Type, Cadence Days, Period Definition (derived)*, *Required Count*, *Grace Days* |
| KPI | KPI name | *Target Value, Target Type, Weight, linked Purpose* |
| SYSTEM | setting key | value, label |

- **Historical/config**: configuration (effective-dated, versioned — a
  "correction" is always a new version row, per Phase 1A's own append-only
  rule).
- **Two-tier "exists" concept (PURPOSES/COMPLIANCE only)**: the 4
  `APPROVED_PURPOSES` and 4 `CMP_DEFAULT_RULES` categories have ALWAYS
  existed without ever needing a `CONFIG_PURPOSES`/`CONFIG_COMPLIANCE` row
  (`purpose_getConfigurationStatus()`'s own documented "exists but
  unconfigured" state). Migrated as explicit root rows with `is_legacy`/
  `is_legacy_default` flags (`04-backup-restore.md`/`dev_seed.sql`) — a
  normalization improvement, not a behavior change.
- **Consumers/writers**: written by `SVMKPI_STORE_CONFIG.gs`, `SVMKPI_RISK_
  CONFIG.gs`, `SVMKPI_COMPLIANCE_CONFIG.gs`, `SVMKPI_KPI_CONFIG.gs`,
  `SVMKPI_PURPOSE_CONFIG.gs` (all built on the shared `SVMKPI_CONFIG.gs`
  engine); read by `SVMKPI_RISK.gs`, `SVMKPI_STORE_LOOKUP.gs`, and the
  Phase 1F Admin UI (`SVMKPI_ADMIN_API.gs`).

## CONFIG_UNMAPPED_STORES (migration reconciliation, Phase 1B)

| Col | Name |
|---|---|
| A | Unmapped ID |
| B | Original Store Name |
| C | Occurrence Count |
| D | First Seen |
| E | Last Seen |
| F | Status (`UNMAPPED`/`RECONCILED`) |
| G | Resolved Store ID |
| H | Detected At |
| I | Reconciled At |
| J | Reconciled By |
| K | Notes |

- **Historical/audit hybrid**: a reconciliation worklist, never rewriting
  the original historical `MASTER_LOG` reference. Maps directly to
  `unmapped_store_references` (`003_stores.sql`).

## CONFIG_AUDIT (append-only audit log, Phase 1A)

12 columns (`CFG_AUDIT_COL`, `SVMKPI_CONFIG.gs`): `Audit ID | Timestamp |
Actor | Area | Entity ID | Action | Previous Value | New Value | Effective
From | Effective To | Reason | Version`. Append-only by convention in the
spreadsheet system (no code path updates or deletes a row). Maps to
`audit_logs` (`009_audit_logs.sql`), where append-only is additionally
enforced at the database level via role GRANTs.

## REPORT_SNAPSHOTS (canonical historical report artifact, Phase 1E)

One row per finalized/superseded report calculation: reporting year,
sequential per-year version number, status (`DRAFT`/`FINALIZED`/
`SUPERSEDED`), evaluation date, reason, configuration provenance, and the
complete calculated result (store risk rows, compliance gaps, Executive
Summary, KPI) as a serialized JSON blob. Maps to `report_snapshots` +
three normalized child tables (`010_report_snapshots.sql`).

## REPORT_<year> (presentation only — NOT migrated as a table)

A per-year sheet regenerated FROM a finalized `REPORT_SNAPSHOTS` row
(`regenerateReportSheet()`) — never an independent source of truth. No
corresponding PostgreSQL table exists for this; it would be a rendering
concern (a query against `report_snapshots`), not a stored entity. See
`01-architecture.md`'s "Snapshot architecture."

## EXECUTIVE SUMMARY / KPI 2026 / Store Health (live dashboard sheets)

Rendered from formulas (Executive Summary) or generated ranges (KPI, Store
Health) directly against `MASTER_LOG`/config — not a separate data source,
not migrated as tables. Their equivalent in the target architecture is a
query against `store_visits`/`store_versions`/`report_snapshots`.

## User/role handling

No `users` sheet or table exists in the current system at all. Identity is
`Session.getActiveUser()` (whichever Google account is signed in);
authorization is "is that email on the `SETTINGS!G` admin list"
(`sl_isAdmin()`/`_getAdminEmails()`, `SVMKPI_ACCESS.gs`). Nothing to
inventory or migrate here beyond that (see `01-architecture.md` section 3).

## File handling

None exists. Confirmed via `grep -rn "DriveApp\|getBlob\|attachment\|
uploadFile\|FileReference" "Apps Script"` returning zero matches across
every `.gs` file.

## Date/year handling

`DATA_YEAR`/`KPI_YEAR` were historically hardcoded independently in 4+
places (a bug class fixed by Phase 1C's `SVMKPI_REPORTING_YEAR.gs`,
`getAvailableReportingYears()` — years are discovered from actual
`MASTER_LOG` data, never hardcoded). The PostgreSQL schema preserves this
exactly via the `reporting_periods` VIEW (`012_reporting_periods_view.sql`)
— see `01-architecture.md` section 2.
