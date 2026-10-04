# Review 013 — Reports Tab: Data Records as the Authoritative Source, Additional Purpose

**Date:** 2026-09-28
**Type:** Bug fix / architecture correction (Reports tab source-of-truth) + additive feature (Additional Purpose, Visit Detail Records).
See `DECISIONS.md` D-036 for the durable decision record.

---

## 0. Repository identity gate

Confirmed before any change: remote `https://github.com/lheiiyy/TddProjectai`,
root contains `SVMI_Project/`, `PROJECT_STATUS.md`, `PROJECT_MEMORY.md`,
`REQUIREMENTS.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md` — the
expected SVMI evidence. No mismatch; proceeded.

## 1. Objective

Fix the Reports tab so `DATA RECORD → REPORTS` is the authoritative flow for
Executive Summary (never a generated report/KPI sheet), add an `Additional
Purpose` KPI metric computed from Data Records, and extend the Executive
Summary report dataset to carry `Additional Purpose`/`Visitor`/`Brand`/
`Store` as real, filterable fields alongside the rest of the relevant Data
Record fields — without inventing a separate "Executive Report" UI (per
explicit instruction: extend the existing Executive Summary/report output,
since no such distinct UI exists anywhere in this repository).

## 2. Pre-implementation trace — what was found

Traced end to end before writing any code:

- **Reports tab UI** (`SVMI_PORTAL.html`/`SVMI_Command_Center_Demo.html`):
  one panel, three sub-views — Executive Summary / KPI 2026 / Store Health
  — switched via `switchReport()` → `loadCurrentReport()` →
  `google.script.run.get*Report()`. **No year selector existed anywhere in
  the Reports tab** (confirmed by direct source search) — not even for KPI
  2026, whose reader already accepted a `year` parameter but was never
  called with one from the UI.
- **Executive Summary API** (`getExecutiveSummaryReport()`,
  `SVMKPI_REPORTS.gs`): read the `EXECUTIVE SUMMARY` **sheet's cells**
  (`sheet.getRange(...).getDisplayValues()`) — a generated report sheet
  built by `SVMKPI_LAYOUT.gs`'s `buildExecutiveSummaryLayout()`. This is
  exactly the forbidden `DATA RECORD → REPORT SHEET → REPORT` pattern:
  the Reports tab's Executive Summary view was authoritative-sourced from
  a cached sheet, not Data Records, and would show stale/wrong numbers
  whenever that sheet was out of date or never rebuilt.
- **`EXECUTIVE SUMMARY` sheet's own formulas** (`_buildESFormulas()`,
  `SVMKPI_LAYOUT.gs`): DO read `MASTER_LOG` directly via native Sheets
  formulas (`COUNTIF`/`COUNTIFS`/`QUERY`) — so the sheet itself is
  Data-Record-derived. The violation was specifically in the **reader**
  depending on that intermediate artifact rather than computing from
  `MASTER_LOG` itself on every call.
- **A real, disclosed inconsistency found along the way**: of the sheet's
  7 KPI-card formulas, only 3 sections (Monthly by Brand, Purpose
  Breakdown, Brand Performance peak-month) were actually year-scoped;
  Total Visits/Store Visits/TLTC/Failed QA/MS/Curing-Support/NCR/
  Provincial, Region, Top Stores, and the Leaderboard were all **all-time
  cumulative**, ignoring whatever year `buildExecutiveSummaryLayout(year)`
  was last rebuilt for — despite the sheet's own title reading "EXECUTIVE
  SUMMARY \<year\>". Fixing this (making every metric consistently
  year-scoped) was necessary to satisfy the explicit requirement that
  "changing the year must change displayed metrics" — see §7 for why this
  was judged in-scope rather than a silent broadening.
- **Additional Purpose**: did not exist anywhere in the repository (no
  code, docs, or test referenced it) before this change.
- **Data Record fields actually used** (`COL`, `SVMKPI_CORE.gs`):
  `TIMESTAMP`, `DATE`, `STORE`, `BRAND`, `REGION`, `VISITOR`, `PURPOSE` —
  confirmed from the actual schema, not guessed. `_getData()` is the
  existing canonical reader that parses/normalizes all seven; nothing
  else in this codebase reads `MASTER_LOG` for reporting purposes without
  going through it (or, for `KPI 2026`/Store Health, through their own
  already-established sheet-cell readers, unmodified and out of scope
  here).
