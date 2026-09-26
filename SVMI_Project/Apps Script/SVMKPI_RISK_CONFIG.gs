// ============================================================
// SVMKPI_RISK_CONFIG.gs
// Store Visit Monitoring KPI — Versioned Risk Configuration (Phase 1D)
// ------------------------------------------------------------
// Contains:
//   1. Risk configuration CRUD (thin wrapper over SVMKPI_CONFIG.gs)
//   2. resolveRiskConfigurationAsOf() — thresholds
//   3. risk_resolvePurposeWeight() — the purpose-weight fallback chain
// ------------------------------------------------------------
// SCOPE: connects the EXISTING canonical risk engine (_computeStoreRisk(),
// SVMKPI_RISK.gs — unchanged algorithm) to versioned, effective-dated
// CONFIG_RISK values. This file does NOT implement a second risk engine
// and does NOT invent new risk rules — only the numbers the existing
// algorithm already reads (thresholds, per-purpose weights) become
// configuration-driven instead of hardcoded constants.
//
// RISK configuration is GLOBAL (Entity ID = CFG_SINGLETON_ENTITY) — there
// is no per-store dimension in the existing risk-scoring algorithm
// (confirmed: _sl_riskTier()'s cutoffs and RISK_PURPOSE_SCORE's weights
// are the same for every store today). resolveRiskConfigurationAsOf()
// therefore takes only a date, not a Store ID — inventing an unused
// storeId parameter would misrepresent behavior that doesn't exist.
//
// PURPOSE WEIGHTS — the one genuinely per-entity dimension — resolve via
// a documented fallback chain (risk_resolvePurposeWeight()) rather than a
// breaking migration:
//   1. CONFIG_PURPOSES' own `riskWeight` field for that purpose, as of
//      the date (Phase 1D's deliberate, no-inheritance path — see
//      SVMKPI_PURPOSE_CONFIG.gs).
//   2. CONFIG_RISK's matching legacy named field (weightFailedQaMs, etc.),
//      as of the date — preserves the pre-Phase-1D shape with zero
//      migration required.
//   3. RISK_PURPOSE_SCORE's hardcoded constant (SVMKPI_RISK.gs) — the
//      ultimate fallback for an environment with NO CONFIG_RISK versions
//      created yet at all (zero behavior change until an admin actually
//      creates one).
//   4. null — a purpose with none of the above has NO risk configuration;
//      it contributes zero to the score, and is reported as "incomplete"
//      by purpose_getConfigurationStatus() (SVMKPI_PURPOSE_CONFIG.gs).
// Never silently reuses a DIFFERENT purpose's weight at any step.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CRUD (admin-gated; cfg_createConfiguration() re-checks too —
// same defense-in-depth double-gate pattern SVMKPI_STORE_CONFIG.gs uses)
// ═══════════════════════════════════════════════════════════════

/**
 * risk_create(fields, effectiveFromStr, reason, options)
 * Creates a new global CONFIG_RISK version. See cfg_createConfiguration()
 * for the full backdate/validation/audit contract this delegates to.
 * @returns {{success:boolean, message?:string, versionId?:string, version?:number, requiresBackdateConfirmation?:boolean}}
 */
function risk_create(fields, effectiveFromStr, reason, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_createConfiguration(CFG_AREA.RISK, CFG_SINGLETON_ENTITY, fields, effectiveFromStr, null, reason, options);
}

/** risk_activate(versionId, reason) / risk_deactivate(versionId, reason) — admin-gated. */
function risk_activate(versionId, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_activateConfiguration(CFG_AREA.RISK, versionId, reason);
}
function risk_deactivate(versionId, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_deactivateConfiguration(CFG_AREA.RISK, versionId, reason);
}

/**
 * risk_rollback(targetVersionId, reason, effectiveFromStr, options)
 * Reuses Phase 1A's rollback-as-new-version behavior unchanged.
 */
