// database/dryrun/store_canonical_identity.js
//
// Phase 2A/2A.2 — canonical Store identity derivation directly from raw
// SETTINGS + MASTER_LOG rows, BEFORE any Store ID has ever been minted.
//
// This is deliberately a different concern from reconcile_stores.js:
// reconcile_stores.js checks MASTER_LOG.storeId against an ALREADY
// populated CONFIG_STORES (i.e. after minting). This module answers the
// earlier question Phase 2 found blocking: production has never minted
// any Store ID, so before one can be minted we must first agree on what
// the canonical set of distinct Store identities even is.
//
// ── Canonical identity rule (confirmed business rule) ───────────────
//
//   Store Identity = Location + Brand
//   canonical key   = NORMALIZED_LOCATION_NAME + '|' + NORMALIZED_BRAND
//
// A physical location may host multiple brands, and each (Location,
// Brand) pair is a SEPARATE SVMI Store with its own Store ID — e.g. a
// town with both a FIGARO and an ANGEL'S PIZZA location is two Stores,
// never one. Physical co-location does NOT imply Store identity
// equivalence. Never use Location alone, never Brand alone, and never a
// fuzzy/similarity match to decide identity.
//
// The real spreadsheet's "Store" column is, in substance, a physical
// LOCATION name (a town/site name), not a store-chain-style unique
// store code — that is exactly why the same value can legitimately
// repeat under two different brands. This module treats it as such
// throughout (`normalizedLocation`/`sourceLocationName`, etc.) even
// though the source column header is literally "STORES". A future
// database model MAY introduce a separate `location_id` distinct from
// the Store ID (to represent "this physical site", independent of which
// brand operates there) — that is NOT part of this phase; today the
// Store ID remains attached directly to the (Location, Brand)
// operational identity, with no separate location table.
//
// Text is normalized ONLY for comparison; original source values are
// always preserved alongside the normalized ones.

const STATUS = {
  // Single SETTINGS row for this (Location,Brand) key, with at least one
  // historical MASTER_LOG visit recorded under the same key. Strongest
  // confidence — safe to propose a Store ID.
  EXACT_MATCH: 'EXACT_MATCH',
  // Single SETTINGS row for this (Location,Brand) key, but zero
  // historical MASTER_LOG visits yet. A configured-but-unvisited store —
  // still safe to propose a Store ID.
  SETTINGS_ONLY: 'SETTINGS_ONLY',
  // More than one SETTINGS row shares this exact (Location,Brand) key,
  // AND every identity-relevant field (Region, Category) agrees across
  // those rows — the same logical store was entered more than once.
  // These collapse to ONE canonical identity for Store-ID purposes;
  // source-row provenance (which rows collapsed) is retained, and
  // neither original row is deleted or modified.
  DUPLICATE_SOURCE_ROWS: 'DUPLICATE_SOURCE_ROWS',
  // More than one SETTINGS row shares the (Location,Brand) key but
  // disagrees on Region/Category — a genuine data conflict. Never
  // auto-resolved by picking one; requires a human decision.
  HUMAN_REVIEW: 'HUMAN_REVIEW',
  // The (Location,Brand) key appears ONLY in MASTER_LOG history, with no
  // matching SETTINGS row at all. No Store ID is proposed for these.
  MASTER_LOG_ONLY_UNRESOLVED: 'MASTER_LOG_ONLY_UNRESOLVED',
};

// READY is a roll-up label, not a fifth persisted status: an identity is
// "ready for Store-ID assignment" iff its status is EXACT_MATCH,
// SETTINGS_ONLY, or DUPLICATE_SOURCE_ROWS. HUMAN_REVIEW and
// MASTER_LOG_ONLY_UNRESOLVED are never ready.
const READY_STATUSES = new Set([STATUS.EXACT_MATCH, STATUS.SETTINGS_ONLY, STATUS.DUPLICATE_SOURCE_ROWS]);

