// database/dryrun/purpose_operational_readiness.js
//
// Phase 2C: operational readiness for Purposes — a dry-run mirror of the
// EXISTING production configuration architecture
// (SVMI_Project/Apps Script/SVMKPI_PURPOSE_CONFIG.gs's
// purpose_getConfigurationStatus() and SVMKPI_ADMIN_API.gs's
// admin_listPurposes()), not a new model invented for this phase.
//
// Distinct concern from purpose_reconciliation.js: that module answers
// "what purposes exist across the migration's three source systems, and
// what should be DECIDED about a discrepancy" (a one-time migration
// question). This module answers "is a purpose CURRENTLY active/
// selectable, and is it ready for the reporting pipeline" (an ongoing
// operational question) — additive only, and it never overwrites a
// purpose_reconciliation.js field.
//
// Core guarantee (mirrors the real system's own documented guarantee in
// SVMKPI_RISK_CONFIG.gs: "Never silently reuses a DIFFERENT purpose's
// weight at any step"): a purpose's KPI/Risk configuration is looked up
// by its own exact key only. A purpose with no entry in
// `deliberateConfigurations` has NO configuration — it is never
// defaulted from another purpose's entry, from legacy behavior, or from
// its own historical usage/workbook presence.
//
// A brand-new purpose becomes active/selectable, and later report-
// eligible, purely by being given an entry in `deliberateConfigurations`
// — no purpose-specific code path is ever added here or anywhere
// downstream; see the generic discovery functions at the bottom.

const PURPOSE_OPERATIONAL_STATUS = {
  // Legacy-approved, or has at least one deliberate configuration entry.
  // Mirrors purpose_getConfigurationStatus()'s `exists`/`active` (in the
  // real app these never diverge today — see that function's own
  // comment).
  ACTIVE_SELECTABLE: 'ACTIVE_SELECTABLE',
  // Neither legacy-approved nor deliberately configured. This is CAPAR's
  // current state: it has real historical usage and real workbook
  // presence (see purpose_reconciliation.js), but no CONFIG_PURPOSES-
  // equivalent record was created for it — those facts are evidence a
  // gap exists, never evidence sufficient to make it active by
  // themselves.
  INACTIVE_NOT_SELECTABLE: 'INACTIVE_NOT_SELECTABLE',
};

/**
 * One purpose's configuration status, mirroring
 * purpose_getConfigurationStatus() (SVMKPI_PURPOSE_CONFIG.gs) field for
 * field. A pure function of its two inputs — no lookup, no I/O, no
 * purpose-name branching.
 *
 * @param {boolean} legacyApproved - already computed elsewhere (e.g.
 *   purpose_reconciliation.js's own `legacyApproved` field) — never
 *   re-derived here, so there is exactly one place that decides legacy
 *   membership.
 * @param {{hasKpiConfig?: boolean, hasRiskConfig?: boolean}} [deliberateConfiguration] -
 *   this purpose's OWN entry only (the caller must look it up by its own
 *   exact key before calling this function — see annotateWithOperationalStatus()).
 */
function resolvePurposeConfigurationStatus({ legacyApproved, deliberateConfiguration }) {
  const exists = !!legacyApproved || !!deliberateConfiguration;
  // No separate "exists but administratively disabled" state exists yet
  // (same as the real function) — documented here rather than inventing
  // one that has no corresponding production concept.
  const active = exists;
  const hasKpiConfig = !!(deliberateConfiguration && deliberateConfiguration.hasKpiConfig);
  const hasRiskConfig = !!(deliberateConfiguration && deliberateConfiguration.hasRiskConfig);

  return {
    exists,
    active,
    hasKpiConfig,
    hasRiskConfig,
    valid: exists && hasKpiConfig && hasRiskConfig,
    incomplete: exists && !(hasKpiConfig && hasRiskConfig),
    operationalStatus: active
      ? PURPOSE_OPERATIONAL_STATUS.ACTIVE_SELECTABLE
      : PURPOSE_OPERATIONAL_STATUS.INACTIVE_NOT_SELECTABLE,
  };
}

/**
 * Annotates a purpose_reconciliation.js result with operational
 * readiness — additively. Every existing field (`sourceValue`,
 * `sourceStatus`, `reconciliationDecision`, `configurationStatus`,
 * `historicalUseCount`, `historicalRowRefs`, ...) is copied through
 * completely unchanged; only a new, non-colliding
 * `operationalConfigurationStatus` object is added per purpose. Never
 * mutates its input.
 *
 * @param {Object} reconciliationResult - the object returned by
 *   purpose_reconciliation.js's reconcilePurposeSources().
 * @param {Object<string,{hasKpiConfig?:boolean, hasRiskConfig?:boolean}>} [deliberateConfigurations] -
 *   EXTERNAL, explicit per-purpose configuration facts keyed by
 *   `normalizedValue`. This mirrors the real CONFIG_PURPOSES/CONFIG_KPI/
 *   CONFIG_RISK versions — it is supplied by the caller, never derived
 *   from historical usage, workbook presence, or another purpose's
 *   entry.
 */
function annotateWithOperationalStatus(reconciliationResult, deliberateConfigurations) {
  const configs = deliberateConfigurations || {};
  const purposes = reconciliationResult.purposes.map((p) => {
    // Exact-key lookup only — a purpose absent from `configs` gets
    // `undefined`, never another purpose's entry.
    const deliberateConfiguration = configs[p.normalizedValue];
    return {
      ...p,
      operationalConfigurationStatus: resolvePurposeConfigurationStatus({
        legacyApproved: p.legacyApproved,
        deliberateConfiguration,
      }),
    };
  });

  return {
    ...reconciliationResult,
    purposes,
    activeSelectableCount: purposes.filter((p) => p.operationalConfigurationStatus.active).length,
    reportEligibleCount: purposes.filter((p) => p.operationalConfigurationStatus.valid).length,
  };
}

/**
 * The operational/admin purpose list — every purpose currently
 * active/selectable. Generic: reads only `operationalConfigurationStatus`,
 * never a purpose name. Mirrors admin_listPurposes() filtered to
 * `active` (SVMKPI_ADMIN_API.gs).
 */
function getActiveSelectablePurposes(annotatedResult) {
  return annotatedResult.purposes.filter((p) => p.operationalConfigurationStatus.active);
}

/**
 * The purposes actually eligible for the normal reporting pipeline right
 * now — `valid` (exists AND has both KPI and Risk configuration).
 * Generic: this is the ONE place a report generator should ask "which
 * purposes do I include," instead of iterating a hardcoded list of
 * purpose names.
 */
function getReportEligiblePurposes(annotatedResult) {
  return annotatedResult.purposes.filter((p) => p.operationalConfigurationStatus.valid);
}

/**
 * Purposes that exist/are known but are not yet report-ready — the
 * explicit "configuration pending" state Rule D requires (never silently
 * folded into another purpose, never silently treated as report-ready).
 */
function getPendingAnalyticsConfigurationPurposes(annotatedResult) {
  return annotatedResult.purposes.filter((p) => p.operationalConfigurationStatus.incomplete);
}

module.exports = {
  PURPOSE_OPERATIONAL_STATUS,
  resolvePurposeConfigurationStatus,
  annotateWithOperationalStatus,
  getActiveSelectablePurposes,
  getReportEligiblePurposes,
  getPendingAnalyticsConfigurationPurposes,
};
