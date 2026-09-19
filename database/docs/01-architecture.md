# SVMI Database Architecture

Status: **DEV architecture, proven locally. Not deployed to any production
database.** This document describes the target PostgreSQL schema designed to
eventually coexist with, and later replace, the current Google Sheets-backed
SVMI system — without migrating, deleting, or modifying any live production
data. See `05-environments.md` for the coexistence/rollout plan and
`03-migration-mapping.md` for the exact spreadsheet → table mapping.

## 1. Entity-Relationship overview

```
users ──< user_roles >── roles                stores ──< store_versions
  │                                              │
  └─< user_profiles                              ├──< store_visits >──< store_visit_visitors >── visitors
                                                  │         │
purposes ──< purpose_versions                    │         └── purpose_id → purposes
  │                                               │
  └──< kpi_configuration_versions (optional)      └──< unmapped_store_references (resolved_store_id)

compliance_rules(category) ──< compliance_rule_versions

risk_rule_sets(singleton, id=1) ──< risk_rule_versions

kpi_configurations ──< kpi_configuration_versions

system_configurations ──< system_configuration_versions

audit_logs  (append-only, references nothing but users.actor_user_id)

report_snapshots ──< report_snapshot_store_results (store_id → stores)
        │       ──< report_snapshot_compliance_gaps (store_id → stores)
        │       ──< report_snapshot_compliance_provenance (→ compliance_rule_versions)
        └── supersedes_snapshot_id → report_snapshots (self-FK)
        └── risk_config_version_id → risk_rule_versions

file_references (entity_type/entity_id — provider-independent, zero rows today)

reporting_periods  (VIEW over store_visits, never a table)
```

Full column-level DDL, constraints, and indexes: `database/migrations/*.sql`
(13 files, `000` through `012`, each with an inline comment tracing it back
to the exact `.gs` file/function it mirrors). Rollback: `database/rollback/`.

## 2. Design principles carried over from the spreadsheet system

- **Versioning envelope, everywhere.** Every configuration area
  (Stores/Visitors/Purposes/Risk/Compliance/KPI/System) repeats the exact
  shape `SVMKPI_CONFIG.gs` (Phase 1A) established: `version_id`, an entity
  FK, `version_num`, `effective_from`/`effective_to`, `envelope_status`
  (`ACTIVE`/`INACTIVE` — never `SUPERSEDED`, which is a `report_snapshots`-
  only status), `created_at`, `created_by`, `reason`. A `UNIQUE (entity,
  effective_from)` constraint enforces "no two versions share an Effective
  From," matching `cfg_createConfiguration()`'s own rule. See
  `svmi_check_effective_range()` (`001_extensions_and_helpers.sql`) for the
  one shared range-order check every one of these tables uses.
- **Append-only historical correction.** A "correction" is always a new
  version row; the source row is never edited or deleted. Enforced not just
  by convention but at the database level: `harden_grants.sql` revokes
  `UPDATE, DELETE` from the application role on every `*_versions` table and
  grants back `UPDATE` on `envelope_status` alone (the one column allowed to
  flip, mirroring `cfg_activateConfiguration()`/`cfg_deactivateConfiguration()`).
