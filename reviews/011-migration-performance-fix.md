# Review 011 — Input Portal Visitors/Date Bugs Traced to a Migration Performance Defect

**Date:** 2026-09-27
**Type:** Bug fix, traced through several rounds of live investigation
against the test copy. See `DECISIONS.md` D-034 for the durable decision
record; this review is the investigation trail and the required audit.

---

## 1. Starting symptom and how the investigation actually proceeded

Reported: "Input Portal can't show the Visitors list, can't type the
date." The date-field part was a genuine, separate UX gap (native
`type="date"` inputs don't accept typed input on phones) and was fixed
first, on its own — see the date-field commit history and `DECISIONS.md`
entries around it. This review covers the Visitors thread, which turned
out to be unrelated to the date field or the mobile tap-handling fix
also made along the way.

**Round 1:** traced the read path (`Visited By` → `filterVisitors()` →
`allVisitors` → `getSidebarData()` → `visitor_getOperationalList()` →
`admin_listConfigEntityIds`/`cfg_resolveConfigurationAsOf` →
`CONFIG_VISITORS`) by direct code inspection. Ruled out: renamed/missing
functions, schema typos, a frontend/backend shape mismatch, an
over-aggressive active/inactive filter. Found, and fixed separately, a
real but secondary bug: `filterVisitors()`/`filterStores()` closed their
dropdown with zero visible feedback when the result was empty — "nothing
happens" was literally true, by design, for an empty result.

**Round 2:** the project owner reported `Admin → Configuration →
Visitors` was *also* empty, confirming the two independent read paths
agreed (both empty) rather than disagreeing — and reported a second,
real defect while investigating: `loadAdminArea()`'s `admin_getAreaSchema`
failure handler only ever cleared the *detail* pane's spinner, never the
*entity list* pane's — a failure there looks exactly like an infinite
spinner, for every `CFG_AREA`, not just Visitors. Also confirmed
`SETTINGS!F` (the legacy visitor roster) still had real data — meaning
this was very likely a Phase 1G migration gap on this specific test-copy
spreadsheet (`DECISIONS.md` D-005/D-006 already establish `SETTINGS` as
a downstream mirror of `CONFIG_*`, not the other way around).

**Round 3:** the project owner ran the existing "Migrate Legacy Data"
tool and reported it hanging until the Apps Script execution time limit.
This round's investigation is the substance of this review.

## 2. Root cause: a bulk migration loop triggering full report rebuilds per entity

Traced every function `settingsMigration_run()` calls, by direct code
reading (not assumed):

- `cfg_createConfiguration()` (`SVMKPI_CONFIG.gs`) — the single write
  primitive every `CONFIG_*` create goes through — calls
  `_cfg_syncLegacyMirror()` on every successful write, unconditionally.
- For `STORES`, that calls `_storeSync_toSettings()` →
  `portal_saveStore()` (`INPUT_PORTAL.gs`), which calls
  `refreshRiskEngine()` — a full Store Health rebuild, scanning all of
  `MASTER_LOG` — **on every single store created**.
- For `VISITORS`, `_visitorSync_toSettings()` → `manageVisitor()` calls
  `buildKPI2026()` — a full KPI 2026 rebuild, also scanning all of
  `MASTER_LOG` — **on every single visitor created**.
- Separately, `store_migrateFromSettings()`'s own "already migrated?"
  check called `store_resolveIdByCurrentName()` once per incoming
  SETTINGS row — and *that* function itself re-reads the **entire**
  `CONFIG_STORES` sheet once per already-existing store to resolve it
  (`_cfg_readVersions()` reads the whole sheet unfiltered, then filters
  in memory) — an O(existing²) sheet-read pattern. The same shape of
  cost existed in `visitor_migrateFromSettings()` (via
  `cfg_resolveConfigurationAsOf()`) and in `store_recordUnmapped()` (a
  full `CONFIG_UNMAPPED_STORES` re-read per distinct unmapped name).
