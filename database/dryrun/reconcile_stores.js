// database/dryrun/reconcile_stores.js
//
// Store identity reconciliation (Phase 2 rule #6). Exact-match only —
// NEVER fuzzy matching, NEVER inferring a Store ID from a similar-looking
// name. Every ambiguous mapping is reported, not resolved.
//
// Identity key is Store Name + Brand (Phase 2A rule #2), NOT Name alone.
// Real production data has confirmed legitimate cases of the same town/
// location name used by two different brands (e.g. a Figaro and an
// Angel's Pizza both named after the same town) — these are genuinely
// distinct stores and must never collapse into one identity just because
// they share a display name.
//
// Inputs (already-parsed row shapes, not raw sheet cells):
//   configStoreVersions: [{ entityId, versionNum, effectiveFrom,
//     effectiveTo, envelopeStatus, storeName, storeBrand, status, ... }]
//   settingsRows: [{ store, brand, region, category }]
//   masterLogRows: [{ store, brand, storeId, rowRef, ... }]  (raw, unfiltered)

function normalizeName(name) {
  return String(name || '').trim().toUpperCase();
}

function compositeIdentityKey(name, brand) {
  return `${normalizeName(name)}|${normalizeName(brand)}`;
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

  // Active/inactive counts from each entity's latest version. Grouped by
  // the composite (Name, Brand) key — NOT name alone — since real data
  // has confirmed the same town/location name legitimately used by two
  // different brands (see same-name/different-brand regression test).
  const keyToEntityIds = new Map();
  for (const [entityId, v] of latest) {
    if (v.status === 'ACTIVE') report.activeStoreCount += 1;
    else if (v.status === 'INACTIVE') report.inactiveStoreCount += 1;
    const key = compositeIdentityKey(v.storeName, v.storeBrand);
    if (!keyToEntityIds.has(key)) keyToEntityIds.set(key, new Set());
    keyToEntityIds.get(key).add(entityId);
  }

  // Duplicate identities: two+ distinct Store IDs, same (Name, Brand) —
  // a real, legitimate historical possibility (old store closed, new
  // store opened later with the same display name AND brand). Reported,
  // never merged.
  for (const [key, ids] of keyToEntityIds) {
    if (ids.size > 1) {
      const [storeName, storeBrand] = key.split('|');
      report.duplicateIdentities.push({ storeName, storeBrand, storeIds: Array.from(ids) });
    }
  }

  // SETTINGS cross-check: exact match against each entity's CURRENT
  // (Name, Brand).
  for (const s of settingsRows || []) {
    const norm = normalizeName(s.store);
    if (!norm) continue;
    const key = compositeIdentityKey(s.store, s.brand);
    const ids = keyToEntityIds.get(key);
    if (!ids) {
      report.unresolvedNames.push({ source: 'SETTINGS', name: s.store, brand: s.brand });
    } else if (ids.size === 1) {
      report.exactMatches += 1;
    } else {
      report.ambiguousMatches.push({ source: 'SETTINGS', name: s.store, brand: s.brand, candidateStoreIds: Array.from(ids) });
    }
  }

  // MASTER_LOG: every row with a Store ID that isn't a known entity ID,
  // or a blank Store ID, is either UNMAPPED or a resolution problem —
  // never guessed via name similarity.
  const unmappedByKey = new Map();
  const inactiveEntityIdsWithHistory = new Set();
  for (const row of masterLogRows || []) {
    const storeId = String(row.storeId || '').trim();
    const storeName = String(row.store || '').trim();
    const storeBrand = String(row.brand || '').trim();

    if (storeId && entityIds.has(storeId)) {
      const v = latest.get(storeId);
      if (v && v.status === 'INACTIVE') inactiveEntityIdsWithHistory.add(storeId);
      continue; // resolved
    }

    // Blank or unknown Store ID — quarantine bucket, grouped by the
    // ORIGINAL historical (Name, Brand) — never rewritten.
    const key = storeName ? compositeIdentityKey(storeName, storeBrand) : '(blank store name)';
    if (!unmappedByKey.has(key)) {
      unmappedByKey.set(key, { originalStoreName: storeName || '(blank store name)', originalStoreBrand: storeBrand, occurrenceCount: 0, rowRefs: [] });
    }
    const entry = unmappedByKey.get(key);
    entry.occurrenceCount += 1;
    entry.rowRefs.push(row.rowRef);
  }

  report.unmappedStores = Array.from(unmappedByKey.values());
  report.historicalOnlyStores = Array.from(inactiveEntityIdsWithHistory);

  return report;
}

module.exports = { reconcileStores, normalizeName, compositeIdentityKey };
