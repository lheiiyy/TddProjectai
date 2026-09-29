# Review 014 — Input Portal Tab Load: Stores/Visitors Not Appearing After Migration Had Already Run

**Date:** 2026-09-29
**Type:** Bug fix, same defect class as D-034/D-035, found in a different
code path. See `DECISIONS.md` D-038 for the durable decision record.

---

## 1. Reported symptom

Live production report, in order:

1. "the visitors is not showing in Input tab"
2. "EVEN THE STORES" — both Stores and Visitors dropdowns empty
3. "I THINK THE PROBLEM IS THE SLOW LOADING PHASE"
4. "MIGRATE ALREADY RUN CONFIG TAB ALREADY CONTAINED DATA" — ruling out
   the simpler explanation (migration never run against production,
   leaving `CONFIG_STORES`/`CONFIG_VISITORS` empty), confirming
   `CONFIG_STORES`/`CONFIG_VISITORS` already held real data at the time
   the Input tab failed to show it.

## 2. Root cause

`getSidebarData()` (`INPUT_PORTAL.gs`), called by the Input Portal tab on
every load (`loadPortalData()` in `SVMI_PORTAL.html`), calls
`store_getOperationalList()` and `visitor_getOperationalList()`. Both had
this shape:

```
_store_listEntityIds() / admin_listConfigEntityIds()   → 1 full-sheet read (fine)
.forEach(id => resolveStoreAsOf(id, ...) / cfg_resolveConfigurationAsOf(...))
                                          → _cfg_readVersions(sheet, schema, entity)
                                          → sheet.getRange(2, 1, lastRow-1, width).getValues()
                                             (a SECOND full-sheet read, PER ENTITY)
```

For N entities this is **1 + N full-sheet reads** of the same,
ever-growing `CONFIG_STORES`/`CONFIG_VISITORS` sheet — the identical O(n²)
defect D-035 (`reviews/012-store-migration-performance-fix.md`) already
diagnosed and fixed, but only in the migration **write** path
(`cfg_createConfiguration()`/`store_migrateFromSettings()`). This **read**
path — which `getSidebarData()` hits on every single Input Portal tab
load, not just once during migration — was never fixed. `CONFIG_STORES`
is an append-only versioned/audited sheet, so `lastRow` (and therefore the
per-call cost) only grows over time, never shrinks.

`loadPortalData()` has no loading spinner and no client-side timeout — it
just waits on `google.script.run...getSidebarData()`. A slow enough
server call is visually indistinguishable from "nothing is showing" until
either the caller gives up waiting or the Apps Script execution-time
ceiling is hit — consistent with all four symptom reports above, in the
order they were reported.

`visitor_getOperationalList()` has the identical shape, but with far
fewer entries in the dataset seen so far it was cheap enough not to be
independently noticeable — not because the code path differs.

## 3. Fix

