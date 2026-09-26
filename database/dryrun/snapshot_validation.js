// database/dryrun/snapshot_validation.js
//
// REPORT_SNAPSHOTS historical-integrity validation (Phase 2 rule #13).
// Structural checks ONLY — this module never recalculates a historical
// report from current configuration; the frozen snapshot is authoritative
// (rule #13's own closing line). Verifying "the frozen result was never
// rewritten" beyond structural presence would require comparing against
// an independent prior capture of the same real spreadsheet, which this
// module does not have access to and will not simulate.
//
// Input: array of snapshot records shaped like
//   { reportingYear, versionNum, status, createdAt, createdBy,
//     finalizedAt, finalizedBy, evaluationDate, reason,
//     supersedesVersion, calculationTimestamp, resultJson, ... }

function validateSnapshots(snapshots) {
  const findings = [];
  const idOf = (s) => `REPORT-${s.reportingYear}-v${s.versionNum}`;

  const seenIds = new Set();
  const seenVersionPerYear = new Map(); // year -> Set(versionNum)
  const byId = new Map();

  for (const s of snapshots) {
    const id = idOf(s);
    byId.set(id, s);

    if (seenIds.has(id)) {
      findings.push({ type: 'DUPLICATE_SNAPSHOT_ID', snapshotId: id });
    }
    seenIds.add(id);

    if (!seenVersionPerYear.has(s.reportingYear)) seenVersionPerYear.set(s.reportingYear, new Set());
    const yearSet = seenVersionPerYear.get(s.reportingYear);
    if (yearSet.has(s.versionNum)) {
      findings.push({ type: 'DUPLICATE_VERSION_WITHIN_YEAR', reportingYear: s.reportingYear, versionNum: s.versionNum });
    }
    yearSet.add(s.versionNum);

    if (!['DRAFT', 'FINALIZED', 'SUPERSEDED'].includes(s.status)) {
      findings.push({ type: 'INVALID_STATUS', snapshotId: id, status: s.status });
    }

    if (s.status === 'FINALIZED' && (s.resultJson == null)) {
      findings.push({ type: 'FINALIZED_MISSING_FROZEN_RESULT', snapshotId: id });
    }
    if (s.status === 'SUPERSEDED' && (s.resultJson == null)) {
      findings.push({ type: 'SUPERSEDED_MISSING_FROZEN_RESULT', snapshotId: id, note: 'A superseded snapshot must retain its original result — a missing result here means the historical record was lost, not just marked superseded.' });
    }
  }

  // At most one FINALIZED per year — the same rule the PostgreSQL schema
  // enforces at the database level (partial unique index).
  const finalizedByYear = new Map();
  for (const s of snapshots) {
    if (s.status !== 'FINALIZED') continue;
    if (!finalizedByYear.has(s.reportingYear)) finalizedByYear.set(s.reportingYear, []);
    finalizedByYear.get(s.reportingYear).push(idOf(s));
  }
  for (const [year, ids] of finalizedByYear) {
    if (ids.length > 1) {
      findings.push({ type: 'MULTIPLE_FINALIZED_SAME_YEAR', reportingYear: year, snapshotIds: ids });
    }
  }

  // Supersession chain validity.
  for (const s of snapshots) {
    if (s.supersedesVersion == null) continue;
    const supersededId = `REPORT-${s.reportingYear}-v${s.supersedesVersion}`;
    const superseded = byId.get(supersededId);
    if (!superseded) {
      findings.push({ type: 'SUPERSEDES_NONEXISTENT_VERSION', snapshotId: idOf(s), pointsTo: supersededId });
    } else if (superseded.status !== 'SUPERSEDED') {
      findings.push({ type: 'SUPERSEDED_ROW_WRONG_STATUS', snapshotId: supersededId, expectedStatus: 'SUPERSEDED', actualStatus: superseded.status });
    }
  }

  return findings;
}

module.exports = { validateSnapshots };
