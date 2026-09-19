// database/dryrun/purpose_reconciliation.js
//
// Cross-source Purpose reconciliation. Distinct from reconcile_purposes.js
// (which reconciles MASTER_LOG usage against a *versioned CONFIG_PURPOSES*
// dataset that does not exist in production). This module instead
// reconciles across the three sources that DO exist for every real
// purpose: the legacy application's hardcoded `APPROVED_PURPOSES`, the
// workbook's own selectable Visit-Type/purpose list, and actual
// MASTER_LOG historical usage — plus an explicit, external administrative
// decision layer (mirrors the Store/Visitor reconciliation pattern: never
// invent a decision, only ever apply one that was supplied).
//
// Never creates KPI weight, KPI target, risk weight, risk rule, or
// compliance rule configuration — that is explicitly out of scope
// (Phase 1D's rule: a new purpose requires a SEPARATE, deliberate
// configuration step). Never mutates a source record; every function
// here is a pure read of its inputs.

function normalize(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

const PURPOSE_SOURCE_STATUS = {
  // Present in the legacy application's hardcoded APPROVED_PURPOSES.
  // Dominant fact — a legacy-approved purpose is reported as such
  // regardless of its workbook/historical facts (all 4 legacy purposes
  // in the real data are also workbook-selectable and historically used).
  LEGACY_APPROVED: 'LEGACY_APPROVED',
  // Not legacy-approved. Selectable in the workbook's own purpose list,
  // but never actually used in MASTER_LOG history.
  WORKBOOK_ONLY: 'WORKBOOK_ONLY',
  // Not legacy-approved, not selectable in the workbook's list, but
  // appears historically in MASTER_LOG (e.g. a retired/typo'd value).
  HISTORICAL_ONLY: 'HISTORICAL_ONLY',
  // Not legacy-approved, but BOTH selectable in the workbook's list AND
  // used historically — the real-data state CAPAR is in.
  WORKBOOK_AND_HISTORICAL: 'WORKBOOK_AND_HISTORICAL',
  // Not legacy-approved, not workbook-selectable, not historically used.
  // Should not occur from real evidence — exists as a type rather than
  // a case this module ever needs to guess into.
  UNRESOLVED: 'UNRESOLVED',
};

const PURPOSE_RECONCILIATION_DECISION = {
  // A legacy-approved purpose needs no reconciliation decision — it is
  // already an established purpose of the application.
  EXISTING_PURPOSE: 'EXISTING_PURPOSE',
  // An EXTERNAL, explicit administrative decision that a non-legacy
  // purpose should be configured as a new purpose. Never inferred from
  // historical usage or workbook presence alone.
  CONFIGURE_AS_NEW_PURPOSE: 'CONFIGURE_AS_NEW_PURPOSE',
  // No administrative decision has been recorded yet for a non-legacy
  // purpose — never defaulted to CONFIGURE_AS_NEW_PURPOSE by guessing.
  HUMAN_REVIEW: 'HUMAN_REVIEW',
};

const CONFIGURATION_STATUS = {
  // A legacy-approved purpose's operational behavior is already
  // established by the existing application logic itself.
  ESTABLISHED: 'ESTABLISHED',
  // Explicitly decided CONFIGURE_AS_NEW_PURPOSE, but no KPI weight, KPI
  // target, risk weight, risk rule, or compliance rule has actually been
  // assigned yet — that is a separate, deliberate future step. Never
  // reported as "ACTIVE" while this is true.
  PENDING_DELIBERATE_CONFIGURATION: 'PENDING_DELIBERATE_CONFIGURATION',
  // No administrative decision recorded at all.
  UNCONFIRMED: 'UNCONFIRMED',
};

/**
 * @param {Object} params
 * @param {string[]} params.legacyPurposeIds - the legacy application's hardcoded APPROVED_PURPOSES, verbatim
 * @param {string[]} params.workbookSelectablePurposes - the workbook's own selectable Visit-Type/purpose list, verbatim
 * @param {Array<{purpose: string, rowRef: string}>} params.masterLogRows - raw historical rows (only `purpose`/`rowRef` are read)
 * @param {Object<string,{decision: string, rationale?: string}>} [params.administrativeDecisions] -
 *   EXTERNAL, explicit decisions keyed by normalized purpose name (e.g. { CAPAR: { decision: 'CONFIGURE_AS_NEW_PURPOSE' } }).
 *   Never derived by this function — only ever applied because supplied.
 */
function reconcilePurposeSources({ legacyPurposeIds, workbookSelectablePurposes, masterLogRows, administrativeDecisions }) {
  const decisions = administrativeDecisions || {};

  const legacyByNorm = new Map();
  for (const p of legacyPurposeIds || []) legacyByNorm.set(normalize(p), p);

  const workbookByNorm = new Map();
  for (const p of workbookSelectablePurposes || []) workbookByNorm.set(normalize(p), p);

  const historicalByNorm = new Map();
  for (const row of masterLogRows || []) {
    const raw = row.purpose;
    if (raw == null || String(raw).trim() === '') continue;
    const norm = normalize(raw);
    if (!historicalByNorm.has(norm)) {
      historicalByNorm.set(norm, { sourceValue: String(raw).trim(), count: 0, rowRefs: [] });
    }
    const entry = historicalByNorm.get(norm);
    entry.count += 1;
    entry.rowRefs.push(row.rowRef);
  }

  const allNorms = new Set([...legacyByNorm.keys(), ...workbookByNorm.keys(), ...historicalByNorm.keys()]);
  const purposes = [];

  for (const norm of allNorms) {
    const legacyApproved = legacyByNorm.has(norm);
    const workbookSelectable = workbookByNorm.has(norm);
    const historicalEntry = historicalByNorm.get(norm);
    const historicalUseCount = historicalEntry ? historicalEntry.count : 0;
    const historicalRowRefs = historicalEntry ? historicalEntry.rowRefs : [];

    // Preserve original casing: prefer the legacy list's own text, then
    // the workbook list's, then the first historical occurrence's —
    // never the normalized value. This is a source-of-truth precedence
    // for DISPLAY only; the join itself is done on the normalized key.
    const sourceValue = legacyByNorm.get(norm) || workbookByNorm.get(norm) || (historicalEntry ? historicalEntry.sourceValue : norm);

    let sourceStatus;
    if (legacyApproved) {
      sourceStatus = PURPOSE_SOURCE_STATUS.LEGACY_APPROVED;
    } else if (workbookSelectable && historicalUseCount > 0) {
      sourceStatus = PURPOSE_SOURCE_STATUS.WORKBOOK_AND_HISTORICAL;
    } else if (workbookSelectable) {
      sourceStatus = PURPOSE_SOURCE_STATUS.WORKBOOK_ONLY;
    } else if (historicalUseCount > 0) {
      sourceStatus = PURPOSE_SOURCE_STATUS.HISTORICAL_ONLY;
    } else {
      sourceStatus = PURPOSE_SOURCE_STATUS.UNRESOLVED;
    }

    let reconciliationDecision;
    let configurationStatus;
    let evidence;
    const administrativeDecision = decisions[norm];

    if (legacyApproved) {
      reconciliationDecision = PURPOSE_RECONCILIATION_DECISION.EXISTING_PURPOSE;
      configurationStatus = CONFIGURATION_STATUS.ESTABLISHED;
      evidence = 'Present in the legacy application\'s hardcoded APPROVED_PURPOSES — an already-established purpose.';
    } else if (administrativeDecision && administrativeDecision.decision === PURPOSE_RECONCILIATION_DECISION.CONFIGURE_AS_NEW_PURPOSE) {
      reconciliationDecision = PURPOSE_RECONCILIATION_DECISION.CONFIGURE_AS_NEW_PURPOSE;
      // Explicitly PENDING, never "ACTIVE" or "ESTABLISHED" — no KPI
      // weight/target, risk weight/rule, or compliance rule has been
      // assigned. That is a separate, deliberate future step.
      configurationStatus = CONFIGURATION_STATUS.PENDING_DELIBERATE_CONFIGURATION;
      evidence = administrativeDecision.rationale
        || 'Business has explicitly decided this purpose should be configured as a new purpose. Historical usage and workbook presence are evidence that a real gap exists, never evidence sufficient by themselves to invent configuration.';
    } else {
      reconciliationDecision = PURPOSE_RECONCILIATION_DECISION.HUMAN_REVIEW;
      configurationStatus = CONFIGURATION_STATUS.UNCONFIRMED;
      evidence = 'Not legacy-approved and no administrative decision has been recorded — remains unresolved pending a business decision.';
    }

    purposes.push({
      sourceValue,
      normalizedValue: norm,
      workbookSelectable,
      legacyApproved,
      historicalUseCount,
      historicalRowRefs,
      sourceStatus,
      reconciliationDecision,
      configurationStatus,
      evidence,
      unresolvedFlag: reconciliationDecision === PURPOSE_RECONCILIATION_DECISION.HUMAN_REVIEW,
    });
  }

  purposes.sort((a, b) => a.normalizedValue.localeCompare(b.normalizedValue));

  return {
    totalPurposes: purposes.length,
    legacyApprovedCount: purposes.filter((p) => p.sourceStatus === PURPOSE_SOURCE_STATUS.LEGACY_APPROVED).length,
    workbookAndHistoricalCount: purposes.filter((p) => p.sourceStatus === PURPOSE_SOURCE_STATUS.WORKBOOK_AND_HISTORICAL).length,
    workbookOnlyCount: purposes.filter((p) => p.sourceStatus === PURPOSE_SOURCE_STATUS.WORKBOOK_ONLY).length,
    historicalOnlyCount: purposes.filter((p) => p.sourceStatus === PURPOSE_SOURCE_STATUS.HISTORICAL_ONLY).length,
    unresolvedCount: purposes.filter((p) => p.unresolvedFlag).length,
    purposes,
  };
}

module.exports = {
  PURPOSE_SOURCE_STATUS,
  PURPOSE_RECONCILIATION_DECISION,
  CONFIGURATION_STATUS,
  normalize,
  reconcilePurposeSources,
};
