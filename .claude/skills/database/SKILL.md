---
name: database
description: How to change SVMI's data storage — the live Google Sheets store (MASTER_LOG, SETTINGS mirror, versioned CONFIG_* sheets, IDENTITY_* sheets, report snapshots) and the DEV-only PostgreSQL schema in database/ (plain SQL migrations, rollbacks, dry-run/import tooling). Use for any new column, field, sheet, table, index, migration, or data backfill.
---

# Database — two stores, one model

| Store | Status | Owns |
|---|---|---|
| Google Sheet (bound to the Apps Script project) | **Live.** The only store the running app uses | Every real record |
| PostgreSQL 16, `database/` | **DEV-only.** No persistent DEV or PROD instance exists; never touched real data (D-011) | The future target schema, mirroring the Sheets model |

There is **no ORM**. Sheets are accessed through Apps Script services;
Postgres through plain SQL files run by `psql`, and Node tooling
(`database/import/`, `database/validation/`) that shells out to `psql`.
Exact shapes live in `DATA_MODEL.md`; Postgres procedure lives in
`database/docs/01`–`06`. Read those — this skill is the rules.

## Invariants (both stores)

1. **History is never rewritten.** `MASTER_LOG` is append-only.
   Configuration changes are new version rows with effective dates.
   Snapshots are superseded, not edited (D-009). No `DELETE`/`UPDATE` of
   history, no "cleanup" of old rows.
2. **Identity rules are fixed:** Store = Location + Brand, immutable
   `STR-<uuid>` (D-001); Visitor/Purpose = normalized name, interim
   (D-003); no inheritance across purposes (D-010). Don't add a
   `location_id` (D-002).
3. **One authoritative source per fact.** `CONFIG_*` is authoritative for
   Stores/Visitors/Purposes; `SETTINGS` A–E/F/H is a regenerated mirror
   (D-006). `SETTINGS!G` (admins) and `!I` (guest password) stay in
   `SETTINGS` (D-007).
4. **Never guess a mapping.** Unresolvable historical names go to
   `CONFIG_UNMAPPED_STORES` / an `unmapped` result, not a best match.
5. **Administrative confirmation is kept separate from automatic
   evidence** (D-012).

## Google Sheets (live)

- **Adding a field to a `CONFIG_*` area:** append a new typed column
  after the existing domain columns (J onward) and add it to that area's
  schema in `CFG_AREA_SCHEMAS` (`SVMKPI_CONFIG.gs`). One column per field —
  never a key/value blob (portability to Postgres). Old rows stay valid
  with the column blank.
- **Adding a `MASTER_LOG` column:** additive at the end (the Store ID
  column `I` is the precedent), never required for older rows to remain
  valid, and every reader must tolerate blanks. Update `COL` and
  `SVMKPI_MASTER_REBUILD.gs`'s header rebuild.
- **New sheets** are created lazily through an `_ensureSheet`-style
  helper with a fixed header row, as `_cfg_ensureSheet` /
  `_identity_ensureSheet_` do.
- **"Migrations" on Sheets** are idempotent, admin-gated functions
  (`SVMKPI_SETTINGS_MIGRATION.gs` pattern): safe to re-run, report
  created/already-present/failed counts, batch reads and writes, and
  suppress per-row side effects (D-034/D-035). Never ship a one-off
  function that mutates live data without owner approval.
- **No transactions exist.** Use `LockService` around read-modify-write
  of shared rows, and order writes so a partial failure leaves history
  valid (write the version row before the audit/mirror).
- **Types:** keep application constants (`COL`, `CFG_AUDIT_COL`,
  `IDENTITY_*_COL`, `CFG_AREA_SCHEMAS`) and the actual header rows in
  sync in the same change; tests assert on these.

## PostgreSQL (DEV-only)

- **Never edit an existing numbered migration.** Add the next
  `NNN_description.sql` plus `rollback/NNN_description.rollback.sql`
  (013 extended 002 this way — D-030). `run_migrations.sh` records
  checksums in `schema_migrations`, and each file runs as one
  transaction (`psql -1`, `ON_ERROR_STOP`).
- **Header comment in every migration:** phase, decisions, which `.gs`
  file/sheet it mirrors, and how it was verified.
- **Mirror the Sheets model:** a `*_versions` table per versioned entity,
  append-only audit, snapshots immutable. Constraints go in the schema
  (FKs, `CHECK`, `NOT NULL`, unique keys on canonical identity), not
  only in app code.
- **Privileges are part of the schema.** `svmi_migrator` owns DDL;
  `svmi_app` is DML-only and is column-restricted on audit/version/
  snapshot tables by `scripts/harden_grants.sql`, which must be re-run
  after new migrations and extended for new tables.
- **Indexes:** add them for the lookups the app actually makes
  (entity + effective date range, canonical keys, year). Keep
  `reporting_periods` a VIEW (D-008 spirit: derived, not stored).
- **Destructive changes** (`DROP`, type narrowing, `NOT NULL` on
  populated columns) need an explicit backfill step, a rollback that
  restores data, and owner approval.
- **Environment safety:** `SVMI_DB_ENV=dev` only. `prod` also requires
  `SVMI_ALLOW_PROD_MIGRATION=yes-i-mean-it` and must never be set by
  Claude. `import/run_import.js` refuses anything but `dev`. Credentials
  come from libpq env vars / uncommitted `.env.dev`; never commit a
  filled `.env.*`.

## Verifying a schema change

- Sheets: extend the relevant `SVMI_Project/tests/*.test.js` and run the
  full suite (`testing` skill).
- Postgres: if a local Postgres is available, create a throwaway DB,
  run `setup_dev_db.sh` → `run_migrations.sh` → `harden_grants.sql`,
  inspect with `\d`, apply the rollback, drop the DB — and say so. If not
  available, say the migration was **not executed**.
- Dry-run tooling: `node database/dryrun/dryrun.test.js`.
- Update `DATA_MODEL.md` (and `database/docs/03-migration-mapping.md` for
  new mappings) in the same change.
