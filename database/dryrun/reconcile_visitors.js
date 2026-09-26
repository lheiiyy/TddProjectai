// database/dryrun/reconcile_visitors.js
//
// Visitor identity reconciliation (Phase 2 rule #7). Same exact-match-
// only discipline as stores: names are never merged because they "look
// similar" — every ambiguous case is reported, not guessed.
//
// Inputs:
//   configVisitorVersions: [{ entityId, visitorName, effectiveFrom,
//     envelopeStatus, ... }]
//   masterLogRows: raw rows, each with `visitedBy` (pipe-delimited) and `rowRef`

const { splitVisitedBy } = require('./masterlog_integrity');

function reconcileVisitors({ configVisitorVersions, masterLogRows }) {
  const knownIds = new Set(configVisitorVersions.map((v) => v.entityId));

  // Visitor ID IS the normalized name (Phase 1's interim-identity
  // decision, unchanged) — so a "duplicate identity" here means two
  // config rows whose entityId differs only by case/whitespace, which
  // would silently collide once normalized. Reported, never auto-merged.
  const byNormalized = new Map();
  for (const id of knownIds) {
    const norm = id.trim().toUpperCase();
    if (!byNormalized.has(norm)) byNormalized.set(norm, []);
    byNormalized.get(norm).push(id);
  }
  const duplicateIdentities = Array.from(byNormalized.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([norm, ids]) => ({ normalized: norm, entityIds: ids }));

  const report = {
    uniqueVisitorIdentities: knownIds.size,
    duplicateIdentities,
    historicalReferencesTotal: 0,
    missingVisitorValueRows: [],   // rows where Visited By is blank/empty after split
    unknownVisitorReferences: [],  // a name used in MASTER_LOG with no CONFIG_VISITORS entry
    ambiguousIdentityCandidates: [], // reserved for a future fuzzy-adjacent case; exact-match system currently produces none by construction
  };

  const unknownCounts = new Map();
  for (const row of masterLogRows || []) {
    const names = splitVisitedBy(row.visitedBy);
    if (names.length === 0) {
      report.missingVisitorValueRows.push({ rowRef: row.rowRef });
      continue;
    }
    for (const name of names) {
      report.historicalReferencesTotal += 1;
      if (!knownIds.has(name)) {
        if (!unknownCounts.has(name)) unknownCounts.set(name, { name, occurrenceCount: 0, rowRefs: [] });
        const entry = unknownCounts.get(name);
        entry.occurrenceCount += 1;
        entry.rowRefs.push(row.rowRef);
      }
    }
  }
  report.unknownVisitorReferences = Array.from(unknownCounts.values());

  return report;
}

module.exports = { reconcileVisitors };
