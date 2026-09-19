// database/dryrun/store_id_finalization.js
//
// Phase 2A.4 — decides the FINAL proposed Store ID for a classified
// historical identity (EXISTING / NEW / HUMAN_REVIEW), given an
// administrative "identity established" declaration. This keeps two
// separate decisions cleanly separate:
//
//   1. IDENTITY decision (historical_identity_classification.js): is
//      this the SAME canonical (Location,Brand) as something already
//      known, a genuinely NEW one, or too ambiguous to say
//      (HUMAN_REVIEW)? Never touched by this module.
//   2. ADMINISTRATIVE decision (external input to this module): has a
//      human confirmed this NEW identity is a real, legitimate Store
//      (however its current operational status is separately recorded)
//      worth minting a deterministic dry-run proposed Store ID for yet?
//
// A HUMAN_REVIEW identity NEVER receives a proposed Store ID here,
// regardless of `identityEstablished` — because the open question for a
// HUMAN_REVIEW identity is exactly "is this the SAME Store as its
// candidate," and minting a fresh ID for it would silently presuppose
// "no" (i.e. invent that it's separate), which is exactly the kind of
// unproven identity invention this whole reconciliation forbids.
//
// The Store ID itself is always derived purely from the canonical
// (Location,Brand) key (store_id_generator.js) — operational status and
// the "established" flag are never part of that derivation, so they can
// never change a Store ID once it exists.

const { deriveProposedStoreId } = require('./store_id_generator');

/**
 * @param {Object} params
 * @param {'EXISTING'|'NEW'|'HUMAN_REVIEW'} params.classification
 * @param {string|null} params.canonicalStoreId - already-known Store ID, only meaningful when classification === 'EXISTING'
 * @param {string} params.compositeKey - this historical identity's own canonical key (NORMALIZED_LOCATION|NORMALIZED_BRAND)
 * @param {boolean} params.identityEstablished - an administrative declaration (never inferred) that a NEW identity is confirmed real and should receive a proposed dry-run Store ID now
 */
function finalizeProposedStoreId({ classification, canonicalStoreId, compositeKey, identityEstablished }) {
  if (classification === 'EXISTING') {
    return canonicalStoreId || null;
  }
  if (classification === 'NEW' && identityEstablished) {
    return deriveProposedStoreId(compositeKey);
  }
  // HUMAN_REVIEW, or a NEW identity not yet administratively established.
  return null;
}

module.exports = { finalizeProposedStoreId };
