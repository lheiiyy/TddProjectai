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


// ═══════════════════════════════════════════════════════════════
// SECTION 3: LEGACY SETTINGS MIRROR (Phase 1G)
// ═══════════════════════════════════════════════════════════════

/**
 * _purposeSync_toSettings(purposeName)
 * Called by SVMKPI_CONFIG.gs's _cfg_syncLegacyMirror() after every
 * successful CONFIG_PURPOSES mutation for this name. Uses
 * purpose_getConfigurationStatus()'s own `active` — NOT a raw
 * cfg_resolveConfigurationAsOf() check — so that deactivating a
 * CONFIG_PURPOSES row for one of the 4 legacy APPROVED_PURPOSES (which
 * are always usable regardless of any CONFIG_PURPOSES version, per that
 * function's own documented legacy fallback) never removes it from the
 * SETTINGS!H list it has always belonged to.
 * Reuses managePurpose() (INPUT_PORTAL.gs), typeof-guarded for sandboxes
 * that load this file alone.
 */
function _purposeSync_toSettings(purposeName) {
  if (typeof managePurpose !== 'function') return;
  const status = purpose_getConfigurationStatus(purposeName);
  managePurpose(status.active ? 'add' : 'remove', purposeName);
}

/**
 * purpose_migrateFromSettings(settingsPurposeNames)
 * One-time (per environment) migration companion to
 * store_migrateFromSettings()/visitor_migrateFromSettings() — creates a
 * CONFIG_PURPOSES version for every name in `settingsPurposeNames` that
 * isn't already "active" per purpose_getConfigurationStatus() (which
 * already covers the 4 legacy APPROVED_PURPOSES without needing a row —
 * those are correctly skipped here, not re-created). Effective from
 * today, same honest-boundary reasoning as the Visitor/Store migrations.
 * Safe to re-run. Admin-gated.
 *
 * A name that fails purpose_create()'s own validation is reported here
 * in `failed`, with the reason, rather than silently vanishing.
 * @param {string[]} settingsPurposeNames
 * @returns {{success:boolean, message?:string, createdNames?:string[], alreadyMigrated?:string[], failed?:{name:string, message:string}[]}}
 */
function purpose_migrateFromSettings(settingsPurposeNames) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const created = [];
  const alreadyMigrated = [];
  const failed = [];
  const seen = {};

  (settingsPurposeNames || []).forEach(raw => {
    const name = String(raw || '').trim().toUpperCase();
    if (!name || seen[name]) return;
    seen[name] = true;

    if (purpose_getConfigurationStatus(name).active) {
      alreadyMigrated.push(name);
      return;
    }

    const result = purpose_create(name, {}, todayStr, 'Migrated from SETTINGS', {});
    if (result.success) {
      created.push(name);
    } else {
      failed.push({ name, message: result.message || 'Unknown error.' });
    }
  });

  return { success: true, createdNames: created, alreadyMigrated, failed };
}