function risk_rollback(targetVersionId, reason, effectiveFromStr, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return cfg_rollbackConfiguration(CFG_AREA.RISK, CFG_SINGLETON_ENTITY, targetVersionId, reason, effectiveFromStr, options);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: resolveRiskConfigurationAsOf() — thresholds
// ═══════════════════════════════════════════════════════════════

// Hardcoded pre-Phase-1D defaults — _sl_riskTier()'s literal cutoffs
// (SVMKPI_RISK.gs). `lowThreshold` has no real comparison anywhere in
// the existing algorithm (only medium/high cutoffs are consumed); it is
// stored/resolved for schema completeness but never compared against —
// documented here rather than inventing a new comparison that doesn't
// exist in the current app.
const RISK_CFG_DEFAULT_THRESHOLDS = { lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 };

/**
 * resolveRiskConfigurationAsOf(dateStr)
 * Returns the risk thresholds effective as of `dateStr` (default: today).
 * Falls back to RISK_CFG_DEFAULT_THRESHOLDS when no CONFIG_RISK version
 * has ever been created — zero behavior change pre-migration.
 * @param {string} [dateStr] - 'YYYY-MM-DD'
 * @returns {{lowThreshold:number, mediumThreshold:number, highThreshold:number, source:string, versionId:(string|null)}}
 */
function resolveRiskConfigurationAsOf(dateStr) {
  const resolved = cfg_resolveConfigurationAsOf(CFG_AREA.RISK, CFG_SINGLETON_ENTITY, dateStr);
  if (!resolved) {
    return Object.assign({ source: 'HARDCODED_DEFAULT', versionId: null }, RISK_CFG_DEFAULT_THRESHOLDS);
  }
  const f = resolved.fields || {};
  return {
    lowThreshold: f.lowThreshold != null && f.lowThreshold !== '' ? Number(f.lowThreshold) : RISK_CFG_DEFAULT_THRESHOLDS.lowThreshold,
    mediumThreshold: f.mediumThreshold != null && f.mediumThreshold !== '' ? Number(f.mediumThreshold) : RISK_CFG_DEFAULT_THRESHOLDS.mediumThreshold,
    highThreshold: f.highThreshold != null && f.highThreshold !== '' ? Number(f.highThreshold) : RISK_CFG_DEFAULT_THRESHOLDS.highThreshold,
    source: 'CONFIG_RISK',
    versionId: resolved.versionId,
  };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: risk_resolvePurposeWeight() — the fallback chain
// ═══════════════════════════════════════════════════════════════

// Maps the 4 pre-existing purposes to CONFIG_RISK's fixed named legacy
// fields — must stay in sync with CFG_AREA_SCHEMAS.RISK's field keys and
// RISK_PURPOSE_SCORE's keys (SVMKPI_RISK.gs), never independently edited.
const RISK_CFG_LEGACY_PURPOSE_FIELD = {
  'FAILED QA/MS':    'weightFailedQaMs',
  'STORE VISIT':     'weightStoreVisit',
  'CURING/SUPPORT':  'weightCuringSupport',
  'TLTC':            'weightTltc',
};

/**
 * risk_resolvePurposeWeight(purposeName, dateStr)
 * The fallback chain documented at the top of this file. Never reuses a
 * DIFFERENT purpose's weight at any step.
 * @param {string} purposeName - normalized (e.g. 'STORE VISIT')
 * @param {string} [dateStr] - 'YYYY-MM-DD'
 * @returns {{weight:number, source:string}|null} null = no risk
 *   configuration at all for this purpose as of this date
 */
function risk_resolvePurposeWeight(purposeName, dateStr) {
  const purpose = String(purposeName || '').trim().toUpperCase();
  if (!purpose) return null;

  // 1. Deliberate, per-purpose override (Phase 1D's no-inheritance path).
  const purposeResolved = cfg_resolveConfigurationAsOf(CFG_AREA.PURPOSES, purpose, dateStr);
  if (purposeResolved && purposeResolved.fields && purposeResolved.fields.riskWeight != null && purposeResolved.fields.riskWeight !== '') {
    const w = Number(purposeResolved.fields.riskWeight);
    if (!isNaN(w)) return { weight: w, source: 'PURPOSE_CONFIG' };
  }

  // 2. CONFIG_RISK's legacy named field, if this purpose has one.
  const legacyField = RISK_CFG_LEGACY_PURPOSE_FIELD[purpose];
  if (legacyField) {
    const riskResolved = cfg_resolveConfigurationAsOf(CFG_AREA.RISK, CFG_SINGLETON_ENTITY, dateStr);
    if (riskResolved && riskResolved.fields && riskResolved.fields[legacyField] != null && riskResolved.fields[legacyField] !== '') {
      const w = Number(riskResolved.fields[legacyField]);
      if (!isNaN(w)) return { weight: w, source: 'RISK_CONFIG_LEGACY' };
    }

    // 3. Ultimate hardcoded fallback — no CONFIG_RISK version exists yet.
    if (typeof RISK_PURPOSE_SCORE !== 'undefined' && RISK_PURPOSE_SCORE[purpose] != null) {
      return { weight: RISK_PURPOSE_SCORE[purpose], source: 'HARDCODED_DEFAULT' };
    }
  }

  // 4. A genuinely new purpose with no configuration anywhere.
  return null;
}