function isReadyStatus(status) {
  return READY_STATUSES.has(status);
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * The canonical identity key: NORMALIZED_LOCATION_NAME + '|' + NORMALIZED_BRAND.
 * Pure function of its two string inputs — no row order, row index,
 * timestamp, or any other incidental input ever participates.
 */
function compositeKey(locationName, brand) {
  return `${normalizeText(locationName)}|${normalizeText(brand)}`;
}

/**
 * Groups SETTINGS roster rows by the canonical (Location, Brand) key.
 * Each SETTINGS row keeps its own row reference and full original field
 * values — nothing is collapsed or discarded here, only grouped for
 * reporting. Grouping into a Map keyed by string is intrinsically
 * order-independent: the result does not depend on the order rows were
 * supplied in.
 */
function groupSettingsRows(settingsRows) {
  const byKey = new Map();
  for (const row of settingsRows || []) {
    const key = compositeKey(row.store, row.brand);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  return byKey;
}

/**
 * Two SETTINGS rows sharing a (Location,Brand) key are TRUE duplicates
 * only if every identity-relevant field agrees (Location, Brand, Region,
 * Category) — not merely the composite key. Rows sharing a key but
 * disagreeing on Region/Category are a genuine data conflict and are
 * reported HUMAN_REVIEW, never silently resolved by picking one.
 */
function classifySettingsDuplicates(byKey) {
  const results = [];
  for (const [key, rows] of byKey) {
    if (rows.length < 2) continue;
    const signature = (r) => JSON.stringify([
      normalizeText(r.store), normalizeText(r.brand),
      normalizeText(r.region), normalizeText(r.category),
    ]);
    const signatures = new Set(rows.map(signature));
    const allFieldsIdentical = signatures.size === 1;
    results.push({
      compositeKey: key,
      rows,
      allFieldsIdentical,
      status: allFieldsIdentical ? STATUS.DUPLICATE_SOURCE_ROWS : STATUS.HUMAN_REVIEW,
    });
  }
  return results;
}

/**
 * Groups MASTER_LOG historical rows by the same canonical key, recording
 * occurrence count and first/last historical appearance (by the row's
 * already-validated ISO date string — never re-derived, never invented).
 */
function groupMasterLogRows(masterLogRows) {
  const byKey = new Map();
  for (const row of masterLogRows || []) {
    const key = compositeKey(row.store, row.brand);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        originalLocationName: row.store,
        originalBrand: row.brand,
        count: 0,
        firstSeen: null,
        lastSeen: null,
        rowRefs: [],
      });
    }
    const entry = byKey.get(key);
    entry.count += 1;
    entry.rowRefs.push(row.rowRef);
    const d = row.dateVisited;
    if (d != null) {
      if (entry.firstSeen === null || d < entry.firstSeen) entry.firstSeen = d;
      if (entry.lastSeen === null || d > entry.lastSeen) entry.lastSeen = d;
    }
  }
  return byKey;
}

/**
 * For a MASTER_LOG-only key with no exact SETTINGS match, lists other
 * SETTINGS keys sharing only the normalized Location name (informational
 * only — NEVER used to auto-assign a match; every unmatched identity is
 * still classified MASTER_LOG_ONLY_UNRESOLVED until a human decides).
 * Same location + different brand is never merged just because the
 * location name resembles another location's.
 */
function findLocationOnlyCandidates(unmatchedKey, settingsByKey) {
  const [location] = unmatchedKey.split('|');
  const candidates = [];
  for (const key of settingsByKey.keys()) {
    const [candLocation, candBrand] = key.split('|');
    if (candLocation === location && key !== unmatchedKey) {
      candidates.push({ compositeKey: key, brand: candBrand });
    }
  }
  return candidates;
}

/**
 * Builds the full canonical identity reconciliation: every distinct
 * (Location, Brand) key seen in either SETTINGS or MASTER_LOG, with its
 * historical usage, match status, and classification. Nothing here mints
 * a Store ID or writes anywhere. Deterministic and order-independent:
 * iterating `settingsRows`/`masterLogRows` in any order produces the
 * same set of canonical identities (Map/Set keyed by the composite
 * string, plus a final stable sort by that same key).
 */
