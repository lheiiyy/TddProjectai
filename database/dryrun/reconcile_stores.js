// database/dryrun/reconcile_stores.js
//
// Store identity reconciliation (Phase 2 rule #6). Exact-match only —
// NEVER fuzzy matching, NEVER inferring a Store ID from a similar-looking
// name. Every ambiguous mapping is reported, not resolved.
//
// Inputs (already-parsed row shapes, not raw sheet cells):
//   configStoreVersions: [{ entityId, versionNum, effectiveFrom,
//     effectiveTo, envelopeStatus, storeName, status, ... }]
//   settingsRows: [{ store, brand, region, category }]
//   masterLogRows: [{ store, storeId, rowRef, ... }]  (raw, unfiltered)

function normalizeName(name) {
  return String(name || '').trim().toUpperCase();
}

function latestVersionPerEntity(configStoreVersions) {
  const byEntity = new Map();
  for (const v of configStoreVersions) {
    const cur = byEntity.get(v.entityId);
    if (!cur || v.effectiveFrom > cur.effectiveFrom) byEntity.set(v.entityId, v);
  }
  return byEntity;
}

function reconcileStores({ configStoreVersions, settingsRows, masterLogRows }) {
  const latest = latestVersionPerEntity(configStoreVersions);
  const entityIds = new Set(configStoreVersions.map((v) => v.entityId));

  const report = {
    sourceStoreCount: entityIds.size, // CONFIG_STORES distinct entity IDs
    destinationStoreCount: entityIds.size, // 1:1 — every entity ID becomes one `stores` row
    activeStoreCount: 0,
    inactiveStoreCount: 0,
    historicalOnlyStores: [], // INACTIVE stores that still have MASTER_LOG history
    unmappedStores: [],        // MASTER_LOG store names with no resolvable Store ID
    exactMatches: 0,
    unresolvedNames: [],       // a name (SETTINGS or MASTER_LOG) matching no known current Store name
    ambiguousMatches: [],      // one name resolving to >1 distinct Store ID
    duplicateIdentities: [],   // >1 distinct Store ID sharing the SAME current name
  };

  // Active/inactive counts from each entity's latest version.
  const nameToEntityIds = new Map();
  for (const [entityId, v] of latest) {
    if (v.status === 'ACTIVE') report.activeStoreCount += 1;
    else if (v.status === 'INACTIVE') report.inactiveStoreCount += 1;
    const norm = normalizeName(v.storeName);
    if (!nameToEntityIds.has(norm)) nameToEntityIds.set(norm, new Set());
    nameToEntityIds.get(norm).add(entityId);
  }

  // Duplicate identities: two+ distinct Store IDs, same current name —
  // a real, legitimate historical possibility (old store closed, new
  // store opened later with the same display name). Reported, never merged.
  for (const [name, ids] of nameToEntityIds) {
    if (ids.size > 1) {
      report.duplicateIdentities.push({ storeName: name, storeIds: Array.from(ids) });
    }
  }

  // SETTINGS cross-check: exact match against each entity's CURRENT name.
  for (const s of settingsRows || []) {
    const norm = normalizeName(s.store);
    if (!norm) continue;
    const ids = nameToEntityIds.get(norm);
    if (!ids) {
      report.unresolvedNames.push({ source: 'SETTINGS', name: s.store });
    } else if (ids.size === 1) {
      report.exactMatches += 1;
    } else {
      report.ambiguousMatches.push({ source: 'SETTINGS', name: s.store, candidateStoreIds: Array.from(ids) });
    }
  }

  // MASTER_LOG: every row with a Store ID that isn't a known entity ID,
  // or a blank Store ID, is either UNMAPPED or a resolution problem —
  // never guessed via name similarity.
  const unmappedByName = new Map();
  const inactiveEntityIdsWithHistory = new Set();
  for (const row of masterLogRows || []) {
    const storeId = String(row.storeId || '').trim();
    const storeName = String(row.store || '').trim();

    if (storeId && entityIds.has(storeId)) {
      const v = latest.get(storeId);
      if (v && v.status === 'INACTIVE') inactiveEntityIdsWithHistory.add(storeId);
      continue; // resolved
    }

    // Blank or unknown Store ID — quarantine bucket, grouped by the
    // ORIGINAL historical name (never rewritten).
    const key = storeName || '(blank store name)';
    if (!unmappedByName.has(key)) {
      unmappedByName.set(key, { originalStoreName: key, occurrenceCount: 0, rowRefs: [] });
    }
    const entry = unmappedByName.get(key);
    entry.occurrenceCount += 1;
    entry.rowRefs.push(row.rowRef);
  }

  report.unmappedStores = Array.from(unmappedByName.values());
  report.historicalOnlyStores = Array.from(inactiveEntityIdsWithHistory);

  return report;
}

module.exports = { reconcileStores, normalizeName };