- `store_migrateFromSettings()` additionally re-scanned all of
  `masterLogRows` once per incoming store to find that store's earliest
  visit date — O(stores × MASTER_LOG rows).

For a real pilot-sized dataset (hundreds of stores, a visitor roster,
thousands of `MASTER_LOG` rows — this is a project literally named
"sys.STORE VISIT 2026"), these are not marginal costs: they compound
multiplicatively, and the full-MASTER_LOG-rescan-per-entity rebuilds
alone are more than sufficient on their own to exceed Apps Script's
execution time limit before the Stores step — which runs first, inside
`settingsMigration_run()`'s single execution — ever finishes. Visitors
and Purposes, migrated *after* Stores in the original combined function,
never got a chance to run at all. This is confirmed to be sufficient
cause by direct code reading; it was not diagnosed by trial and error.

**Was the previous migration attempt partially applied?** Every
individual `cfg_createConfiguration()` call commits its own row
(`sheet.appendRow()` + `SpreadsheetApp.flush()`) before returning — so
whatever Stores managed to create before the execution was killed by the
platform's time limit is real, committed data, and every migrate
function's own "skip if already resolves" check (unchanged by this fix)
means a subsequent run picks up exactly where the killed one left off,
safely. **No rollback occurs, and none was needed** — this is the same
idempotent, additive-only design the tool already had; this fix does not
change that guarantee, it only makes the tool fast enough to typically
finish before hitting the limit at all, and split the work so a
Stores-side problem can no longer withhold Visitors/Purposes indefinitely.

## 3. Fix

See `DECISIONS.md` D-034 for the full decision record. Summary:

1. `options.suppressRebuild` threaded through
   `cfg_createConfiguration()` → `_cfg_syncLegacyMirror()` →
   `_storeSync_toSettings()`/`_visitorSync_toSettings()` →
   `portal_saveStore()`/`portal_removeStore()`/`manageVisitor()` — every
   bulk-migration call site sets it; every interactive single-entity
   call site (unchanged) omits it, so nothing about a normal Admin UI
   edit changed.
2. `store_migrateFromSettings()` and `visitor_migrateFromSettings()`
   each build one in-memory index up front
   (`_store_buildCurrentNameIndex_()`, an `earliestByName` map,
   `_store_recordUnmappedBulk_()`) instead of re-reading a sheet once
   per candidate — O(existing) total, not O(existing²).
3. Each migrate function runs its own suppressed-rebuild's real rebuild
   exactly once, after its batch, only if it actually created anything.
4. `settingsMigration_run()` (unchanged contract, still supported) sits
   alongside three new entry points — `settingsMigration_runStores()`/
   `_runVisitors()`/`_runPurposes()` — each independently admin-gated,
   each its own Apps Script execution. `SVMI_PORTAL.html`'s
   `runSettingsMigration()` now calls Visitors → Purposes → Stores in
   that order (cheapest and most urgently-needed first; Stores, the
   heaviest, last), continuing to the next step regardless of whether an
   earlier one failed, and reports every step's outcome (including a
   step that errored outright, not just per-row failures within a
   successful step) rather than any of it going silent.
5. `filterStores()`/`filterVisitors()` (`SVMI_PORTAL.html`) now show an
   explicit "nothing configured yet" vs. "no match" message instead of
   silently closing the dropdown.
6. `loadAdminArea()`'s schema-load failure handler now clears both
   loading panes, not just one — fixes the stuck-spinner risk for every
   `CFG_AREA`, not only Visitors.

