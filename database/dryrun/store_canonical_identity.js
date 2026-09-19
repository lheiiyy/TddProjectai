// database/dryrun/store_canonical_identity.js
//
// Phase 2A — canonical Store identity derivation directly from raw
// SETTINGS + MASTER_LOG rows, BEFORE any Store ID has ever been minted.
//
// This is deliberately a different concern from reconcile_stores.js:
// reconcile_stores.js checks MASTER_LOG.storeId against an ALREADY
// populated CONFIG_STORES (i.e. after minting). This module answers the
// earlier question Phase 2 found blocking: production has never minted
// any Store ID, so before one can be minted we must first agree on what
// the canonical set of distinct Store identities even is.
//
// Canonical identity rule (Phase 2A rule #2): Store Name + Brand.
// Never Name alone, never Region alone, never Category alone, never a
// fuzzy match. Text is normalized ONLY for comparison; original source
// values are always preserved alongside the normalized ones.

function normalizeText(value) {
  return String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, ' ');
}

function compositeKey(storeName, brand) {
  return `${normalizeText(storeName)}|${normalizeText(brand)}`;
}

/**
 * Groups SETTINGS roster rows by the canonical (Name, Brand) key and
 * flags rows sharing a key as duplicate candidates. Each SETTINGS row
 * keeps its own row reference and full original field values — nothing
 * is collapsed or discarded here, only grouped for reporting.
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
 * Two SETTINGS rows are TRUE duplicates only if every identity-relevant
 * field agrees (Name, Brand, Region, Category) — not merely the
 * composite key. Rows sharing a key but disagreeing on Region/Category
 * are a genuine data conflict and must be reported as NEEDS_REVIEW, never
 * silently resolved by picking one.
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
    results.push({
      compositeKey: key,
      rows,
      allFieldsIdentical: signatures.size === 1,
      decision: signatures.size === 1 ? 'CONFIRMED_DUPLICATE_ONE_LOGICAL_STORE' : 'NEEDS_REVIEW',
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
        originalStoreName: row.store,
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
 * SETTINGS keys sharing only the normalized Name (informational only —
 * NEVER used to auto-assign a match; every unmatched identity is still
 * classified as UNRESOLVED/CANDIDATE_FOR_HUMAN_REVIEW until a human
 * decides).
 */
function findNameOnlyCandidates(unmatchedKey, settingsByKey) {
  const [name] = unmatchedKey.split('|');
  const candidates = [];
  for (const key of settingsByKey.keys()) {
    const [candName, candBrand] = key.split('|');
    if (candName === name && key !== unmatchedKey) {
      candidates.push({ compositeKey: key, brand: candBrand });
    }
  }
  return candidates;
}

/**
 * Builds the full canonical identity reconciliation: every distinct
 * (Name, Brand) key seen in either SETTINGS or MASTER_LOG, with its
 * historical usage, match status, and a proposed (not yet decided)
 * classification. Nothing here mints a Store ID or writes anywhere.
 */
function buildStoreIdentityReconciliation({ settingsRows, masterLogRows }) {
  const settingsByKey = groupSettingsRows(settingsRows);
  const masterLogByKey = groupMasterLogRows(masterLogRows);
  const duplicateSettings = classifySettingsDuplicates(settingsByKey);

  const allKeys = new Set([...settingsByKey.keys(), ...masterLogByKey.keys()]);
  const identities = [];

  for (const key of allKeys) {
    const [normalizedStoreName, normalizedBrand] = key.split('|');
    const settingsMatches = settingsByKey.get(key) || [];
    const mlEntry = masterLogByKey.get(key);
    const hasSettingsMatch = settingsMatches.length > 0;
    const hasHistory = !!mlEntry;

    let status;
    let reason;
    if (hasSettingsMatch && settingsMatches.length > 1) {
      status = 'DUPLICATE_SETTINGS_IDENTITY';
      reason = 'This (Store,Brand) key appears more than once in SETTINGS — see duplicateSettingsRows.';
    } else if (hasSettingsMatch && hasHistory) {
      status = 'READY_FOR_STORE_ID_ASSIGNMENT';
      reason = 'Exact (Store,Brand) match in SETTINGS, with historical MASTER_LOG usage.';
    } else if (hasSettingsMatch && !hasHistory) {
      status = 'READY_FOR_STORE_ID_ASSIGNMENT';
      reason = 'Exact (Store,Brand) match in SETTINGS; no historical visits yet recorded.';
    } else {
      // In MASTER_LOG but not in SETTINGS at all — never auto-mapped.
      const nameOnlyCandidates = findNameOnlyCandidates(key, settingsByKey);
      status = 'CANDIDATE_FOR_HUMAN_REVIEW';
      reason = nameOnlyCandidates.length > 0
        ? `No exact (Store,Brand) match in SETTINGS. Same Store Name exists under a different Brand in SETTINGS (informational only, not an automatic match): ${nameOnlyCandidates.map((c) => c.compositeKey).join('; ')}.`
        : 'No exact (Store,Brand) match in SETTINGS, and no same-name candidate under a different Brand either.';
    }

    identities.push({
      compositeKey: key,
      sourceStoreName: settingsMatches[0] ? settingsMatches[0].store : (mlEntry ? mlEntry.originalStoreName : undefined),
      sourceBrand: settingsMatches[0] ? settingsMatches[0].brand : (mlEntry ? mlEntry.originalBrand : undefined),
      normalizedStoreName,
      normalizedBrand,
      region: settingsMatches[0] ? settingsMatches[0].region : undefined,
      category: settingsMatches[0] ? settingsMatches[0].category : undefined,
      settingsRowRefs: settingsMatches.map((r) => r.rowRef).filter((v) => v !== undefined),
      settingsMatchCount: settingsMatches.length,
      historicalMasterLogCount: mlEntry ? mlEntry.count : 0,
      historicalFirstSeen: mlEntry ? mlEntry.firstSeen : null,
      historicalLastSeen: mlEntry ? mlEntry.lastSeen : null,
      masterLogRowRefs: mlEntry ? mlEntry.rowRefs : [],
      matchedSettingsRow: hasSettingsMatch,
      status,
      reason,
    });
  }

  identities.sort((a, b) => a.compositeKey.localeCompare(b.compositeKey));

  return {
    totalSettingsRows: (settingsRows || []).length,
    distinctSettingsCompositeKeys: settingsByKey.size,
    distinctMasterLogCompositeKeys: masterLogByKey.size,
    distinctIdentityCount: allKeys.size,
    duplicateSettingsRows: duplicateSettings,
    unmatchedCount: identities.filter((i) => i.status === 'CANDIDATE_FOR_HUMAN_REVIEW').length,
    readyCount: identities.filter((i) => i.status === 'READY_FOR_STORE_ID_ASSIGNMENT').length,
    identities,
  };
}

module.exports = {
  normalizeText,
  compositeKey,
  groupSettingsRows,
  classifySettingsDuplicates,
  groupMasterLogRows,
  findNameOnlyCandidates,
  buildStoreIdentityReconciliation,
};
