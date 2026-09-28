# REVIEW-001 — SVMI Fix Checklist / Implementation Backlog

**Type:** Checklist / audit only — no production code, architecture, or requirements were modified while producing this document.
**Repository:** `lheiiyy/TddProjectai` (remote confirmed via `.git/config`: `https://github.com/lheiiyy/TddProjectai`, branch `main`).
**Scope:** `SVMI_Project/` (Google Apps Script application).
**Status of this document:** created, **not committed**. Awaiting explicit instruction to commit/push per this repo's controlled-PR workflow.

---

## A. Repository Identity Verification

```
Repository:    lheiiyy/TddProjectai (origin, confirmed via .git/config)
SVMI identity: CONFIRMED — SVMI_Project/ contains the full SVMKPI_*.gs module set
               (SVMKPI_CORE, SVMKPI_ACCESS, SVMKPI_ADMIN, SVMKPI_ADMIN_API,
               SVMKPI_CALENDAR, SVMKPI_COMPLIANCE_CONFIG, SVMKPI_CONFIG,
               SVMKPI_KPI_CONFIG, SVMKPI_KPI_REBUILD, SVMKPI_LAYOUT,
               SVMKPI_MASTER_REBUILD, SVMKPI_PURPOSE_CONFIG,
               SVMKPI_REPORTING_YEAR, SVMKPI_REPORTS, SVMKPI_REPORT_SNAPSHOT,
               SVMKPI_RISK, SVMKPI_RISK_CONFIG, SVMKPI_RISK_LAYOUT,
               SVMKPI_STORE_CONFIG, SVMKPI_STORE_LOOKUP, SVMKPI_STORE_MASTER),
               plus INPUT_PORTAL.gs, SVMI_PORTAL.html (production Web App UI),
               SVMI_LOCK.html, appsscript.json, and SVMI_Project/DEPLOY.md
               (the project's real, detailed build/design log).
Identity gate: PASS
```

**Important sub-finding (governance, not identity):** the workflow this task specifies begins with "Read `PROJECT_STATUS.md`, `PROJECT_MEMORY.md`, then `REQUIREMENTS.md`/`ARCHITECTURE.md`/`DATA_MODEL.md`/`DECISIONS.md`/`IMPLEMENTATION_LOG.md`/`TESTING_LOG.md`/`reviews/*`." A repository-wide search confirms **none of these files or the `reviews/` directory exist anywhere in this repository** (this document creates `reviews/` for the first time). This is recorded as **FIX-031** below rather than silently worked around — see that row for why it matters and what it blocks. The only pre-existing real documentation is `SVMI_Project/DEPLOY.md` (a detailed, largely accurate chronological build log — see prior repository review) and `database/docs/*.md`. This checklist was therefore built from **direct code inspection plus `DEPLOY.md`**, cross-checked against the user acceptance findings supplied for this task, exactly as instructed ("also inspect the actual current code; do not rely only on previous AI conversation summaries").

---

## B. Current State Summary

**Verified by user UAT and consistent with repository evidence:**
- Main portal/dashboard, Store Visit data-entry, and Visitor-in-input all match working, wired code paths (`INPUT_PORTAL.gs`, `SVMKPI_STORE_LOOKUP.gs`).
- "Additional Purpose" visible in Visit Purpose Breakdown is consistent with the Purpose Config system (`SVMKPI_PURPOSE_CONFIG.gs`) being genuinely wired into the Executive Summary's "Visit Purpose Breakdown" card (`SVMI_PORTAL.html:2342`, `SVMKPI_LAYOUT.gs:325`).

