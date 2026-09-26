// database/dryrun/reconcile_purposes.js
//
// Purpose reconciliation (Phase 2 rule #8). Classifies every purpose seen
// anywhere in the real data — never creates configuration to satisfy the
// migration (the established rule: "a new purpose requires deliberate
// KPI/risk configuration").
//
// Inputs:
//   legacyPurposeIds: the 4 APPROVED_PURPOSES (from SVMKPI_CORE.gs,
//     passed in explicitly rather than hardcoded here, so this module
//     stays a pure function of its inputs)
//   configPurposeVersions: [{ entityId, effectiveFrom, envelopeStatus, riskWeight, ... }]
//   kpiConfigurationVersions: [{ purposeId, ... }] (nullable purposeId link)
//   riskConfigVersions: [{ weightFailedQaMs, weightStoreVisit, weightCuringSupport, weightTltc, ... }]
//   masterLogRows: raw rows with `purpose`, `dateVisited`, `rowRef`

const { parseDateCell } = require('./date_parse');

function reconcilePurposes({ legacyPurposeIds, configPurposeVersions, kpiConfigurationVersions, masterLogRows }) {
  const legacySet = new Set(legacyPurposeIds);
  const configuredIds = new Set(configPurposeVersions.map((v) => v.entityId));
  const kpiLinkedIds = new Set((kpiConfigurationVersions || []).map((v) => v.purposeId).filter(Boolean));

  const earliestConfigByPurpose = new Map();
  for (const v of configPurposeVersions) {
    const cur = earliestConfigByPurpose.get(v.entityId);
    if (!cur || v.effectiveFrom < cur) earliestConfigByPurpose.set(v.entityId, v.effectiveFrom);
  }
  const latestEnvelopeByPurpose = new Map();
  for (const v of configPurposeVersions) {
    const cur = latestEnvelopeByPurpose.get(v.entityId);
    if (!cur || v.effectiveFrom > cur.effectiveFrom) latestEnvelopeByPurpose.set(v.entityId, v);
  }

  const report = {
    withConfiguration: [],      // has at least one purpose_versions row (deliberately configured risk weight)
    withoutConfiguration: [],   // used in MASTER_LOG, no configuration, not legacy either
    legacy: [],                 // one of the 4 APPROVED_PURPOSES
    inactive: [],                // latest configured version's envelope_status = INACTIVE
    unknown: [],                 // used in MASTER_LOG, not legacy, no configuration at all
    kpiLinked: Array.from(kpiLinkedIds),
    preConfigurationHistoricalUsage: [], // MASTER_LOG rows using a purpose BEFORE its earliest configuration version existed
  };

  const seenInLog = new Set();
  for (const row of masterLogRows || []) {
    const purpose = String(row.purpose || '').trim();
    if (!purpose) continue;
    seenInLog.add(purpose);

    if (configuredIds.has(purpose)) {
      const earliestConfig = earliestConfigByPurpose.get(purpose);
      const visitDate = parseDateCell(row.dateVisited);
      if (visitDate && earliestConfig) {
        const visitIso = visitDate.toISOString().slice(0, 10);
        if (visitIso < earliestConfig) {
          report.preConfigurationHistoricalUsage.push({ purpose, rowRef: row.rowRef, visitDate: visitIso, earliestConfigEffectiveFrom: earliestConfig });
        }
      }
    }
  }

  for (const p of seenInLog) {
    if (legacySet.has(p)) {
      report.legacy.push(p);
    } else if (configuredIds.has(p)) {
      report.withConfiguration.push(p);
    } else {
      report.unknown.push(p);
      report.withoutConfiguration.push(p);
    }
  }

  for (const [purpose, v] of latestEnvelopeByPurpose) {
    if (v.envelopeStatus === 'INACTIVE') report.inactive.push(purpose);
  }

  return report;
}

module.exports = { reconcilePurposes };
