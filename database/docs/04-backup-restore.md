# Backup / Restore — Design and Proof

"A backup that has never been restored is not considered verified." This
document describes the design AND the actual proof performed in this phase
against a local, ephemeral DEV PostgreSQL 16 instance running inside the
sandbox this phase was built in — **not** a provisioned cloud DEV instance
the user has ongoing access to. Setting up a real persistent DEV/PROD
PostgreSQL instance (Supabase/Neon/Railway/RDS/self-hosted) is a follow-up
step for whoever owns deploying this; see `05-environments.md`.

## Design (zero-cost-first)

- `database/scripts/backup.sh` — `pg_dump -Fc --no-owner --no-privileges`
  into `database/backups/<database>-<UTC timestamp>.dump`. Standard
  PostgreSQL CLI only, no third-party or paid backup service.
- `database/scripts/restore.sh <dump-file> <new-database-name>` —
  **always** creates a brand-new database and refuses if the target name
  already exists, so a restore is never a destructive in-place operation.
  `pg_restore --no-owner --no-privileges` into that fresh database.
- Both scripts take connection details entirely from standard libpq
  environment variables (`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`), never a
  hardcoded database name.

## Proof performed in this phase (actual commands, actual output)

1. Loaded the full synthetic fixture into the local `svmi_dev` database
   (see `03-migration-mapping.md`) — 20 non-empty tables populated, full
   29-check validation suite passing (`database/validation/run_validation.js`).
2. Ran `database/scripts/backup.sh` against `svmi_dev`:
   ```
   [backup] database: svmi_dev  ->  backups/svmi_dev-20260919T013951Z.dump
   [backup] done. size: 96K
   ```
3. Ran `database/scripts/restore.sh backups/svmi_dev-20260919T013951Z.dump
   svmi_dev_restore_proof` — created a brand-new database
   (`svmi_dev_restore_proof`) and restored into it. `pg_restore` reported
   every table, sequence, constraint, index, and foreign key recreated
   successfully with zero errors.
4. Re-ran the **exact same** validation suite
   (`node validation/run_validation.js import/fixtures/spreadsheet_fixture.json`)
   with `PGDATABASE=svmi_dev_restore_proof` instead of `svmi_dev`:
   ```
   29/29 checks passed.
   ```
   Identical result to the original database — every business-total count
   and every field-by-field sample check (versioned-attribute correction,
   pipe-string → junction-row normalization, risk threshold resolution,
   report-snapshot supersession chain, JSONB/relational-projection
   agreement) matched.
5. Dropped `svmi_dev_restore_proof` (proof complete; it was a temporary
   verification database, not a second environment to keep around).

This is the concrete meaning of "proven" for this phase: the SAME
validation suite that confirmed the original import was correct also
confirms the restored copy is byte-for-byte equivalent in every way that
suite checks.

## What this proof does NOT cover (explicitly out of scope here)

- A real cloud-hosted DEV/PROD instance's backup schedule, retention
  policy, or automated restore-drill cadence — this phase proves the
  mechanism works, not an operational schedule around it (see
  `05-environments.md` for what a real deployment still needs to decide).
- Point-in-time recovery (WAL archiving) — `pg_dump` is a logical,
  point-in-time-of-dump backup only; PITR is a larger, paid-tier-adjacent
  operational decision explicitly deferred (zero-cost-first preference,
  `01-architecture.md`).
- Restoring INTO an existing database (this phase's `restore.sh` refuses
  that by design, to guarantee no accidental overwrite — a real operational
  runbook would need a documented, explicit "replace this DB" procedure,
  which is out of scope for a DEV-only proof).
