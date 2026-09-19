// database/dryrun/location_convention_candidates.js
//
// Phase 2A.3 — informational-only "embedded naming convention" candidate
// finder for MASTER_LOG-only unresolved (Location,Brand) identities.
//
// The real Phase 2A dry run found the source organization's own SETTINGS
// roster already uses a documented pattern in places: a brand word
// embedded directly in the Location field alongside a SEPARATE, agreeing
// Brand column value (e.g. a location literally named "F <TOWN>" or
// "<TOWN> FIGARO" whose Brand column is also "FIGARO"). This is evidence
// FROM THE CANONICAL DATA ITSELF, not a similarity heuristic invented
// here — the function only reports a candidate when one location's word
// sequence is an exact prefix or suffix of another's AND both share the
// SAME brand. It never crosses brands (same-location/different-brand is
// a completely separate, deliberately ignored case — see
// store_canonical_identity.js's `findLocationOnlyCandidates`) and it
// never uses edit-distance/fuzzy scoring — only exact word containment.
//
// This is informational ONLY. It never resolves an identity by itself;
// every result must still be surfaced as a candidate for human review.

function normalizeWords(value) {
  return String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, ' ').split(' ').filter(Boolean);
}

function isWordSuffixOf(shortWords, longWords) {
  if (longWords.length <= shortWords.length) return false;
  const offset = longWords.length - shortWords.length;
  return shortWords.every((w, i) => w === longWords[offset + i]);
}

function isWordPrefixOf(shortWords, longWords) {
  if (longWords.length <= shortWords.length) return false;
  return shortWords.every((w, i) => w === longWords[i]);
}

/**
 * Finds same-brand canonical identities whose location word-sequence
 * strictly contains (as an exact prefix or suffix) the historical
 * location's word-sequence, or vice versa. Returns [] when there is no
 * such structural relationship — never scores "closeness" or partial
 * word matches.
 *
 * @param {string} historicalLocation
 * @param {string} historicalBrand
 * @param {Array<{normalizedLocation: string, normalizedBrand: string}>} canonicalIdentities
 */
function findEmbeddedConventionCandidates({ historicalLocation, historicalBrand, canonicalIdentities }) {
  const brand = normalizeWords(historicalBrand).join(' ');
  const queryWords = normalizeWords(historicalLocation);
  const candidates = [];

  for (const identity of canonicalIdentities || []) {
    const candBrand = normalizeWords(identity.normalizedBrand).join(' ');
    if (candBrand !== brand) continue; // never cross brands
    const candWords = normalizeWords(identity.normalizedLocation);
    if (candWords.join(' ') === queryWords.join(' ')) continue; // exact match is handled elsewhere

    if (isWordSuffixOf(queryWords, candWords) || isWordPrefixOf(queryWords, candWords)
      || isWordSuffixOf(candWords, queryWords) || isWordPrefixOf(candWords, queryWords)) {
      candidates.push({
        candidateLocation: identity.normalizedLocation,
        candidateBrand: identity.normalizedBrand,
        candidateStoreId: identity.proposedStoreId || null,
        matchType: 'EMBEDDED_NAMING_CONVENTION',
        evidence: `Same brand (${identity.normalizedBrand}); "${identity.normalizedLocation}" and "${historicalLocation}" share an exact word-sequence prefix/suffix relationship (structural containment, not similarity scoring).`,
      });
    }
  }

  return candidates;
}

module.exports = { normalizeWords, isWordSuffixOf, isWordPrefixOf, findEmbeddedConventionCandidates };
