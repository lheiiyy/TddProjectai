// ============================================================
// SVMKPI_KPI_CONFIG.gs
// Store Visit Monitoring KPI — Versioned KPI Weight/Target Configuration
// (Phase 1D)
// ------------------------------------------------------------
// Contains:
//   1. KPI configuration CRUD (thin wrapper over SVMKPI_CONFIG.gs)
//   2. resolveKPIConfigurationAsOf(kpiId, date)
//   3. kpi_purposeHasConfig() — the Purpose-configuration-status helper
// ------------------------------------------------------------
// DOCUMENTED GAP (see CFG_AREA_SCHEMAS.KPI's own comment, SVMKPI_CONFIG.gs,
// and DEPLOY.md's Phase 1D section): the existing year-neutral KPI engine
// (buildKPI2026()/getKPI2026Report(), SVMKPI_KPI_REBUILD.gs/SVMKPI_
// REPORTS.gs) is a pure visit-count tracker with NO weighting, scoring,
// or target-comparison logic anywhere — confirmed absent since the
// original Phase 0 audit and Phase 1A's own schema comment. This file
// builds ONLY the configuration storage/validation/effective-dated-
// resolution INFRASTRUCTURE (entity id = kpiName), per Phase 1D's own
// "no business-rule invention" constraint. It does NOT wire a weight or
// target into any live calculation, because no live calculation exists
// to consume one yet.
//
// Entity ID = normalized `kpiName` (interim, same discipline as
// CONFIG_VISITORS/CONFIG_PURPOSES). "No duplicate KPI configurations" is
// already enforced generically by cfg_createConfiguration()'s existing
// same-exact-Effective-From / overlapping-window rejection (Phase 1A) —
// nothing new needed here.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CRUD (admin-gated)
// ═══════════════════════════════════════════════════════════════

/**
 * kpi_create(kpiName, fields, effectiveFromStr, reason, options)
 * @param {string} kpiName
 * @param {{targetValue?:*, targetType?:string, weight?:number, purposeRef?:string}} fields
 * @returns {{success:boolean, message?:string, versionId?:string, version?:number, requiresBackdateConfirmation?:boolean}}
 */
function kpi_create(kpiName, fields, effectiveFromStr, reason, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const id = String(kpiName || '').trim().toUpperCase();
  if (!id) return { success: false, message: 'KPI Name cannot be blank.' };
  const withName = Object.assign({ kpiName: kpiName }, fields);
  return cfg_createConfiguration(CFG_AREA.KPI, id, withName, effectiveFromStr, null, reason, options);
}

/** kpi_update(kpiName, fields, effectiveFromStr, reason, options) — full-field-set, same contract as kpi_create(). */
function kpi_update(kpiName, fields, effectiveFromStr, reason, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const id = String(kpiName || '').trim().toUpperCase();
  const existing = cfg_getConfiguration(CFG_AREA.KPI, id);
  if (existing.length === 0) return { success: false, message: 'KPI has no existing configuration: ' + id };
  return kpi_create(id, fields, effectiveFromStr, reason, options);
}

function kpi_activate(versionId, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_activateConfiguration(CFG_AREA.KPI, versionId, reason);
}
function kpi_deactivate(versionId, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_deactivateConfiguration(CFG_AREA.KPI, versionId, reason);
}
function kpi_rollback(kpiName, targetVersionId, reason, effectiveFromStr, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const id = String(kpiName || '').trim().toUpperCase();
  return cfg_rollbackConfiguration(CFG_AREA.KPI, id, targetVersionId, reason, effectiveFromStr, options);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: RESOLUTION
// ═══════════════════════════════════════════════════════════════

/**
 * resolveKPIConfigurationAsOf(kpiId, dateStr)
 * Returns the KPI configuration version effective as of `dateStr`
 * (default: today), or null if the KPI has no version at all as of that
 * date. Pure resolution — this is infrastructure only; see this file's
 * header for why it is not wired into any calculation.
 * @param {string} kpiId
 * @param {string} [dateStr]
 * @returns {{versionId, kpiName:string, targetValue:*, targetType:(string|null), weight:(number|null), purposeRef:(string|null)}|null}
 */
function resolveKPIConfigurationAsOf(kpiId, dateStr) {
  const id = String(kpiId || '').trim().toUpperCase();
  if (!id) return null;
  const resolved = cfg_resolveConfigurationAsOf(CFG_AREA.KPI, id, dateStr);
  if (!resolved) return null;
  const f = resolved.fields || {};
  return {
    versionId: resolved.versionId,
    kpiName: f.kpiName || id,
    targetValue: f.targetValue != null && f.targetValue !== '' ? f.targetValue : null,
    targetType: f.targetType || null,
    weight: f.weight != null && f.weight !== '' ? Number(f.weight) : null,
    purposeRef: f.purposeRef || null,
  };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: PURPOSE-CONFIGURATION-STATUS HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * kpi_purposeHasConfig(purposeName, dateStr)
 * Whether ANY KPI entity's resolved-as-of-date version references this
 * purpose via `purposeRef` — purely structural (a config row exists), not
 * "is being applied in a calculation" (see this file's header). Used by
 * purpose_getConfigurationStatus() (SVMKPI_PURPOSE_CONFIG.gs).
 * @param {string} purposeName
 * @param {string} [dateStr]
 * @returns {boolean}
 */
function kpi_purposeHasConfig(purposeName, dateStr) {
  const purpose = String(purposeName || '').trim().toUpperCase();
  if (!purpose) return false;

  const allVersions = cfg_getConfiguration(CFG_AREA.KPI); // every entity, every version
  const kpiIds = {};
  allVersions.forEach(v => { kpiIds[v.entityId] = true; });

  return Object.keys(kpiIds).some(id => {
    const resolved = resolveKPIConfigurationAsOf(id, dateStr);
    return resolved && String(resolved.purposeRef || '').trim().toUpperCase() === purpose;
  });
}
