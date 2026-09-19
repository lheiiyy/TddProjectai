// database/dryrun/historical_identity_classification.js
//
// Phase 2A.3/2A.5 — final classification for a MASTER_LOG-only historical
// (Location,Brand) identity: EXISTING, NEW, or HUMAN_REVIEW. Never
// merges on brand-crossing co-location; never resolves on structural
// naming-convention evidence alone (that evidence routes to
// HUMAN_REVIEW, not an automatic EXISTING match) UNLESS a human has
// explicitly, externally confirmed the merge (`confirmedCanonicalMatch`)
// — this function never invents that confirmation itself, it only ever
// applies one that was passed in.

const { compositeKey } = require('./store_canonical_identity');
const { findEmbeddedConventionCandidates } = require('./location_convention_candidates');

const CLASSIFICATION = {
  EXISTING: 'EXISTING',
  NEW: 'NEW',
  HUMAN_REVIEW: 'HUMAN_REVIEW',
};

// Distinguishes HOW an EXISTING classification was reached — required so
// administrative confirmation never "claims that an existing match was
// discovered" (Phase 2A.5 rule #12): a deterministic exact match and an
// explicit human-confirmed merge are never conflated in the evidence
// trail, even though both end up as CLASSIFICATION.EXISTING.
const MATCH_TYPE = {
  EXACT_MATCH: 'EXACT_MATCH',
  ADMINISTRATIVELY_CONFIRMED_MERGE: 'ADMINISTRATIVELY_CONFIRMED_MERGE',
  EMBEDDED_NAMING_CONVENTION: 'EMBEDDED_NAMING_CONVENTION', // HUMAN_REVIEW only, never resolves by itself
  NONE: 'NONE',
};

/**
 * @param {Object} params
 * @param {string} params.historicalLocation
 * @param {string} params.historicalBrand
 * @param {Array} params.canonicalIdentities - ready (EXACT_MATCH/SETTINGS_ONLY/
 *   DUPLICATE_SOURCE_ROWS) identities from store_canonical_identity.js,
 *   each with normalizedLocation/normalizedBrand/canonicalLocation/
 *   canonicalBrand/proposedStoreId(optional).
 * @param {Array} params.sameLocationDifferentBrandCandidates - informational
 *   only; never drives the classification decision (mandatory rule #4).
 * @param {Object|null} [params.confirmedCanonicalMatch] - an EXTERNAL,
 *   explicit business decision (never derived by this function) that
 *   this historical identity IS the same Store as a specific canonical
 *   identity. Must carry canonicalLocation/canonicalBrand/proposedStoreId.
 *   Only ever applied when the caller supplies it — this function never
 *   guesses or infers one from naming-convention evidence.
 */
function classifyHistoricalIdentity({ historicalLocation, historicalBrand, canonicalIdentities, sameLocationDifferentBrandCandidates, confirmedCanonicalMatch }) {
  const key = compositeKey(historicalLocation, historicalBrand);
  const exactMatch = (canonicalIdentities || []).find((c) => compositeKey(c.normalizedLocation, c.normalizedBrand) === key);

  if (exactMatch) {
    return {
      classification: CLASSIFICATION.EXISTING,
      canonicalLocation: exactMatch.canonicalLocation,
      canonicalBrand: exactMatch.canonicalBrand,
      canonicalStoreId: exactMatch.proposedStoreId || null,
      matchType: MATCH_TYPE.EXACT_MATCH,
      matchReason: 'Exact (Location,Brand) match found in the canonical dataset.',
      evidence: [],
      sameLocationDifferentBrandCandidates: sameLocationDifferentBrandCandidates || [],
    };
  }

  if (confirmedCanonicalMatch) {
    // A human has explicitly confirmed, outside of this function, that
    // this historical identity IS the same Store as the given canonical
    // identity. This is never inferred from naming similarity, evidence
    // strength, or anything else this function computes — it is only
    // ever applied because it was handed in as a fact.
    return {
      classification: CLASSIFICATION.EXISTING,
      canonicalLocation: confirmedCanonicalMatch.canonicalLocation,
      canonicalBrand: confirmedCanonicalMatch.canonicalBrand,
      canonicalStoreId: confirmedCanonicalMatch.proposedStoreId || null,
      matchType: MATCH_TYPE.ADMINISTRATIVELY_CONFIRMED_MERGE,
      matchReason: 'Business has explicitly confirmed this historical identity is the same Store as the given canonical identity — not automatically discovered from naming evidence.',
      evidence: [],
      sameLocationDifferentBrandCandidates: sameLocationDifferentBrandCandidates || [],
    };
  }

  const conventionCandidates = findEmbeddedConventionCandidates({
    historicalLocation, historicalBrand, canonicalIdentities,
  });

  if (conventionCandidates.length > 0) {
    return {
      classification: CLASSIFICATION.HUMAN_REVIEW,
      proposedStoreId: null,
      matchType: MATCH_TYPE.EMBEDDED_NAMING_CONVENTION,
      reason: 'No exact (Location,Brand) match, but the canonical dataset contains same-brand location(s) whose naming structurally contains this historical location (an established naming-convention pattern already present in the source organization\'s own roster) — insufficient to auto-resolve, requires a human decision.',
      evidence: conventionCandidates,
      sameLocationDifferentBrandCandidates: sameLocationDifferentBrandCandidates || [],
    };
  }

  return {
    classification: CLASSIFICATION.NEW,
    proposedStoreId: null, // never minted here — only in the dry-run assignment artifact, after this classification is accepted
    matchType: MATCH_TYPE.NONE,
    reason: 'No exact (Location,Brand) match, and no same-brand naming-convention candidate found in the canonical dataset. Historical visit(s) recorded under this (Location,Brand) are the only evidence.',
    evidence: [],
    sameLocationDifferentBrandCandidates: sameLocationDifferentBrandCandidates || [],
  };
}

module.exports = { CLASSIFICATION, MATCH_TYPE, classifyHistoricalIdentity };