- **Report-to-report dependency classification**:
  - `getExecutiveSummaryReport()` → `EXECUTIVE SUMMARY` sheet: **Required**
    — fixed this pass (source of the whole task).
  - `getKPI2026Report()` → `KPI <year>` sheet, `getStoreHealthReport()` →
    `STORE HEALTH` sheet: **Deferred** — explicitly out of scope. Neither
    was named in the task, both are stable/tested/live-deployed, and
    rewriting them would be an unrelated, much larger change (KPI 2026's
    per-visitor/per-week breakdown and Store Health's risk-scoring engine
    have no simple from-`MASTER_LOG` equivalent to reuse the way
    `_es_discoverReportablePurposes()` did for Executive Summary's Purpose
    Breakdown). `buildExecutiveSummaryLayout()`/`_buildESFormulas()`
    themselves: **kept, unmodified** — the sheet remains a legitimate
    presentation/spreadsheet-native artifact (still rebuildable via Admin
    → Tools), simply no longer the Reports tab's authoritative source.

## 3. Source-of-truth fix

`getExecutiveSummaryReport(year)` (`SVMKPI_REPORTS.gs`) rewritten to:

```
MASTER_LOG (Data Records)
    ↓  _getData()  (canonical reader, ONE read)
selected reporting year (pure filter — never written back)
    ↓
canonical parsing/filtering (_parseDateCell already inside _getData();
_normalizeVisitors/_aggregateVisitors/_aggregateList reused, not
duplicated; _es_discoverReportablePurposes() reused for Purpose
Breakdown — SAME function SVMKPI_LAYOUT.gs's sheet-writer already uses,
so the two can never disagree)
    ↓
report calculations + dimensions (kpi/monthly/region/purpose/topStores/
leaderboard/brandPerformance + the new `records` dataset)
    ↓
Reports UI
```

