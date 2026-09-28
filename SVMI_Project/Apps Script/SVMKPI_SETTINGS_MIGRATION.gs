// ============================================================
// SVMKPI_SETTINGS_MIGRATION.gs
// Store Visit Monitoring KPI — Legacy SETTINGS -> Configuration
// One-Time Migration (Phase 1G)
// ------------------------------------------------------------
// Contains exactly one admin-facing entry point:
//   settingsMigration_run() — reads the CURRENT SETTINGS sheet (Stores,
//   Visitor Roster, Purpose List) plus MASTER_LOG (for stores' earliest-
//   visit dates), and calls store_migrateFromSettings()/
//   visitor_migrateFromSettings()/purpose_migrateFromSettings() (Phase
//   1B/1G) for anything not already migrated.
// ------------------------------------------------------------
// WHY THIS EXISTS: store_migrateFromSettings() (SVMKPI_STORE_CONFIG.gs)
// was built in Phase 1B but never wired to anything callable — no menu
// item, no button, no other function ever invoked it. Phase 1G makes
// Admin → Configuration the ONE authoritative place to create/edit a
// Store/Visitor/Purpose (removing the "Store & Roster Manager" card that
// used to write straight to SETTINGS), which means whatever SETTINGS
// already held before this migration needs an actual, one-time way to
// become real CONFIG_STORES/CONFIG_VISITORS/CONFIG_PURPOSES rows — this
// is that way, finally reachable from System Tools' "Migrate Legacy Data"
// card in the Admin UI.
//
// Never touches MASTER_LOG or SETTINGS itself (it only READS them) —
// all it writes is new CONFIG_*/CONFIG_AUDIT rows via the already-admin-
// gated store_create()/cfg_createConfiguration() paths, exactly as if an
// admin had typed each one in individually through Admin → Configuration.
// Safe to run more than once: every underlying migrate function skips a
// name that already resolves, so re-running only picks up anything new
// added to SETTINGS since the last run (e.g. by some other legacy path)
// without creating a duplicate.
// ============================================================

/**
 * _settingsMigration_readSettings_()
 * Shared SETTINGS read for all four entry points below — one pass over
 * the sheet, split into the three per-area lists each migrate function
 * needs. Cheap (a single bounded getRange/getValues() call) — not the
 * part of this migration that was ever slow; see D-034 below for what
 * was.
 * @returns {{settingsStores:object[], settingsVisitors:string[], settingsPurposes:string[]}}
 */
function _settingsMigration_readSettings_() {
  const settings = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
  const settingsStores = [];
  const settingsVisitors = [];
  const settingsPurposes = [];
  if (!settings) return { settingsStores, settingsVisitors, settingsPurposes };

  const lastRow = settings.getLastRow();
  if (lastRow >= 2) {
    settings.getRange(2, 1, lastRow - 1, 8).getValues().forEach(row => {
      const store = String(row[COL_S_STORE - 1] || '').trim();
      const brand = String(row[COL_S_BRAND - 1] || '').trim();
      const region = String(row[COL_S_REGION - 1] || '').trim();
      const category = String(row[COL_S_CATEGORY - 1] || '').trim();
      const visitor = String(row[COL_S_VISITOR - 1] || '').trim();
      const purpose = String(row[COL_S_PURPOSE - 1] || '').trim();
      if (store) settingsStores.push({ store, brand, region, category });
      if (visitor) settingsVisitors.push(visitor);
      if (purpose) settingsPurposes.push(purpose);
    });
  }
  return { settingsStores, settingsVisitors, settingsPurposes };
}

function _settingsMigration_readMasterLog_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterLog = ss.getSheetByName(SHEET_MASTER);
  if (!masterLog || typeof _getData !== 'function') return [];
  const data = _getData(masterLog);
  return data.stores.map((store, i) => ({ store, date: data.dates[i] }));
}

