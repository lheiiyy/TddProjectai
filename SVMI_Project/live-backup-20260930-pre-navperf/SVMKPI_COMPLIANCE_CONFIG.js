// ============================================================
// SVMKPI_COMPLIANCE_CONFIG.gs
// Store Visit Monitoring KPI — Versioned Compliance Configuration
// + Period-to-Date Resolution (Phase 1D)
// ------------------------------------------------------------
// Contains:
//   1. Compliance configuration CRUD (thin wrapper over SVMKPI_CONFIG.gs)
//   2. Category-level resolution with hardcoded-default fallback
//   3. resolveComplianceConfigurationAsOf(storeId, date) — Store ID entry point
// ------------------------------------------------------------
// SCOPE: CONFIG_COMPLIANCE's Entity ID is CATEGORY (e.g. 'NCR',
// 'FAR PROVINCIAL') — compliance cadence is genuinely a per-CATEGORY
// business rule in the existing app (SVMKPI_RISK.gs's now-legacy
// RISK_CADENCE/_sl_getCadenceDays()), not a per-store one; nothing here
// invents a new per-store dimension.
//
// Store ID as the configuration IDENTITY (Phase 1D business decision):
// the resolution ENTRY POINT for "what compliance rule applies to store
// X" is always Store ID, never Store Name — resolveComplianceConfiguration
// AsOf(storeId, date) resolves the store's CATEGORY as of that date via
// Phase 1B's resolveStoreAsOf() FIRST (a store's category is itself
// effective-dated and can change over time), then looks up the category's
// rule. Store Name is never the configuration foreign key anywhere in
// this chain — it's Phase 1B's job to have already turned a name into a
// Store ID before this file is ever called with one.
//
// Calendar-period-to-date, not rolling-N-day, is the compliance MODEL
// (Phase 1D business decision) — see SVMKPI_CALENDAR.gs's
// resolveCalendarPeriod() and SVMKPI_STORE_LOOKUP.gs's refactored
// sl_getComplianceGaps(), which is what actually EVALUATES period-to-date
// compliance using this file's resolved rule. This file only resolves
// WHICH rule applies; it does not itself count MASTER_LOG activity.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CRUD (admin-gated)
// ═══════════════════════════════════════════════════════════════

/**
 * cmp_create(category, fields, effectiveFromStr, reason, options)
 * Creates a new CONFIG_COMPLIANCE version for a category. `periodDefinition`
 * is derived automatically from `fields.cadenceType` (never independently
 * supplied by the caller) so the two columns can never drift apart — see
 * SVMKPI_CALENDAR.gs's _cal_familyFromCadenceType().
 * @param {string} category - e.g. 'NCR', 'FAR PROVINCIAL'
 * @param {{cadenceType:string, cadenceDays:number, requiredCount?:number, graceDays?:number}} fields
 * @returns {{success:boolean, message?:string, versionId?:string, version?:number, requiresBackdateConfirmation?:boolean}}
 */
function cmp_create(category, fields, effectiveFromStr, reason, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const cat = String(category || '').trim().toUpperCase();
  if (!cat) return { success: false, message: 'Category cannot be blank.' };

  const family = _cal_familyFromCadenceType(fields && fields.cadenceType);
  const withDerived = Object.assign({}, fields, family ? { periodDefinition: family } : {});
  return cfg_createConfiguration(CFG_AREA.COMPLIANCE, cat, withDerived, effectiveFromStr, null, reason, options);
}

/**
 * cmp_update(category, fields, effectiveFromStr, reason, options)
 * Adds a new version for an EXISTING category — same full-field-set
 * contract as cmp_create()/cfg_createConfiguration() generally (not a
 * partial patch).
 */
function cmp_update(category, fields, effectiveFromStr, reason, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const cat = String(category || '').trim().toUpperCase();
  const existing = cfg_getConfiguration(CFG_AREA.COMPLIANCE, cat);
  if (existing.length === 0) return { success: false, message: 'Category has no existing compliance configuration: ' + cat };
  return cmp_create(cat, fields, effectiveFromStr, reason, options);
}

