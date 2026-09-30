// ============================================================
// SVMKPI_ADMIN_API.gs
// Store Visit Monitoring KPI — Admin UI Read-Side Aggregation (Phase 1F)
// ------------------------------------------------------------
// Contains ONLY thin, READ-ONLY aggregation the Admin UI needs to
// enumerate "what exists" in an area (e.g. "every known Purpose",
// "every known Compliance category") before drilling into Phase 1A/1B/
// 1D/1E's own typed services for detail/history/mutation.
//
// Nothing here duplicates a business rule, a calculation, or a mutation:
// every actual configuration read/write the Admin UI performs calls an
// EXISTING, already admin-gated function directly —
// cfg_getConfiguration()/cfg_resolveConfigurationAsOf()/
// cfg_createConfiguration()/cfg_activateConfiguration()/
// cfg_deactivateConfiguration()/cfg_rollbackConfiguration()/
// cfg_getAuditLog(), store_create()/store_update()/store_activate()/
// store_deactivate()/resolveStoreAsOf()/store_getUnmappedStores()/
// store_reconcileUnmapped(), purpose_create()/...(), risk_create()/...(),
// cmp_create()/...(), kpi_create()/...(), getAvailableReportingYears(),
// listReportSnapshots()/getReportSnapshot()/getReportSnapshotByVersion()/
// getLatestFinalizedReportSnapshot()/finalizeReport()/
// supersedeReportSnapshot()/regenerateReportSheet()/getDraftReport().
// SVMI_PORTAL.html calls all of those directly via google.script.run —
// this file exists only for the handful of "list everything" queries
// none of those functions already provide by themselves.
//
// No function in this file is admin-gated on its own: each one only
// ever aggregates already-public read data (cfg_getConfiguration(),
// APPROVED_PURPOSES, CMP_DEFAULT_RULES, CFG_AREA_SCHEMAS, SETTINGS) —
// exactly the same trust level as the existing getStoreHealthReport()/
// getKPI2026Report() readers, neither of which is admin-gated either.
// Every MUTATION remains behind the existing area-specific function's
// own sl_isAdmin() check — nothing here weakens or bypasses that.
// ============================================================


/**
 * admin_getAreaSchema(area)
 * Exposes CFG_AREA_SCHEMAS[area]'s field list/required set so the Admin
 * UI can render a generic, TYPED "new version" form per area without
 * hardcoding business field names/labels in client-side JS (the schema
 * itself is the one source of truth, same as every backend validator).
 * @returns {{fields:{key:string,header:string}[], required:string[]}|null}
 */
function admin_getAreaSchema(area) {
  const schema = CFG_AREA_SCHEMAS[area];
  if (!schema) return null;
  return { fields: schema.fields, required: schema.required || [] };
}

/**
 * admin_listConfigEntityIds(area)
 * Every distinct Entity ID that has at least one version in the given
 * CONFIG_* area — a thin, deduplicated wrapper over
 * cfg_getConfiguration(area)'s own "every entity" mode. Used directly
 * for VISITORS (which has no legacy/hardcoded entity source the way
 * Purposes/Compliance categories do — see admin_listPurposes()/
 * admin_listComplianceCategories() below for those two).
 * @returns {string[]} sorted entity IDs
 */
function admin_listConfigEntityIds(area) {
  const seen = {};
  const ids = [];
  cfg_getConfiguration(area).forEach(v => { if (!seen[v.entityId]) { seen[v.entityId] = true; ids.push(v.entityId); } });
  return ids.sort();
}

/**
 * admin_getConfigEntityDetail(area, entityId, dateStr)
 * The current (as of dateStr, default today) version plus the FULL
 * version history for one entity in one area — everything the Admin
 * UI's detail/history panel needs in one call.
 * @returns {{current:(object|null), history:object[]}}
 */
function admin_getConfigEntityDetail(area, entityId, dateStr) {
  return {
    current: cfg_resolveConfigurationAsOf(area, entityId, dateStr),
    history: cfg_getConfiguration(area, entityId).sort((a, b) => a.versionNum - b.versionNum),
  };
}

/**
 * admin_getRiskDetail(dateStr)
 * Risk (SVMKPI_RISK_CONFIG.gs) is a global singleton — no entity
 * enumeration needed, just its one CFG_SINGLETON_ENTITY history.
 */
