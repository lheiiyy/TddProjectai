# SVMI — Implementation Log

Chronological summary. Full design rationale for each phase lives in
`SVMI_Project/DEPLOY.md`'s own per-phase sections and `database/dryrun/README.md`;
this file is the durable index, not a replacement. Commit hashes are from
`git log` on this branch's history.

## Apps Script track (`SVMI_Project/`)

| Date | Commit | Phase | Summary |
|---|---|---|---|
| 2026-09-16 | `8b29274` | — | Store & Roster Manager added to System Tools (direct-to-SETTINGS editor — later removed, see Phase 1G) |
| 2026-09-18 | `4432660` | Phase 0 | Hardening ahead of configuration-driven administration |
| 2026-09-18 | `5023fe0` | Phase 0.5 | Closed Phase 0's own verification gaps |
| 2026-09-18 | `720809d` | Phase 1A | Configuration data model, versioning, and audit foundation (`SVMKPI_CONFIG.gs`) — purely additive infrastructure, nothing wired to it yet |
| 2026-09-18 | `931d6b3` | Phase 1B | Immutable Store ID identity + historical store-attribute resolution; SETTINGS→Store-ID migration tooling built (not yet wired to a UI) |
| 2026-09-18 | `1fe5784` | Phase 1C | Reporting-year abstraction — year-neutral KPI/report APIs, removed manual annual rollover (D-008) |
| 2026-09-18 | `ac12efa` | Phase 1D | Versioned Risk + Compliance + KPI configuration + calendar cadence |
| 2026-09-18 | `cb973a8` | Phase 1E | Historical report snapshots + per-year report sheets |
| 2026-09-18 | `f09d317` | Phase 1E (fix) | Freeze Executive Summary/KPI in every snapshot (completeness fix) |
| 2026-09-19 | `398c2e5` | Phase 1F | Snapshot and Configuration Administration UI (the Admin tab) |
| 2026-09-19 | `51b9163`–`9adff00` | Phase 2A/2A.2–2A.5 | Canonical Store/Visitor identity reconciliation tooling; **Store identity = Location + Brand confirmed against real data (D-001)**; administrative-confirmation discipline established (D-012) — *this is `database/dryrun/` tooling, not an Apps Script change* |
| 2026-09-19 | `a12820a`–`ed646c3` | Phase 2C | Purpose operational readiness (CAPAR → inactive-not-selectable, D-004); Executive Summary + Store Insights made purpose-dynamic; Purpose Breakdown's old top-4 limit removed |
| 2026-09-19/23 | (this session) | Phase 1G | Removed "Store & Roster Manager"; Admin → Configuration made the sole authoritative path for Stores/Visitors/Purposes; `SVMKPI_VISITOR_CONFIG.gs` and `SVMKPI_SETTINGS_MIGRATION.gs` added; `_cfg_syncLegacyMirror()` keeps `SETTINGS` A–E/F/H in sync; `getSidebarData()` reads `CONFIG_*` directly; Admin Configuration UI gained per-field explanations and guided Store dropdowns (see `DECISIONS.md` D-005/D-006) |
| 2026-09-23 | (this session) | Audit | Read-only System Peripherals architectural audit — findings recorded in `PROJECT_STATUS.md` and `reviews/` |

**The application itself has not changed since Phase 1G.** The three
rows above (Audit onward) and the Documentation track below are all
documentation-only work — no `.gs`/`.html` file was touched by any of them.

## Documentation track (spans `SVMI_Project/`, `database/`, and the repo root)

| Date | Commit | Pass | Summary |
|---|---|---|---|
| 2026-09-23 | `a84074b` | Documentation foundation | Created the 8 root docs (`PROJECT_MEMORY.md` through `TESTING_LOG.md`) and `reviews/001-workflow-documentation-compliance.md` — none existed before. Flagged, but did not fix, staleness in `SVMI_Project/DEPLOY.md`, `SVMI_Project/README.txt`, and `database/dryrun/README.md`. |
| 2026-09-23 | `f96b2d8` | Documentation reconciliation | Created `CLAUDE.md`; established the Documentation Authority Model in `PROJECT_MEMORY.md`; **fixed** the three files pass 1 had only flagged — added historical/superseded banners to `SVMI_Project/DEPLOY.md`'s Store & Roster Manager/Navigation/Admin-list sections, corrected `SVMI_Project/README.txt`'s file count and tab description, corrected `database/dryrun/README.md`'s test count. |
| 2026-09-24 | (this session) | Workflow-readiness gap-fix | A follow-up readiness audit found this file's own "What is superseded" section (since retitled "Legacy-documentation staleness — found, then resolved," below) and `PROJECT_STATUS.md` had not been updated after pass 2 landed, so both still claimed the pass-1 files were "not corrected" — a real conflicting-source-of-truth defect. Corrected both, and added `reviews/002-documentation-reconciliation.md` (the review artifact pass 2 should have produced). |

## Database track (`database/`)

| Date | Commit | Summary |
|---|---|---|
| 2026-09-19 | `95fa4e5` | PostgreSQL DEV schema + migration/rollback scripts, proven against a local ephemeral instance |
| 2026-09-19 | `e1a81ca` | Phase 2 dry-run tooling scaffolding (pure functions, synthetic data, no live database) |
| 2026-09-19 | `51b9163`–`278d44a` | Phase 2A/2A.2 — canonical Store/Visitor identity + the Location+Brand rule (D-001) |
| 2026-09-19 | `eb8ba93`–`82af2b1` | Phase 2A.3–2A.5 — EXISTING/NEW/HUMAN_REVIEW classification, operational status, administratively-confirmed merges |
| 2026-09-19 | `f7cb12d` | Visitor identity reconciliation, mirroring the Store pattern |
| 2026-09-19 | `9adff00`–`ed646c3` | Cross-source Purpose reconciliation (CAPAR) + operational readiness |

**Status: paused.** The dry-run tooling is complete and unit-tested
against synthetic data; it has not been run against real SVMI data, and
no production Postgres instance exists (D-011). Next step on this track
is a real data export from the project owner — not something an AI
session should attempt to obtain itself.

## Legacy-documentation staleness — found, then resolved

Both items below were **found** during the Documentation foundation pass
(`a84074b`) and **fixed** during the Documentation reconciliation pass
(`f96b2d8`), two separate commits — see the Documentation track table
above. Current state (verified, not carried over from either pass's own
notes):

- `SVMI_Project/DEPLOY.md`'s "Store & Roster Manager" section described a
  tool that no longer exists as of Phase 1G (superseded by `DECISIONS.md`
  D-005). It now carries an explicit `⚠ HISTORICAL — NO LONGER CURRENT`
  banner pointing to `DECISIONS.md` D-005/D-006 and `ARCHITECTURE.md` §5;
  the section's rationale is preserved underneath the banner, not deleted.
  The same pass added equivalent correction banners to that file's
  Navigation and Admin-list sections, which had the same problem.
- `SVMI_Project/README.txt` said "10 .gs files"; there are 24 as of
  Phase 1G. It now states 24, with a note explaining the correction, and
  points to `ARCHITECTURE.md` §4 instead of re-listing every file.

`database/dryrun/README.md`'s stale "37/37" test-count claim (found in
the same first pass, not listed above since it isn't an Apps Script doc)
was corrected the same way in `f96b2d8` — see `TESTING_LOG.md` for the
current, verified count (158/158) rather than trusting any one doc's own
inline figure.
