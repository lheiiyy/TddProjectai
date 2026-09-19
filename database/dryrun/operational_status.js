// database/dryrun/operational_status.js
//
// Phase 2A.4 — explicit historical operational status for a canonical
// (Location,Brand) identity.
//
// Status is a DECLARED BUSINESS FACT, never inferred from visit counts,
// presence/absence in SETTINGS, report-sheet formatting, or any other
// data signal — Phase 2 already established that historical operational
// status cannot be reliably reconstructed from the old workbook. This
// module only ever RECORDS a status a human has explicitly declared; it
// never computes one from evidence.
//
// Status is deliberately kept ORTHOGONAL to identity classification
// (EXISTING/NEW/HUMAN_REVIEW, from historical_identity_classification.js)
// — never overloaded onto it. A HUMAN_REVIEW identity can be declared
// INACTIVE while its identity match remains unresolved; an EXISTING
// identity's status is independent of how it was matched.

const STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  // No explicit business declaration recorded for this identity — never
  // defaulted to ACTIVE or INACTIVE by guessing.
  UNSPECIFIED: 'UNSPECIFIED',
};

/**
 * Applies a set of business-confirmed status declarations, keyed by the
 * canonical (Location,Brand) composite key (as produced by
 * store_canonical_identity.js's `compositeKey`), to a list of records.
 * Any record whose key is not present in `declarations` keeps
 * UNSPECIFIED — never defaulted to ACTIVE or INACTIVE.
 *
 * Deliberately sets `operationalStatus`, NOT `status` — records coming
 * from store_canonical_identity.js already carry their OWN `status`
 * field (the identity-classification STATUS enum: EXACT_MATCH,
 * SETTINGS_ONLY, DUPLICATE_SOURCE_ROWS, HUMAN_REVIEW,
 * MASTER_LOG_ONLY_UNRESOLVED) — reusing the name `status` here would
 * silently clobber that field on every such record. Keeping operational
 * status under its own field name is also what "never overload
 * EXISTING/NEW/HUMAN_REVIEW with status" (Phase 2A.4 rule A) means in
 * practice: two orthogonal facts need two distinct fields, not one
 * shared name.
 *
 * @param {Array<{compositeKey?: string, historicalLocation?: string, historicalBrand?: string, normalizedLocation?: string, normalizedBrand?: string}>} records
 * @param {Object<string,string>} declarations - map of "LOCATION|BRAND" -> STATUS value
 */
function applyOperationalStatus(records, declarations) {
  const decls = declarations || {};
  return (records || []).map((r) => {
    const key = r.compositeKey
      || `${String(r.historicalLocation || r.normalizedLocation || '').trim().toUpperCase()}|${String(r.historicalBrand || r.normalizedBrand || '').trim().toUpperCase()}`;
    return { ...r, operationalStatus: decls[key] || STATUS.UNSPECIFIED };
  });
}

module.exports = { STATUS, applyOperationalStatus };
