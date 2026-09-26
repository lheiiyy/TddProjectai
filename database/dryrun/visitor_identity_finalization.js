// database/dryrun/visitor_identity_finalization.js
//
// Phase 2 (visitor reconciliation) — final EXISTING/NEW identity for a
// historical visitor token, given (a) automatic evidence-only
// classification from visitor_identity_classification.js, and (b) an
// OPTIONAL explicit, external administrative decision. Never invents a
// match: a merge or a "this is a distinct identity" confirmation is only
// ever applied because it was supplied from outside, never derived from
// name similarity/case-folding alone.
//
// Identity key: the existing application architecture
// (SVMKPI_CONFIG.gs's CFG_AREA_SCHEMAS.VISITORS) documents that Entity
// ID = normalized Visitor Name is the current interim scheme — there is
// no separate immutable Visitor ID to reuse, and none is invented here.
// `canonicalVisitor` IS the canonical identity for reporting purposes,
// exactly mirroring that existing convention.

const VISITOR_CLASSIFICATION = { EXISTING: 'EXISTING', NEW: 'NEW' };

// Distinguishes HOW an EXISTING/NEW classification was reached, same
// discipline as the Store domain's MATCH_TYPE: an automatic discovery
// and an explicit human decision are never conflated in the evidence
// trail, even when they produce the same classification value.
const VISITOR_MATCH_TYPE = {
  EXACT_ROSTER_MATCH: 'EXACT_ROSTER_MATCH',
  ADMINISTRATIVELY_CONFIRMED_MERGE: 'ADMINISTRATIVELY_CONFIRMED_MERGE',
  ADMINISTRATIVELY_IDENTIFIED_NEW: 'ADMINISTRATIVELY_IDENTIFIED_NEW',
  UNCONFIRMED: 'UNCONFIRMED',
};

const ADMINISTRATIVE_CONFIRMATION = {
  NONE: 'NONE',
  CONFIRMED_EXISTING_IDENTITY: 'CONFIRMED_EXISTING_IDENTITY',
  CONFIRMED_DISTINCT_VISITOR_IDENTITY: 'CONFIRMED_DISTINCT_VISITOR_IDENTITY',
  CONFIRMED_VISITOR_IDENTITY: 'CONFIRMED_VISITOR_IDENTITY',
};

/**
 * @param {Object} params
 * @param {string} params.token - the raw historical MASTER_LOG token, preserved verbatim (never rewritten)
 * @param {string} params.automaticClassification - from visitor_identity_classification.js: EXACT_ROSTER_MATCH | CASE_VARIANT_OF_ROSTER_ENTRY | LIKELY_NEW_VISITOR | UNRESOLVED
 * @param {string|null} [params.matchedRosterName] - from the automatic classifier, for CASE_VARIANT_OF_ROSTER_ENTRY
 * @param {Object|null} [params.confirmedMerge] - an EXTERNAL, explicit business decision: { canonicalVisitor, administrativeConfirmation, rationale? } — this token IS the same visitor as an existing canonicalVisitor. Never derived from evidence; only ever applied because it was supplied.
 * @param {Object|null} [params.confirmedDistinct] - an EXTERNAL, explicit business decision: { canonicalVisitor, administrativeConfirmation, rationale? } — this token is its own distinct, newly-recognized visitor identity, canonically named canonicalVisitor. Never claims a pre-existing identity was discovered (rule: administrative confirmation of distinctness is not a match).
 */
function finalizeVisitorIdentity({ token, automaticClassification, matchedRosterName, confirmedMerge, confirmedDistinct }) {
  if (automaticClassification === 'EXACT_ROSTER_MATCH') {
    return {
      token,
      classification: VISITOR_CLASSIFICATION.EXISTING,
      canonicalVisitor: token,
      matchType: VISITOR_MATCH_TYPE.EXACT_ROSTER_MATCH,
      administrativeConfirmation: ADMINISTRATIVE_CONFIRMATION.NONE,
      rationale: 'Exact roster match — automatically discovered from the data, no administrative act needed.',
    };
  }

  if (confirmedMerge) {
    return {
      token,
      classification: VISITOR_CLASSIFICATION.EXISTING,
      canonicalVisitor: confirmedMerge.canonicalVisitor,
      matchType: VISITOR_MATCH_TYPE.ADMINISTRATIVELY_CONFIRMED_MERGE,
      administrativeConfirmation: confirmedMerge.administrativeConfirmation,
      rationale: confirmedMerge.rationale
        || 'Business has explicitly confirmed this historical token is the same visitor as the given canonical identity — not automatically discovered from case-folding or naming similarity alone.',
    };
  }

  if (confirmedDistinct) {
    return {
      token,
      classification: VISITOR_CLASSIFICATION.NEW,
      canonicalVisitor: confirmedDistinct.canonicalVisitor,
      matchType: VISITOR_MATCH_TYPE.ADMINISTRATIVELY_IDENTIFIED_NEW,
      administrativeConfirmation: confirmedDistinct.administrativeConfirmation,
      rationale: confirmedDistinct.rationale
        || 'Business has explicitly confirmed this token represents a distinct visitor identity — this confirms distinctness, it does not claim any existing identity was discovered.',
    };
  }

  // No administrative decision recorded — never guessed. Stays exactly
  // as the automatic evidence classified it; a case-variant or
  // likely-new token remains UNCONFIRMED until a human decides.
  return {
    token,
    classification: null,
    canonicalVisitor: null,
    matchType: VISITOR_MATCH_TYPE.UNCONFIRMED,
    administrativeConfirmation: ADMINISTRATIVE_CONFIRMATION.NONE,
    rationale: automaticClassification === 'CASE_VARIANT_OF_ROSTER_ENTRY'
      ? `Case-variant candidate of roster entry "${matchedRosterName}" — not merged without an administrative decision.`
      : 'No exact match and no administrative confirmation recorded — remains unresolved pending a business decision.',
  };
}

module.exports = { VISITOR_CLASSIFICATION, VISITOR_MATCH_TYPE, ADMINISTRATIVE_CONFIRMATION, finalizeVisitorIdentity };