/**
 * settingsMigration_run()
 * Admin-gated (each underlying migrate function re-checks sl_isAdmin()
 * independently — this function has no privilege of its own).
 *
 * Runs all three areas (Stores, Visitors, Purposes) in one Apps Script
 * execution — the original, still-supported entry point, unchanged in
 * contract. D-034 (below) fixed the actual performance problem this
 * used to have (several O(n^2) sheet-read patterns plus a full report
 * rebuild after every single created entity — see
 * reviews/011-migration-performance-fix.md), so this combined call is
 * now expected to comfortably finish within Apps Script's execution
 * limit for a realistic pilot-sized dataset. `settingsMigration_runStores()`/
 * `_runVisitors()`/`_runPurposes()` below are the same three steps
 * split into independently-callable functions, for the extra
 * resilience of each getting its own execution-time budget — the
 * Admin UI now calls those three instead of this one, precisely so a
 * problem in one area's migration (however unlikely now) can never
 * prevent the other two from running. This function is kept, with its
 * exact original behavior, for any other caller (including this
 * project's own tests) that already depends on the single combined
 * call.
 * @returns {{success:boolean, message?:string, stores?:object, visitors?:object, purposes?:object}}
 */
function settingsMigration_run() {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

    const legacy = _settingsMigration_readSettings_();
    const masterLogRows = _settingsMigration_readMasterLog_();

    const storesResult = store_migrateFromSettings(legacy.settingsStores, masterLogRows);
    const visitorsResult = typeof visitor_migrateFromSettings === 'function'
      ? visitor_migrateFromSettings(legacy.settingsVisitors)
      : { success: false, message: 'visitor_migrateFromSettings not available.' };
    const purposesResult = typeof purpose_migrateFromSettings === 'function'
      ? purpose_migrateFromSettings(legacy.settingsPurposes)
      : { success: false, message: 'purpose_migrateFromSettings not available.' };

    return {
      success: true,
      stores: storesResult,
      visitors: visitorsResult,
      purposes: purposesResult,
    };
  } catch (e) {
    logError('settingsMigration_run', e);
    return { success: false, message: e.message };
  }
}

/**
 * settingsMigration_runStores() / _runVisitors() / _runPurposes()
 * D-034 — the same migration as settingsMigration_run(), split into
 * three independently-callable, independently-admin-gated steps, each
 * its own Apps Script execution (its own execution-time budget). The
 * Admin UI calls all three, one after another, regardless of whether an
 * earlier one failed — so a problem in Stores (historically the
 * heaviest of the three, since it's the only one that also scans
 * MASTER_LOG) can never block Visitors or Purposes from running. Each
 * is exactly as safe to re-run as the combined call: the underlying
 * migrate function skips anything already migrated.
 * @returns {{success:boolean, message?:string, stores?:object}} (etc., one key per function)
 */
function settingsMigration_runStores() {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
    const legacy = _settingsMigration_readSettings_();
    const masterLogRows = _settingsMigration_readMasterLog_();
    return { success: true, stores: store_migrateFromSettings(legacy.settingsStores, masterLogRows) };
  } catch (e) {
    logError('settingsMigration_runStores', e);
    return { success: false, message: e.message };
  }
}

function settingsMigration_runVisitors() {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
    if (typeof visitor_migrateFromSettings !== 'function') {
      return { success: false, message: 'visitor_migrateFromSettings not available.' };
    }
    const legacy = _settingsMigration_readSettings_();
    return { success: true, visitors: visitor_migrateFromSettings(legacy.settingsVisitors) };
  } catch (e) {
    logError('settingsMigration_runVisitors', e);
    return { success: false, message: e.message };
  }
}

function settingsMigration_runPurposes() {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
    if (typeof purpose_migrateFromSettings !== 'function') {
      return { success: false, message: 'purpose_migrateFromSettings not available.' };
    }
    const legacy = _settingsMigration_readSettings_();
    return { success: true, purposes: purpose_migrateFromSettings(legacy.settingsPurposes) };
  } catch (e) {
    logError('settingsMigration_runPurposes', e);
    return { success: false, message: e.message };
  }
}
