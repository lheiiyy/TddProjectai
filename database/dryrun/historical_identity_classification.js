// database/dryrun/historical_identity_classification.js
//
// Phase 2A.3 — final classification for a MASTER_LOG-only historical
// (Location,Brand) identity: EXISTING, NEW, or HUMAN_REVIEW. Never
// merges on brand-crossing co-location; never resolves on structural
// naming-convention evidence alone (that evidence routes to
// HUMAN_REVIEW, not an automatic EXISTING match).

const { compositeKey } = require('./store_canonical_identity');
const { findEmbeddedConventionCandidates } = require('./location_convention_candidates');

const CLASSIFICATION = {
  EXISTING: 'EXISTING',
  NEW: 'NEW',
  HUMAN_REVIEW: 'HUMAN_REVIEW',
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
 */
function classifyHistoricalIdentity({ historicalLocation, historicalBrand, canonicalIdentities, sameLocationDifferentBrandCandidates }) {
  const key = compositeKey(historicalLocation, historicalBrand);
  const exactMatch = (canonicalIdentities || []).find((c) => compositeKey(c.normalizedLocation, c.normalizedBrand) === key);

  if (exactMatch) {
    return {
      classification: CLASSIFICATION.EXISTING,
      canonicalLocation: exactMatch.canonicalLocation,
      canonicalBrand: exactMatch.canonicalBrand,
      canonicalStoreId: exactMatch.proposedStoreId || null,
      matchReason: 'Exact (Location,Brand) match found in the canonical dataset.',
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
      reason: 'No exact (Location,Brand) match, but the canonical dataset contains same-brand location(s) whose naming structurally contains this historical location (an established naming-convention pattern already present in the source organization\'s own roster) — insufficient to auto-resolve, requires a human decision.',
      evidence: conventionCandidates,
      sameLocationDifferentBrandCandidates: sameLocationDifferentBrandCandidates || [],
    };
  }

  return {
    classification: CLASSIFICATION.NEW,
    proposedStoreId: null, // never minted here — only in the dry-run assignment artifact, after this classification is accepted
    reason: 'No exact (Location,Brand) match, and no same-brand naming-convention candidate found in the canonical dataset. Historical visit(s) recorded under this (Location,Brand) are the only evidence.',
    evidence: [],
    sameLocationDifferentBrandCandidates: sameLocationDifferentBrandCandidates || [],
  };
}

module.exports = { CLASSIFICATION, classifyHistoricalIdentity };