**Files/functions affected:** `SVMKPI_CONFIG.gs` (`cfg_createConfiguration`,
`_cfg_syncLegacyMirror`), `SVMKPI_STORE_CONFIG.gs`
(`store_migrateFromSettings`, `_storeSync_toSettings`, new
`_store_buildCurrentNameIndex_`/`_store_recordUnmappedBulk_`),
`SVMKPI_VISITOR_CONFIG.gs` (`visitor_migrateFromSettings`,
`_visitorSync_toSettings`), `INPUT_PORTAL.gs` (`manageVisitor`,
`portal_saveStore`, `portal_removeStore`), `SVMKPI_SETTINGS_MIGRATION.gs`
(new `settingsMigration_runStores`/`_runVisitors`/`_runPurposes`, shared
`_settingsMigration_readSettings_`/`_readMasterLog_` helpers,
`settingsMigration_run` refactored onto the same helpers, contract
unchanged), `SVMI_PORTAL.html` (`runSettingsMigration`, `loadAdminArea`,
`filterStores`, `filterVisitors`, new `_emptyDropMessage`).

## 4. Required audit — every Admin Configuration area

| Configuration Area | Sheet | Schema Load | Data Load | Empty Data Handling | Error Handling | Status |
|---|---|---|---|---|---|---|
| STORES | `CONFIG_STORES` | `admin_getAreaSchema('STORES')` — trivial, cannot fail for a defined area | `admin_listConfigEntityIds`/`admin_getAreaSchema`; **migration path was O(existing²) + per-entity rebuild** | List pane: `'No stores exist yet.'` (already correct) | Own branch already called `adminShowError('adminEntityList', …)` correctly; **shared schema-load step did not** (fixed) | **Fixed** (migration perf + shared spinner bug) |
| VISITORS | `CONFIG_VISITORS` | same shared step | `admin_listConfigEntityIds` (generic "VISITORS, KPI" branch); **migration path was O(existing²) + per-entity rebuild** | List pane: `'None configured yet. Click + New to add one.'` (already correct); **Portal's own picker silently did nothing on empty** (fixed) | Own branch already correct; shared step fixed | **Fixed** (root cause of the reported bug) |
| PURPOSES | `CONFIG_PURPOSES` | same shared step | `admin_listPurposes` (has a 4-item legacy fallback, unaffected) | Renders each purpose's validity badge; empty case untested here (list is never empty — legacy defaults always present) | Own branch already correct; shared step fixed | Not implicated — no per-entity rebuild in its sync path (`managePurpose()` has none); left as-is |
| RISK | `CONFIG_RISK` (singleton) | same shared step | No server call — `loadAdminArea('RISK')` renders a single static row directly | N/A (always exactly one row) | N/A | Not implicated |
| COMPLIANCE | `CONFIG_COMPLIANCE` | same shared step | `admin_listComplianceCategories` | List pane: `'No categories found.'` (already correct) | Own branch already correct; shared step fixed | Shared-step fix applies; not otherwise implicated |
| KPI | `CONFIG_KPI` | same shared step | Same generic "VISITORS, KPI" branch as Visitors | `'None configured yet. Click + New to add one.'` (already correct) | Own branch already correct; shared step fixed | Shared-step fix applies; not otherwise implicated (KPI is unwired infrastructure per `PROJECT_STATUS.md` — no migration path exists for it at all) |
| SYSTEM | `CONFIG_SYSTEM` | same shared step | `admin_getSystemAreaInfo` | `'No system settings have ever been defined.'` (already correct) | Own branch already correct; shared step fixed | Shared-step fix applies; not otherwise implicated |

**Missing-data classification (per the six-way distinction requested) for
what was actually found:**
- The reported Visitors bug: **B** (data missing from `CONFIG_VISITORS`
  on this test-copy spreadsheet) as the underlying condition, compounded
  by **E** (the migration meant to fix B failed to complete — a backend
  timeout — before ever reaching the Visitors step).
- The Admin Configuration stuck-spinner risk: **F**-adjacent — a
  frontend defect (failure handler not clearing the right element),
  triggerable by any backend failure in the shared schema-load step, for
  any area — not observed to have actually fired for Visitors
  specifically in this incident (its own branch's error handling was
  already correct), but a real, now-fixed defect regardless.
- No area showed C (schema/validation wrongly rejecting real data) or D
  (resolution logic wrongly excluding existing data) — `_cfg_resolveAsOf`/
  `_parseDateCell` were read in full and are correctly defensive
  (return `null`, never throw, on any malformed input).

