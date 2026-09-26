# SVMI — Data Model

Two storage systems exist side by side today: the live Google Sheet, and
the DEV-only PostgreSQL schema built to eventually replace it. This file
describes both. See `ARCHITECTURE.md` for how each is used at runtime.

## 1. `MASTER_LOG` — permanent historical event storage

**Append-only.** Every visit ever submitted, forever. Never rewritten to
"correct" history — a correction is a new understanding layered on top
(e.g. a store's category resolved differently as of a later date), never
an edit to an existing row.

| Col | Field | Notes |
|---|---|---|
| A | Timestamp | |
| B | Date Visited | |
| C | Store | Display name — legacy identity, kept for backward compatibility |
| D | Brand | |
| E | Region | |
| F | Visited By | Pipe-delimited when multiple visitors |
| G | Purpose | |
| H | Remarks | |
| I | Store ID | Phase 1B — authoritative identity going forward; blank on rows written before this column existed, or when the submitted name didn't resolve to a Store ID at submission time; never required for the row to remain valid |

## 2. `SETTINGS` — legacy sheet, now a generated compatibility mirror

**As of Phase 1G, columns A–E, F, and H are compatibility data only** —
fully regenerable from `CONFIG_STORES`/`CONFIG_VISITORS`/`CONFIG_PURPOSES`
and kept in sync automatically by `_cfg_syncLegacyMirror()` every time one
of those areas is mutated through Admin → Configuration (the only path
that can mutate them). Nothing new should ever treat these columns as an
independent source of truth again.

| Col | Field | Status |
|---|---|---|
| A–C, E | Store / Brand / Region / Category | Mirror of `CONFIG_STORES` |
| D | Validation formula | Derived/computed, not data |
| F | Visitor Roster | Mirror of `CONFIG_VISITORS` |
| G | Admin emails | **Still independently authoritative** — not part of the `CONFIG_*` migration |
| H | Purpose List | Mirror of `CONFIG_PURPOSES` |
| I | Guest password | **Still independently authoritative** — not part of the `CONFIG_*` migration |

Still read directly (unmodified by Phase 1G) by: Store Health
(`_computeStoreRisk()`'s seed pass), Store Master Insight, `sl_getBrandList()`
and other `SVMKPI_STORE_LOOKUP.gs` functions, and Executive
Summary/KPI 2026's **live cell-reference formulas** (`=TRIM(SETTINGS!F5)`
style) — this last point is why the mirror must keep existing at all, not
just why it must stay correct.

**Who still writes to it:** exactly four internal functions in
`INPUT_PORTAL.gs` (`portal_saveStore`, `portal_removeStore`,
`manageVisitor`, `managePurpose`), and only when called by the
Configuration sync hooks — no client-side path calls them anymore. See
`DECISIONS.md` D-005/D-006.

**Known limitation:** this guarantee holds for the app's own UI. Nothing
prevents a human from editing `SETTINGS` cells directly in the Sheet — Apps
Script cannot block that. A manual edit would be invisible to Input
Portal's picker (which reads `CONFIG_*` directly) while still visible to
Store Health/Executive Summary/KPI 2026 (which still read `SETTINGS`),
reintroducing the exact drift Phase 1G removed from the app's own paths.

## 3. `CONFIG_*` — the versioned configuration engine

One shared envelope shape, columns A–I, identical across every area:

| Col | Field |
|---|---|
| A | Version ID (`AREA-ENTITY-vN`) |
| B | Entity ID |
| C | Version # (1-based, per entity) |
| D | Effective From |
| E | Effective To (blank = open-ended) |
| F | Status (`ACTIVE`/`INACTIVE` — envelope-level; a row is never deleted, only marked inactive) |
| G | Created At |
| H | Created By |
| I | Reason |

Domain-specific fields start at column J, one typed column per field —
never a generic key/value blob (deliberate, for portability to the
Postgres columns below).

| Sheet | Entity ID | Domain fields |
|---|---|---|
| `CONFIG_STORES` | Store ID (`STR-<uuid>`, immutable) | Store Name, Brand, Region, Category, Store Status |
| `CONFIG_VISITORS` | Normalized Visitor Name (interim identity) | Visitor Name |
| `CONFIG_PURPOSES` | Normalized Purpose Name (interim identity) | Purpose Name, Risk Weight (optional, never inherited) |
| `CONFIG_RISK` | Singleton (`DEFAULT`) | Low/Medium/High thresholds, per-purpose weights |
| `CONFIG_COMPLIANCE` | Category name | Cadence Type/Days, Period Definition, Required Count, Grace Days |
| `CONFIG_KPI` | KPI name | Target Value/Type, Weight, Purpose Reference — **stored, validated, not yet consumed by any calculation** |
| `CONFIG_SYSTEM` | (none populated) | `settingKey`/`settingValue`/`settingLabel` — schema exists, deliberately unpopulated; no business setting has been moved here |

Plus:
- **`CONFIG_AUDIT`** — append-only log of every mutation across every area.
- **`CONFIG_UNMAPPED_STORES`** — historical `MASTER_LOG` store names the
  SETTINGS→Store-ID migration couldn't confidently map (never guessed).

## 4. Identity rules (do not reverse — see `DECISIONS.md`)

- **Store identity = Location + Brand.** `canonical key = NORMALIZED_LOCATION|NORMALIZED_BRAND`.
  Two brands at the same physical location are two Stores. Store ID
  (`STR-<uuid>`) is minted once per canonical key and never reassigned.
- **Visitor / Purpose identity = normalized name** (interim — no immutable
  ID scheme exists for either yet, unlike Store).
- Store Category is constrained to a hardcoded 4-value list
  (`APPROVED_CATEGORIES`); Compliance's per-category rule uses the same
  category string as its key but has no enforced link back to that list —
  see the System Peripherals audit (`reviews/`) for this gap.

## 5. Report snapshots

`SVMKPI_REPORT_SNAPSHOT.gs` freezes a year's Executive Summary/KPI/Store
Health/compliance-gap results into a permanent, immutable record.
Finalizing twice for the same year is rejected; a correction is a
**supersede** (a new snapshot, explicitly linked to the one it replaces),
never an edit to the frozen one. Reporting year itself is data-derived
(`getDefaultReportingYear()` — the latest year actually present in
`MASTER_LOG`), not a manual constant.

## 6. PostgreSQL schema (DEV-only, `database/migrations/000`–`012`)

Same versioning-envelope/audit/immutable-snapshot principles as the
Sheets model, expressed as real tables with FK constraints and
column-level grants (not just application-level convention):

`users`, `user_profiles`, `roles`, `user_roles` · `stores`, `store_versions`,
`unmapped_store_references` · `visitors`, `visitor_versions` ·
`purposes`, `purpose_versions` · `risk_rule_sets`, `risk_rule_versions` ·
`compliance_rules`, `compliance_rule_versions` · `kpi_configurations`,
`kpi_configuration_versions` · `system_configurations`,
`system_configuration_versions` · `store_visits`, `store_visit_visitors` ·
`audit_logs` · `report_snapshots`, `report_snapshot_store_results`,
`report_snapshot_compliance_gaps`, `report_snapshot_compliance_provenance` ·
`file_references` (provider-independent, zero rows today) ·
`reporting_periods` (a VIEW over `store_visits`, never a table).

Exact column-level DDL: `database/migrations/*.sql`, each with an inline
comment tracing it back to the `.gs` file/function it mirrors. Exact
spreadsheet→table mapping: `database/docs/03-migration-mapping.md`.
**No row of real SVMI data has been migrated into this schema.**

## 7. Identity/access logical model — target (Phase 1H-B) and Phase 1H-C's implemented foundation

Records the logical shape of the identity/access model per
`DECISIONS.md` D-015–D-030 and `reviews/004`/`reviews/006`/`reviews/007`.
The pilot's outer access gate (Google sign-in + `SETTINGS!G2:G`/
`SETTINGS!I2`) is unchanged — see §2 above and
`reviews/003-phase-1h-security-identity-audit.md` — this section is
layered on top of it, not a replacement (D-025).

