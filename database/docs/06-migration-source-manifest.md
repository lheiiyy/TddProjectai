# Database Phase 2 — Migration Source Manifest

Column-level manifest for the real-data dry run: every source column that
will actually be read, exactly which destination column it becomes, what
(if any) transformation is applied, and how nullability/identity/history
are handled. This extends `03-migration-mapping.md` (which mapped
table-to-table) down to the individual-column level the dry run's
extraction/quarantine tooling is built against.

Columns NOT listed here are explicitly not treated as authoritative for
migration (e.g. `SETTINGS!D`'s validation-formula helper column — display
only, never a data source).

## MASTER_LOG

| Source col | Destination | Transformation | Nullability | Identity/key | Historical preservation | Notes/limitations |
|---|---|---|---|---|---|---|
| A Timestamp | `store_visits.recorded_at` | parsed via the app's own `_parseDateCell()` equivalent | required; malformed → quarantine | none | verbatim | — |
| B Date Visited | `store_visits.visited_at` | parsed via `_parseDateCell()` equivalent; malformed → quarantine, never defaulted to today | required | none | verbatim; this IS the reporting-year source | never use current date as a substitute (rule #5) |
| C Store (name) | *(not copied — resolved via `store_id`)* | used ONLY to resolve/quarantine Store ID | — | — | preserved verbatim inside quarantine/unmapped records | dropped from `store_visits` itself, per `01-architecture.md`'s de-duplication decision |
| D Brand | *(not copied)* | resolved historically via `store_id → store_versions` instead | — | — | — | matches Phase 1 schema decision |
| E Region | *(not copied)* | same as Brand | — | — | — | — |
| F Visited By | `store_visit_visitors` (junction rows) | split on `\|`, trimmed, empty tokens dropped (mirrors `INPUT_PORTAL.gs`'s own `visitedByStr.split('|').map(trim).filter(Boolean)`) | a token not matching a known Visitor ID → quarantine that VISITOR reference (not the whole row) | Visitor ID = normalized name (interim identity, unchanged from Phase 1) | verbatim split, no merge/dedup beyond exact string match | never fuzzy-matched |
| G Purpose | `store_visits.purpose_id` | none (already normalized in source) | required; unknown purpose → quarantine | Purpose ID = normalized name | verbatim | never auto-created |
| H Remarks | `store_visits.remarks` | none | nullable | — | verbatim | — |
| I Store ID | `store_visits.store_id` | resolved against `CONFIG_STORES`/`stores`; blank or unresolved → row quarantined into `unmapped_store_references`, NOT loaded into `store_visits` | blank is valid input (legacy pre-migration rows) but blocks loading | Store ID is the immutable identity | never inferred/fuzzy-matched | see `03-migration-mapping.md`'s worked example |

## SETTINGS

| Source col | Destination | Transformation | Notes |
|---|---|---|---|
| A Store, B Brand, C Region, E Category | Used only as a **fallback/cross-check** against `CONFIG_STORES` for stores that predate Phase 1B's Store ID migration | exact-name match only | `CONFIG_STORES` is authoritative wherever both exist and disagree — the disagreement itself is a data-quality finding, not silently resolved |
| D (validation formula) | *(not migrated)* | — | display-only helper, not a data column |

## CONFIG_STORES / CONFIG_VISITORS / CONFIG_PURPOSES / CONFIG_RISK / CONFIG_COMPLIANCE / CONFIG_KPI / CONFIG_SYSTEM

All seven share the versioning-envelope manifest below (columns per
`SVMKPI_CONFIG.gs`'s `CFG_AREA_SCHEMAS`); domain fields are listed per-area
in `02-data-inventory.md`'s table (unchanged for Phase 2).

| Source col | Destination | Transformation | Nullability | Identity/key | Historical preservation | Notes |
|---|---|---|---|---|---|---|
| Version ID | `*_versions.version_id` | copied if present; else generated deterministically for this run only | required | surrogate | verbatim | a generated ID is recorded in the manifest, never silently invented as if original |
| Entity ID | `*_versions` entity FK / root row PK | copied verbatim | required | THE identity (Store ID / normalized name / Category / `GLOBAL` singleton) | verbatim | never re-derived from another column |
| Version Num | `*_versions.version_num` | copied verbatim | required | part of `(entity, version_num)` unique key | verbatim | overlap/duplicate detection happens here — see §12 of the phase's own checklist |
| Effective From | `*_versions.effective_from` | parsed as a date | required | part of `(entity, effective_from)` unique key | verbatim | never backdated by migration itself |
| Effective To | `*_versions.effective_to` | parsed as a date or NULL | nullable | — | verbatim | NULL means "current/open-ended," not "unknown" |
| Envelope Status | `*_versions.envelope_status` | mapped `ACTIVE`/`INACTIVE` only (see Phase 1's own `SUPERSEDED`-is-invalid-here finding) | required | — | verbatim | a source value outside `{ACTIVE,INACTIVE}` is a quarantined finding, never coerced |
| Created At | `*_versions.created_at` | copied verbatim | required | — | verbatim | — |
| Created By | `*_versions.created_by` | **NOT mapped to a real `users.user_id`** (no `users` data exists — see `01-architecture.md` §7) | left NULL | — | original actor string preserved only in the raw extraction artifact, never as a false FK | disclosed limitation, not a defect |
| Reason | `*_versions.reason` | copied verbatim | nullable | — | verbatim | — |

## CONFIG_AUDIT

12-column direct copy into `audit_logs`, per `02-data-inventory.md`. `Actor`
is preserved in the raw artifact only (same `created_by`-mapping limitation
as above). `was_backdated`/`backdate_confirmed` are new columns with no
source equivalent — populated `false` for every imported historical row
(the source doesn't carry these as an explicit flag for past events; they
only matter for NEW writes going forward).

## REPORT_SNAPSHOTS

Direct, mostly 1:1 mapping into `report_snapshots` + 3 child tables per
`03-migration-mapping.md`'s existing manifest row — **unchanged for Phase
2**, with one addition: the dry run must verify (not just copy) that
`result_json` for each historical row is loaded **exactly as frozen**, with
zero recalculation against current configuration (rule #13).

## REPORT_<year> presentation sheets

Not migrated as data (rendering-only, per `01-architecture.md`). Read
ONLY, where available, as a content-level cross-check that a regenerated
view of a FINALIZED snapshot still matches what the presentation sheet
shows — never as a second source of truth, and never written to.

## Explicitly NOT authoritative / not migrated this phase

- `SETTINGS!D` (validation helper formula)
- Any `EXECUTIVE SUMMARY` / `KPI <year>` / `Store Health` sheet (live
  formula-rendered views, not stored data)
- `inspection_findings` / `finding_categories` (no such entity in the real
  data model — see `01-architecture.md`'s Implementation Notes; re-checked,
  not revisited, in this phase per its own instruction not to expand scope)
