// database/dryrun/administrative_confirmation.js
//
// Phase 2A.5 — labels WHICH kind of administrative act (if any) produced
// a historical identity's final classification. Purely a label over
// signals that already exist elsewhere (identity classification, match
// type, and the external "identity established" decision from
// store_id_finalization.js) — it never makes a decision itself.
//
// Rule #12: "Administrative confirmation does not claim that an existing
// match was discovered." An EXISTING identity reached via a genuine
// EXACT_MATCH needed no administrative act at all (NONE); only an
// EXISTING identity reached via an explicit human-confirmed merge
// (ADMINISTRATIVELY_CONFIRMED_MERGE) is labeled EXISTING_CANONICAL. A
// NEW identity administratively confirmed as a real, distinct Store is
// labeled CONFIRMED_DISTINCT_STORE — this confirms distinctness, never
// implies a match was found (rule #12).

const { CLASSIFICATION, MATCH_TYPE } = require('./historical_identity_classification');

const ADMINISTRATIVE_CONFIRMATION = {
  NONE: 'NONE',
  EXISTING_CANONICAL: 'EXISTING_CANONICAL',
  CONFIRMED_DISTINCT_STORE: 'CONFIRMED_DISTINCT_STORE',
};

/**
 * @param {Object} params
 * @param {'EXISTING'|'NEW'|'HUMAN_REVIEW'} params.classification
 * @param {string} [params.matchType] - from historical_identity_classification.js's MATCH_TYPE
 * @param {boolean} [params.identityEstablished] - the same external administrative flag used by store_id_finalization.js
 */
function describeAdministrativeConfirmation({ classification, matchType, identityEstablished }) {
  if (classification === CLASSIFICATION.EXISTING && matchType === MATCH_TYPE.ADMINISTRATIVELY_CONFIRMED_MERGE) {
    return ADMINISTRATIVE_CONFIRMATION.EXISTING_CANONICAL;
  }
  if (classification === CLASSIFICATION.NEW && identityEstablished) {
    return ADMINISTRATIVE_CONFIRMATION.CONFIRMED_DISTINCT_STORE;
  }
  return ADMINISTRATIVE_CONFIRMATION.NONE;
}

module.exports = { ADMINISTRATIVE_CONFIRMATION, describeAdministrativeConfirmation };
