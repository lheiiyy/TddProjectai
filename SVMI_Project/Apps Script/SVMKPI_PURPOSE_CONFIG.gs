// ============================================================
// SVMKPI_PURPOSE_CONFIG.gs
// Store Visit Monitoring KPI — Deliberate Purpose KPI/Risk Configuration
// (Phase 1D)
// ------------------------------------------------------------
// Contains:
//   1. Purpose configuration CRUD (thin wrapper over SVMKPI_CONFIG.gs)
//   2. purpose_getConfigurationStatus() — exists/active/hasKpiConfig/hasRiskConfig
// ------------------------------------------------------------
// Creating a new Purpose (a CONFIG_PURPOSES version) does NOT
// automatically give it KPI or risk behavior (Phase 1D business
// decision) — this file's status resolver is how the system answers
// "does this purpose actually have deliberate configuration" without
// ever silently inheriting another purpose's weight/target.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CRUD (admin-gated)
// ═══════════════════════════════════════════════════════════════

/**
 * purpose_create(purposeName, fields, effectiveFromStr, reason, options)
 * `fields.riskWeight` is OPTIONAL and deliberate — omitting it means
 * this purpose has no risk configuration of its own (see
 * purpose_getConfigurationStatus() below); it is NEVER auto-filled from
 * another purpose's weight.
 */
function purpose_create(purposeName, fields, effectiveFromStr, reason, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const id = String(purposeName || '').trim().toUpperCase();
  if (!id) return { success: false, message: 'Purpose Name cannot be blank.' };
  const withName = Object.assign({ purposeName: purposeName }, fields);
  return cfg_createConfiguration(CFG_AREA.PURPOSES, id, withName, effectiveFromStr, null, reason, options);
}

/** purpose_update(purposeName, fields, effectiveFromStr, reason, options) — full-field-set contract. */
function purpose_update(purposeName, fields, effectiveFromStr, reason, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const id = String(purposeName || '').trim().toUpperCase();
  const existing = cfg_getConfiguration(CFG_AREA.PURPOSES, id);
  if (existing.length === 0) return { success: false, message: 'Purpose has no existing configuration: ' + id };
  return purpose_create(id, fields, effectiveFromStr, reason, options);
}

function purpose_activate(versionId, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_activateConfiguration(CFG_AREA.PURPOSES, versionId, reason);
}
function purpose_deactivate(versionId, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_deactivateConfiguration(CFG_AREA.PURPOSES, versionId, reason);
}
function purpose_rollback(purposeName, targetVersionId, reason, effectiveFromStr, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const id = String(purposeName || '').trim().toUpperCase();
  return cfg_rollbackConfiguration(CFG_AREA.PURPOSES, id, targetVersionId, reason, effectiveFromStr, options);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: CONFIGURATION STATUS
// ═══════════════════════════════════════════════════════════════

/**
 * purpose_getConfigurationStatus(purposeName, dateStr)
 * Distinguishes exists / active / hasKpiConfig / hasRiskConfig as of a
 * date — never conflates them, never silently upgrades "exists" into
 * "fully configured."
 *
 * `exists`/`active`: a resolvable CONFIG_PURPOSES version (its envelope
 * Status is ACTIVE by construction — cfg_resolveConfigurationAsOf() only
 * ever returns ACTIVE-status versions), OR — for backward compatibility,
 * since the 4 original purposes (SVMKPI_CORE.gs's APPROVED_PURPOSES)
 * have always existed and been usable WITHOUT any CONFIG_PURPOSES row —
 * membership in that hardcoded list. A genuinely NEW purpose with
 * neither is reported as not existing at all, never guessed into
 * existence.
 *
 * `hasKpiConfig`/`hasRiskConfig`: purely structural — a config row (or,
 * for risk, a resolvable fallback per risk_resolvePurposeWeight()'s
 * documented chain) exists, not that any calculation currently applies
 * it (no KPI calculation exists to apply one at all — see SVMKPI_KPI_
 * CONFIG.gs's header).
 * @param {string} purposeName
 * @param {string} [dateStr]
 * @returns {{purposeName:string, exists:boolean, active:boolean, hasKpiConfig:boolean, hasRiskConfig:boolean, valid:boolean, incomplete:boolean}}
 */
function purpose_getConfigurationStatus(purposeName, dateStr) {
  const id = String(purposeName || '').trim().toUpperCase();

  const resolved = cfg_resolveConfigurationAsOf(CFG_AREA.PURPOSES, id, dateStr);
  const isLegacyApproved = typeof APPROVED_PURPOSES !== 'undefined' && APPROVED_PURPOSES.indexOf(id) !== -1;

  const exists = !!resolved || isLegacyApproved;
  const active = exists; // no separate "exists but inactive" state exists in the current app beyond
                          // the envelope's own ACTIVE/INACTIVE lifecycle, which resolution already filters on

  const hasKpiConfig = kpi_purposeHasConfig(id, dateStr);
  const hasRiskConfig = risk_resolvePurposeWeight(id, dateStr) !== null;

  return {
    purposeName: id,
    exists,
    active,
    hasKpiConfig,
    hasRiskConfig,
    valid: exists && hasKpiConfig && hasRiskConfig,
    incomplete: exists && !(hasKpiConfig && hasRiskConfig),
  };
}
