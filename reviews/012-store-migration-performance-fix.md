# Review 012 — D-034 Wasn't Enough for Stores: the Real Cost Was Inside `cfg_createConfiguration()` Itself

**Date:** 2026-09-27
**Type:** Bug fix, completing D-034/`reviews/011-migration-performance-fix.md`.
See `DECISIONS.md` D-035 for the durable decision record.

---

## 1. Live verification of D-034, and what it actually found

The project owner deployed D-034 (v16) and ran "Migrate Legacy Data" for
real on the test copy. Result, reported verbatim:

```
[8:14:12 PM] Stores step failed: Exceeded maximum execution time

Migrate Legacy Data:
Stores: +0 (already had 0)
Visitors: +12 (already had 0)
Purposes: +0 (already had 4)
1 STEP ERROR
```

This confirms the three-way split (D-034) worked exactly as designed:
Visitors and Purposes completed and are unaffected by whatever is still
wrong with Stores — separately confirmed live: `CONFIG_VISITORS` has 12
real entries, Input Portal → Visited By shows them, a visitor was
selected and a submission made successfully. **This review does not
touch Visitors or Purposes at all** — per the explicit instruction not
to modify a working path without a discovered regression, and because
nothing about them needed to change.

**Was the previous Stores attempt partially applied?** Every store
`cfg_createConfiguration()` call still commits its own row
individually — nothing about D-034 changed that. The report
(`Stores: +0 (already had 0)`) is Apps Script's own count from
*within* the killed execution's return value never actually reaching
the client (a mid-execution kill does not get to return anything), not
proof nothing was written. Re-running is safe either way:
`store_migrateFromSettings()`'s "already resolves → skip" check
(unchanged by this fix) means any store that *did* get created before
the kill is correctly detected and skipped on the next attempt, not
duplicated.

## 2. Why Stores still timed out after D-034

D-034 fixed the **caller's own** redundant work inside
`store_migrateFromSettings()` — the O(n²) "already migrated?" check
(`store_resolveIdByCurrentName()` re-reading the whole sheet per
candidate) and the O(stores×rows) `MASTER_LOG` rescan. What it did not
touch: `cfg_createConfiguration()` — the shared write primitive every
single `CONFIG_*` create goes through, called once per store inside the
now-optimized loop — has its **own**, internal, unconditional cost:

- `_cfg_readVersions(sheet, schema, entity)` (`SVMKPI_CONFIG.gs`)
  **always reads the entire sheet** via
  `sheet.getRange(2, 1, lastRow - 1, width).getValues()`, regardless of
  `entity` — it filters to the one entity requested only *after*
  reading every row. Called once per `cfg_createConfiguration()` call,
  for validation (duplicate effective-date / overlap checks against
  `existingVersions`). As `CONFIG_STORES` grows by one row per store
  created, every subsequent store's validation re-reads a bigger sheet
  than the last — O(n²) over the whole migration, entirely inside a
  function D-034 never touched.
- `_storeSync_toSettings()` (`SVMKPI_STORE_CONFIG.gs`), called once per
  store via `_cfg_syncLegacyMirror()`, does **two more** such full-sheet
  reads on top of that: `cfg_getConfiguration(CFG_AREA.STORES, id)` for
  the entity's full rename history, and `store_getById(id)` (→
  `resolveStoreAsOf` → `_cfg_readVersions()` again) for its current
  state. D-034 suppressed the *rebuild* these functions can trigger
  (`portal_saveStore()`'s `refreshRiskEngine()` call) but not these two
  reads that happen before ever reaching that rebuild decision.

Three independent full-sheet reads per store, each on a sheet that
keeps growing by one row per store — this is the same disease D-034
diagnosed and fixed, one layer deeper, and it is sufficient on its own
to explain the timeout on a real store count, independent of anything
else. Confirmed by direct code reading of both functions in full, not
inferred from the timing report alone — and confirmed a second way, by
a mechanical read-count test (§4) that would have caught this before
the first live attempt if it had existed for D-034.

**Why Visitors didn't hit this:** `visitor_migrateFromSettings()` (fixed
under D-034) already builds its own bulk index and does not call
anything equivalent to `_storeSync_toSettings()`'s two extra reads in
its own sync path — and at only 12 entities, even a smaller residual
per-call cost would not have been enough to time out. Stores, with a
real roster far larger than 12, and carrying the extra
`_storeSync_toSettings()` cost Visitors' sync path never had, is a
different order of magnitude.

## 3. Fix

Three new options on `cfg_createConfiguration()`, all opt-in, all
omitted by every pre-existing call site (so interactive single-entity
Admin UI behavior is provably unchanged):

- **`knownNewEntity`** — skip `_cfg_readVersions()`, use `[]` directly.
  `store_create()` now sets this automatically whenever it is not given
  an explicit Store ID (the normal case, including migration): a
  freshly-minted `Utilities.getUuid()`-based ID cannot already have a
  version — this is a proof, not an assumption, resting on the exact
  same collision-free guarantee this codebase already extends to that
  primitive everywhere else a Store ID is minted. An explicit Store ID
  keeps the real, unconditional duplicate check (exercised directly by
  `store-identity.test.js`'s "duplicate Store ID is rejected" test,
  confirmed still passing).