function cmp_activate(versionId, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_activateConfiguration(CFG_AREA.COMPLIANCE, versionId, reason);
}
function cmp_deactivate(versionId, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_deactivateConfiguration(CFG_AREA.COMPLIANCE, versionId, reason);
}
function cmp_rollback(category, targetVersionId, reason, effectiveFromStr, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const cat = String(category || '').trim().toUpperCase();
  return cfg_rollbackConfiguration(CFG_AREA.COMPLIANCE, cat, targetVersionId, reason, effectiveFromStr, options);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: CATEGORY-LEVEL RESOLUTION (hardcoded-default fallback)
// ═══════════════════════════════════════════════════════════════

// Pre-Phase-1D hardcoded defaults — copied EXACTLY from the existing
// RISK_CADENCE/_sl_getCadenceDays() mapping (SVMKPI_RISK.gs) and
// sl_getComplianceGaps()'s existing category branches (SVMKPI_STORE_
// LOOKUP.gs), never invented. Used only when a category has NO
// CONFIG_COMPLIANCE version yet — zero behavior change pre-migration.
const CMP_DEFAULT_RULES = {
  'NCR':              { cadenceType: 'MONTHLY',     cadenceDays: 31,  periodDefinition: 'MONTH',       requiredCount: 1, graceDays: 0 },
  'NEAR PROVINCIAL':  { cadenceType: 'MONTHLY',     cadenceDays: 31,  periodDefinition: 'MONTH',       requiredCount: 1, graceDays: 0 },
  'FAR PROVINCIAL':   { cadenceType: 'QUARTERLY',   cadenceDays: 92,  periodDefinition: 'QUARTER',     requiredCount: 1, graceDays: 0 },
  'FLIGHT PROVINCIAL':{ cadenceType: 'SEMI_ANNUAL', cadenceDays: 183, periodDefinition: 'SEMI_ANNUAL', requiredCount: 1, graceDays: 0 },
};

/**
 * _cmp_resolveByCategory(category, dateStr)
 * Internal. Resolves the compliance rule for a raw CATEGORY string as of
 * a date — CONFIG_COMPLIANCE if a version exists, else the hardcoded
 * default for a recognized category, else null (unrecognized category —
 * matches sl_getComplianceGaps()'s existing "skip unknown category"
 * behavior).
 * @returns {{category, cadenceType, cadenceDays, periodDefinition, requiredCount, graceDays, source, versionId}|null}
 */
function _cmp_resolveByCategory(category, dateStr) {
  const cat = String(category || '').trim().toUpperCase();
  if (!cat) return null;

  // Defensive: the full SVMKPI_CONFIG.gs engine may not be loaded in a
  // narrower context (e.g. a test exercising only the calendar-period
  // model) — degrade straight to the hardcoded default in that case
  // rather than throwing.
  const resolved = (typeof cfg_resolveConfigurationAsOf === 'function')
    ? cfg_resolveConfigurationAsOf(CFG_AREA.COMPLIANCE, cat, dateStr)
    : null;
  if (resolved && resolved.fields) {
    const f = resolved.fields;
    return {
      category: cat,
      cadenceType: f.cadenceType,
      cadenceDays: Number(f.cadenceDays),
      periodDefinition: f.periodDefinition || _cal_familyFromCadenceType(f.cadenceType),
      requiredCount: (f.requiredCount != null && f.requiredCount !== '') ? Number(f.requiredCount) : 1,
      graceDays: (f.graceDays != null && f.graceDays !== '') ? Number(f.graceDays) : 0,
      source: 'CONFIG_COMPLIANCE',
      versionId: resolved.versionId,
    };
  }

  const def = CMP_DEFAULT_RULES[cat];
  if (!def) return null;
  return Object.assign({ category: cat, source: 'HARDCODED_DEFAULT', versionId: null }, def);
}

/**
 * cmp_getCadenceDays(category, dateStr)
 * Drop-in replacement for SVMKPI_RISK.gs's old _sl_getCadenceDays() —
 * same "0 = unrecognized category" contract, now resolved from
 * CONFIG_COMPLIANCE as of a date (falling back to the same hardcoded
 * defaults) instead of a fixed lookup table.
 * @returns {number}
 */
function cmp_getCadenceDays(category, dateStr) {
  const resolved = _cmp_resolveByCategory(category, dateStr);
  return resolved ? resolved.cadenceDays : 0;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: resolveComplianceConfigurationAsOf(storeId, date) — the
// Store ID entry point
// ═══════════════════════════════════════════════════════════════

/**
 * resolveComplianceConfigurationAsOf(storeId, dateStr)
 * THE authoritative store-specific compliance-rule resolver. Resolves
 * the store's CATEGORY as of `dateStr` via Phase 1B's resolveStoreAsOf()
 * (a store's category is itself effective-dated and can change over
 * time), then resolves that category's compliance rule as of the same
 * date. Store Name is never consulted anywhere in this chain.
 *
 * Returns null if the Store ID doesn't resolve to any store as of that
 * date (unmigrated/unknown Store ID) — callers with only a raw Category
 * string already in hand (e.g. a not-yet-migrated environment reading
 * SETTINGS directly) should call _cmp_resolveByCategory() instead, the
 * same graceful-degradation pattern Phase 1B established elsewhere.
 * @param {string} storeId
 * @param {string} [dateStr] - 'YYYY-MM-DD'
 * @returns {{category, cadenceType, cadenceDays, periodDefinition, requiredCount, graceDays, source, versionId}|null}
 */
function resolveComplianceConfigurationAsOf(storeId, dateStr) {
  if (typeof resolveStoreAsOf !== 'function') return null;
  const storeResolved = resolveStoreAsOf(storeId, dateStr);
  if (!storeResolved || !storeResolved.fields || !storeResolved.fields.category) return null;
  return _cmp_resolveByCategory(storeResolved.fields.category, dateStr);
}