Target logical entities (D-015–D-023):

| Entity | Key fields (logical, not final DDL) |
|---|---|
| User | Immutable internal User ID (identity key, D-017); external IdP subject; current email; display name; account status (D-019); role assignment (D-020) |
| Identity/access audit event | Event type (access requested/verified/approved/rejected, login/logout, role or status change, MFA state change, privileged-operation allow/deny — D-023); actor; timestamp; **never a secret value** |

**Implemented as of Phase 1H-C** (D-024–D-030) — pilot storage (Google
Sheets, one sheet per entity, same discipline as `CONFIG_*`) plus a
mirrored Postgres extension:

| Sheet (pilot) / table (`013_identity_extension.sql`) | Purpose |
|---|---|
| `IDENTITY_USERS` / `users` (extended) | User ID, full name, email, department, account status (D-027's 6-state list), auth provider/subject, email-verified-at |
| `IDENTITY_VERIFICATIONS` / `identity_verifications` | Pending email-OTP: hashed code (never plaintext), expiry, attempt count |
| `IDENTITY_ROLES` / `roles` (extended) | `ADMIN`, `USER` — extensible by adding a row |
| `IDENTITY_PERMISSIONS` / `permissions` | Named capabilities (`REGISTRATION_APPROVE`, `USER_MANAGE`, `ROLE_ASSIGN`, `PERMISSION_ASSIGN`, `SCOPE_ASSIGN`, `IDENTITY_AUDIT_VIEW`) |
| `IDENTITY_ROLE_PERMISSIONS` / `role_permissions` | Which permissions a role grants — `ADMIN` seeded with all, `USER` with none |
| `IDENTITY_USER_ROLES` / `user_roles` (existing table, now populated) | Role membership |
| `IDENTITY_USER_PERMISSIONS` / `user_permissions` | Direct per-user permission grants, additive to role |
| `IDENTITY_USER_SCOPE` / `user_scope` | `SYSTEM`/`REGION`/`STORE` access grants |
| `IDENTITY_MFA` / `identity_mfa` | TOTP status/secret (D-028 — see below) — its own sheet/table, never joined into a general user listing |
| `IDENTITY_AUDIT` / `identity_audit_log` | Append-only; implements the "Identity/access audit event" row above (D-023/D-029) |

**Relationship to the existing DEV-only `users`/`user_roles`/`roles`
tables** (`database/migrations/002_users_roles.sql`, listed in §6 above):
confirmed and extended, not replaced, by `013_identity_extension.sql`
(D-030) — `002` is left exactly as originally written (its header
comment corrected with a pointer to `013`, not a rewrite). `013` was
verified end-to-end against a local ephemeral Postgres instance
(applied, inspected, rolled back) as part of Phase 1H-C.

**MFA secret storage (D-028):** `IDENTITY_MFA.secret` /
`identity_mfa.secret` is a documented, temporary exception to D-022 ("SVMI
must not store MFA secrets") — no external IdP is selected yet (D-024) to
own it instead. Isolated in its own sheet/table specifically so it is
never an incidental part of a broader `SELECT`/read.

Which identity provider, exact token format, additional roles beyond
`ADMIN`/`USER`, and non-admin MFA policy remain **PENDING DECISION** —
see `reviews/004-...md` §12 and `reviews/006-...md` §12.
