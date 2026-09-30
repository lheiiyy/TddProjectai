# REVIEW-003 — Navigation Load Performance: Unvisited This Month / NAC, Reports, Store Insights

**Type:** Performance fix only. No business rule, compliance semantic, risk
threshold, Store ID, deployment configuration, or MASTER_LOG data changed.
**Status:** Fixed and tested (mocked-sheet harness). **Not yet live-verified**
against a real Spreadsheet — see §10.
**Branch:** `main` (canonical reference branch per Decision A). No merge,
cherry-pick, or branch operation performed.

---

## 0. Identity Gate (confirmed before any edit)

- Repository: `lheiiyy/TddProjectai` (confirmed via `.git/config` remote URL
  and, independently, via the GitHub API's own file listing for `main`).
- Branch: `main` (confirmed via `.git/HEAD` → `ref: refs/heads/main`, and
  `git branch --show-current`).
- Project: `SVMI_Project/` present with the full `Apps Script/` source tree
  (26 files) — confirmed via direct listing.
- **Correction to this session's own prior documentation:** `DECISIONS.md`
  (Decision A, §9a) and `REVIEW-002.md` had stated `main` lacks "the Store
  ID architecture, versioned configuration engine... or the D-036/D-037
  Reports fix." Direct inspection for this task found `main` DOES already
  carry the Store ID/versioned-configuration engine (`SVMKPI_STORE_CONFIG.gs`,
  `SVMKPI_CONFIG.gs`, `SVMKPI_COMPLIANCE_CONFIG.gs`, etc.) — confirmed via
  GitHub's own commit history for `main`: `931d6b3` ("Phase 1B: immutable
  Store identity + historical store attributes"), committed directly to
  `main` in this project's own history, not merged from the candidate
  branch. **D-036/D-037 (Reports Executive Summary source-of-truth
  correction) are confirmed still absent from `main`** — `getExecutiveSummaryReport()`
  still reads the pre-built `EXECUTIVE SUMMARY` sheet, not `MASTER_LOG`
  directly (see §4). This is a factual correction to the prior record, not
  a decision reversal; nothing about Decision A's actual settlement changes.
- **Mandatory docs-first read:** `PROJECT_STATUS.md`, `PROJECT_MEMORY.md`,
  `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`,
  `IMPLEMENTATION_LOG.md`, `TESTING_LOG.md` do **not exist on `main`**
  (confirmed via repo-wide glob) — only `DECISIONS.md` and
  `SVMI_Project/reviews/REVIEW-001.md`/`REVIEW-002.md` exist. This review
  follows that actually-established convention rather than creating the
  named-but-absent files fresh.

---

## 1. Reported problem and investigation order

Live report: a noticeable loading delay opening "Unvisited This Month" /
NAC. Also requested: check Reports (Executive Summary/KPI/Store Health)
and Store Insights for similar avoidable delay.

Traced end to end per the task's required shape, client → RPC → server →
render, for all three areas, before changing anything. Full traces below;
§7 (Unvisited/NAC) was the confirmed dominant bottleneck.

---

## 2. Root cause — Unvisited This Month / NAC (`sl_getComplianceGaps`)

**Confirmed root cause:** `sl_getComplianceGaps()` (`SVMKPI_STORE_LOOKUP.gs`)
iterates every store (`allStores.forEach`, S = configured store count) and,
per store, called:

- `store_resolveIdByCurrentName(store)` — itself loops over **every**
  Store ID and calls `resolveStoreAsOf(id, todayStr)` per ID, each of
  which is a **full `CONFIG_STORES` sheet read** (`cfg_resolveConfigurationAsOf`
  → `_cfg_readVersions` → `sheet.getRange(2, 1, lastRow-1, width).getValues()`).
  That alone is O(S) reads, each O(S) rows.
- `resolveComplianceConfigurationAsOf(storeId, evaluationDate)` — calls
  `resolveStoreAsOf()` **again** (another full `CONFIG_STORES` read) and
  `_cmp_resolveByCategory()` (a full `CONFIG_COMPLIANCE` read).

**Complexity before:** O(S) outer iterations × O(S) reads per
`store_resolveIdByCurrentName` call = **O(S²) full `CONFIG_STORES` reads**,
each transferring O(S) rows → **O(S³) cell-level work** for store
resolution alone, plus **O(S) `CONFIG_COMPLIANCE` reads**. `CONFIG_STORES`
is an append-only versioned/audited sheet that only grows, so this gets
worse over time even at a fixed store count.

This is the same defect class D-034/D-035 (on the other branch) and D-038
(this session, same branch family) already fixed — but in the migration
**write** path; this is the first fix of it in this **read** path.

**Fix:** Added `cfg_resolveAllAsOf(area, dateStr)` to `SVMKPI_CONFIG.gs` —
reads a CONFIG area's sheet exactly once, groups by entity in memory,
resolves each entity's as-of version via the existing `_cfg_resolveAsOf()`
helper (unchanged). `sl_getComplianceGaps()` now builds three lookups
**once**, before the per-store loop:
1. `nameToStoreId` — from `cfg_resolveAllAsOf(CFG_AREA.STORES, today)`,
   same iteration order and "first match wins" tie-break as
   `store_resolveIdByCurrentName()`.
2. `storesAsOfEval` — from `cfg_resolveAllAsOf(CFG_AREA.STORES, evaluationDate)`.
3. `complianceByCategory` — from `cfg_resolveAllAsOf(CFG_AREA.COMPLIANCE, evaluationDate)`.

`resolveComplianceConfigurationAsOf()` and `_cmp_resolveByCategory()`
gained **optional, additive** `prebuiltStoreMap`/`prebuiltMap` parameters:
omitted (every pre-existing caller), behavior is byte-for-byte identical
to before; passed (only `sl_getComplianceGaps()`'s new call), the function
does a map lookup instead of a fresh sheet read. `store_resolveIdByCurrentName()`
itself is untouched — it remains correct and appropriately cheap for its
other, single-lookup caller (`INPUT_PORTAL.gs` at submission time).

**Complexity after:** O(1) `CONFIG_STORES` reads (2, both fixed regardless
of S) + O(1) `CONFIG_COMPLIANCE` reads (1) for the whole function, each
O(S)/O(C) size. Total resolution cost drops from O(S³) to O(S).

---

## 3. Root cause — Store Insights (`sl_getStoreData` / store-selection click)

Navigation itself (`loadSIStores()` → `sl_getStoreList()`) is a single,
already-efficient bounded SETTINGS read — confirmed no issue there. The
delay is entirely in the **per-store-click** RPC, `sl_getStoreData()`:

1. **Full ALL-store risk computation for a 1-store result.**
   `_sl_computeCanonicalHealth()` calls `_computeStoreRisk()` — the SAME
   engine that computes Store Health for **every** store — then discards
   every row except the one selected (`riskRows.find(r => r.store === storeName)`).
   Not restructured in this pass (see §9, Deferred) — but two real,
   avoidable costs inside that ALL-store computation were fixed:
2. **Duplicate MASTER_LOG read.** `sl_getStoreData()` already reads
   MASTER_LOG once (`raw = log.getRange(2,1,lastRow-1,8).getValues()`).
   `_sl_computeCanonicalHealth()` then called `_getData(log)`, a
   **second**, independent full MASTER_LOG read, inside the same RPC.
3. **Per-store `CONFIG_COMPLIANCE` re-read inside `_computeStoreRisk()`.**
   Its final `.map()` over every store called `_sl_computeComplianceScore()`
   → `_sl_getCadenceDays()` → `cmp_getCadenceDays()` → `_cmp_resolveByCategory()`
   — one fresh `CONFIG_COMPLIANCE` read **per store**, though
   `CONFIG_COMPLIANCE` is keyed by category (a handful of values), never
   by store.
4. **A third, previously-undiscovered MASTER_LOG read**, found only while
   verifying the fix mechanically (see §8): `_computeStoreRisk(data, new Date())`
   omits `year`, so it falls back to `getDefaultReportingYear()` —
   which re-reads MASTER_LOG's Date column (`_ry_extractYearsFromLog()`)
   from scratch, a **third** MASTER_LOG read for the same RPC, discovering
   years already present in the `data` already read in step 2.

**Fix:**
- `sl_getStoreData()` now builds an in-memory `prebuiltData` object (in
  `_getData()`'s own shape) from its own already-read `raw` rows, and
  passes it to `_sl_computeCanonicalHealth()`/`_sl_emptyResult()`, which
  use it instead of calling `_getData(log)` again. (`SL_COL` (0-indexed)
  and `COL` (1-indexed) address the same physical MASTER_LOG columns A–G,
  confirmed by direct comparison — `_getData()`'s shape is reproduced
  exactly, Remarks excluded exactly as `_getData()` itself never reads it.)
- `_computeStoreRisk()` now builds `complianceByCategory` (one
  `cfg_resolveAllAsOf(CFG_AREA.COMPLIANCE, today)` call) **once**, before
  its per-store `.map()`, and passes it through
  `_sl_computeComplianceScore()`/`_sl_getCadenceDays()`/`cmp_getCadenceDays()`
  (all three gained the same additive, optional `prebuiltMap` parameter
  as §2 — omitted, unchanged behavior; every existing caller of these
  three functions passes nothing and is unaffected).
- `_sl_computeCanonicalHealth()` now derives the same "latest year with
  data, else current calendar year" answer `getDefaultReportingYear()`
  would give, **in memory** from `data.dates` (already read), and passes
  it explicitly to `_computeStoreRisk()` as `year` — skipping that
  function's internal `getDefaultReportingYear()` fallback entirely for
  this one call site. The shared `getDefaultReportingYear()` function
  itself is untouched and behaves identically for every other caller.

**Complexity after:** MASTER_LOG reads per store-click RPC: 3 → 1.
`CONFIG_COMPLIANCE` reads: O(stores) → O(1).

---

## 4. Root cause — Reports

**KPI (`getKPI2026Report`) — Required, fixed.** Read the whole visitor
data block via one `getRange(row, ...).getDisplayValues()` call **per
visitor row** (V separate Sheets-API round trips for V visitors), inside
a `for` loop walking the sheet row by row. Fixed to one bounded
`getRange(DATA_ROW_START, ..., blockRows, rowWidth).getDisplayValues()`
call covering the whole potential data span, then the exact same
`readRow()`/`at()` index-slicing logic runs against the in-memory 2D
array instead of a fresh live read — same early-termination rule (blank
name or "TEAM TOTAL" ends the scan) preserved exactly.
**Complexity:** O(V) round trips → O(1).

**Store Health (`getStoreHealthReport`) — inspected, already efficient,
no change.** Reads its two data spans (`getDisplayValues()`/`getValues()`)
each in ONE bounded call regardless of row count — no per-row reads
found. Confirmed it does **not** call `refreshRiskEngine()`/`populateRiskEngine()`
or otherwise rebuild/recompute risk on a read; it only reads the
already-built `STORE HEALTH` sheet. Navigating to this Reports subview
does not trigger a rebuild.

**Executive Summary (`getExecutiveSummaryReport`) — Deferred, out of
scope for this task.** Still reads the pre-built `EXECUTIVE SUMMARY`
sheet via a series of small, bounded `getRange().getDisplayValues()`
calls (~9 calls, none scaling with MASTER_LOG/store count) — this is the
**pre-D-036 architecture**, not the `MASTER_LOG`-direct source-of-truth
correction D-036/D-037 established on the other branch (§0's correction).
Bringing D-036/D-037 to `main` is an architecture decision, not a
performance fix, and is explicitly out of this task's scope ("do not
convert deferred architecture decisions into this performance task"); the
existing reader's own call pattern is small and bounded, not the kind of
avoidable O(n)-shaped cost this task targets. Left unchanged.

**Navigation-level:** `switchTab('Reports')` only calls `loadCurrentReport()`
**once** per session (`reportsLoadedOnce` flag) — confirmed no duplicate
RPC on repeated navigation to Reports. `switchReport(which)` issues
exactly one RPC per subview switch, no duplication.

---

## 5. Store Insights navigation-level check

`loadSIStores()` → `sl_getStoreList()`: single bounded SETTINGS read, no
per-row calls, confirmed efficient — not the bottleneck. The delay is
entirely in the per-click `sl_getStoreData()` RPC (§3), which fires
exactly once per store selection (no duplicate/sequential RPCs on the
client side, confirmed by reading `SVMI_PORTAL.html`'s call site).

---

## 6. Client-side rendering (`ftCreate`/`ftRows`/`ftRender`)

Inspected per the task's instruction not to touch this without evidence.
`ftRows()` is a plain in-memory JS array `.filter()`/`.sort()` over the
already-returned rows — O(rows) in JS, negligible next to the O(S²)–O(S³)
server-side sheet-read costs found above, at the dataset sizes involved
(compliance gaps: tens to low hundreds of rows, not thousands). No
evidence it contributes materially to the reported delay. **Not
modified** — per the task's own instruction to leave the filtering engine
alone absent such evidence.

---

## 7. Files changed

- **`SVMKPI_CONFIG.gs`** — new function `cfg_resolveAllAsOf(area, dateStr)`
  (additive only).
- **`SVMKPI_COMPLIANCE_CONFIG.gs`** — `_cmp_resolveByCategory()`,
  `cmp_getCadenceDays()`, `resolveComplianceConfigurationAsOf()` each
  gained an additive, optional prebuilt-map parameter; identical behavior
  when omitted.
- **`SVMKPI_STORE_LOOKUP.gs`** — `sl_getComplianceGaps()` builds and uses
  the three prebuilt maps (§2); `sl_getStoreData()` builds `prebuiltData`
  and passes it to `_sl_computeCanonicalHealth()`/`_sl_emptyResult()`
  (§3); `_sl_computeCanonicalHealth()` uses `prebuiltData` and derives
  `evaluationYear` in memory instead of calling `getDefaultReportingYear()`.
- **`SVMKPI_RISK.gs`** — `_computeStoreRisk()` builds `complianceByCategory`
  once before its per-store `.map()`; `_sl_getCadenceDays()`,
  `_sl_computeComplianceScore()` gained the same additive prebuilt-map
  parameter, threaded through.
- **`SVMKPI_REPORTS.gs`** — `getKPI2026Report()` reads the visitor data
  block once instead of once per row.
- **`SVMI_Project/tests/compliance-config.test.js`** — read-count
  instrumentation added to the mock sheet; two new test sections
  (60-distinct-store compliance-gaps scale proof; Store Insights
  duplicate-read proof).
- **`SVMI_Project/tests/kpi-roster-history.test.js`** — read-count
  instrumentation added; one new test section (50-visitor KPI report
  read-count proof).

**Not touched:** `resolveStoreAsOf()`, `cfg_resolveConfigurationAsOf()`,
`store_resolveIdByCurrentName()`, `getDefaultReportingYear()` (the shared
functions themselves — all still used unchanged by every other caller);
`getExecutiveSummaryReport()`/`getStoreHealthReport()`; any business rule,
compliance semantic, risk threshold, Store ID, MASTER_LOG data,
deployment configuration; `TLM_Project/`, `Hub_Project/`, or any other
unrelated project; `ftCreate`/`ftRows`/`ftRender`.

---

## 8. Before/after measurement (mocked-sheet test evidence)

All figures below are **mechanical read-count evidence from the mocked
Node `vm` test harness**, not a live-Spreadsheet timing measurement — no
live Apps Script execution was run in this session (see §10). RPC counts
are the number of distinct `google.script.run` calls the frontend makes
per navigation event, confirmed by reading `SVMI_PORTAL.html` directly.

| Navigation | RPCs (before) | RPCs (after) | Sheet reads (before) | Sheet reads (after) | Main bottleneck |
|---|---|---|---|---|---|
| Unvisited / NAC (60 stores, test fixture) | 1 | 1 (unchanged) | `CONFIG_STORES`: O(S²) (~120 at S=60) · `CONFIG_COMPLIANCE`: O(S) (~60) | `CONFIG_STORES`: ≤2 · `CONFIG_COMPLIANCE`: ≤1 | `store_resolveIdByCurrentName()`/`resolveComplianceConfigurationAsOf()` re-scanning `CONFIG_STORES`/`CONFIG_COMPLIANCE` once per store |
| Store Insights (per store click, 60 stores) | 1 | 1 (unchanged) | MASTER_LOG: 3 · `CONFIG_COMPLIANCE`: O(S) (~60) | MASTER_LOG: 1 · `CONFIG_COMPLIANCE`: ≤1 | Duplicate `_getData()` MASTER_LOG read + duplicate `getDefaultReportingYear()` MASTER_LOG read + per-store `CONFIG_COMPLIANCE` re-read inside `_computeStoreRisk()` |
| Reports / KPI (50 visitors, test fixture) | 1 | 1 (unchanged) | 50 separate `getDisplayValues()` calls | 1 bounded `getDisplayValues()` call | One Sheets-API round trip per visitor row |
| Reports / Executive Summary | 1 | 1 (unchanged) | ~9 small bounded reads (unchanged) | ~9 small bounded reads (unchanged) | None found in scope — pre-D-036 architecture, deferred (§4) |
| Reports / Store Health | 1 | 1 (unchanged) | 2 bulk reads (unchanged) | 2 bulk reads (unchanged) | None found — already efficient, no rebuild-on-navigation |

**Complexity before → after** (S = configured store count, V = visitor
count, both independent of MASTER_LOG row count):

| Function | Before | After |
|---|---|---|
| `sl_getComplianceGaps()` store resolution | O(S²) sheet reads → O(S³) cell work | O(1) sheet reads → O(S) cell work |
| `_computeStoreRisk()` cadence resolution | O(S) `CONFIG_COMPLIANCE` reads | O(1) |
| `sl_getStoreData()` MASTER_LOG reads | O(1) but literally 3× per call | O(1), 1× per call |
| `getKPI2026Report()` visitor read | O(V) round trips | O(1) round trip |

---

## 9. Required / Recommended / Optional / Deferred

**Required (fixed in this pass):**
- `sl_getComplianceGaps()`'s O(S²)/O(S³) `CONFIG_STORES` re-scan — the
  reported bottleneck. Fixed.
- `getKPI2026Report()`'s one-round-trip-per-visitor-row read. Fixed.

**Recommended (fixed in this pass, found during investigation, real but
smaller than the two Required items):**
- `_computeStoreRisk()`'s per-store `CONFIG_COMPLIANCE` re-read. Fixed.
- `sl_getStoreData()`'s duplicate MASTER_LOG read via `_getData()`. Fixed.
- `_sl_computeCanonicalHealth()`'s `getDefaultReportingYear()` MASTER_LOG
  re-scan. Fixed (found only while mechanically verifying the fix above —
  see §3 item 4).

**Recommended (found, NOT fixed in this pass — named, not silently
dropped):**
- `sl_getComplianceGaps()` itself also calls `getDefaultReportingYear()`
  (when `reportingYear` is omitted — the normal case from
  `loadCompliance()`), which does its own dedicated MASTER_LOG Date-column
  scan **before** the function's own main MASTER_LOG read happens.
  Eliminating this would require reordering the function so year discovery
  runs after (and reuses) the main read — a bigger restructuring of
  already-delicately-ordered, well-tested period-boundary logic than this
  pass's "smallest safe change" scope should risk. A single O(n) extra
  scan, not the O(S²)/O(S³) class this pass targeted.
- `getKPI2026Report()`'s own `getDefaultReportingYear()` fallback (when
  `year` is omitted) has the same extra-MASTER_LOG-scan shape. Same
  reasoning — not fixed here.
- `sl_getStoreData()`'s `_sl_getMeta()` does its own bounded, one-time
  linear SETTINGS scan per call — O(S), paid once per call (not per
  store-in-a-loop), the same order as several already-accepted reads
  elsewhere in this codebase. Could reuse `_sl_getStoreMetaLookup()`'s
  equivalent, already-built lookup instead, but this specific cost is not
  in the O(S²)/O(S³) class and was judged not worth the coupling risk in
  this pass.
- `admin_listPurposes()`/`purpose_getConfigurationStatus()` (used by
  `getSidebarData()`, the Input Portal tab, not the three areas this task
  targeted) has the identical per-entity `CONFIG_COMPLIANCE`-style
  re-read shape as §2's original defect, but keyed by Purpose, a small
  set. Out of this task's three named navigation targets.

**Optional/Future:**
- `ftCreate`/`ftRows`/`ftRender` — no evidence of material cost at current
  data volumes; revisit only if a future dataset size makes client-side
  filtering itself measurably slow.

**Deferred (depends on another architecture/decision, explicitly not
touched):**
- Bringing D-036/D-037 (Executive Summary `MASTER_LOG`-direct
  source-of-truth correction) to `main`. This is Decision-A-adjacent
  architecture work, not a performance fix, and is out of this task's
  scope by its own explicit instruction.

---

## 10. Tests run and results

Full existing suite (20 files) re-run after every change:

```
calendar-period.test.js:          25/25
canonical-risk-engine.test.js:    10/10
compliance-config.test.js:        110/110  (was 42/42 — 68 new assertions: two new scale sections)
config-service.test.js:           71/71
date-parsing.test.js:             13/13
duplicate-prevention.test.js:     33/33
kpi-purpose-config.test.js:       44/44
kpi-roster-history.test.js:       13/13   (was 9/9 — one new read-count section)
portal-ui.test.js:                173/173
report-snapshot.test.js:          163/163
reporting-year.test.js:           57/57
risk-config.test.js:              33/33
risk-scoring.test.js:             30/30
roster-auto-refresh.test.js:      7/7
store-identity.test.js:           51/51
store-lookup-date-handling.test.js: 18/18
store-remove-history.test.js:     19/19
store-scale.test.js:              20/20
submission-lock.test.js:          10/10
admin-api.test.js:                FAILING — pre-existing, unrelated (see below)
```

**`admin-api.test.js`'s failure is pre-existing and unrelated to this
change.** It hardcodes `cfg_rollbackConfiguration('VISITORS', ..., '2026-09-19', {})`
as a non-backdated rollback date; as of this session's actual system date
(2026-09-30), that literal date is now 11 days in the past, so the
rollback's own (unrelated, unmodified) backdate-confirmation check
correctly rejects it. Confirmed unrelated: the failing assertions are
about `VISITORS` CONFIG rollback (`cfg_rollbackConfiguration`), a code
path this task's changes never touch, and the same class of "hardcoded
date, breaks as real time passes" issue this file's own comments
elsewhere already acknowledge as a known risk. **Not fixed here** — out
of this task's scope (navigation load performance), and fixing an
unrelated pre-existing test requires its own, separately-scoped change.

**Mechanical read-count proofs added** (not just functional
pass/fail — see §8's table for the actual counts each proves):
- `compliance-config.test.js`: 60-distinct-store `sl_getComplianceGaps()`
  scale test, asserting ≤2 `CONFIG_STORES` reads and ≤1 `CONFIG_COMPLIANCE`
  read for the whole call (would have been ~120 and ~60 respectively
  before this fix).
- `compliance-config.test.js`: 60-store Store Insights test, asserting
  exactly 1 MASTER_LOG read and ≤1 `CONFIG_COMPLIANCE` read for one
  `sl_getStoreData()` call (would have been 3 and ~60 respectively).
- `kpi-roster-history.test.js`: 50-visitor `getKPI2026Report()` test,
  asserting exactly 1 multi-row `getDisplayValues()` call (would have
  been 50).

**Functional correctness preserved** (same inputs → same outputs),
confirmed by:
- The existing 42 `compliance-config.test.js` assertions (period-to-date
  boundaries, Store ID category-change resolution, rollback,
  security/admin gating, the pre-existing 5,200-row scale test) all still
  pass unmodified.
- The new 60-store test's gap count and window-label assertions confirm
  the Store-ID-resolved path (not just the SETTINGS-category fallback)
  produces the correct Monthly/Quarterly/Semi-Annual classification.
- `canonical-risk-engine.test.js`/`risk-scoring.test.js`/`risk-config.test.js`
  (30+ assertions) exercise `_computeStoreRisk()`/`_sl_computeComplianceScore()`
  directly and confirm scoring is unchanged.
- `report-snapshot.test.js` (163 assertions) exercises
  `sl_getComplianceGaps()`/`_computeStoreRisk()` via the report-finalization
  path and confirms no regression there either.
- `kpi-roster-history.test.js`'s pre-existing 9 assertions (historical
  visitor retention, live-formula vs. literal name cells, TEAM TOTAL
  termination) all still pass unmodified against the rewritten read path.

**Live verification status: NOT performed.** No `clasp push` or
production/test-copy deployment was made in this session — this review
is mocked-sheet test evidence only, exactly as the task's own instructions
require it to be labeled. Deploying and live-verifying (per this
project's own established discipline — backup, push, verify diff) is a
separate, explicit next step requiring the Product Owner's go-ahead,
consistent with every prior production change in this project's history.

---

## 11. Known limitations / remaining risk

- The mocked `vm` sandbox cannot reproduce real Apps Script per-call
  network latency or the live execution-time ceiling — the read-count
  reductions above are a direct, mechanical proxy for round-trip count
  (each `getRange().getValues()`/`getDisplayValues()` call is one round
  trip to the real Sheets backend), the same evidentiary standard D-034/
  D-035/D-038 already established for this class of fix in this project,
  but they are not a substitute for an actual timed live run.
- The three Recommended-but-not-fixed `getDefaultReportingYear()` call
  sites (§9) remain real, if smaller, avoidable MASTER_LOG re-scans.
- Store Insights' "compute risk for every store, use one" structural
  inefficiency (§3 item 1) is not restructured in this pass — the fixes
  applied reduce its most expensive PER-STORE avoidable work (the
  `CONFIG_COMPLIANCE` re-read) to O(1), but the underlying MASTER_LOG scan
  and in-memory per-store scoring loop still run for every store on every
  single-store click. This is now a plain O(n) MASTER_LOG scan (the same
  order Store Health's own rebuild already pays), not an additional
  O(stores)-config-read multiplier — considered acceptable for this pass,
  named here rather than silently left unmentioned.