**`SVMKPI_CONFIG.gs`** — new function `cfg_resolveAllAsOf(area, dateStr)`,
the batch counterpart to `cfg_resolveConfigurationAsOf()`. Reads the
area's sheet exactly **once** via `_cfg_readVersions(sheet, schema,
null)` (already supported reading every entity's versions in one call —
`store_migrateFromSettings()`'s own D-034 fix uses the same "read once,
group in memory" approach for the write path), groups the results by
`entityId` in memory, then resolves each entity's as-of version via the
existing `_cfg_resolveAsOf()` helper. Same resolution semantics as
`cfg_resolveConfigurationAsOf()` called per-entity — an entity with no
version effective on the given date is simply absent from the returned
map, exactly as a per-entity caller would have skipped a null result.

**`SVMKPI_STORE_CONFIG.gs`** — `store_getOperationalList()` now calls
`cfg_resolveAllAsOf(CFG_AREA.STORES, asOfStr)` once and iterates the
returned map, instead of calling `resolveStoreAsOf()` once per store ID.
Filtering logic (excluding `fields.status === 'INACTIVE'`) is unchanged.

**`SVMKPI_VISITOR_CONFIG.gs`** — `visitor_getOperationalList()` now
returns `Object.keys(cfg_resolveAllAsOf(CFG_AREA.VISITORS,
dateStr)).sort()` — no more per-visitor `cfg_resolveConfigurationAsOf()`
call, and no more separate `admin_listConfigEntityIds()` call either
(the batch resolver's own grouping already gives the exact same set of
resolvable entity IDs).

**No other file changed.** `resolveStoreAsOf()` and
`cfg_resolveConfigurationAsOf()` themselves are untouched and still used
exactly as before by every other caller that resolves a single, known
entity (e.g. `store_getById()`, `manageVisitor()`) — those call sites
were never the problem (one known ID, one read, already O(1)) and don't
need this batch form.

## 4. Related, NOT fixed here (scope discipline)

`admin_listPurposes()` (`SVMKPI_ADMIN_API.gs`) has the same per-entity
shape via `purpose_getConfigurationStatus()`, which itself calls
`cfg_resolveConfigurationAsOf()`, `kpi_purposeHasConfig()`, and
`risk_resolvePurposeWeight()` per purpose name. Not fixed in this pass:
the reported symptom was Stores and Visitors, never Purposes; the
dataset's purpose count is small enough (4 in the live-verified test
data) that this has not been reported as a problem; and a real fix here
would need to touch two more CONFIG domains (KPI, Risk) beyond
`SVMKPI_CONFIG.gs` itself, a larger surface than this pass's scope.
Left as a named, not a silent, gap for a future pass if purpose count
ever grows enough to matter.

## 5. Mechanical proof, not just a timing inference

`settings-config-migration.test.js` gained a new section (search "D-038")
using the same `getMultiRowReadCount()` instrumentation D-035's own test
introduced:

1. Seeds 40 stores and 40 visitors (backdated to yesterday, so a
   same-day deactivation exercised later doesn't collide on effective
   date).
2. Calls `store_getOperationalList()`/`visitor_getOperationalList()`.
3. Asserts both return all 40 entries.
4. Asserts the multi-row read count on `CONFIG_STORES`/`CONFIG_VISITORS`
   increased by **exactly 1** each — the one legitimate full read this
   fix performs, not one per entity (was 40 before this fix, for 40
   entities).
5. Confirms correctness alongside the read-count proof: deactivating one
   store correctly removes it from the next `store_getOperationalList()`
   call — the batch resolver's filtering behaves identically to the old
   per-entity resolver's.

Full test suite re-run after this change: **27 files, 0 failures**
(`admin-api.test.js` 84/84, `config-service.test.js` 71/71,
`identity.test.js` 109/109, `identity-legacy-admin-mfa.test.js` 52/52,
`store-identity.test.js` 51/51, `portal-ui.test.js` 180/180,
`settings-config-migration.test.js` 57/57 including the 6 new D-038
assertions, and every other file — all green, no regressions).

## 6. What was deliberately NOT touched

- `resolveStoreAsOf()`, `cfg_resolveConfigurationAsOf()` — untouched,
  still the correct tool for resolving one known entity.
- `store_migrateFromSettings()`, `cfg_createConfiguration()` (D-034/D-035)
  — untouched, this pass is the read path, not the write path.
- `admin_listPurposes()`/`purpose_getConfigurationStatus()` — see §4.
- Deployment manifest, identity/MFA/RBAC, any Decision A/B/C/D scope —
  this is an isolated, mechanical performance fix to an already-deployed
  read function, not an architecture or branch-reconciliation decision.

---

## Confirmation

No validation rule, audit record, or `CONFIG_STORES`/`CONFIG_VISITORS`
row shape changed. No new duplicate-detection or write behavior was
introduced — this is a read-only optimization. Every other caller of
`resolveStoreAsOf()`/`cfg_resolveConfigurationAsOf()` is unaffected (they
still exist, unchanged). Full existing test suite passes unmodified in
its pre-existing assertions; new assertions are additive proof of this
specific fix only.
