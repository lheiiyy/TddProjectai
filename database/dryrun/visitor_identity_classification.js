// database/dryrun/visitor_identity_classification.js
//
// Phase 2A rule #9 — visitor identity review, one level more specific
// than reconcile_visitors.js's plain known/unknown split. Every distinct
// historical MASTER_LOG visitor token is classified into exactly one of:
//
//   EXACT_ROSTER_MATCH             — byte-identical to a roster name
//   CASE_VARIANT_OF_ROSTER_ENTRY   — matches a roster name once both are
//                                    normalized, but not byte-identical
//                                    (never silently merged — reported)
//   LIKELY_NEW_VISITOR             — matches no roster name at all, even
//                                    normalized (still a human decision,
//                                    "likely" not "confirmed")
//   UNRESOLVED                     — case-fold collides with MORE THAN
//                                    ONE roster entry (defensive category;
//                                    exact-match discipline should make
//                                    this empty in practice, but the type
//                                    must exist rather than guessing)

const { splitVisitedBy } = require('./masterlog_integrity');

function normalize(name) {
  return String(name || '').trim().toUpperCase();
}

function classifyVisitorTokens({ roster, masterLogRows }) {
  const rosterList = Array.from(roster || []);
  const rosterExact = new Set(rosterList);
  const byNormalized = new Map();
  for (const r of rosterList) {
    const n = normalize(r);
    if (!byNormalized.has(n)) byNormalized.set(n, []);
    byNormalized.get(n).push(r);
  }

  const byToken = new Map();
  for (const row of masterLogRows || []) {
    for (const token of splitVisitedBy(row.visitedBy)) {
      if (!byToken.has(token)) {
        byToken.set(token, { token, occurrenceCount: 0, rowRefs: [] });
      }
      const entry = byToken.get(token);
      entry.occurrenceCount += 1;
      entry.rowRefs.push(row.rowRef);
    }
  }

  const results = [];
  for (const entry of byToken.values()) {
    const normalized = normalize(entry.token);
    const rosterCandidates = byNormalized.get(normalized) || [];

    let classification;
    let matchedRosterName = null;
    if (rosterExact.has(entry.token)) {
      classification = 'EXACT_ROSTER_MATCH';
      matchedRosterName = entry.token;
    } else if (rosterCandidates.length === 1) {
      classification = 'CASE_VARIANT_OF_ROSTER_ENTRY';
      matchedRosterName = rosterCandidates[0];
    } else if (rosterCandidates.length === 0) {
      classification = 'LIKELY_NEW_VISITOR';
    } else {
      classification = 'UNRESOLVED';
    }

    results.push({
      token: entry.token,
      normalized,
      occurrenceCount: entry.occurrenceCount,
      rowRefs: entry.rowRefs,
      classification,
      matchedRosterName,
    });
  }

  results.sort((a, b) => a.token.localeCompare(b.token));

  return {
    rosterSize: rosterList.length,
    distinctTokenCount: results.length,
    exactMatchCount: results.filter((r) => r.classification === 'EXACT_ROSTER_MATCH').length,
    caseVariantCount: results.filter((r) => r.classification === 'CASE_VARIANT_OF_ROSTER_ENTRY').length,
    likelyNewCount: results.filter((r) => r.classification === 'LIKELY_NEW_VISITOR').length,
    unresolvedCount: results.filter((r) => r.classification === 'UNRESOLVED').length,
    tokens: results,
  };
}

module.exports = { classifyVisitorTokens, normalize };
