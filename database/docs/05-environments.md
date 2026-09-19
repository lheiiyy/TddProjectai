# Environments — DEV / PROD Isolation

## The model

Two logically separate PostgreSQL databases, never shared, never pointed at
by the same credentials:

| | DEV | PROD |
|---|---|---|
| Purpose | Schema development, migration testing, import/validation tooling, this phase's proof | Would eventually serve the real application — **does not exist yet**; no production database has been created, migrated, or touched by this phase |
| `SVMI_DB_ENV` | `dev` | `prod` (additionally requires `SVMI_ALLOW_PROD_MIGRATION=yes-i-mean-it`) |
| Who runs migrations | `svmi_migrator` role | `svmi_migrator` role (a DIFFERENT set of credentials — never shared with DEV) |
| Who the app connects as | `svmi_app` role | `svmi_app` role (again, separate credentials) |
| Import/seed tooling | `import/run_import.js` (refuses anything but `dev`) | **No production import tooling exists.** A real production data migration is a separate, future, explicitly-approved phase. |
| Env template | `.env.dev.example` | `.env.prod.example` (placeholders only — never filled in by this phase) |

In THIS phase, "DEV" was a local, ephemeral PostgreSQL 16 instance inside
the sandbox this work was performed in (`service postgresql start`) — good
enough to genuinely execute and prove every migration/import/validation/
backup-restore step, but **not** a persistent, cloud-hosted DEV environment
the user can reconnect to later. Standing up a real persistent DEV instance
(and, later, PROD) is the next owner's job, using the schema/tooling this
phase produced unchanged.

## Roles (see `database/scripts/create_roles.sql` / `harden_grants.sql`)

- **`svmi_migrator`** — owns the schema. The ONLY role that ever runs
  `run_migrations.sh`. Full DDL rights via `ALTER DEFAULT PRIVILEGES`, so
  every table it creates automatically gets `svmi_app`'s default grant.
- **`svmi_app`** — the role the application actually connects as. DML only,
  and — after `harden_grants.sql` runs (always AFTER migrations, since it
  references tables that don't exist beforehand) — explicitly without
  `UPDATE`/`DELETE` on `audit_logs` or full `UPDATE` on any
  `report_snapshot*`/`*_versions` table, narrowed to the one column each
  is allowed to mutate. This is enforced by PostgreSQL column-level GRANTs,
  not just application code — proven directly in this phase (see below).

Passwords are never committed; they are set out-of-band with `ALTER ROLE
... WITH PASSWORD '...'` per environment, per the template files.

**Discovered during this phase and fixed**: migrations must be run AS
`svmi_migrator` (not a superuser), because `ALTER DEFAULT PRIVILEGES FOR
ROLE svmi_migrator` only applies to tables `svmi_migrator` itself creates.
An earlier run against the local DEV instance was mistakenly performed as
the `postgres` superuser, which left `svmi_app` with almost no grants at
all on the new tables — caught by inspecting `\z` output, fixed by
recreating the DEV database and rerunning every step as `svmi_migrator`
over a real (password-authenticated, TCP) connection. `run_migrations.sh`'s
own header comment already documented the intended role; this was a
one-time operator error in this phase's own exploration, not a tooling bug.

**Proven directly** (this phase, against the local DEV instance): connected
as `svmi_app` and confirmed (a) it CAN `INSERT` into `audit_logs`, (b) it
CANNOT `UPDATE` `audit_logs` at all (`permission denied for table
audit_logs`), (c) it CANNOT update `report_snapshots.result_json` even
though it can `SELECT`/`INSERT` on that table (`permission denied for table
report_snapshots` — the column-level grant genuinely blocks the non-status
columns).

## Bootstrap order (DEV)

```
scripts/setup_dev_db.sh        # creates the DEV database, applies create_roles.sql
scripts/run_migrations.sh      # applies database/migrations/*.sql, as svmi_migrator
scripts/harden_grants.sql      # narrows svmi_app's grants, as svmi_migrator (owner)
seed/dev_seed.sql              # (optional) minimal legacy-purpose/category baseline
import/run_import.js <fixture> # (optional) loads a synthetic fixture for a full proof
validation/run_validation.js   # confirms counts + field checks against whatever was loaded
```

Every step refuses to run without `SVMI_DB_ENV` set correctly — there is no
default that silently targets anything.

## What this phase deliberately stops short of

Per this phase's own explicit scope: **no production cutover, no
replacement of the spreadsheet data source, no live production data ever
touched.** The spreadsheet system remains the sole production system.
Everything in `database/` is additive — new files, a new isolated DEV
database, proven tooling — with zero changes to `SVMI_Project/` (confirmed
by `git status` and a full regression re-run; see the phase completion
report). A future production migration phase would need, at minimum: a
real provisioned PROD PostgreSQL instance, a genuine Sheets-API extraction
step (replacing `extract.js`'s fixture reader), a human sign-off on the
validation output against REAL spreadsheet data, and an explicit, separate
go/no-go decision on cutover timing and rollback — none of which this
phase performs or assumes.
