# Review 001 — Workflow Documentation Compliance

**Type:** Documentation/workflow compliance review. **Not** an application-
code review — no `.gs`/`.html`/JS/CSS/schema/production-data changes were
made or evaluated for correctness here.

**Date:** 2026-09-23
**Standard:** *AI Web App Development Workflow, Version 2.0*
**Scope:** `SVMI_Project/` and `database/` (the two SVMI trees in this
repo — see `PROJECT_MEMORY.md` for why `TLM_Project/` is excluded).

## What was checked

Inspected the repository for every document category the workflow calls
for (`/docs/`, `PROJECT_MEMORY.md`, `PROJECT_STATUS.md`, `REQUIREMENTS.md`,
`ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md`, `IMPLEMENTATION_LOG.md`,
`TESTING_LOG.md`, `reviews/`, `CLAUDE.md`/equivalent, existing phase/review
records) before creating anything, per Step 1's instruction not to assume
absence.

## Findings — before this pass

- **None of the 8 named documents existed.** No `PROJECT_MEMORY.md`,
  `PROJECT_STATUS.md`, `REQUIREMENTS.md`, `ARCHITECTURE.md`,
  `DATA_MODEL.md`, `DECISIONS.md`, `IMPLEMENTATION_LOG.md`,
  `TESTING_LOG.md`, or `reviews/` anywhere in the repo.
- **No `CLAUDE.md` or equivalent AI-operating-instructions file** exists
  anywhere in the repo.
- **Equivalent information existed, but scattered and undifferentiated**:
  `SVMI_Project/DEPLOY.md` (109 KB) already functions as a hybrid
  deploy-guide + phase-by-phase implementation/testing log; `database/docs/`
  (6 files) already covers Postgres architecture, data inventory,
  migration mapping, backup/restore, environments, and source manifest in
  reasonable Workflow-2.0-adjacent shape; `database/dryrun/README.md`
  documents the Phase 2 reconciliation tooling and its business
  decisions in narrative form. None of this was duplicated wholesale —
  the new top-level docs summarize and point into it (see "Files created"
  in the top-level report).
- **A prior AI session could not have started from the repo documentation
  alone** — the durable decisions (Store identity = Location + Brand,
  SETTINGS's post-Phase-1G status, CAPAR's operational status, etc.) only
  existed as prose buried inside `DEPLOY.md`/`database/dryrun/README.md`,
  with no single current-status or decision-log entry point.

## Documentation now present

All 8 named documents created at the repo root, plus
`reviews/001-workflow-documentation-compliance.md` (this file). See the
top-level task report for the exact file list.

## Missing/uncertain information that could not be verified

- **No original requirements document was found anywhere in the repo or
  its history.** `REQUIREMENTS.md` is explicitly labeled as reconstructed
  from implementation evidence, not a rediscovered original — this should
  be confirmed with the project owner if a formal spec exists elsewhere.
- **The exact current list of admin emails and the current guest password
  value** are live spreadsheet data (`SETTINGS!G`/`!I`) — not readable from
  this repository, and correctly not recorded anywhere in these docs.
- **Whether a persistent (non-ephemeral) DEV Postgres instance now exists**
  outside this session's own local proof — `database/docs/05-environments.md`
  says standing one up was left to "the next owner"; not confirmable from
  the repo alone.
- **The exact current production Apps Script deployment state** (which
  version is actually live at the `/exec` URL) — not derivable from the
  repo; `DEPLOY.md` documents the process but not a live deployment log.

## Documentation inconsistencies discovered (not corrected — outside the 8-file scope)

- `SVMI_Project/DEPLOY.md`'s "Store & Roster Manager" section describes a
  tool that no longer exists as of Phase 1G (superseded by `DECISIONS.md`
  D-005). Left unedited — noted in `IMPLEMENTATION_LOG.md` instead.
- `SVMI_Project/README.txt` says "10 .gs files"; there are 24. Left
  unedited for the same reason.
- `database/dryrun/README.md` cites "37/37" for `dryrun.test.js`; a direct
  run today shows 158/158 (the file's own test count grew across later
  phases the README text wasn't updated to reflect). Recorded correctly in
  `TESTING_LOG.md`; the README itself left unedited (not one of the 8
  named documents).

## Recommended next repository task

Per `PROJECT_STATUS.md`: after this checkpoint is reviewed and accepted,
the next *implementation* phase, in dependency order, is:
1. Admin Configuration screen for admin access (guest password + admin
   email list) — `DECISIONS.md` D-007.
2. Admin-configurable Approved Regions/Categories (Brand deferred until
   Executive Summary's fixed-layout coupling is addressed) — D-013.
3. Fix the Brand-dropdown/Region-dropdown sourcing inconsistency in the
   Admin Store form.
4. Wire `CONFIG_KPI` into an actual KPI calculation, or explicitly mark it
   deferred rather than half-built.
5. Resolve or remove `CONFIG_RISK`'s dead Low Threshold field.

This review does not implement any of the above.