**Verified by user UAT but NOT independently confirmable from repository evidence, or in tension with it — flagged for reconciliation, not assumed correct:**
- **"Unmapped Store workflow is currently marked verified"** — repository evidence shows `store_getUnmappedStores()`/`store_reconcileUnmapped()` (`SVMKPI_STORE_CONFIG.gs:341,378`) are fully implemented **server-side** but **no UI surface for them exists anywhere in `SVMI_PORTAL.html`** (confirmed by an exhaustive call-site search — see FIX-002/FIX-014). This needs reconciliation: either the deployed app ("v19") differs from this repository checkout, or "verified" refers to something other than an end-user UI workflow (e.g., a backend/sheet-level check). Given this workflow's own premise that "the repository is the persistent source of truth," this discrepancy is treated as the single highest-priority open question in this checklist.
- **"Security testing performed by the user is currently marked verified"** — a prior full repository security review (this session, prior turn) found a concrete, code-evidenced authorization gap (admin-only sheet-rebuild functions reachable directly via `google.script.run`, bypassing `sl_isAdmin()` — see FIX-001). A manual UI-driven security pass is unlikely to have exercised a direct browser-console RPC call, so this is flagged for scope clarification (FIX-004), not treated as contradicting the user's finding.

**Not yet verified (per this task's own acceptance findings):** login/auth full acceptance, existing-function regression testing, overall business acceptance, pilot validation — all still open/ongoing. No repository evidence changes this; it is orthogonal to code inspection.

**Confirmed requirement clarifications needed before implementation (not yet actioned, per this task's "checklist only" scope):**
- "Visit Detail Records" does not exist as a literally-named feature anywhere in the codebase. The closest candidate is the Store Insights profile's "🕒 Recent Visits" per-visit table (`SVMI_PORTAL.html:1839`, `sl_getStoreData().recentVisits`, `SVMKPI_STORE_LOOKUP.gs:143,223,248`) — see FIX-006.
- "Visitor... not visible in the report" is in tension with the fact that Visitor already appears in the Executive Summary's "Visitor Leaderboard (YTD)" section (`SVMI_PORTAL.html` `renderExecutiveSummaryReport`/`getExecutiveSummaryReport()` in `SVMKPI_REPORTS.gs`) — see FIX-005 for which specific report/table is actually meant.

---

## C. Master Fix Checklist

| ID | Priority | Category | Finding / Fix Needed | Evidence | Required Action | Dependencies | Verification Needed | Status |
|---|---|---|---|---|---|---|---|---|
| FIX-001 | P0 | Security | Admin-only sheet/report rebuild functions (`refreshRiskEngine`, `buildExecutiveSummaryLayout`, `rebuildStoreMasterInsight`, `rebuildMasterLogHeaders`, `rebuildSettingsHeaders`, `rebuildDataSheetHeaders`, `regenerateReportSheet`) have no `sl_isAdmin()` check of their own — only their `portal_*` wrapper does | `SVMKPI_ADMIN.gs:180-183,225-238,165-179`; `SVMKPI_RISK.gs:613-627`; `SVMKPI_STORE_MASTER.gs:60`; `SVMKPI_LAYOUT.gs:86-133`; `SVMKPI_REPORT_SNAPSHOT.gs:764-831` (no wrapper at all) | Add `if (!sl_isAdmin()) return {...}` as the first line of each named function | None | Confirm fix does not break the legitimate wrapper→worker call path (wrapper already checked; double-check is safe/idempotent) | READY FOR IMPLEMENTATION |
| FIX-002 | P0 | Functional / Governance | "Unmapped Store workflow currently marked verified" conflicts with repository evidence of no such UI anywhere in `SVMI_PORTAL.html` | `SVMKPI_STORE_CONFIG.gs:341,378` (backend exists); exhaustive `SVMI_PORTAL.html` call-site search (no "Unmapped" string, no call to either function) | Reconcile: confirm which deployed version ("v19") was tested, and whether "verified" meant the UI workflow or a backend/sheet-level check | None (informational) | User/ChatGPT confirmation of what was actually tested and on which deployment | NEEDS VERIFICATION |
| FIX-003 | P1 | Security / Deployment | `doGet`/`_handleWebAppRequest_` have no top-level error handling — any exception while serving the page (e.g. `SpreadsheetApp.getActiveSpreadsheet()` failing for a user with no Sheet access) produces a raw, unhandled Apps Script error page | `SVMKPI_ADMIN.gs:86-91`; `SVMKPI_ACCESS.gs:128-146` (no try/catch anywhere in this path, unlike every RPC function in the project) | Wrap `_handleWebAppRequest_` in try/catch and serve a friendly HTML error page on failure | None | Confirm this is compatible with `HtmlService` error-page constraints (Apps Script limits what can be returned from a thrown `doGet`) | READY FOR IMPLEMENTATION |
| FIX-004 | P1 | Security / Process | "Security testing performed by user marked verified" needs scope clarification against FIX-001's code-level finding (unlikely to have been exercised by manual UI testing) | See FIX-001 evidence | Clarify UAT security-test scope; re-verify FIX-001 is fixed and retested after implementation | FIX-001 | Confirmation of what the user's security pass actually covered | NEEDS VERIFICATION |
| FIX-005 | P2 | Functional / Reports | "Visitor not visible in the report" is in tension with Visitor already appearing in Executive Summary's "Visitor Leaderboard (YTD)" | `SVMI_PORTAL.html:2354-2357` (`renderExecutiveSummaryReport`); `SVMKPI_REPORTS.gs:47+` (`getExecutiveSummaryReport`) | Clarify which specific report/screen the user means (Leaderboard already exists; may mean Store Health, Compliance Gaps, or a detail table instead) | None | User/ChatGPT confirmation of the exact report/screen in question | NEEDS VERIFICATION |
| FIX-006 | P1 | Functional / Reports | "Visit Detail Records" does not exist under that name; most likely candidate is Store Insights' "Recent Visits" per-visit table | `SVMI_PORTAL.html:1839`; `SVMKPI_STORE_LOOKUP.gs:143,223,248` (`recentVisits`) | Confirm exact UI element(s) meant before any removal; confirm underlying `MASTER_LOG` fields/columns are NOT to be removed, only the presentation | None | User/ChatGPT confirmation of scope; explicit list of what must be preserved for future reports/migration | NEEDS VERIFICATION |
| FIX-007 | P2 | Testing | No automated test exists specifically proving a 5th+ ("Additional") admin-created Purpose flows correctly into the Visit Purpose Breakdown report, though user has manually verified it | `SVMI_Project/tests/kpi-purpose-config.test.js` covers KPI-purpose linkage, not the Purpose Breakdown report render path | Add a regression test covering: `purpose_create()` → visit submission with new purpose → `getExecutiveSummaryReport()`'s purpose breakdown | None | None | READY FOR IMPLEMENTATION |
| FIX-008 | FUTURE | Data / Architecture | Dual store-identity model (Store ID for migrated stores, Store Name fallback for legacy/unmigrated `MASTER_LOG` rows) is permanent unless a full backfill runs | `INPUT_PORTAL.gs:29-34` (`MASTER_LOG` col I comment); `SVMKPI_STORE_CONFIG.gs` (`store_resolveIdByCurrentName` fallback) | Document current migration completion %; plan backfill before DB migration | None | Confirm current % of `MASTER_LOG` rows with a populated Store ID | FUTURE |
| FIX-009 | FUTURE | Data | Visitor/Purpose identity is name-based (no case/whitespace normalization); "LEO" vs "Leo" can silently diverge | `SVMKPI_CONFIG.gs:57-64` (self-disclosed); `INPUT_PORTAL.gs` `manageVisitor()`/`managePurpose()` (no normalization beyond `.trim().toUpperCase()`, which does not catch all variants) | Design an immutable Visitor/Purpose ID scheme (mirroring Store ID's Phase 1B pattern) before DB migration | FIX-008 pattern reuse | None | FUTURE |
| FIX-010 | P1 | Functional / Reports / Data | Inconsistent inactive-store handling: Store Health includes a store removed from `SETTINGS` (via `MASTER_LOG` fallback); Compliance Gaps silently excludes the same store | `SVMKPI_RISK.gs:402-409,421` (fallback exists); `SVMKPI_STORE_LOOKUP.gs:798-809,829` (`sl_getComplianceGaps` — no fallback, explicit skip) | Decide the intended behavior (should an inactive store's history still count toward Compliance Gaps?), then align both functions to the same rule | None | Product decision on intended behavior for inactive/removed stores | OPEN |
| FIX-011 | FUTURE | Architecture | No service/repository abstraction between business logic and `SpreadsheetApp` calls — every report/lookup function calls Sheets APIs inline | Pervasive across `SVMKPI_STORE_LOOKUP.gs`, `SVMKPI_RISK.gs`, `SVMKPI_REPORTS.gs`, etc. | Design a thin data-access layer boundary before REST/DB migration work begins, so the migration doesn't require touching every calling function | None | Architecture decision (ChatGPT/governance) | FUTURE |
| FIX-012 | FUTURE | Architecture / Data | Postgres `store_versions.brand` has no constraint enforcing brand continuity per Store ID, undermining the documented "Location+Brand = Store identity" rule ahead of migration | `database/migrations/003_stores.sql:9-20`; `database/dryrun/store_canonical_identity.js:84-86` (identity computed only offline) | Add a constraint/trigger before any real migration; out of scope for this pilot | None | None | FUTURE |
| FIX-013 | P2 | Functional / Architecture | `CONFIG_KPI` (targets/weights) is configuration-only with no runtime consumer — an admin can configure it and see no effect | `SVMKPI_KPI_CONFIG.gs:11-21` (self-disclosed in code) | Decide: wire it into a real KPI calculation, or label/hide it as "not yet active" in the Admin UI | None | Product decision on whether KPI scoring is a near-term requirement | OPEN |
| FIX-014 | P1 | Functional | `store_getUnmappedStores()`/`store_reconcileUnmapped()` are fully implemented server-side with no Admin UI anywhere to use them | `SVMKPI_STORE_CONFIG.gs:341,378`; no "Unmapped" UI element in `SVMI_PORTAL.html` | Build the missing Admin UI panel — pending FIX-002's reconciliation outcome | FIX-002 | Confirm FIX-002's outcome first (avoid duplicate/redundant build if a different deployed version already has this) | OPEN |
| FIX-015 | P1 | Functional / Reports | Reports tab (Executive Summary/KPI/Store Health) has no year selector; backend fully supports a `year` parameter on every report function | `SVMI_PORTAL.html:2292-2303` (`loadCurrentReport()` calls all three report functions with zero args); `SVMKPI_REPORTING_YEAR.gs` (`getAvailableReportingYears()` already exists and is used elsewhere, e.g. the admin Report Snapshot panel at `SVMI_PORTAL.html:3283-3291`) | Add a year `<select>` to the Reports tab, wired to the existing backend functions | None | UI/UX decision on placement and default behavior | OPEN |
| FIX-016 | P3 | Reports / UI cleanup | Backend returns fields the UI never renders (`getStoreHealthReport()`'s `storeYtd`/`failedCount`/`curingCount`; `sl_getStoreData()`'s `health.components.daysSince`) | `SVMKPI_REPORTS.gs:203-206`; `SVMI_PORTAL.html:2417-2448` (`HEALTH_COLS`/`healthRenderRow`); `SVMKPI_STORE_LOOKUP.gs:302-304` vs. `SVMI_PORTAL.html:2762-2767` (`renderHealth`) | Either display the fields or stop computing/returning them | None | Confirm none of these fields are needed for a near-term report enhancement first | DEFERRED |
| FIX-017 | P3 | UI / Cosmetic | UI labels ("KPI 2026", "Rebuild KPI 2026") are permanently hardcoded regardless of actual reporting year in use; already disclosed as deliberate in `DEPLOY.md` | `SVMI_PORTAL.html:725,783-788,2475,2493-2494` | Reword labels to be year-neutral whenever convenient | None | None | DEFERRED |
| FIX-018 | P1 | Performance | Full `MASTER_LOG`/`SETTINGS` scans repeated on every RPC call with no caching — `checkDuplicateVisit`/`_findRecordedVisitors` scan the whole sheet on every single visit submission (twice) | `INPUT_PORTAL.gs:391-435,350-377` | Design a scoped/indexed lookup (e.g. by date range or a maintained per-store index) instead of a full-width full-height scan on every call | None | Confirm current `MASTER_LOG` row count to size the urgency | OPEN |
| FIX-019 | P1 | Performance | Initial page load fires ~5 concurrent `google.script.run` calls (`loadSIStores`, `loadCurrentUser`, `loadAdminStatus`, `loadDataYear`, `loadCurrentReport`), each a separate Apps Script execution, plus the default landing Reports tab immediately triggers a full `MASTER_LOG` scan | `SVMI_PORTAL.html:1040-1049` (`window.onload`-style init sequence) | Evaluate consolidating some of these into fewer RPC round-trips, or deferring non-critical ones (e.g. admin-status check) until after first paint | FIX-018 (shares root cause) | Measure actual load-time contribution of each call before optimizing | OPEN |
| FIX-020 | P1 | Performance / Concurrency | Lock hold time in `processSubmissionAsync` scales with `MASTER_LOG` size (full scan happens inside the `LockService` critical section), increasing "Server is busy" collisions as data grows | `INPUT_PORTAL.gs:261-314` | Same fix as FIX-018 — narrowing the in-lock scan directly reduces lock hold time | FIX-018 | None | OPEN |
| FIX-021 | P2 | Performance | `SVMI_PORTAL.html` is a single ~3,487-line HTML/CSS/JS payload with no evidenced code-splitting/minification | `SVMI_Project/Apps Script/SVMI_PORTAL.html` (full file) | Evaluate payload size impact on initial load; consider minification if load time is confirmed dominated by transfer/parse time | FIX-019 (measure together) | Actual load-time profiling data | DEFERRED |
| FIX-022 | P2 | Performance | KPI rebuild writes native Sheets `SUMPRODUCT` formulas over a 200,000-row range per visitor/week/month cell — a Sheets-recalculation cost that grows with visitor count × data volume | `SVMKPI_KPI_REBUILD.gs:115-127` (`_visitorWeekFormula`, `MASTER_LOG_MAX_ROW`) | Monitor; consider script-computed values (as Store Health already does) if this becomes noticeably slow | None | Current visitor count and row count | DEFERRED |
| FIX-023 | P1 | Security / Deployment | Colleague access error — root cause not confirmed; strongest evidenced candidate is the `executeAs:"USER_ACCESSING"` sharing requirement | `SVMKPI_ACCESS.gs:76-79` (own comment: a user with no Sheet access gets calls that "fail with a permission error"); `DEPLOY.md:216-220` (documents this exact trade-off) | Confirm whether affected colleagues had been individually granted Viewer/Editor access to the underlying Google Sheet at the time of the error | FIX-003 (better error surfacing would make this diagnosable from the error message itself) | Actual error message/screenshot from an affected colleague | NEEDS VERIFICATION |
| FIX-024 | P2 | Security / Compatibility | Secondary candidate cause for colleague access error: Google blocks OAuth sign-in inside embedded in-app browsers (e.g. a chat app's built-in browser), which can produce a sign-in failure indistinguishable from other errors without the actual message | No direct repo evidence — general Google OAuth/Apps Script platform behavior; access model confirmed at `appsscript.json:6-9` (`access:"ANYONE"` requires real Google sign-in) | Ask affected colleagues how they opened the link (which app/browser) | None | Actual error message/screenshot; how the link was opened | NEEDS VERIFICATION |
| FIX-025 | P2 | Testing / Responsive | Automated responsive tests (`responsive-check.js`) only exercise the demo HTML, never the real production portal | `responsive-check.js:12` (loads `SVMI_Command_Center_Demo.html` only) | Add at minimum a responsive smoke test against the real `SVMI_PORTAL.html` | FIX-029 | None | OPEN |
| FIX-026 | P1 | Testing / Security | No test loads the real `SVMKPI_ACCESS.gs` (`sl_isAdmin`, guest-password gate) — every "security" test stubs `sl_isAdmin()` as a trivial boolean | Full test-file inventory of `SVMI_Project/tests/*.test.js` (prior session audit) | Add a test that loads the real `SVMKPI_ACCESS.gs` against a mocked `Session`/`SETTINGS` sheet | None | None | READY FOR IMPLEMENTATION |
| FIX-027 | P1 | Testing | No CI exists; correctness depends on a human manually running ~20 `node` test commands before every push | Repo-wide search: no `.github/`, no `package.json`, no CI config anywhere; `DEPLOY.md`'s own manual "Checks before you push" checklist | Add a minimal CI job running the existing `tests/*.test.js` files as-is (no new framework needed) | None | None | READY FOR IMPLEMENTATION |
| FIX-028 | P1 | Testing | No automated test coverage of the real production `SVMI_PORTAL.html` at all — the only Playwright tests load the demo file | `SVMI_Project/tests/portal-ui.test.js:12` (loads `SVMI_Command_Center_Demo.html`) | Add Playwright coverage against the real portal (requires handling the guest-password gate in the test harness) | FIX-003, FIX-026 | Decide how tests authenticate past the guest-password/Google sign-in gate in CI | OPEN |
| FIX-029 | FUTURE | Testing / DB migration prep | `database/dryrun/*.js` reconciliation logic is an independently-maintained reimplementation of production `.gs` logic with no automated cross-check for drift (e.g. `date_parse.js` hardcodes a timezone rather than reading it dynamically) | `database/dryrun/date_parse.js` vs. `SVMKPI_CORE.gs:316-331` (`_parseDateCell`) | Add a cross-check test before this tooling is trusted for a real migration | None | None | FUTURE |
| FIX-030 | P1 | Documentation / Governance | `PROJECT_STATUS.md`, `PROJECT_MEMORY.md`, `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md`, `IMPLEMENTATION_LOG.md`, `TESTING_LOG.md`, and `reviews/` did not exist anywhere in this repository prior to this document | Repo-wide glob search (this session) | Decide where/how these should be established and maintained going forward, consistent with the ChatGPT/Claude Code role split this workflow defines | None | Governance decision (ChatGPT) on document ownership and location | OPEN |
| FIX-031 | P3 | Documentation | `SVMI_Project/README.txt` describes a stale file layout (10 `.gs` files) vs. the 21 that currently exist | `SVMI_Project/README.txt:4-5` | Update file listing | None | None | READY FOR IMPLEMENTATION |
| FIX-032 | P2 | Documentation | `SVMKPI_ADMIN_API.gs`'s header comment falsely claims `store_getUnmappedStores()`, `store_reconcileUnmapped()`, `getReportSnapshotByVersion()`, `getLatestFinalizedReportSnapshot()` are called directly by `SVMI_PORTAL.html` — none are | `SVMKPI_ADMIN_API.gs:17-21`; confirmed false by exhaustive call-site search | Correct the comment to state these are implemented but not yet wired to the UI | None | None | READY FOR IMPLEMENTATION |
| FIX-033 | P2 | Architecture / Repo hygiene | `live-backup-20260916/` is a stale, materially **less secure** snapshot (no `sl_isAdmin()` checks at all, `access:"MYSELF"`/`executeAs:"USER_DEPLOYING"`, unconditional `DATA_YEAR=2026`) sitting alongside the real app, plus a dead scratch file (`Untitled.js`) | `SVMI_Project/live-backup-20260916/appsscript.json` vs. `SVMI_Project/Apps Script/appsscript.json`; `SVMKPI_ADMIN.js` (backup) vs. `SVMKPI_ADMIN.gs` (current) | Archive/rename/relocate to make its non-authoritative, superseded status unambiguous | None | Confirm nothing depends on this folder before relocating | OPEN |
| FIX-034 | P3 | Repo hygiene | `TLM_Project/` (an unrelated Apps Script app) shares this repository and reuses the sheet-tab name `MASTER_LOG`, raising cross-project confusion risk | `TLM_Project/Apps Script/Code.gs`; `TLM_Project/INSTALL.md` | Decide whether `TLM_Project` should remain in this repository | None | Governance decision — out of scope for SVMI implementation work | DEFERRED |

---

## D. Recommended Implementation Sequence

Only `OPEN`, `READY FOR IMPLEMENTATION`, and `NEEDS VERIFICATION` items are sequenced; `FUTURE` and `DEFERRED` items are intentionally excluded from near-term scheduling per their own definition.

```
1.  FIX-002   Reconcile "Unmapped Store workflow verified" claim (clarify before any related build work)
2.  FIX-032   Correct the false SVMKPI_ADMIN_API.gs header comment (trivial, independent)
3.  FIX-001   Close the admin-authorization bypass (P0 security, mechanical, no dependency)
4.  FIX-003   Add error handling to doGet/_handleWebAppRequest_ (supports diagnosing FIX-023)
5.  FIX-023   Verify colleague-access sharing-model hypothesis (cheap operational check)
6.  FIX-024   Ask affected colleagues how they opened the link (in parallel with #5)
7.  FIX-004   Reconcile "security testing verified" scope against FIX-001's fix
8.  FIX-026   Add a real sl_isAdmin() test
9.  FIX-027   Stand up CI running the existing test suite
10. FIX-010   Decide and align inactive-store handling (Store Health vs. Compliance Gaps)
11. FIX-006   Clarify "Visit Detail Records" scope (blocks any future removal work)
12. FIX-005   Clarify which report the "Visitor not visible" finding refers to
13. FIX-014   Build the Unmapped Store admin UI (pending FIX-002's outcome)
14. FIX-015   Add a year selector to the Reports tab
15. FIX-018   Reduce full-sheet-scan frequency in duplicate-check/report paths
16. FIX-020   (resolved as a consequence of FIX-018)
17. FIX-019   Reduce/parallelize initial-load RPC overhead
18. FIX-028   Add Playwright coverage of the real production portal
19. FIX-025   Add responsive coverage of the real production portal
20. FIX-013   Decide CONFIG_KPI's fate (wire up or clearly label inert)
21. FIX-007   Add an Additional-Purpose regression test
22. FIX-033   Archive/rename the stale, less-secure live-backup snapshot
23. FIX-030   Governance decision on establishing project-memory documentation
24. FIX-031   Update stale README.txt file listing
```

`FIX-008, FIX-009, FIX-011, FIX-012, FIX-016, FIX-017, FIX-021, FIX-022, FIX-029, FIX-034` remain FUTURE/DEFERRED and are not part of this sequence.

---

## E. PR Succession Rule (confirmed)

Per this repository's controlled-workflow requirement, each fix group above will produce its own independent cycle:

```
Selected FIX-### → Implementation → Tests → Documentation update → Commit → PR → Review → Merge
```

No two unrelated fix categories (security, reports, performance, UI, database-prep, refactoring) will be combined into a single PR. A PR may contain multiple commits only when they belong to the same tightly-scoped fix (e.g. FIX-018 and FIX-020 share one root cause and may be one PR; FIX-001 and FIX-015 will not be).

Each implementation PR will state: Fix ID(s), problem addressed, files changed, architecture impact, data impact, tests performed, regression checks, responsive checks (where applicable), deployment impact, known limitations, and follow-up/dependencies — per this task's section 11.

---

## F. Stop Point

This document is a checklist/audit only. **No code, architecture, or requirements were changed.** Awaiting the approved FIX ID(s) before any implementation begins.