function admin_getRiskDetail(dateStr) {
  return admin_getConfigEntityDetail(CFG_AREA.RISK, CFG_SINGLETON_ENTITY, dateStr);
}

/**
 * admin_listPurposes(dateStr)
 * Every purpose the system currently knows about: the 4 legacy
 * APPROVED_PURPOSES (which have always existed without ever needing a
 * CONFIG_PURPOSES row — see SVMKPI_PURPOSE_CONFIG.gs's own header)
 * UNIONed with any additional purpose that has at least one
 * CONFIG_PURPOSES version, each resolved through the EXISTING
 * purpose_getConfigurationStatus() — never re-deriving that status here.
 * @returns {object[]} purpose_getConfigurationStatus()'s own shape, one per known purpose
 */
function admin_listPurposes(dateStr) {
  const names = {};
  (typeof APPROVED_PURPOSES !== 'undefined' ? APPROVED_PURPOSES : []).forEach(p => { names[p] = true; });
  cfg_getConfiguration(CFG_AREA.PURPOSES).forEach(v => { names[v.entityId] = true; });
  return Object.keys(names).sort().map(name => purpose_getConfigurationStatus(name, dateStr));
}

/**
 * admin_listComplianceCategories()
 * Every category with a resolvable compliance rule: the hardcoded
 * CMP_DEFAULT_RULES categories (SVMKPI_COMPLIANCE_CONFIG.gs — the
 * pre-Phase-1D categories that have always worked without ever needing
 * a CONFIG_COMPLIANCE version) UNIONed with any category that has at
 * least one such version.
 * @returns {string[]} sorted category names
 */
function admin_listComplianceCategories() {
  const names = {};
  Object.keys(typeof CMP_DEFAULT_RULES !== 'undefined' ? CMP_DEFAULT_RULES : {}).forEach(c => { names[c] = true; });
  cfg_getConfiguration(CFG_AREA.COMPLIANCE).forEach(v => { names[v.entityId] = true; });
  return Object.keys(names).sort();
}

/**
 * admin_listAllStores(dateStr)
 * Every Store ID that has EVER existed — not just the operationally
 * ACTIVE ones store_getOperationalList() (SVMKPI_STORE_CONFIG.gs)
 * deliberately limits itself to — each resolved as of `dateStr` (default
 * today) via Phase 1B's own resolveStoreAsOf(), including its current
 * operational Store Status. This is an ADMIN screen, not an operational
 * one: an inactive store must remain visible/manageable here even though
 * it is correctly hidden from the Input Portal's store picker.
 * @returns {{storeId:string, storeName:string, brand:string, region:string, category:string, status:string, versionNum:number, effectiveFrom:Date}[]}
 */
function admin_listAllStores(dateStr) {
  const ids = _store_listEntityIds();
  return ids
    .map(id => {
      const resolved = resolveStoreAsOf(id, dateStr);
      if (!resolved) return null;
      const f = resolved.fields || {};
      return {
        storeId: id,
        storeName: f.storeName,
        brand: f.brand,
        region: f.region,
        category: f.category,
        status: String(f.status || CFG_STATUS.ACTIVE).toUpperCase(),
        versionNum: resolved.versionNum,
        effectiveFrom: resolved.effectiveFrom,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.storeName).localeCompare(String(b.storeName)));
}

/**
 * admin_getSystemAreaInfo()
 * CONFIG_SYSTEM is intentionally empty/infrastructure-only as of Phase
 * 1A (see SVMKPI_CONFIG.gs's own schema comment) — no business-
 * configurable system setting has ever been defined. This reports that
 * fact (plus whatever, if anything, has actually been created) so the
 * Admin UI can show an honest read-only state instead of a generic
 * key/value editor for a schema with no defined settings.
 * @returns {{hasAnyEntries:boolean, entities:string[], note:string}}
 */
function admin_getSystemAreaInfo() {
  const entities = admin_listConfigEntityIds(CFG_AREA.SYSTEM);
  return {
    hasAnyEntries: entities.length > 0,
    entities,
    note: 'CONFIG_SYSTEM is intentionally infrastructure-only as of Phase 1A — no business-configurable system setting has been defined yet. This schema exists so a genuinely new one has somewhere principled to go later, never as a generic arbitrary key/value editor.',
  };
}
