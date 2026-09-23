# SVMI — Project Memory

Durable context for any AI session (or human) picking this repository up
cold. This file orients; it does not duplicate detail that belongs in
`ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md`, `IMPLEMENTATION_LOG.md`,
or `TESTING_LOG.md` — read this first, then follow its pointers.

## What SVMI is

**SVMI (Store Visit Monitoring Initiative)** is a Google Sheets + Apps
Script application ("SVMI Command Center") that lets field staff log store
visits and lets administrators track visit compliance, a per-store risk
score ("Store Health"), a weekly KPI tracker, and executive reporting —
with a growing layer of versioned, effective-dated, audited administrative
configuration replacing what used to be informal spreadsheet edits.

A separate, parallel effort (`database/`) is building a PostgreSQL schema
and migration tooling intended to eventually coexist with, and later
replace, the Sheets-backed system — **DEV-only, proven locally, not
deployed to any production database, and has not yet touched any real
SVMI data.**

## Repository map — three projects, only two of them SVMI

| Directory | What it is | Status |
|---|---|---|
| `SVMI_Project/` | The live Apps Script application (`Apps Script/*.gs` + `SVMI_PORTAL.html`), its test suite, and `DEPLOY.md` | **Live** — this is what a real deployment runs |
| `database/` | The PostgreSQL target schema, migrations, rollback scripts, and Phase 2 real-data migration dry-run tooling | **DEV-only** — schema proven locally; no PROD instance exists; dry-run tooling built and unit-tested against synthetic data, paused pending a real data export from the project owner |
| `TLM_Project/` | **A completely different, unrelated Apps Script project** ("Team Leader Monitoring" / "TL Tracker") that happens to live in the same repo | Not part of SVMI. Do not conflate its files, README, or history with SVMI's. |

Everything else in this file, and in the sibling docs listed below, is
about `SVMI_Project/` and `database/` only.

## Where to look for what

| Question | Read |
|---|---|
| What does the system do, and for whom? | `REQUIREMENTS.md` |
| How is it built, end to end? | `ARCHITECTURE.md` |
| What data exists and where does it live? | `DATA_MODEL.md` |
| Why was it built this way — what's settled and must not be re-opened? | `DECISIONS.md` |
| What has actually been done, in order? | `IMPLEMENTATION_LOG.md` |
| What's been tested, and what passed? | `TESTING_LOG.md` |
| Where do things stand right now, and what's next? | `PROJECT_STATUS.md` |
| Deep operational detail (deploy steps, exact phase-by-phase design rationale, access-control setup) | `SVMI_Project/DEPLOY.md` — long-form, still authoritative for *how to deploy* and for the detailed reasoning behind each phase; the files above summarize it, they don't replace it |
| Exact PostgreSQL schema/mapping/environment rules | `database/docs/01-architecture.md` through `06-migration-source-manifest.md` |
| Review history | `reviews/` |

## The two-track architecture, in one paragraph

The live system runs entirely inside a Google Sheet via Apps Script:
`MASTER_LOG` is the permanent, append-only record of every visit ever
submitted; `SETTINGS` used to be the only place Stores/Visitors/Purposes
were configured, but as of Phase 1G that is no longer true (see
`DECISIONS.md` D-005/D-006) — Admin → Configuration, backed by versioned
`CONFIG_*` sheets with effective dates and an audit log, is now the sole
authoritative source for those three, and `SETTINGS` is kept as a
generated, read-only-in-practice mirror for the handful of report sheets
that still read it directly. The `database/` track is a from-scratch
PostgreSQL redesign of the same model (versioning envelope, audit log,
report snapshots) that has been schema-proven and tooling-proven in DEV
but never run against real production data and never deployed anywhere
the live app actually uses.

## Durable identity rules (do not re-derive or re-litigate — see DECISIONS.md)

- **Store identity = Location + Brand.** The same physical location
  hosting two brands is two Stores. Confirmed against real data during the
  Phase 2A dry run.
- **Visitor and Purpose identity = normalized name** (interim scheme; no
  immutable ID exists for either yet, unlike Store ID).
- **A purpose with no deliberate KPI/Risk configuration never inherits
  another purpose's weight** — includes CAPAR, which has real historical
  usage but is currently `INACTIVE_NOT_SELECTABLE`.

## Current authoritative-path rule (Phase 1G)

**Admin → Configuration is the only place a Store, Visitor, or Purpose is
created, renamed, activated, or deactivated.** The "Store & Roster
Manager" tool that used to write directly to `SETTINGS` has been removed.
Do not recreate a second editing path for these three entities — see
`DECISIONS.md` D-005.