Never reads `EXECUTIVE SUMMARY`, never reads a KPI sheet, never writes
anything (`SpreadsheetApp` write methods are structurally absent from the
function — proved by a source-text test, not just inspection). The
`EXECUTIVE SUMMARY` sheet may still exist and still be rebuilt as a
presentation artifact; it is provably no longer read by this function
(tested with the sheet altogether missing, and separately with a
deliberately wrong/stale copy present — both times the reader returns the
real `MASTER_LOG`-derived numbers, never the sheet's).

## 4. Additional Purpose

`Additional Purpose` = count of a reporting year's visits whose `Purpose`
is not one of the 4 fixed legacy purposes already broken out as their own
KPI cards (`APPROVED_PURPOSES`, `SVMKPI_CORE.gs`) — i.e. any purpose
configured/used beyond those 4, discovered from the data itself. Computed
fresh on every call from the year-filtered in-memory index; never
hardcoded (proved by a test that adds one such row and shows the count
change); never read from `EXECUTIVE SUMMARY`/`KPI 2026`/any other report;
changes correctly across two different reporting years in the same
`MASTER_LOG` (proved directly).

## 5. Required dimensions / report dataset

`getExecutiveSummaryReport()` gained a `records` array — one entry per
`MASTER_LOG` row for the selected year, each carrying `date`, `store`,
`brand`, `region`, `visitor` (array — pipe-split via the canonical
`_normalizeVisitors()`, never a raw joined string), `purpose`, and the
derived `additionalPurpose` boolean, plus `timestamp`. This is real data
in the report's own dataset — usable for filtering/grouping/breakdowns —
not a display-only label set, and it was **not** narrowed to only the 4
mandatory dimensions: `date`/`region`/`timestamp` remain present too, per
the explicit instruction not to reduce the dataset.

The Reports UI (`SVMI_PORTAL.html` and, identically,
`SVMI_Command_Center_Demo.html`) surfaces this as a new "Visit Detail
Records" table under Executive Summary, reusing the exact same
`ftCreate`/`ftRender` filter-and-sort table engine Store Health/Unvisited
This Month/Store Insights already use — Store/Visitor get free-text
search, Brand/Region/Purpose/Additional-Purpose get the existing
checklist filter popover. No new framework or filtering engine was
introduced.

## 6. Year selection

A year `<select id="esYearSel">` was added to the Reports toolbar
(visible only for Executive Summary), populated from
`getAvailableReportingYears()` — the same canonical "which years actually
have data" function Admin → Report Snapshots' own `snapYearSel` already
uses (`SVMKPI_REPORTING_YEAR.gs`), never a hardcoded list. Selecting a
year re-calls `getExecutiveSummaryReport(year)`; the year is a pure read
filter — `getExecutiveSummaryReport()` performs no writes at all, proved
both by a source-text check and by a test that calls it three times
across two different years and diffs `MASTER_LOG`'s own cell contents
byte-for-byte before/after. Omitting a year still defaults to
`getDefaultReportingYear()` (latest year present), matching
`getKPI2026Report()`'s existing convention exactly. KPI 2026/Store Health
are unchanged and still take no year argument from this UI — out of
scope, per §2's dependency classification.

## 7. Minimal-change judgment call — disclosed, not silent

Section 10 of the task asked for the smallest change that restores the
intended architecture, and to document any broader change before
proceeding rather than making it silently. One such call was made:
**every** Executive Summary metric (not just the new Additional Purpose
card) is now year-scoped, including the 4 that were previously all-time
cumulative regardless of the sheet's own year (§2). This was judged
necessary rather than optional, for two reasons: (a) the task's own year-
selection requirement is unconditional — "changing the year must ...
change displayed metrics" — and leaving most cards frozen at all-time
totals while only Additional Purpose responded to the selector would be
an internally inconsistent reading, not a faithful implementation of that
requirement; (b) computing every metric from the same single
year-filtered index inside one function is not an architecturally larger
change than computing only one metric that way — it is the same
mechanism applied uniformly, not a second implementation. `getKPI2026Report()`/
`getStoreHealthReport()` were left exactly as they are — genuinely out of
scope, not touched.

## 8. Data Record field mapping (§9 of the task)

| Report field | `MASTER_LOG` column (`COL`, `SVMKPI_CORE.gs`) |
|---|---|
| `records[].date` | `COL.DATE` (via `_parseDateCell()`) |
| `records[].store` | `COL.STORE` |
| `records[].brand` | `COL.BRAND` |
| `records[].region` | `COL.REGION` |
| `records[].visitor` | `COL.VISITOR` (via `_normalizeVisitors()`) |
| `records[].purpose` / `additionalPurpose` | `COL.PURPOSE` (raw / derived) |
| `records[].timestamp` | `COL.TIMESTAMP` |

The frontend never sees a sheet name, row, or column number — it only
calls `getExecutiveSummaryReport(year)`/`getAvailableReportingYears()`
and renders the JSON shape returned, exactly as every other report reader
in this portal already works.

## 9. Architecture / data / integration impact

- **Architecture**: `DATA RECORD → REPORTS` is now the real, tested flow
  for Executive Summary. No new framework, no new data store, no new
  filtering engine (`ftCreate` reused as-is). `buildExecutiveSummaryLayout()`
  and the `EXECUTIVE SUMMARY` sheet are unmodified and still exist as a
  presentation/spreadsheet-native artifact — not authoritative, not
  removed.
- **Data**: no schema change. `MASTER_LOG` is read-only from this path
  (proved). No new sheet, no new column.
- **Integration**: `getExecutiveSummaryReport()`'s return shape is
  additive — every field the old shape had is still present with the same
  meaning; `kpi` grew one entry, `records`/`selectedYear`/`availableYears`
  are new. No caller other than the Reports tab itself exists.
- **Portal/Demo parity**: `SVMI_PORTAL.html` (real) and
  `SVMI_Command_Center_Demo.html` (the file `portal-ui.test.js`/
  `responsive-check.js` actually drive, per `ARCHITECTURE.md` §4) were
  updated identically — toolbar, `switchReport`/`loadCurrentReport`/
  `loadEsYears`, the Visit Detail Records table, and (demo only) its own
  mock `getExecutiveSummaryReport()`/new `getAvailableReportingYears()`
  mock, mirroring the real reader's logic against the demo's sample
  `MASTER_LOG` (`DB.log`).

## 10. Tests

All run in this session, exact counts:

- **New file** `reports-source-of-truth.test.js` — **53/53** — source-of-
  truth structural proof (no sheet dependency, works with the sheet
  absent, ignores a deliberately-wrong stale sheet), Additional Purpose
  (correct count, not hardcoded, year-scoped), dimensions present and not
  narrowed, year selection (two years differ, non-mutating, no per-year
  sheet required, default-year convention), existing-metrics regression
  (Total/Store/TLTC/Failed/Curing/NCR/Provincial/Top Stores/Leaderboard/
  Brand Performance/Monthly-by-Brand against a hand-checked fixture).
- `purpose-report-surfaces.test.js` — **84/84** (its Executive-Summary-
  reader block rewritten to build a real `MASTER_LOG` fixture instead of
  a hand-built sheet, since the reader no longer reads a sheet at all;
  every other block — `buildExecutiveSummaryLayout()`, Store Insights,
  `validateMasterLog()` — untouched and still passing).
- `portal-ui.test.js` — **180/180** (172 prior + 8 new: 8 KPI cards incl.
  Additional Purpose, year selector populated, Visit Detail Records table
  renders, all 5 required-dimension column headers present).
- `responsive-check.js` — **100/100** (66 prior + 34 new, 6 device sizes ×
  ~5–6 Reports-specific checks each: no horizontal overflow, 8 KPI cards
  with real width, year selector visible/on-screen/touch-sized, Visit
  Detail Records table scrolls in its own box with working column
  filters).
- **Full existing suite**: **1378 assertions across 27 files, 0
  failures** (merged-base pre-existing total was 1316/26; net +62 from
  this pass).
- **Syntax/runtime**: `SVMKPI_REPORTS.gs` — `node --check`, clean. Both
  portal HTML files' inline `<script>` blocks — `new Function()` parse
  check, clean (one pre-existing, unrelated failure in `SVMI_PORTAL.html`'s
  separate tiny bootstrap script is an Apps Script `<?!= ?>` template tag,
  not valid standalone JS by design, present before this change and
  outside the block this change touched).
- **Responsive**: verified via `responsive-check.js` at phone
  portrait/landscape, tablet portrait/landscape, small laptop, and
  desktop — metric cards, year selector, the detail table, and its
  filters all confirmed usable at every size, no horizontal overflow
  introduced.

## 11. Review classification

- **Required** (fixed this pass): Executive Summary reading a report
  sheet as its authoritative source; Additional Purpose missing; required
  dimensions missing from the report dataset; no year selection on
  Reports; inconsistent (partial) year-scoping across existing metrics.
- **Recommended** (not done, real but smaller technical debt): the
  `records` array is unbounded — a very large `MASTER_LOG` year could
  make a single `getExecutiveSummaryReport()` payload large. Not a
  correctness problem today (no scale issue has been reported for this
  tab, unlike the D-034/D-035 migration-loop pattern), but worth a
  paginated/limited variant if visit volume grows substantially.
- **Optional/Future**: applying the same MASTER_LOG-direct pattern to
  `getKPI2026Report()`/`getStoreHealthReport()` for full architectural
  uniformity across all three Reports views.
- **Deferred** (explicitly out of scope, not touched): `KPI 2026`/`KPI
  2027`-sheet-backed reporting; Store Health's risk-scoring sheet;
  `buildExecutiveSummaryLayout()`'s own sheet-writing engine.

## 12. Known issues / remaining work

- The `records` payload-size Recommended item above is real but
  unexercised — no test proves a scale threshold, because none was set.
- `KPI 2026`'s reader still receives no year argument from the UI (a
  pre-existing gap, not introduced or worsened here) — deferred, since
  fixing it was never asked for and is a distinct, separable task.
- Live behavior (an actual deployed test-copy `MASTER_LOG` with a real,
  multi-year visit history) has not been verified — this review's
  evidence is the `.gs` unit-test suite (real Apps Script source in a
  Node `vm` sandbox, per `ARCHITECTURE.md` §8) and the demo/Playwright UI
  checks; it has not been pushed to the live test copy or exercised
  against production data.
