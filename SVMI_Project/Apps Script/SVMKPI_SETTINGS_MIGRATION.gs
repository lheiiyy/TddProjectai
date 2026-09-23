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
 * settingsMigration_run()
 * Admin-gated (each underlying migrate function re-checks sl_isAdmin()
 * independently — this function has no privilege of its own).
 * @returns {{success:boolean, message?:string, stores?:object, visitors?:object, purposes?:object}}
 */
function settingsMigration_run() {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settings = ss.getSheetByName(SHEET_SETTINGS);
    if (!settings) return { success: false, message: 'SETTINGS sheet not found.' };

    const lastRow = settings.getLastRow();
    const settingsStores = [];
    const settingsVisitors = [];
    const settingsPurposes = [];

    if (lastRow >= 2) {
      const data = settings.getRange(2, 1, lastRow - 1, 8).getValues();
      data.forEach(row => {
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

    let masterLogRows = [];
    const masterLog = ss.getSheetByName(SHEET_MASTER);
    if (masterLog && typeof _getData === 'function') {
      const data = _getData(masterLog);
      masterLogRows = data.stores.map((store, i) => ({ store, date: data.dates[i] }));
    }

    const storesResult = store_migrateFromSettings(settingsStores, masterLogRows);
    const visitorsResult = typeof visitor_migrateFromSettings === 'function'
      ? visitor_migrateFromSettings(settingsVisitors)
      : { success: false, message: 'visitor_migrateFromSettings not available.' };
    const purposesResult = typeof purpose_migrateFromSettings === 'function'
      ? purpose_migrateFromSettings(settingsPurposes)
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
