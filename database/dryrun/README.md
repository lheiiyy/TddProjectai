# Database Phase 2 — Real-Data Migration Dry Run (tooling)

Status as of this commit: **analysis/reconciliation modules built and unit-
tested against synthetic inputs; NOT YET RUN against real spreadsheet
data.** See `database/docs/07-phase2-realdata-dryrun-report.md` (created
once a real run happens) for actual findings.

## Why this phase is paused on input, not logic

Phase 2 requires the ACTUAL SVMI spreadsheet data. This environment has a
live, authenticated `clasp` OAuth credential bound to the real production
Apps Script project, but:

- clasp's OAuth scopes do not grant direct Sheets API read access to cell
  values (its scopes cover script deployment/management, not spreadsheet
  data).
- The only way to pull real data with what's available would be to push a
  temporary export function to the LIVE production script and run it — a
  real (even if reverted) change to a production system.

Given the choice, the decision was: **the real export/CSV comes from the
user directly** — this environment never touches the live script or the
OAuth credential for data extraction. See the chat for the exact request.
Real extracted data and anything derived from it (raw artifacts,
quarantine lists, reconciliation reports with real names) stay **local/
ephemeral only** (this session used `/tmp/svmi_phase2_realdata/`, outside
the git working tree) and are never committed — only this
logic/tooling/docs layer, which contains zero real data, is committed.

## What's built (pure functions, unit-tested — `dryrun.test.js`, 37/37)

| Module | Purpose | Phase 2 rule |
|---|---|---|
| `date_parse.js` | Faithful JS port of `_parseDateCell()` (SVMKPI_CORE.gs) | #10, #5 |
| `quarantine.js` | Shared quarantine-entry collector, typed resolution categories | #4 |
| `masterlog_integrity.js` | The full MASTER_LOG integrity report (counts, malformed dates, duplicate candidates, visitor/purpose problems) | #9 |
| `reconcile_stores.js` | Exact-match-only store identity reconciliation | #6 |
| `reconcile_visitors.js` | Exact-match-only visitor identity reconciliation | #7 |
| `reconcile_purposes.js` | Purpose classification (legacy/configured/unknown/pre-configuration usage) | #8 |
| `reporting_year_check.js` | Reproduces `_ry_extractYearsFromLog()`'s exact algorithm + a source-vs-Postgres comparator | #10 |
| `config_overlap_check.js` | Generic effective-dated overlap/gap/duplicate detector, works across all 7 config areas | #12 |
| `snapshot_validation.js` | REPORT_SNAPSHOTS structural integrity (uniqueness, supersession chain validity, frozen-result presence) | #13 |

Each module is a pure function of its input — no filesystem, no network,
no database — so it was fully testable BEFORE any real data existed, and
needs no changes once real data arrives; only a reader that turns the real
export into the same input shape is still needed (see below).

## What's still needed once real data is available

1. **A reader** turning whatever file the user provides (CSV per sheet, or
   a single multi-sheet export) into the raw row shapes these modules
   consume — not yet written, since the exact format depends on what's
   provided.
2. **`raw_capture.js`** — writes the immutable raw-extraction artifact
   (rule #4) with run metadata (timestamp, run ID, sheet names/dimensions,
   row counts) to the local ephemeral run directory.
3. **`run_dry_run.js`** — orchestrates: raw capture → build the
   intermediate shape → run every module above → write
   quarantine/reconciliation reports → load into a FRESH isolated DEV
   PostgreSQL database (reusing `database/import/load.js`'s proven
   TRUNCATE/INSERT approach and `create_roles.sql`/`harden_grants.sql`) →
   count/content reconciliation → idempotency re-run → permission
   re-verification.
4. Business-logic parity checks (rule #19) and the final structured
   completion report (rule #25), both of which need real numbers to be
   honest rather than illustrative.
