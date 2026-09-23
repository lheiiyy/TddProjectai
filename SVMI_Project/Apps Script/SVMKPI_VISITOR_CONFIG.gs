// ============================================================
// SVMKPI_VISITOR_CONFIG.gs
// Store Visit Monitoring KPI — Visitor Roster Configuration (Phase 1G)
// ------------------------------------------------------------
// Contains:
//   1. Operational queries (visitor_getConfigurationStatus, visitor_getOperationalList)
//   2. SETTINGS!F -> CONFIG_VISITORS one-time migration
//   3. _visitorSync_toSettings() — the legacy-mirror sync hook
// ------------------------------------------------------------
// SCOPE: this is the Visitors counterpart to SVMKPI_PURPOSE_CONFIG.gs.
// Unlike Purposes/Stores, Admin's own client-side code already calls
// SVMKPI_CONFIG.gs's generic cfg_createConfiguration()/
// cfg_activateConfiguration()/cfg_deactivateConfiguration()/
// cfg_rollbackConfiguration() DIRECTLY for the VISITORS area (see
// SVMI_PORTAL.html's adminBuildCreateCall()/adminToggleEnvStatus()/
// adminBuildRollbackCall()) — there has never been a need for
// visitor_create()/visitor_activate()/visitor_deactivate() wrapper
// functions, so none are added here. This file exists for the read-side
// query Input Portal needs (visitor_getOperationalList()) and the
// SETTINGS legacy-mirror sync/migration Phase 1G requires, mirroring
// SVMKPI_STORE_CONFIG.gs's/SVMKPI_PURPOSE_CONFIG.gs's own such helpers.
//
// IDENTITY: Entity ID = normalized Visitor Name (interim, unchanged from
// Phase 1A — same identity model CONFIG_PURPOSES already uses). A Visitor
// Name can never be "renamed" the way a Store Name can, since the name
// IS the identity here — a different name is definitionally a different
// entity, not a new version of this one.
// ============================================================


/**
 * visitor_getConfigurationStatus(visitorName, dateStr)
 * Mirrors purpose_getConfigurationStatus() (SVMKPI_PURPOSE_CONFIG.gs) —
 * exists/active as of a date. No legacy hardcoded-list fallback exists
 * for Visitors (unlike Purposes' 4 APPROVED_PURPOSES): every visitor's
 * only ever CONFIG_VISITORS versions (post-migration) or nothing.
 * @returns {{visitorName:string, exists:boolean, active:boolean}}
 */
function visitor_getConfigurationStatus(visitorName, dateStr) {
  const id = String(visitorName || '').trim().toUpperCase();
  const resolved = cfg_resolveConfigurationAsOf(CFG_AREA.VISITORS, id, dateStr);
  return { visitorName: id, exists: !!resolved, active: !!resolved };
}

/**
 * visitor_getOperationalList(dateStr)
 * Every visitor with a resolvable ACTIVE CONFIG_VISITORS version as of
 * `dateStr` (default today) — what Input Portal's "Visited By" picker
 * and the SETTINGS!F legacy mirror should both reflect. Sorted A→Z, same
 * convention as store_getOperationalList().
 * @returns {string[]}
 */
function visitor_getOperationalList(dateStr) {
  const ids = admin_listConfigEntityIds(CFG_AREA.VISITORS);
  const out = [];
  ids.forEach(id => {
    if (cfg_resolveConfigurationAsOf(CFG_AREA.VISITORS, id, dateStr)) out.push(id);
  });
  return out.sort();
}

/**
 * _visitorSync_toSettings(visitorName)
 * Phase 1G — called by SVMKPI_CONFIG.gs's _cfg_syncLegacyMirror() after
 * every successful CONFIG_VISITORS mutation for this name. Keeps the
 * legacy SETTINGS!F roster (which Input Portal's dropdown no longer
 * reads, but SVMKPI_KPI_REBUILD.gs's/SVMKPI_LAYOUT.gs's live formulas
 * still reference by cell) in sync — this name's own row only, never a
 * full-roster rewrite.
 *
 * Reuses manageVisitor() (INPUT_PORTAL.gs) as the actual writer, same
 * "don't re-implement a tested primitive" choice SVMKPI_STORE_CONFIG.gs's
 * _storeSync_toSettings() makes for portal_saveStore()/portal_removeStore().
 * typeof-guarded for sandboxes that load this file without INPUT_PORTAL.gs.
 */
function _visitorSync_toSettings(visitorName) {
  if (typeof manageVisitor !== 'function') return;
  const status = visitor_getConfigurationStatus(visitorName);
  manageVisitor(status.active ? 'add' : 'remove', visitorName);
}

/**
 * visitor_migrateFromSettings(settingsVisitorNames)
 * One-time (per environment) migration companion to
 * store_migrateFromSettings() — creates a CONFIG_VISITORS version for
 * every name in `settingsVisitorNames` that doesn't already resolve
 * today, effective from today (MASTER_LOG's "Visited By" column has no
 * single reliable per-visitor "first appearance" date — it's a pipe-
 * delimited multi-name field per row — so, honestly, today is the
 * earliest date this migration can actually claim, same reasoning
 * store_migrateFromSettings() uses for a store with no MASTER_LOG
 * history at all). Safe to re-run: a name that already resolves is
 * skipped, never re-created.
 * Admin-gated.
 * @param {string[]} settingsVisitorNames
 * @returns {{success:boolean, message?:string, createdNames?:string[], alreadyMigrated?:string[]}}
 */
function visitor_migrateFromSettings(settingsVisitorNames) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const created = [];
  const alreadyMigrated = [];
  const seen = {};

  (settingsVisitorNames || []).forEach(raw => {
    const name = String(raw || '').trim().toUpperCase();
    if (!name || seen[name]) return;
    seen[name] = true;

    if (cfg_resolveConfigurationAsOf(CFG_AREA.VISITORS, name)) {
      alreadyMigrated.push(name);
      return;
    }

    const result = cfg_createConfiguration(CFG_AREA.VISITORS, name, { visitorName: name }, todayStr, null, 'Migrated from SETTINGS', {});
    if (result.success) created.push(name);
  });

  return { success: true, createdNames: created, alreadyMigrated };
}
