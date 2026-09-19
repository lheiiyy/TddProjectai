# Spreadsheet → PostgreSQL Migration Mapping

Source sheet → destination table(s) → transformation → validation rule, for
every entity in `02-data-inventory.md`. Implemented (against a SYNTHETIC
fixture, never live data) in `database/import/{extract,transform,load}.js`;
proven end-to-end in `04-backup-restore.md`.

| Source | Destination | Transformation | Validation |
|---|---|---|---|
| `SETTINGS` / `CONFIG_STORES` | `stores` (root) + `store_versions` (per version) | One `stores` row per distinct Store ID; one `store_versions` row per configuration version, carrying Store Name/Brand/Region/Category/Status + the versioning envelope columns verbatim. | `counts.js`: `stores`, `store_versions` row counts must equal the number of distinct entity IDs / total version rows in the source. |
| `CONFIG_VISITORS` | `visitors` (root) + `visitor_versions` | Visitor ID stays the normalized name itself (no surrogate key invented). | `counts.js`: `visitors`, `visitor_versions`. |
| `CONFIG_PURPOSES` + `APPROVED_PURPOSES` | `purposes` (root, `is_legacy` flag) + `purpose_versions` | The 4 `APPROVED_PURPOSES` become real root rows (`is_legacy=true`) even where no `CONFIG_PURPOSES` version ever existed for them (see `dev_seed.sql` for the zero-version baseline case). Any purpose with an actual configured Risk Weight also gets a `purpose_versions` row. | `field_checks.js`: `purposes.is_legacy` for `'STORE VISIT'` = true. |
| `CONFIG_COMPLIANCE` + `CMP_DEFAULT_RULES` | `compliance_rules` (root, keyed by **Category**, `is_legacy_default` flag) + `compliance_rule_versions` | Same two-tier pattern as Purposes, but keyed by Category, not Purpose — `cadence_type`/`cadence_days`/`period_definition`/`required_count`/`grace_days` copied verbatim from `CMP_DEFAULT_RULES`/`CONFIG_COMPLIANCE`. | `field_checks.js`: FAR PROVINCIAL cadence = `QUARTERLY, 92`. |
| `CONFIG_RISK` | `risk_rule_sets` (singleton, seeded by migration) + `risk_rule_versions` | One version row per historical threshold/weight change; `risk_rule_set_id` is always `1`. | `field_checks.js`: current-version threshold triple. |
| `CONFIG_KPI` | `kpi_configurations` (root) + `kpi_configuration_versions` | Verbatim copy of target value/type/weight/linked purpose — **no scoring algorithm is invented**; this remains infrastructure-only, matching the documented gap in `SVMKPI_KPI_CONFIG.gs`. | `counts.js`: `kpi_configurations`, `kpi_configuration_versions`. |
| `CONFIG_SYSTEM` | `system_configurations` + `system_configuration_versions` | Verbatim, but the source is documented as (and the fixture keeps) EMPTY — see `01-architecture.md`. | `counts.js`: expects 0 unless the fixture is changed. |
| `CONFIG_AUDIT` | `audit_logs` | Column-for-column copy (`Actor` is NOT mapped to a real `actor_user_id` — see below). `was_backdated`/`backdate_confirmed` default `false` for imported historical rows (the source doesn't carry these as explicit flags; they only matter for NEW writes going forward). | `counts.js`: `audit_logs`. |
| `CONFIG_UNMAPPED_STORES` | `unmapped_store_references` | Direct copy where present; ALSO populated freshly by the import tooling itself for any `MASTER_LOG` row whose Store ID is blank/unresolved (see next row) — a genuine migration-time discovery, not just a copy. | `counts.js`: `unmapped_store_references`. |
| `MASTER_LOG` | `store_visits` + `store_visit_visitors` | **(a)** Brand/Region/Store-name columns are dropped — resolved historically via `store_id → store_versions` instead of copied (removes the spreadsheet's own denormalization). **(b)** `Visited By`'s pipe-delimited string (`"LEO \| GIO"`) is split and written as real `store_visit_visitors` junction rows — one row per visitor per visit, the exact normalization this phase asked for. **(c)** A row with a blank/unresolved Store ID is **quarantined**, not loaded: it is NOT inserted into `store_visits` (which has a `NOT NULL` FK to `stores`) and is instead rolled into `unmapped_store_references` (incrementing `occurrence_count`, updating `first_seen`/`last_seen`). This is a deliberate "never guess, never silently drop" choice — see worked example below. | `counts.js`: `store_visits`, `store_visit_visitors`, `unmapped_store_references`. `field_checks.js`: the pipe-string → junction-row split for a specific known multi-visitor visit. |
| `REPORT_SNAPSHOTS` | `report_snapshots` + `report_snapshot_store_results` + `report_snapshot_compliance_gaps` + `report_snapshot_compliance_provenance` | `snapshot_id` is synthesized as `REPORT-<year>-v<n>` (matching the spreadsheet's own convention exactly). The complete calculated result is kept as `result_json` (byte-for-byte) AND flattened into the three normalized child tables, from the SAME source object, in the SAME transform pass — never independently recalculated. `supersedes_snapshot_id` is resolved from the fixture's `supersedesVersion` field into the synthesized ID of the prior version. `risk_config_version_id` is resolved from a `version_num` reference into the real generated `version_id` UUID. | `field_checks.js`: current FINALIZED version number, `result_json` totals vs. relational projection row count, supersession chain, status-only mutation on the superseded row. |
| `REPORT_<year>` (presentation sheet) | *(not migrated — no table)* | Rendering-only; regenerated from `report_snapshots` on demand. Nothing to map. | n/a |
| *(none — no `users` sheet exists)* | `users` / `user_profiles` / `user_roles` | Nothing to import. Forward architecture only (see `01-architecture.md` section 3). | n/a |
| *(none — no file-handling code exists)* | `file_references` | Nothing to import (confirmed zero matches for Drive/file-handling code repo-wide). | n/a |

## Actor / identity mapping (a known, disclosed limitation)

Every source "Actor" (an email string, e.g. `admin@dev.local`) is currently
**not** mapped to a real `users.user_id` — `audit_logs.actor_user_id` and
every `*_versions.created_by` are loaded as `NULL`. This is not data loss:
the original actor string is preserved informationally in the fixture and
in import warnings, and mapping it to a real `users` row is explicitly part
of the (separate, not-yet-built) authentication migration — inventing a
placeholder `users` row here would misrepresent authentication data that
doesn't exist yet.

## Worked example: an unmapped `MASTER_LOG` row (from the fixture)

Fixture row: `store: "UNKNOWN NEW STORE"`, `storeId: ""`, visited
`2026-06-01`. The importer detects `storeId` does not resolve to any known
`stores` row and:

1. Does **not** insert a `store_visits` row for it.
2. Inserts (or updates) a row in `unmapped_store_references` with
   `original_store_name = 'UNKNOWN NEW STORE'`, `occurrence_count = 1`,
   `first_seen = last_seen = '2026-06-01'`, `status = 'UNMAPPED'`.
3. Emits a warning naming the exact row and reason.

Proven in the actual DEV run (`04-backup-restore.md`): 6 of 7 fixture
`MASTER_LOG` rows loaded into `store_visits`; the 7th is the row above,
correctly quarantined and counted by `counts.js`'s
`unmapped_store_references` check.

## Extraction → normalization → validation → DEV load pipeline

```
extract.js   → reads a JSON fixture shaped like the real sheets
                 (real Sheets-API extraction is a drop-in future
                 replacement for this ONE function only)
transform.js → PURE function: fixture shape -> per-table row arrays,
                 in dependency order, with the quarantine logic above
                 (unit-testable with no database at all)
load.js      → generates one deterministic SQL script (TRUNCATE + INSERT,
                 dev-reload only) and applies it via `psql`
validation/  → counts.js (business totals) + field_checks.js (sample
                 field-by-field checks), BOTH computed from the SAME
                 fixture + SAME transform.js the importer used — never a
                 hardcoded expected number
```

Human verification step (required before any real production plan, NOT
performed in this phase): a person reviews the count/field validation
output plus a manual spot-check against the live spreadsheet before any
production migration is even proposed. This phase stops at "DEV load,
validated, backup/restore proven" — see `05-environments.md`'s closing
section.