- **Report snapshots are frozen historical artifacts, not a live view.**
  `report_snapshots` mirrors `REPORT_SNAPSHOTS`/Phase 1E exactly:
  `DRAFT`/`FINALIZED`/`SUPERSEDED` status, `result_json jsonb NOT NULL`
  holding the complete byte-for-byte frozen calculation (the same
  "serialized blob is fine for a computed, read-only artifact" precedent
  `CONFIG_AUDIT`'s own Previous/New Value columns already established),
  PLUS normalized child tables (`report_snapshot_store_results`,
  `report_snapshot_compliance_gaps`, `report_snapshot_compliance_provenance`)
  as a queryable projection of the SAME frozen data — written together, at
  the same insert, never independently recalculated. `harden_grants.sql`
  revokes all UPDATE/DELETE on `report_snapshots` and grants back `UPDATE
  (status)` only — the ONE mutation the supersession flow needs
  (`FINALIZED` → `SUPERSEDED` on the previous row). A genuine strengthening
  beyond the spreadsheet engine: `uq_report_snapshots_one_finalized_per_year`
  is a PostgreSQL **partial unique index** enforcing "at most one FINALIZED
  snapshot per year" at the database level — something the spreadsheet
  engine could only approximate with a `LockService`-protected re-read.
- **Reporting years are discovered, never hardcoded, never a maintained
  table.** `reporting_periods` (`012_reporting_periods_view.sql`) is a VIEW
  — `SELECT DISTINCT EXTRACT(YEAR FROM visited_at) FROM store_visits` —
  mirroring `getAvailableReportingYears()` (Phase 1C) exactly, and
  deliberately NOT a table a human would need to remember to update (the
  precise "DATA_YEAR/KPI_YEAR drift" bug class Phase 0–1C existed to
  eliminate).
- **Audit structure, not a raw-payload dump.** `audit_logs` mirrors
  `CONFIG_AUDIT` column-for-column (`entity_type`/`entity_id`/`action`/
  `actor_user_id`/`occurred_at`/`reason`/`previous_value`/`new_value`/
  `version_num`), keeping `previous_value`/`new_value` as the SAME compact
  structured-text summary the source system already writes (never a full
  row dump). Two columns are a genuine improvement enabled by real columns
  (not a behavior change): `was_backdated`/`backdate_confirmed`, making
  explicit what the source system only implies by comparing
  `effective_from` to `created_at`.

## 3. Authentication / authorization boundary

`users` (pure authentication identity — `auth_provider`/`auth_subject`,
provider-independent even though Google is the only provider today) →
`user_profiles` (SVMI-specific, deliberately minimal — the source system has
no per-user profile data beyond "is this email an admin") → `roles`/
`user_roles`. **Business rule: there is one Admin role.** `roles` is seeded
with exactly `ADMIN` — this is NOT a general RBAC system; it exists so the
current one-role reality (`sl_isAdmin()`/the `SETTINGS!G` admin email list,
`SVMKPI_ACCESS.gs`) has an explicit row instead of an implicit hardcoded
list. Authorization decisions belong entirely server-side, by checking
`user_roles` — a client-supplied `isAdmin`/`role` value must never be
trusted, exactly matching Phase 1F's own explicit constraint for the Admin
UI. There is currently no data to import into any of these three tables
(see `03-migration-mapping.md`) — this is forward architecture for the
eventual auth migration, not a reflection of data that exists yet.

## 4. Provider-independent file storage

`file_references` carries the storage provider identity in a DATA column
(`storage_provider`/`storage_key`), never in the schema shape — moving
providers later changes rows, never this table. Zero rows exist to migrate
today: a full-repository grep (`DriveApp|getBlob|attachment|uploadFile|
FileReference`) across every `.gs` file returned no matches — there is no
file-handling code anywhere in the current application.

## 5. DEV/PROD architecture

See `05-environments.md` for the full model. Summary: two logically
separate PostgreSQL databases (never shared), two roles per database
(`svmi_migrator` owns the schema and is the only role that runs
`run_migrations.sh`; `svmi_app` is the narrow DML-only role the application
connects as), and a hard safety gate (`SVMI_DB_ENV`) in every script that
can mutate schema or data — refusing to run at all unless explicitly told
`dev` or `prod`, with `prod` requiring a second explicit opt-in
(`SVMI_ALLOW_PROD_MIGRATION=yes-i-mean-it`).

## 6. Backup/restore architecture

Zero-cost-first: plain `pg_dump -Fc` / `pg_restore` via the standard
PostgreSQL CLI (no third-party or paid backup service). See
`04-backup-restore.md` for the actual proof performed in this phase — a
backup was taken of the local DEV database, restored into a brand-new
database, and the full 29-check validation suite re-run against the
restored copy with identical results.

## 7. Implementation notes (assumptions, ambiguities, data-quality issues)

- **No `inspection_findings`/`finding_categories` tables.** These were in
  this phase's own "candidate" list and were deliberately NOT created after
  inspecting the real data model: a `MASTER_LOG` Purpose value like
  `'FAILED QA/MS'` is already a complete, single-row fact about one visit —
  not a parent record with its own list of child findings. Inventing a
  child-entity table here would violate this project's repeated
  "no business-rule invention" constraint. If a real multi-finding-per-visit
  concept is ever needed, it is new product scope, not a migration
  artifact.
- **Visitor/Purpose identity stays the normalized name itself** (`visitor_id
  text PRIMARY KEY` = the normalized name, same for `purpose_id`), NOT a
  surrogate ID — this is the SAME interim identity choice Phase 1A/1B
  already disclosed ("a real Visitor/Purpose ID is a later migration, out
  of scope"), carried forward rather than silently upgraded.
- **Compliance rules are keyed by CATEGORY, not by Purpose.** An early draft
  of this schema mistakenly modeled `compliance_rules` as purpose-keyed;
  re-reading `SVMKPI_COMPLIANCE_CONFIG.gs` (`CMP_DEFAULT_RULES`,
  `resolveComplianceConfigurationAsOf(storeId, date)`) confirmed compliance
  is genuinely per-Category (`NCR`/`NEAR PROVINCIAL`/`FAR PROVINCIAL`/
  `FLIGHT PROVINCIAL`), resolved via a store's category. Caught and fixed
  before any DEV data was loaded.
- **A `store_visits` row requires a real Store ID (NOT NULL FK).** Some
  historical `MASTER_LOG` rows predate the Store ID column and have a
  blank Store ID (Phase 1B's own documented `CONFIG_UNMAPPED_STORES`
  scenario). Rather than guessing a Store ID or silently dropping the row,
  the import tooling (`import/transform.js`) quarantines such rows into
  `unmapped_store_references` (occurrence count, first/last seen) and does
  **not** load them into `store_visits` until a human reconciles them to a
  real Store ID — see `03-migration-mapping.md` for the exact rule and
  `04-backup-restore.md`/validation output for a worked example (1 of 7
  fixture rows quarantined this way).
- **No cross-table duplicate-visit trigger.** Phase 0.5's exact-duplicate
  rule (same Store + same Visitor + same date) spans two tables here
  (`store_visits` + `store_visit_visitors`) and is not expressible as a
  single native SQL constraint without either a denormalized column or a
  trigger. This phase enforces it at the application/tooling layer only
  (matching where the spreadsheet enforces it today — inside
  `processSubmissionAsync()`'s `LockService` section, not a spreadsheet-
  native constraint either). A trigger-based enforcement is a flagged
  follow-up, not implemented here to avoid inventing new production
  behavior beyond what was asked.
- **`system_configurations` is seeded empty**, per `007_kpi_and_system_
  configuration.sql`'s own comment: almost every "system setting" candidate
  in the current app is either developer-controlled code or already lives
  in `SETTINGS`, and moving those now would be an unrequested, out-of-scope
  migration.
- **`users`/`user_profiles`/`user_roles` have nothing to import.** The
  current system has no `users` table at all — identity is "whichever
  Google account is signed in." These three tables are forward
  architecture only.
- **Actor attribution on imported historical rows.** Since there is no real
  `users` data to import (previous point), every imported `*_versions.
  created_by` and `audit_logs.actor_user_id` is `NULL` for now — the
  original spreadsheet actor (an email string) is preserved informationally
  only inside the fixture/import warnings, not as a false FK. Wiring real
  actor attribution is part of the (not-yet-built) authentication
  migration, not this phase.