## 5. Test results

Full existing suite (26 files) re-run after the fix, all passing, **no
test needed to change**: `settings-config-migration.test.js`'s own
`settingsMigration_run()` idempotency/failure-reporting assertions pass
unmodified against the refactored implementation (same external
contract, verified by the test itself, not just by reading the diff) —
**45/45**. Also re-ran, all green: `store-identity` (51), `risk-scoring`
(30), `roster-auto-refresh` (7), `kpi-roster-history` (11),
`store-remove-history` (19), `admin-api` (84), `config-service` (71),
`identity` (109 — up from 100; the D-033 pilot-MFA-toggle assertions
from the prior session were only reasoned-through then, and are
confirmed passing now that they could actually be executed),
`identity-legacy-admin-mfa` (52 — same D-033 confirmation),
`security-remediation` (34), `compliance-config` (42),
`kpi-purpose-config` (44), `report-snapshot` (163), `reporting-year`
(57), `risk-config` (33), `store-scale` (20), `submission-lock` (10),
`duplicate-prevention` (33), `date-parsing` (13), `calendar-period`
(25), `canonical-risk-engine` (10), `purpose-generic-reporting` (65),
`purpose-report-surfaces` (82), `store-lookup-date-handling` (27).
`responsive-check.js` (66/66) and `portal-ui.test.js` (173/173,
including phone-viewport checks) also re-run clean — both against the
standalone demo file, per this repo's disclosed testing-architecture
limitation (`ARCHITECTURE.md` §8), so they confirm no regression to the
existing harness/UI patterns but do not directly exercise the real
portal's new date-field/empty-list markup.

**No new automated test was added for the migration performance fix
itself** — this is a disclosed gap, not an oversight: the existing test
sandbox's mocked `SpreadsheetApp`/sheet objects have no notion of Apps
Script's real execution-time limit or of `SpreadsheetApp` round-trip
cost, so a test asserting "this used to take too long and now doesn't"
cannot be meaningfully expressed in that harness — only re-running the
real tool against the real, real-sized spreadsheet (which the project
owner did, and should do again against this fix) can confirm the actual
timing improvement. What *is* covered by the existing, unmodified test
suite: that the fix does not change `store_migrateFromSettings()`'s/
`visitor_migrateFromSettings()`'s/`settingsMigration_run()`'s observable
behavior (same creates, same skips, same failure reports, same
idempotency) — correctness, not speed, which is what an automated test
can actually verify here.

## 6. What was deliberately not built

A cross-invocation checkpoint/resume mechanism (e.g. `PropertiesService`-
backed progress markers letting a single migration call pick up
mid-batch after a timeout) was considered and set aside for now: with
the O(n²) sheet-read patterns and the per-entity rebuild both eliminated,
realistic pilot-sized data (hundreds of entities, thousands of
`MASTER_LOG` rows) should complete a single migration step comfortably
inside Apps Script's execution limit — the three-way split by area
already gives natural checkpointing at the area granularity (a
completed Visitors/Purposes step survives regardless of what happens to
Stores), and every migrate function was already idempotent at the
per-entity level, so simply re-running a step that did time out picks up
where it left off with no data loss either way. Building finer-grained
intra-step resumability now would add real complexity for a need this
fix is expected to have already removed. If a future, much larger
dataset still times out even one of the three split steps, that is the
concrete trigger for revisiting this — not something to build
preemptively against an unconfirmed need.

---

## Confirmation

No `CONFIG_*` write behavior, validation rule, or audit record changed.
No duplicate visitor/store data source was introduced — `SETTINGS`
remains a generated mirror, `CONFIG_*` remains the one authoritative
source, unchanged from D-005/D-006. Nothing was migrated blindly:
`store_create()`'s/`cfg_createConfiguration()`'s own validation, and
every existing failure-reporting behavior, are untouched. The full
pre-existing test suite (26 files) passes unmodified.