- **`suppressLegacyMirror`** — skip `_cfg_syncLegacyMirror()` (and its
  two reads) entirely, not just the rebuild inside it. Used only by
  `store_migrateFromSettings()`, safe there specifically because
  migration's source data for name/brand/region/category **is**
  `SETTINGS` itself (that is literally where it was just read from) —
  there is nothing new to mirror back into the sheet it came from.
- **`deferFlush`** — skip the two per-call `SpreadsheetApp.flush()`
  calls (one for the row, one for the audit entry, threaded into
  `_cfg_writeAudit()` too); `store_migrateFromSettings()` flushes once,
  itself, right before the end-of-batch Store Health rebuild.

`store_migrateFromSettings()` now passes
`{ backdateConfirmed: true, suppressRebuild: true, suppressLegacyMirror: true, deferFlush: true }`
to `store_create()`. No other call site anywhere in the codebase passes
any of these three new options.

**Files/functions affected:** `SVMKPI_CONFIG.gs`
(`cfg_createConfiguration`, `_cfg_writeAudit`), `SVMKPI_STORE_CONFIG.gs`
(`store_create`, `store_migrateFromSettings`). Nothing in
`SVMKPI_VISITOR_CONFIG.gs`/`SVMKPI_PURPOSE_CONFIG.gs`/`INPUT_PORTAL.gs`/
`SVMI_PORTAL.html` was touched by this pass — Visitors/Purposes/the
frontend migration flow are exactly as D-034 left them.

## 4. Mechanical proof, not just a timing inference

A live Apps Script execution-time limit cannot be reproduced in this
repo's mocked-sheet Node `vm` test harness — the same disclosed
limitation D-034's own review named. What *can* be proven mechanically
in that harness: the actual **read pattern** that caused the timeout.
`settings-config-migration.test.js`'s sheet mock gained
`getMultiRowReadCount()` — a counter incremented on every genuine
multi-row `getValues()` call (the shape of "re-read the whole sheet",
as opposed to an incidental single-cell read). A new test:

1. Seeds 3 pre-existing stores via plain, non-migration `store_create()`
   calls (confirming the counter behaves as expected on the
   *unoptimized*, interactive path — it does: 4 reads from seeding,
   matching hand-traced expectations exactly).
2. Migrates 40 brand-new stores via `store_migrateFromSettings()` in one
   call.
3. Asserts the multi-row read count increased by **exactly 1** — the one
   legitimate upfront index build `store_migrateFromSettings()` already
   does (D-034), not one (or two, or three) per store.
4. Confirms correctness alongside the read-count proof: all 40 created,
   zero failures, a second identical run creates zero duplicates and
   reports all 40 as already-migrated, and a migrated store resolves
   through real Store ID identity exactly like any other.

This directly proves the O(n²)→O(n) claim, rather than leaving it as an
inference from "the live tool didn't time out this time."

## 5. Test results

`settings-config-migration.test.js` grew from 45 to 51 assertions (6
new — the D-035 section above); full file still 51/51. Full existing
26-file suite re-run, all green, **1312 assertions total** — including
`store-identity.test.js` (51/51, including the explicit-Store-ID
duplicate-rejection test, proving that check's behavior is unchanged),
`duplicate-prevention.test.js` (33/33), `admin-api.test.js` (84/84),
`config-service.test.js` (71/71), `identity.test.js` (109/109),
`identity-legacy-admin-mfa.test.js` (52/52), and every other file
touching `cfg_createConfiguration()`/`store_create()` either directly or
transitively. `responsive-check.js` (66/66) and `portal-ui.test.js`
(173/173, incl. phone-viewport checks) also re-run clean.

## 6. Live verification report

```
Stores source count:        (from the live SETTINGS sheet — not visible from this environment; see the project owner's next "Migrate Legacy Data" run)
CONFIG_STORES before:       0 (per the reported "already had 0")
Stores added:                pending live re-run of v17
Stores already existing:     pending live re-run of v17
Stores remaining:            pending live re-run of v17
Execution time:               pending live re-run of v17
Completed / resumable:       pending live re-run of v17 (expected: completed, given the O(n²)->O(n) fix and the mechanical proof in §4)
Visitors regression:         none — Visitors/Purposes code paths untouched by this pass
Purposes regression:         none — untouched by this pass
Tests:                        1312 assertions, 26 files, 0 failures
Responsive:                   66/66
Portal UI:                    173/173
```

The numeric live-execution fields above cannot be filled in from this
environment — they require the project owner to click "Migrate Legacy
Data" again against the deployed fix and report what it says, exactly as
happened for D-034. This section will be completed in the next commit
once that report comes back, consistent with this review's own
requirement not to mark Stores migration complete until live behavior
actually confirms it.

---

## Confirmation

No validation rule, audit record, or `CONFIG_STORES`/`CONFIG_AUDIT`
row-shape changed. No duplicate visitor/store source was introduced.
`SETTINGS` remains a generated, non-authoritative mirror (D-006),
unchanged. The Visitors and Purposes migration paths — confirmed working
live — were not modified. Every interactive, single-entity Admin UI
create/edit path is provably unaffected (none of the three new options
are set anywhere outside `store_migrateFromSettings()`). Full existing
test suite passes unmodified in its pre-existing assertions; new
assertions added are additive proof of this specific fix, not a
replacement for anything.
