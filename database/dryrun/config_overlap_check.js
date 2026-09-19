// database/dryrun/config_overlap_check.js
//
// Effective-dated configuration overlap/gap checks (Phase 2 rule #12),
// generic across every config area (Store/Visitor/Purpose/Risk/
// Compliance/KPI/System) since they all share the same versioning
// envelope (version_num, effective_from, effective_to, envelope_status)
// established in Phase 1A.
//
// This module only DETECTS and REPORTS — it never resolves a conflict by
// altering source data (rule #12's own closing line). Each finding
// carries a `requiresHumanClassification: true` flag rather than an
// assumed verdict, because the phase's own instruction is to determine
// per real finding whether it is (1) a valid historical state, (2) a
// source-data defect, (3) a migration-model mismatch, or (4) an
// implementation defect — a judgment call that needs the actual data in
// front of a human, not a hardcoded guess.

function checkConfigOverlaps(versions, { areaName }) {
  const findings = [];
  const byEntity = new Map();
  for (const v of versions) {
    if (!byEntity.has(v.entityId)) byEntity.set(v.entityId, []);
    byEntity.get(v.entityId).push(v);
  }

  for (const [entityId, list] of byEntity) {
    const seenVersionNums = new Map();
    const seenEffectiveFrom = new Map();
    let openEndedActiveCount = 0;

    for (const v of list) {
      if (!v.effectiveFrom) {
        findings.push({ areaName, entityId, type: 'MISSING_EFFECTIVE_FROM', detail: v, requiresHumanClassification: true });
      }
      if (v.effectiveTo && v.effectiveFrom && v.effectiveTo < v.effectiveFrom) {
        findings.push({ areaName, entityId, type: 'INVALID_EFFECTIVE_RANGE', detail: v, requiresHumanClassification: true });
      }
      if (v.envelopeStatus !== 'ACTIVE' && v.envelopeStatus !== 'INACTIVE') {
        findings.push({ areaName, entityId, type: 'INVALID_ENVELOPE_STATUS', detail: v, requiresHumanClassification: true });
      }
      if (v.versionNum != null) {
        if (seenVersionNums.has(v.versionNum)) {
          findings.push({ areaName, entityId, type: 'DUPLICATE_VERSION_NUM', detail: { versionNum: v.versionNum, rows: [seenVersionNums.get(v.versionNum), v] }, requiresHumanClassification: true });
        } else {
          seenVersionNums.set(v.versionNum, v);
        }
      }
      if (v.effectiveFrom) {
        if (seenEffectiveFrom.has(v.effectiveFrom)) {
          findings.push({ areaName, entityId, type: 'DUPLICATE_EFFECTIVE_FROM', detail: { effectiveFrom: v.effectiveFrom, rows: [seenEffectiveFrom.get(v.effectiveFrom), v] }, requiresHumanClassification: true });
        } else {
          seenEffectiveFrom.set(v.effectiveFrom, v);
        }
      }
      if (v.envelopeStatus === 'ACTIVE' && !v.effectiveTo) {
        openEndedActiveCount += 1;
      }
    }

    if (openEndedActiveCount > 1) {
      findings.push({ areaName, entityId, type: 'MULTIPLE_SIMULTANEOUS_OPEN_ACTIVE_VERSIONS', detail: { count: openEndedActiveCount }, requiresHumanClassification: true });
    }

    // Pairwise overlap check on [effectiveFrom, effectiveTo || +Infinity).
    const sorted = list.filter((v) => v.effectiveFrom).slice().sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const aEnd = a.effectiveTo || '9999-12-31';
        const bEnd = b.effectiveTo || '9999-12-31';
        const overlaps = a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd;
        if (overlaps) {
          findings.push({ areaName, entityId, type: 'OVERLAPPING_EFFECTIVE_RANGES', detail: { a, b }, requiresHumanClassification: true });
        }
      }
    }
  }

  return findings;
}

module.exports = { checkConfigOverlaps };