function buildStoreIdentityReconciliation({ settingsRows, masterLogRows }) {
  const settingsByKey = groupSettingsRows(settingsRows);
  const masterLogByKey = groupMasterLogRows(masterLogRows);
  const duplicateSettings = classifySettingsDuplicates(settingsByKey);

  const allKeys = new Set([...settingsByKey.keys(), ...masterLogByKey.keys()]);
  const identities = [];

  for (const key of allKeys) {
    const [normalizedLocation, normalizedBrand] = key.split('|');
    const settingsMatches = settingsByKey.get(key) || [];
    const mlEntry = masterLogByKey.get(key);
    const hasSettingsMatch = settingsMatches.length > 0;
    const hasHistory = !!mlEntry;

    let status;
    let reason;
    if (hasSettingsMatch && settingsMatches.length > 1) {
      const dup = duplicateSettings.find((d) => d.compositeKey === key);
      status = dup.status; // DUPLICATE_SOURCE_ROWS or HUMAN_REVIEW
      reason = status === STATUS.DUPLICATE_SOURCE_ROWS
        ? 'Multiple SETTINGS rows share this (Location,Brand) key with identical Region/Category — collapsed to one canonical identity; see duplicateSettingsRows for source-row provenance.'
        : 'Multiple SETTINGS rows share this (Location,Brand) key but disagree on Region/Category — a genuine conflict, not auto-resolved.';
    } else if (hasSettingsMatch && hasHistory) {
      status = STATUS.EXACT_MATCH;
      reason = 'Exact (Location,Brand) match in SETTINGS, with historical MASTER_LOG usage.';
    } else if (hasSettingsMatch && !hasHistory) {
      status = STATUS.SETTINGS_ONLY;
      reason = 'Exact (Location,Brand) match in SETTINGS; no historical visits yet recorded.';
    } else {
      // In MASTER_LOG but not in SETTINGS at all — never auto-mapped,
      // and never merged into a same-name/different-brand identity.
      const locationOnlyCandidates = findLocationOnlyCandidates(key, settingsByKey);
      status = STATUS.MASTER_LOG_ONLY_UNRESOLVED;
      reason = locationOnlyCandidates.length > 0
        ? `No exact (Location,Brand) match in SETTINGS. Same Location exists under a different Brand in SETTINGS (informational only, not an automatic match — different brand means a different Store): ${locationOnlyCandidates.map((c) => c.compositeKey).join('; ')}.`
        : 'No exact (Location,Brand) match in SETTINGS, and no same-location candidate under a different Brand either.';
    }

    const firstSettingsRow = settingsMatches[0];
    identities.push({
      compositeKey: key,
      canonicalLocation: firstSettingsRow ? firstSettingsRow.store : (mlEntry ? mlEntry.originalLocationName : undefined),
      canonicalBrand: firstSettingsRow ? firstSettingsRow.brand : (mlEntry ? mlEntry.originalBrand : undefined),
      normalizedLocation,
      normalizedBrand,
      region: firstSettingsRow ? firstSettingsRow.region : undefined,
      category: firstSettingsRow ? firstSettingsRow.category : undefined,
      settingsRowRefs: settingsMatches.map((r) => r.rowRef).filter((v) => v !== undefined),
      settingsMatchCount: settingsMatches.length,
      historicalMasterLogCount: mlEntry ? mlEntry.count : 0,
      historicalFirstSeen: mlEntry ? mlEntry.firstSeen : null,
      historicalLastSeen: mlEntry ? mlEntry.lastSeen : null,
      masterLogRowRefs: mlEntry ? mlEntry.rowRefs : [],
      matchedSettingsRow: hasSettingsMatch,
      status,
      readyForStoreIdAssignment: isReadyStatus(status),
      reason,
    });
  }

  identities.sort((a, b) => a.compositeKey.localeCompare(b.compositeKey));

  const countByStatus = (s) => identities.filter((i) => i.status === s).length;

  return {
    totalSettingsRows: (settingsRows || []).length,
    distinctSettingsCompositeKeys: settingsByKey.size,
    distinctMasterLogCompositeKeys: masterLogByKey.size,
    distinctIdentityCount: allKeys.size,
    duplicateSettingsRows: duplicateSettings,
    exactMatchCount: countByStatus(STATUS.EXACT_MATCH),
    settingsOnlyCount: countByStatus(STATUS.SETTINGS_ONLY),
    duplicateSourceRowsCount: countByStatus(STATUS.DUPLICATE_SOURCE_ROWS),
    humanReviewCount: countByStatus(STATUS.HUMAN_REVIEW),
    masterLogOnlyUnresolvedCount: countByStatus(STATUS.MASTER_LOG_ONLY_UNRESOLVED),
    unmatchedCount: countByStatus(STATUS.MASTER_LOG_ONLY_UNRESOLVED), // kept for backward-compat naming
    // `readyCount` matches the original Phase 2A definition: unambiguous
    // single-SETTINGS-row identities only (EXACT_MATCH + SETTINGS_ONLY).
    // DUPLICATE_SOURCE_ROWS identities are reported separately
    // (`duplicateSourceRowsCount`) because promoting a duplicate pair to
    // "ready" requires an explicit human-approved collapse decision —
    // that approval is applied downstream (by whoever calls this module
    // with knowledge of which duplicates were approved), not assumed
    // here. `storeIdEligibleCount` is the total that WILL receive a
    // proposed Store ID once approved duplicates are included.
    readyCount: countByStatus(STATUS.EXACT_MATCH) + countByStatus(STATUS.SETTINGS_ONLY),
    storeIdEligibleCount: identities.filter((i) => i.readyForStoreIdAssignment).length,
    identities,
  };
}

module.exports = {
  STATUS,
  isReadyStatus,
  normalizeText,
  compositeKey,
  groupSettingsRows,
  classifySettingsDuplicates,
  groupMasterLogRows,
  findLocationOnlyCandidates,
  buildStoreIdentityReconciliation,
};
