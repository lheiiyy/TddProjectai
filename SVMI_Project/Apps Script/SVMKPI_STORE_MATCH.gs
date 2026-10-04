// ============================================================
// SVMKPI_STORE_MATCH.gs
// Phase C.1 — Store Name Matching (Admin → Tools).
// ------------------------------------------------------------
// Gives every visit a real Store ID before Phase D (reports read the visit
// tables by Store ID). Lists four kinds of problem and fixes only what an
// admin picks in the portal, after a preview:
//
//   1. A name in MASTER_LOG that matches no store (a closed store that was
//      never configured, or a spelling of an existing one)
//        → new store (open, or closed from a date), or
//        → "same store as" an existing store
//   2. One such name saved under two or more brands (may be two stores)
//        → split by brand first: the other brands' visits get "NAME (F)"
//          etc., then each name is handled on its own
//   3. Two or more stores of the SAME brand that are really one store
//        → merge: one Store ID, one name, all visits
//   4. One store whose visits were recorded under different spellings
//        → one name for all its visits
//
// Entry points — admin only, and the only functions here google.script.run
// can call (every other name ends in "_"):
//   portal_getStoreCleanup()              read-only: what needs attention
//   portal_previewStoreCleanup(decisions) read-only: what each choice would do
//   portal_applyStoreCleanupDecision(d)   applies ONE choice (short calls, so
//                                         the portal can show progress)
//   portal_finishStoreCleanup()           one Store Health refresh at the end
//
// What applying writes:
//   CONFIG_STORES / CONFIG_AUDIT   only through store_create / store_update /
//                                  store_deactivate / cfg_deactivateConfiguration
//   CONFIG_UNMAPPED_STORES         the name's entry → RECONCILED
//   CONFIG_STORE_MERGES  (new)     one row per merged store: Store ID → Store ID
//   MASTER_LOG columns C and I     store name and Store ID on the affected rows
//                                  only, so today's name-based reports see one
//                                  store. No other column is touched.
//   MASTER_LOG_FIXES     (new)     one row per changed MASTER_LOG row with the
//                                  old and new name/ID — the original spelling
//                                  is never lost (written BEFORE the rows).
//
// Safety: every choice is re-validated on the server against fresh data and
// applied while holding the script lock (the same one Input Portal
// submissions use). Just before MASTER_LOG is written, the target rows are
// read again; if anyone added, deleted or sorted rows meanwhile, nothing is
// written to MASTER_LOG.
//
// Merging records the merge in CONFIG_STORE_MERGES first, then "voids" the
// duplicate's configuration versions (envelope status INACTIVE — it resolves
// on no date at all, so no report can count it as a store that needed
// visits). svt_buildStoreResolver_ (SVMKPI_TABLES.gs) follows the merge, so
// any visit that still points at the old Store ID lands on the kept one.
//
// Never merges across brands: an Angel's Pizza and a Figaro in the same town
// are two stores (same rule as database/dryrun: no brand-crossing merge).
// Suggestions are only suggestions — nothing is applied unless chosen.
// ============================================================

const SMT_MERGES_SHEET = 'CONFIG_STORE_MERGES';
const SMT_MERGES_HEADERS = [
  'Merge ID', 'Merged Store ID', 'Merged Store Name', 'Into Store ID', 'Into Store Name',
  'Merged At', 'Merged By', 'Notes',
];
const SMT_FIXES_SHEET = 'MASTER_LOG_FIXES';
const SMT_FIXES_HEADERS = [
  'Fix ID', 'Fixed At', 'Fixed By', 'Action', 'MASTER_LOG Row', 'Date Visited',
  'Old Store Name', 'New Store Name', 'Old Store ID', 'New Store ID',
];

const SMT_TYPE = { CREATE: 'create', MAP: 'map', MERGE: 'merge', SPLIT: 'split' };

// Name comparison for SUGGESTIONS only (never for an automatic match).
const SMT_WORD_MAP = { STA: 'SANTA', STO: 'SANTO', MT: 'MOUNT', GEN: 'GENERAL' };
const SMT_DROP_WORDS = {
  F: 1, FIG: 1, FIGARO: 1, AP: 1, ANGELS: 1, PIZZA: 1, APEX: 1, TIEN: 1, MAS: 1, KOOBIDEH: 1,
  SM: 1, CITY: 1, MALL: 1, BRANCH: 1, STORE: 1, THE: 1,
};
const SMT_SUGGEST_MIN = 0.6;
const SMT_MAX_SUGGESTIONS = 3;

// Where an Angel's Pizza and a Figaro share a town, the Figaro store carries
// a tag: STA. MARIA (Angel's Pizza) / STA. MARIA (F) (Figaro). Used to
// pre-fill a suggested name, to name a brand's visits when a name is split
// by brand, and to guess the brand of a name whose rows have none recorded.
const SMT_BRAND_TAG = { FIGARO: 'F' };


// ═══════════════════════════════════════════════════════════════
// SECTION 1: PUBLIC ENTRY POINTS
// ═══════════════════════════════════════════════════════════════

/**
 * portal_getStoreCleanup()
 * Admin only, read-only.
 * @returns {{success:boolean, message?:string, today?:string, options?:object,
 *   stores?:object[], unmatched?:object[], groups?:object[], unmatchedVisits?:number}}
 *   Dates are 'yyyy-MM-dd' strings (google.script.run cannot return Date objects).
 */
function portal_getStoreCleanup() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const t0 = Date.now();
  try {
    const ctx = smt_loadContext_();
    const stats = smt_storeStats_(ctx);
    const unmatched = smt_unmatched_(ctx);

    const stores = Object.keys(ctx.entities)
      .filter(id => !ctx.entities[id].isVoid)
      .map(id => smt_storeOut_(ctx, stats, id))
      .sort((a, b) => a.storeName.localeCompare(b.storeName) || a.brand.localeCompare(b.brand));

    let unmatchedVisits = 0;
    const unmatchedOut = Object.keys(unmatched).map(name => {
      const u = unmatched[name];
      unmatchedVisits += u.visits;
      const brands = Object.keys(u.brands)
        .sort((a, b) => (u.brands[b] - u.brands[a]) || a.localeCompare(b))
        .map(b => ({ brand: b, visits: u.brands[b] }));
      const mixed = brands.length > 1;
      const brand = mixed ? '' : (brands.length ? brands[0].brand : smt_inferBrand_(name));
      const region = smt_top_(u.regions);
      const suggestions = mixed ? [] : smt_suggest_(ctx, name, brand);
      const unmappedEntry = smt_findUnmappedEntry_(ctx, name);
      return {
        name,
        visits: u.visits,
        firstSeen: smt_ymd_(u.first),
        lastSeen: smt_ymd_(u.last),
        brand,
        brands,
        noBrand: u.noBrand,
        mixed,
        splitKeepBrand: mixed ? (u.brands["ANGEL'S PIZZA"] ? "ANGEL'S PIZZA" : brands[0].brand) : '',
        region,
        suggestions,
        defaultCategory: smt_defaultCategory_(ctx, suggestions, region),
        defaultClosedFrom: smt_ymd_(u.last ? smt_addDays_(u.last, 1) : smt_addDays_(ctx.today, 1)),
        unmappedId: unmappedEntry ? unmappedEntry.unmappedId : '',
      };
    }).sort((a, b) => (b.visits - a.visits) || a.name.localeCompare(b.name));

    const groups = smt_groups_(ctx, stats, unmatched);

    if (typeof _perfLog === 'function') _perfLog('portal_getStoreCleanup', t0, unmatchedOut.length + ' names, ' + groups.length + ' groups');
    return {
      success: true,
      today: smt_ymd_(ctx.today),
      options: {
        brands: APPROVED_BRANDS.slice(),
        regions: APPROVED_REGIONS.slice(),
        categories: APPROVED_CATEGORIES.slice(),
      },
      stores,
      unmatched: unmatchedOut,
      groups,
      unmatchedVisits,
    };
  } catch (e) {
    if (typeof logError === 'function') logError('portal_getStoreCleanup', e);
    return { success: false, message: e.message };
  }
}

/**
 * portal_previewStoreCleanup(decisions)
 * Admin only, read-only. Plans every decision against the current data, in
 * the order they will be applied (merges → splits → new stores → "same
 * store as"), and reports problems before anything is written.
 * @param {object[]} decisions  each has a client `key` plus:
 *   {type:'create', name, storeName, brand, region, category, active, closedFrom}
 *   {type:'map',    name, storeId}
 *   {type:'merge',  keepId, mergeIds[], finalName}
 *   {type:'split',  name, keepBrand}
 * @returns {{success:boolean, message?:string, plans?:object[], order?:string[]}}
 */
function portal_previewStoreCleanup(decisions) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    const ctx = smt_loadContext_();
    const batch = smt_newBatch_();
    const ordered = smt_order_(decisions || []);
    const plans = ordered.map(d => {
      const p = smt_plan_(ctx, d, batch);
      return {
        key: d.key, type: p.type, label: p.label, ok: p.ok,
        errors: p.errors, warnings: p.warnings, lines: p.lines,
        rows: p.changedRows || 0,
      };
    });
    return { success: true, plans, order: ordered.map(d => d.key) };
  } catch (e) {
    if (typeof logError === 'function') logError('portal_previewStoreCleanup', e);
    return { success: false, message: e.message };
  }
}

/**
 * portal_applyStoreCleanupDecision(decision)
 * Admin only. Re-reads everything, re-validates, then applies ONE decision
 * while holding the script lock (the same lock Input Portal submissions and
 * Rebuild Visit Tables use). Store Health is NOT refreshed per decision —
 * call portal_finishStoreCleanup() once after the last one.
 * @returns {{success:boolean, message:string, warning?:string, storeId?:string, rowsUpdated?:number}}
 */
function portal_applyStoreCleanupDecision(decision) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: 'A visit is being saved or another tool is running — try again in a moment.' };
  }
  try {
    const ctx = smt_loadContext_();
    const plan = smt_plan_(ctx, decision, null);
    if (!plan.ok) return { success: false, message: plan.errors.join(' ') };
    let result;
    if (plan.type === SMT_TYPE.CREATE) result = smt_applyCreate_(ctx, plan);
    else if (plan.type === SMT_TYPE.MAP) result = smt_applyMap_(ctx, plan);
    else if (plan.type === SMT_TYPE.SPLIT) result = smt_applySplit_(ctx, plan);
    else result = smt_applyMerge_(ctx, plan);
    SpreadsheetApp.flush();
    return result;
  } catch (e) {
    if (typeof logError === 'function') logError('portal_applyStoreCleanupDecision', e);
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * portal_finishStoreCleanup()
 * Admin only. One Store Health refresh after a batch of decisions (each
 * decision skips its own refresh, exactly like the SETTINGS migration does).
 */
function portal_finishStoreCleanup() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (typeof refreshRiskEngine === 'function' && typeof RISK_SHEET_NAME !== 'undefined' && ss.getSheetByName(RISK_SHEET_NAME)) {
      const r = refreshRiskEngine();
      return r && r.success
        ? { success: true, message: 'Store Health refreshed (' + r.rows + ' MASTER_LOG rows).' }
        : { success: false, message: (r && r.message) || 'Store Health refresh failed — run Rebuild Store Health.' };
    }
    return { success: true, message: 'No Store Health sheet — nothing to refresh.' };
  } catch (e) {
    if (typeof logError === 'function') logError('portal_finishStoreCleanup', e);
    return { success: false, message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: CONTEXT — one read of each sheet per call
// ═══════════════════════════════════════════════════════════════

function smt_loadContext_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = ss.getSheetByName('MASTER_LOG');
  if (!master) throw new Error('MASTER_LOG sheet not found.');
  const raw = svt_readMasterLog_(master);
  const today = _store_today();

  const byEntity = {};
  cfg_getConfiguration(CFG_AREA.STORES).forEach(v => {
    (byEntity[v.entityId] = byEntity[v.entityId] || []).push(v);
  });

  const merges = smt_readMerges_();
  const entities = {};
  const nameOwners = {}; // clean name -> {storeId:true}: every version (voided too) + reconciled aliases
  Object.keys(byEntity).forEach(id => {
    const versions = byEntity[id];
    const live = versions.filter(v => v.status === CFG_STATUS.ACTIVE && v.effectiveFrom)
      .sort((a, b) => (a.effectiveFrom - b.effectiveFrom) || (a.versionNum - b.versionNum));
    // As of today; a store whose only versions start in the future still shows.
    const current = _cfg_resolveAsOf(versions, today) || live[0] || null;
    const f = current ? (current.fields || {}) : {};
    const status = current ? (_normalizeEnum(f.status) || CFG_STATUS.ACTIVE) : '';
    entities[id] = {
      id,
      versions,
      current,
      first: live[0] || null,
      isVoid: !current,
      name: smt_cleanName_(f.storeName),
      brand: _normalizeEnum(f.brand),
      region: _normalizeEnum(f.region),
      category: _normalizeEnum(f.category),
      status,
      since: live.length ? live[0].effectiveFrom : null,
      closedFrom: status === CFG_STATUS.INACTIVE && current ? current.effectiveFrom : null,
      future: live.filter(v => v.effectiveFrom.getTime() > today.getTime()).map(v => v.effectiveFrom),
    };
    versions.forEach(v => {
      const n = smt_cleanName_(v.fields && v.fields.storeName);
      if (n) (nameOwners[n] = nameOwners[n] || {})[id] = true;
    });
  });

  const unmappedEntries = typeof store_getUnmappedStores === 'function' ? store_getUnmappedStores() : [];
  const reconciled = {}; // alias name -> Store ID it is reconciled to (merges followed)
  unmappedEntries.forEach(u => {
    if (String(u.status || '') !== 'RECONCILED') return;
    const n = smt_cleanName_(u.originalStoreName);
    const id = smt_follow_(merges, String(u.resolvedStoreId || '').trim().toUpperCase());
    if (!n || !id) return;
    reconciled[n] = id;
    (nameOwners[n] = nameOwners[n] || {})[id] = true;
  });

  const resolve = svt_buildStoreResolver_();
  const rows = [];
  raw.forEach((r, i) => {
    const name = smt_cleanName_(r[SVT_ML.STORE]);
    if (!name) return;
    rows.push({
      rowNum: i + 2,
      name,
      rawName: r[SVT_ML.STORE] == null ? '' : String(r[SVT_ML.STORE]),
      colI: String(r[SVT_ML.STORE_ID] == null ? '' : r[SVT_ML.STORE_ID]).trim().toUpperCase(),
      colIRaw: r[SVT_ML.STORE_ID] == null ? '' : r[SVT_ML.STORE_ID],
      id: resolve(r[SVT_ML.STORE], r[SVT_ML.STORE_ID]),
      date: _parseDateCell(r[SVT_ML.DATE]),
      brand: _normalizeEnum(r[3]),
      region: _normalizeEnum(r[4]),
    });
  });

  return { ss, master, today, entities, nameOwners, reconciled, merges, unmappedEntries, rows };
}

/** Per Store ID: visits, first/last date, and the names its rows carry. */
function smt_storeStats_(ctx) {
  const stats = {};
  ctx.rows.forEach(r => {
    if (!r.id) return;
    const s = stats[r.id] || (stats[r.id] = { visits: 0, first: null, last: null, names: {} });
    s.visits++;
    smt_widen_(s, r.date);
    s.names[r.name] = (s.names[r.name] || 0) + 1;
  });
  return stats;
}

/** Names whose rows resolve to no Store ID, with visit and brand stats. */
function smt_unmatched_(ctx) {
  const by = {};
  ctx.rows.forEach(r => {
    if (r.id) return;
    const u = by[r.name] || (by[r.name] = { visits: 0, first: null, last: null, brands: {}, noBrand: 0, regions: {} });
    u.visits++;
    smt_widen_(u, r.date);
    if (r.brand) u.brands[r.brand] = (u.brands[r.brand] || 0) + 1;
    else u.noBrand++;
    if (r.region) u.regions[r.region] = (u.regions[r.region] || 0) + 1;
  });
  return by;
}

function smt_storeOut_(ctx, stats, id) {
  const e = ctx.entities[id];
  const s = stats[id] || { visits: 0, first: null, last: null };
  return {
    storeId: id,
    storeName: e.name,
    brand: e.brand,
    region: e.region,
    category: e.category,
    status: e.status,
    since: smt_ymd_(e.since),
    closedFrom: smt_ymd_(e.closedFrom),
    visits: s.visits,
    firstSeen: smt_ymd_(s.first),
    lastSeen: smt_ymd_(s.last),
  };
}

/**
 * Stores to review: same-brand stores whose names compare equal (possible
 * duplicates), and single stores whose visits carry a name other than the
 * store's current one (different spellings, or history from before a rename).
 */
function smt_groups_(ctx, stats, unmatched) {
  const groups = [];
  const byKey = {};
  Object.keys(ctx.entities).forEach(id => {
    const e = ctx.entities[id];
    if (e.isVoid || !e.brand) return;
    const key = smt_canonKey_(e.name);
    if (!key) return;
    (byKey[e.brand + '|' + key] = byKey[e.brand + '|' + key] || []).push(id);
  });

  const grouped = {};
  Object.keys(byKey).sort().forEach(k => {
    const ids = byKey[k];
    if (ids.length < 2) return;
    ids.forEach(id => { grouped[id] = true; });
    groups.push(smt_describeGroup_(ctx, stats, unmatched, ids, 'duplicate'));
  });

  Object.keys(stats).sort().forEach(id => {
    const e = ctx.entities[id];
    if (!e || e.isVoid || grouped[id]) return;
    if (Object.keys(stats[id].names).some(n => n !== e.name)) {
      groups.push(smt_describeGroup_(ctx, stats, unmatched, [id], 'spelling'));
    }
  });
  return groups;
}

function smt_describeGroup_(ctx, stats, unmatched, ids, type) {
  const stores = ids.map(id => smt_storeOut_(ctx, stats, id));
  // Keep an open store over a closed one, then the store that existed
  // first, then the one with more visits.
  const keep = stores.slice().sort((a, b) =>
    ((a.status === CFG_STATUS.INACTIVE) - (b.status === CFG_STATUS.INACTIVE))
    || (a.since && b.since ? a.since.localeCompare(b.since) : (a.since ? -1 : (b.since ? 1 : 0)))
    || (b.visits - a.visits) || a.storeName.localeCompare(b.storeName))[0];

  const names = {};
  ids.forEach(id => {
    const s = stats[id];
    if (s) Object.keys(s.names).forEach(n => { names[n] = (names[n] || 0) + s.names[n]; });
  });

  return {
    type,
    brand: ctx.entities[ids[0]].brand,
    stores,
    names: Object.keys(names).map(n => ({ name: n, visits: names[n] })).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name)),
    suggestedKeep: keep.storeId,
    suggestedName: smt_suggestName_(ctx, ctx.entities[keep.storeId], Object.keys(names), unmatched),
  };
}

/**
 * Suggested single name for a group, following the town-sharing convention
 * (STA. MARIA = Angel's Pizza, STA. MARIA (F) = Figaro):
 *   1. a name already recorded for this store — or an unmatched name of the
 *      same brand that compares equal — that ends with this brand's tag;
 *   2. else, when a store of another brand has the same comparison key:
 *      that store's name + this brand's tag;
 *   3. else the kept store's current name.
 * Brands with no tag (everything except Figaro today) always get 3.
 */
function smt_suggestName_(ctx, keep, groupNames, unmatched) {
  const tag = SMT_BRAND_TAG[keep.brand];
  if (!tag) return keep.name;
  const suffix = ' (' + tag + ')';
  const key = smt_canonKey_(keep.name);

  const candidates = {};
  groupNames.concat([keep.name]).forEach(n => { candidates[n] = true; });
  Object.keys(unmatched || {}).forEach(n => {
    const u = unmatched[n];
    const brands = Object.keys(u.brands || {});
    const brand = brands.length === 1 ? brands[0] : (brands.length ? '' : smt_inferBrand_(n));
    if (smt_canonKey_(n) === key && brand === keep.brand) candidates[n] = true;
  });
  const tagged = Object.keys(candidates).filter(n => n.slice(-suffix.length) === suffix).sort();
  if (tagged.length) return tagged[0];

  const neighbours = Object.keys(ctx.entities)
    .map(id => ctx.entities[id])
    .filter(e => !e.isVoid && e.brand && e.brand !== keep.brand && smt_canonKey_(e.name) === key)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (neighbours.length) return smt_cleanName_(neighbours[0].name + suffix);
  return keep.name;
}

function smt_suggest_(ctx, name, brand) {
  const key = smt_canonKey_(name);
  if (!key) return [];
  const out = [];
  Object.keys(ctx.entities).forEach(id => {
    const e = ctx.entities[id];
    if (e.isVoid) return;
    let best = 0;
    smt_entityNames_(e).forEach(n => {
      const s = smt_similarity_(key, smt_canonKey_(n));
      if (s > best) best = s;
    });
    if (best < SMT_SUGGEST_MIN) return;
    const sameBrand = !!brand && e.brand === brand;
    out.push({
      storeId: id,
      score: Math.round(Math.min(1, best + (sameBrand ? 0.1 : 0)) * 100) / 100,
      strong: best === 1 && sameBrand,
      open: e.status !== CFG_STATUS.INACTIVE,
      since: smt_ymd_(e.since),
    });
  });
  out.sort((a, b) => (b.score - a.score) || (b.strong - a.strong) || (b.open - a.open) || String(a.since).localeCompare(String(b.since)));
  return out.slice(0, SMT_MAX_SUGGESTIONS).map(s => ({ storeId: s.storeId, score: s.score, strong: s.strong }));
}

/** Category to pre-fill for a new store: the matching store's (any brand), else NCR for NCR. */
function smt_defaultCategory_(ctx, suggestions, region) {
  for (let i = 0; i < suggestions.length; i++) {
    const e = ctx.entities[suggestions[i].storeId];
    if (e && e.category && suggestions[i].score >= 0.9 && APPROVED_CATEGORIES.indexOf(e.category) !== -1) return e.category;
  }
  return region === 'NCR' ? 'NCR' : '';
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: PLANNING (pure — reads ctx, writes nothing)
// ═══════════════════════════════════════════════════════════════

function smt_newBatch_() {
  return { names: {}, entities: {}, mergedInto: {}, finalNameFor: {}, unmatchedNames: {} };
}

/** Merges, then splits, then new stores, then "same store as" — the order the portal applies them. */
function smt_order_(decisions) {
  const rank = { merge: 0, split: 1, create: 2, map: 3 };
  const r = d => (rank[d.type] != null ? rank[d.type] : 9);
  return decisions
    .map((d, i) => ({ d: d || {}, i }))
    .sort((a, b) => (r(a.d) - r(b.d)) || a.i - b.i)
    .map(x => x.d);
}

function smt_plan_(ctx, d, batch) {
  batch = batch || smt_newBatch_();
  const p = { ok: false, type: d && d.type, label: '', errors: [], warnings: [], lines: [], changedRows: 0 };
  if (!d || !d.type) p.errors.push('No action chosen.');
  else if (d.type === SMT_TYPE.CREATE) smt_planCreate_(ctx, d, batch, p);
  else if (d.type === SMT_TYPE.MAP) smt_planMap_(ctx, d, batch, p);
  else if (d.type === SMT_TYPE.MERGE) smt_planMerge_(ctx, d, batch, p);
  else if (d.type === SMT_TYPE.SPLIT) smt_planSplit_(ctx, d, batch, p);
  else p.errors.push('Unknown action: ' + d.type);
  p.ok = p.errors.length === 0;
  return p;
}

/** The unmatched rows of a name, or an error when there are none / they span brands. */
function smt_unmatchedRows_(ctx, name, batch, p) {
  if (!name) { p.errors.push('Missing the MASTER_LOG name.'); return null; }
  if (batch.unmatchedNames[name]) { p.errors.push('"' + name + '" is also part of another change in this list.'); return null; }
  const rows = ctx.rows.filter(r => !r.id && r.name === name);
  if (!rows.length) { p.errors.push('"' + name + '" has no unmatched visits any more — press Find again.'); return null; }
  return rows;
}

function smt_mixedBrandError_(name, rows) {
  const counts = smt_countBy_(rows, 'brand');
  const brands = Object.keys(counts).sort();
  if (brands.length < 2) return '';
  return 'Visits named "' + name + '" were saved under ' + brands.length + ' brands ('
    + brands.map(b => b + ' ×' + counts[b]).join(', ') + ') — they may be different stores. Use "Split by brand" first.';
}

function smt_planCreate_(ctx, d, batch, p) {
  const name = smt_cleanName_(d.name);
  p.label = name || '(no name)';
  const rows = smt_unmatchedRows_(ctx, name, batch, p);
  if (!rows) return;
  const mixed = smt_mixedBrandError_(name, rows);
  if (mixed) { p.errors.push(mixed); return; }

  const storeName = smt_cleanName_(d.storeName || name);
  const brand = _normalizeEnum(d.brand);
  const region = _normalizeEnum(d.region);
  const category = _normalizeEnum(d.category);
  if (!storeName) p.errors.push('Store name is required.');
  if (APPROVED_BRANDS.indexOf(brand) === -1) p.errors.push('Pick a brand.');
  if (APPROVED_REGIONS.indexOf(region) === -1) p.errors.push('Pick a region.');
  if (APPROVED_CATEGORIES.indexOf(category) === -1) p.errors.push('Pick a category.');
  if (storeName) {
    const owner = smt_nameOwner_(ctx, storeName, {});
    if (owner) p.errors.push('"' + storeName + '" is already a name of ' + smt_label_(ctx.entities[owner]) + ' — use "Same store as" for it, or type a different name.');
    else if (batch.names[storeName]) p.errors.push('"' + storeName + '" is also used by another change in this list.');
  }

  const span = smt_span_(rows);
  const effFrom = span.first && span.first.getTime() <= ctx.today.getTime() ? span.first : ctx.today;
  let closedFrom = null;
  if (!d.active) {
    closedFrom = d.closedFrom ? _parseDateCell(d.closedFrom) : smt_addDays_(span.last || ctx.today, 1);
    if (!closedFrom) p.errors.push('Closed-from date is not a valid date.');
    else if (span.last && closedFrom.getTime() <= span.last.getTime()) p.errors.push('Closed-from date must be after the last visit (' + smt_ymd_(span.last) + ').');
    else if (closedFrom.getTime() <= effFrom.getTime()) p.errors.push('Closed-from date must be after ' + smt_ymd_(effFrom) + '.');
  }

  const recorded = Object.keys(smt_countBy_(rows, 'brand'))[0] || '';
  if (recorded && brand && recorded !== brand) p.warnings.push('These visits were saved under brand ' + recorded + '.');

  p.lines.push('New store "' + storeName + '" · ' + [brand, region, category].join(' · ') + ' · open from ' + smt_ymd_(effFrom)
    + (closedFrom ? ', closed from ' + smt_ymd_(closedFrom) : ''));
  p.lines.push(rows.length + ' MASTER_LOG row(s) get its Store ID' + (storeName !== name ? ' and the name "' + storeName + '"' : ''));
  const entry = smt_findUnmappedEntry_(ctx, name);
  if (entry) p.lines.push('CONFIG_UNMAPPED_STORES: "' + name + '" → RECONCILED');

  Object.assign(p, {
    name, storeName, rows, effFrom, closedFrom, changedRows: rows.length,
    fields: { storeName, brand, region, category, status: CFG_STATUS.ACTIVE },
    unmappedId: entry ? entry.unmappedId : '',
  });
  if (storeName) batch.names[storeName] = true;
  batch.unmatchedNames[name] = true;
}

function smt_planMap_(ctx, d, batch, p) {
  const name = smt_cleanName_(d.name);
  p.label = name || '(no name)';
  if (!name) { p.errors.push('Missing the MASTER_LOG name.'); return; }
  if (batch.unmatchedNames[name]) { p.errors.push('"' + name + '" is also part of another change in this list.'); return; }

  const picked = String(d.storeId || '').trim().toUpperCase();
  let target = smt_follow_(ctx.merges, picked);
  if (batch.mergedInto[target]) target = batch.mergedInto[target]; // merged earlier in this same list
  const e = ctx.entities[target];
  if (!picked || !e || e.isVoid) { p.errors.push('Pick the store these visits belong to.'); return; }

  // Rows of this name that are unmatched, or already on this store (e.g.
  // after a rename made the name resolve) — never rows of another store.
  const rows = ctx.rows.filter(r => r.name === name && (!r.id || r.id === target));
  if (!rows.length) {
    const other = ctx.rows.filter(r => r.name === name && r.id)[0];
    p.errors.push(other && ctx.entities[other.id]
      ? '"' + name + '" now belongs to ' + smt_label_(ctx.entities[other.id]) + ' — press Find again.'
      : '"' + name + '" has no unmatched visits any more — press Find again.');
    return;
  }
  const mixed = smt_mixedBrandError_(name, rows.filter(r => !r.id));
  if (mixed) { p.errors.push(mixed); return; }

  const conflicts = rows.filter(r => r.brand && r.brand !== e.brand);
  if (conflicts.length) p.warnings.push(conflicts.length + ' of these visits were saved under brand ' + conflicts[0].brand + ', the store is ' + e.brand + ' (MASTER_LOG row ' + smt_rowList_(conflicts) + ').');
  if (e.closedFrom) {
    const late = rows.filter(r => r.date && r.date.getTime() >= e.closedFrom.getTime());
    if (late.length) p.warnings.push(late.length + ' visit(s) are on or after ' + e.name + ' closed (' + smt_ymd_(e.closedFrom) + ') — MASTER_LOG row ' + smt_rowList_(late) + '.');
  }
  if (target !== picked) p.lines.push('The store you picked was merged into ' + smt_label_(e) + ' — using that one.');

  const targetName = batch.finalNameFor[target] || e.name;
  const changing = rows.filter(r => r.rawName !== targetName || r.colI !== target);
  const extendFrom = smt_extendFrom_(e, smt_span_(rows).first);
  const entry = smt_findUnmappedEntry_(ctx, name);
  const ownName = smt_entityNames_(e).indexOf(name) !== -1;
  const needAlias = !!entry || (!ownName && ctx.reconciled[name] !== target);
  if (!changing.length && !needAlias && !extendFrom) {
    p.errors.push('Nothing to change — these visits already belong to ' + smt_label_(e) + '.');
    return;
  }

  p.lines.push(rows.length + ' visit(s) → ' + targetName + ' (' + e.brand + ')');
  if (changing.length) {
    p.lines.push(changing.length + ' MASTER_LOG row(s) ' + (name === targetName
      ? 'get its Store ID (the name already matches)'
      : 'get the name "' + targetName + '" and its Store ID'));
  }
  if (needAlias) p.lines.push('CONFIG_UNMAPPED_STORES: "' + name + '" → RECONCILED');
  if (extendFrom) p.lines.push(e.name + ' starts on ' + smt_ymd_(e.since) + ' — its start moves back to ' + smt_ymd_(extendFrom) + ', the earliest of these visits');

  const span = smt_span_(rows);
  Object.assign(p, {
    name, rows: changing, changedRows: changing.length, targetId: target, target: e,
    first: span.first, last: span.last, extendFrom, needAlias, unmappedId: entry ? entry.unmappedId : '',
  });
  batch.unmatchedNames[name] = true;
}

function smt_planMerge_(ctx, d, batch, p) {
  const keepId = String(d.keepId || '').trim().toUpperCase();
  const keep = ctx.entities[keepId];
  if (!keep || keep.isVoid) { p.label = '(no store)'; p.errors.push('Pick the store to keep.'); return; }
  p.label = keep.name + ' (' + keep.brand + ')';

  const seen = {};
  const mergeIds = [];
  (d.mergeIds || []).forEach(raw => {
    const id = String(raw || '').trim().toUpperCase();
    if (!id || id === keepId || seen[id]) return;
    seen[id] = true;
    mergeIds.push(id);
  });

  mergeIds.forEach(id => {
    const m = ctx.entities[id];
    if (!m || m.isVoid) p.errors.push('Store ' + id + ' was not found (already merged?) — press Find again.');
    else if (m.brand !== keep.brand) p.errors.push('Cannot merge ' + smt_label_(m) + ' into ' + smt_label_(keep) + ': different brands stay separate stores.');
    if (batch.entities[id]) p.errors.push((m ? smt_label_(m) : id) + ' is also part of another change in this list.');
  });
  if (batch.entities[keepId]) p.errors.push(smt_label_(keep) + ' is also part of another change in this list.');

  const finalName = smt_cleanName_(d.finalName || keep.name);
  if (!finalName) p.errors.push('Type the name to use.');
  const group = {};
  [keepId].concat(mergeIds).forEach(id => { group[id] = true; });
  if (finalName) {
    const owner = smt_nameOwner_(ctx, finalName, group);
    if (owner) p.errors.push('"' + finalName + '" is already a name of ' + smt_label_(ctx.entities[owner]) + '.');
    else if (batch.names[finalName]) p.errors.push('"' + finalName + '" is also used by another change in this list.');
  }

  const renaming = !!finalName && finalName !== keep.name;
  if (renaming && smt_hasVersionOn_(keep, ctx.today)) {
    p.errors.push(keep.name + ' already has a change dated today, so it can\'t get a new name until tomorrow — keep "' + keep.name + '" for now, or do this tomorrow.');
  }

  const groupRows = ctx.rows.filter(r => group[r.id]);
  const changing = groupRows.filter(r => r.rawName !== finalName || r.colI !== keepId);
  const extendFrom = smt_extendFrom_(keep, smt_span_(groupRows).first);
  if (!p.errors.length && !mergeIds.length && !renaming && !changing.length && !extendFrom) p.errors.push('Nothing to change for ' + smt_label_(keep) + '.');

  const conflicts = groupRows.filter(r => r.brand && r.brand !== keep.brand);
  if (conflicts.length) {
    const cb = smt_countBy_(conflicts, 'brand');
    p.warnings.push(conflicts.length + ' visit(s) were saved under another brand (' + Object.keys(cb).sort().map(b => b + ' ×' + cb[b]).join(', ')
      + ') — MASTER_LOG row ' + smt_rowList_(conflicts) + '. Check them before applying.');
  }
  const openRetired = mergeIds.filter(id => ctx.entities[id] && !ctx.entities[id].isVoid && ctx.entities[id].status !== CFG_STATUS.INACTIVE);
  if (keep.status === CFG_STATUS.INACTIVE && openRetired.length) {
    p.warnings.push('You are keeping ' + keep.name + ', which is closed, and retiring ' + openRetired.map(id => ctx.entities[id].name).join(', ')
      + ', which is open — afterwards the store is not in the Input Portal. Mark the open one as Keep if the store is still open.');
  }
  if (keep.closedFrom) {
    const late = groupRows.filter(r => r.date && r.date.getTime() >= keep.closedFrom.getTime());
    if (late.length) p.warnings.push(late.length + ' visit(s) are on or after ' + keep.name + ' closed (' + smt_ymd_(keep.closedFrom) + ') — MASTER_LOG row ' + smt_rowList_(late) + '.');
  }
  if (renaming && keep.future.length) {
    p.warnings.push(keep.name + ' has a change scheduled for ' + keep.future.map(smt_ymd_).join(', ')
      + ' that still uses the old name — update it in Admin → Configuration → Stores.');
  }

  mergeIds.forEach(id => {
    const m = ctx.entities[id];
    if (!m || m.isVoid) return;
    const n = groupRows.filter(r => r.id === id).length;
    p.lines.push('Merge ' + smt_label_(m) + ' (' + n + ' visit' + (n === 1 ? '' : 's') + ') into ' + smt_label_(keep) + ' — its Store ID stops being used');
  });
  if (renaming) p.lines.push('Rename ' + keep.name + ' → ' + finalName + ' (from today)');
  if (extendFrom) p.lines.push(keep.name + ' starts on ' + smt_ymd_(keep.since) + ' — its start moves back to ' + smt_ymd_(extendFrom) + ', the earliest of these visits');
  p.lines.push(changing.length + ' MASTER_LOG row(s) get the name "' + finalName + '" and ' + keep.name + '\'s Store ID');

  Object.assign(p, { keep, keepId, mergeIds, finalName, renaming, extendFrom, rows: changing, changedRows: changing.length });
  batch.entities[keepId] = true;
  mergeIds.forEach(id => { batch.entities[id] = true; batch.mergedInto[id] = keepId; });
  if (finalName) { batch.names[finalName] = true; batch.finalNameFor[keepId] = finalName; }
}

function smt_planSplit_(ctx, d, batch, p) {
  const name = smt_cleanName_(d.name);
  p.label = name || '(no name)';
  const rows = smt_unmatchedRows_(ctx, name, batch, p);
  if (!rows) return;
  const counts = smt_countBy_(rows, 'brand');
  const brands = Object.keys(counts).sort();
  if (brands.length < 2) { p.errors.push('"' + name + '" was saved under one brand only — no split needed.'); return; }
  const keepBrand = _normalizeEnum(d.keepBrand);
  if (brands.indexOf(keepBrand) === -1) { p.errors.push('Pick which brand keeps the name "' + name + '".'); return; }

  const moves = [];
  brands.filter(b => b !== keepBrand).forEach(b => {
    const newName = smt_cleanName_(name + ' (' + (SMT_BRAND_TAG[b] || b) + ')');
    const owner = smt_nameOwner_(ctx, newName, {});
    if (owner && ctx.entities[owner] && ctx.entities[owner].brand !== b) {
      p.errors.push('"' + newName + '" is already a name of ' + smt_label_(ctx.entities[owner]) + '.');
      return;
    }
    if (batch.names[newName]) { p.errors.push('"' + newName + '" is also used by another change in this list.'); return; }
    const brandRows = rows.filter(r => r.brand === b);
    moves.push({ brand: b, name: newName, rows: brandRows });
    p.lines.push(brandRows.length + ' visit(s) saved as ' + b + ' → name "' + newName + '"'
      + (owner ? ' — already the name of ' + smt_label_(ctx.entities[owner]) + ', so they count there' : ''));
    batch.names[newName] = true;
  });
  const stay = rows.filter(r => r.brand === keepBrand || !r.brand);
  const unknown = stay.filter(r => !r.brand).length;
  p.lines.push(stay.length + ' visit(s) keep the name "' + name + '" (' + keepBrand + (unknown ? ', incl. ' + unknown + ' with no brand recorded' : '') + ')');
  p.lines.push('Then press Find again — each name has one brand and can be set up on its own.');

  Object.assign(p, { name, moves, changedRows: moves.reduce((n, m) => n + m.rows.length, 0) });
  batch.unmatchedNames[name] = true;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: APPLYING (called only from portal_applyStoreCleanupDecision,
// inside the script lock, with a freshly validated plan)
// ═══════════════════════════════════════════════════════════════

const SMT_STALE_NOTE = 'MASTER_LOG changed while this ran (rows were added, deleted or sorted), so no MASTER_LOG row was changed. Press Find again.';

function smt_applyCreate_(ctx, p) {
  const reason = 'Store Name Matching: new store for MASTER_LOG name "' + p.name + '"';
  const created = store_create(p.fields, smt_ymd_(p.effFrom), reason, { backdateConfirmed: true, suppressRebuild: true });
  if (!created || !created.success) return { success: false, message: 'Could not create the store: ' + ((created && created.message) || 'unknown error') };
  const storeId = created.storeId;

  const warnings = [];
  if (p.closedFrom) {
    const off = store_deactivate(storeId, 'Store Name Matching: store closed', smt_ymd_(p.closedFrom), { backdateConfirmed: true, suppressRebuild: true });
    if (!off || !off.success) warnings.push('created, but not marked closed (' + ((off && off.message) || 'unknown error') + ') — deactivate it in Admin → Configuration → Stores');
  }

  const written = smt_writeRowsSafely_(ctx, [{ rows: p.rows, name: p.storeName, id: storeId }], 'NEW STORE');
  if (p.unmappedId) smt_reconcile_(p.unmappedId, storeId, 'Store Name Matching: new store "' + p.storeName + '"', warnings);
  if (written.stale) {
    return { success: false, storeId, message: 'Store "' + p.storeName + '" was created, but ' + SMT_STALE_NOTE };
  }
  return {
    success: true,
    storeId,
    rowsUpdated: written.count,
    warning: warnings.join('; '),
    message: 'New store "' + p.storeName + '"' + (p.closedFrom ? ' (closed from ' + smt_ymd_(p.closedFrom) + ')' : '')
      + ' · ' + written.count + ' MASTER_LOG row(s) updated',
  };
}

function smt_applyMap_(ctx, p) {
  const warnings = [];
  if (p.needAlias) {
    let unmappedId = p.unmappedId;
    if (!unmappedId) {
      const rec = store_recordUnmapped(p.name, smt_ymd_(p.first), smt_ymd_(p.last), p.rows.length);
      unmappedId = rec && rec.unmappedId;
    }
    if (unmappedId) smt_reconcile_(unmappedId, p.targetId, 'Store Name Matching: same store as "' + p.target.name + '"', warnings);
  }
  if (p.extendFrom) smt_extendStart_(p.target, p.extendFrom, warnings);

  const written = smt_writeRowsSafely_(ctx, [{ rows: p.rows, name: p.target.name, id: p.targetId }], 'SAME STORE');
  if (written.stale) return { success: false, storeId: p.targetId, message: '"' + p.name + '" was linked to ' + p.target.name + ' in Configuration, but ' + SMT_STALE_NOTE };
  return {
    success: true,
    storeId: p.targetId,
    rowsUpdated: written.count,
    warning: warnings.join('; '),
    message: 'Same store as ' + p.target.name + ' (' + p.target.brand + ')'
      + (p.name !== p.target.name ? ', renamed from "' + p.name + '"' : '') + ' · ' + written.count + ' MASTER_LOG row(s) updated',
  };
}

function smt_applyMerge_(ctx, p) {
  const keep = p.keep;
  const warnings = [];

  // 1) Record each merge FIRST, then retire the duplicate (void its
  //    versions). If retiring fails, the record already sends its visits to
  //    the kept store, and the merge can simply be run again.
  p.mergeIds.forEach(id => {
    const m = ctx.entities[id];
    const reason = 'Store Name Matching: merged into ' + keep.id + ' (' + p.finalName + ')';
    smt_recordMerge_(id, m.name, keep.id, p.finalName, reason);
    m.versions.filter(v => v.status === CFG_STATUS.ACTIVE).forEach(v => {
      const r = cfg_deactivateConfiguration(CFG_AREA.STORES, v.versionId, reason, { suppressRebuild: true });
      if (!r || !r.success) warnings.push('could not retire ' + v.versionId + ' (' + ((r && r.message) || 'unknown error') + ') — run this merge again');
    });
  });

  // 2) Visits older than the kept store's first version: move its start back.
  if (p.extendFrom) smt_extendStart_(keep, p.extendFrom, warnings);

  // 3) Rename the kept store (a new version from today — its Store ID never changes).
  let rowName = p.finalName;
  if (p.renaming) {
    const fields = Object.assign({}, keep.current.fields, { storeName: p.finalName });
    const r = store_update(keep.id, fields, smt_ymd_(ctx.today), 'Store Name Matching: ' + (p.mergeIds.length ? 'one name after merge' : 'one name for all visits'), { suppressRebuild: true });
    if (!r || !r.success) {
      rowName = keep.name;
      warnings.push('not renamed (' + ((r && r.message) || 'unknown error') + ') — visits keep the name "' + keep.name + '"');
    }
  }

  // 4) SETTINGS mirror: it is keyed by name, so re-sync the kept store and
  //    any other store that uses one of the names that just went away.
  smt_resyncSettings_(ctx, keep, p.mergeIds, warnings);

  // 5) MASTER_LOG rows of every store in the group.
  const rows = rowName === p.finalName ? p.rows : p.rows.filter(r => r.rawName !== rowName || r.colI !== keep.id);
  const written = smt_writeRowsSafely_(ctx, [{ rows, name: rowName, id: keep.id }], p.mergeIds.length ? 'MERGE' : 'ONE NAME');
  if (written.stale) return { success: false, storeId: keep.id, message: 'Configuration was updated for ' + keep.name + ', but ' + SMT_STALE_NOTE };

  return {
    success: true,
    storeId: keep.id,
    rowsUpdated: written.count,
    warning: warnings.join('; '),
    message: (p.mergeIds.length ? 'Merged ' + p.mergeIds.length + ' store(s) into ' : 'One name for ') + '"' + rowName + '" (' + keep.brand + ')'
      + ' · ' + written.count + ' MASTER_LOG row(s) updated',
  };
}

function smt_applySplit_(ctx, p) {
  const written = smt_writeRowsSafely_(ctx, p.moves.map(m => ({ rows: m.rows, name: m.name, id: null })), 'SPLIT BY BRAND');
  if (written.stale) return { success: false, message: SMT_STALE_NOTE };
  return {
    success: true,
    rowsUpdated: written.count,
    message: '"' + p.name + '" split by brand: ' + p.moves.map(m => m.rows.length + ' → "' + m.name + '"').join(', ')
      + ' · ' + written.count + ' MASTER_LOG row(s) updated — press Find again',
  };
}

/**
 * Writes the new store name (column C) and, when an id is given, Store ID
 * (column I) on the given MASTER_LOG rows — only cells that change.
 * Order: (1) re-read the target rows and stop if any no longer hold what was
 * read at the start (someone added, deleted or sorted rows); (2) append
 * every change to MASTER_LOG_FIXES; (3) write the cells.
 * @param {{rows:object[], name:string, id:(string|null)}[]} changes
 * @returns {{count:number, stale:boolean}}
 */
function smt_writeRowsSafely_(ctx, changes, action) {
  const fixId = 'FIX-' + Utilities.getUuid();
  const at = new Date();
  const by = typeof sl_getCurrentUser === 'function' ? sl_getCurrentUser() : '';
  const touched = [];
  const log = [];
  const nameRefs = {}; // value -> A1 refs
  const idRefs = {};
  changes.forEach(c => {
    c.rows.forEach(r => {
      const nameChanges = r.rawName !== c.name;
      const idChanges = c.id != null && r.colI !== c.id;
      if (!nameChanges && !idChanges) return;
      touched.push(r);
      if (nameChanges) (nameRefs[c.name] = nameRefs[c.name] || []).push('C' + r.rowNum);
      if (idChanges) (idRefs[c.id] = idRefs[c.id] || []).push('I' + r.rowNum);
      log.push([fixId, at, by, action, r.rowNum, r.date || '', r.rawName, c.name, r.colIRaw, c.id != null ? c.id : r.colIRaw]);
    });
  });
  if (!log.length) return { count: 0, stale: false };
  if (!smt_rowsUnchanged_(ctx, touched)) return { count: 0, stale: true };

  svt_appendRows_(smt_ensureSheet_(SMT_FIXES_SHEET, SMT_FIXES_HEADERS,
    'Written by Admin → Tools → Store Name Matching: one row per MASTER_LOG row it changed, with the old name and Store ID. Keep this sheet — it is the record of the original spelling.'),
    log, SMT_FIXES_HEADERS.length);
  Object.keys(nameRefs).forEach(v => ctx.master.getRangeList(nameRefs[v]).setValue(v));
  Object.keys(idRefs).forEach(v => ctx.master.getRangeList(idRefs[v]).setValue(v));
  return { count: log.length, stale: false };
}

/** True when every row still holds the store name and Store ID read at the start. */
function smt_rowsUnchanged_(ctx, rows) {
  if (!rows.length) return true;
  let min = Infinity, max = 0;
  rows.forEach(r => { if (r.rowNum < min) min = r.rowNum; if (r.rowNum > max) max = r.rowNum; });
  if (max > ctx.master.getLastRow()) return false;
  const block = ctx.master.getRange(min, 3, max - min + 1, 7).getValues(); // C..I
  return rows.every(r => {
    const v = block[r.rowNum - min];
    return String(v[0] == null ? '' : v[0]) === r.rawName
      && String(v[6] == null ? '' : v[6]).trim().toUpperCase() === r.colI;
  });
}

/** New version, effective from `from`, copying the store's first version — so visits before its start resolve. */
function smt_extendStart_(e, from, warnings) {
  if (!e.first) return;
  const r = store_update(e.id, Object.assign({}, e.first.fields), smt_ymd_(from),
    'Store Name Matching: start moved back to the first visit', { backdateConfirmed: true, suppressRebuild: true });
  if (!r || !r.success) warnings.push('start date not moved back (' + ((r && r.message) || 'unknown error') + ')');
}

/** Re-sync SETTINGS for the kept store and every other store using a name the merge/rename took away. */
function smt_resyncSettings_(ctx, keep, mergeIds, warnings) {
  if (typeof _storeSync_toSettings !== 'function') return;
  const gone = {};
  mergeIds.forEach(id => smt_entityNames_(ctx.entities[id]).forEach(n => { gone[n] = true; }));
  gone[keep.name] = true;
  const ids = [keep.id];
  Object.keys(ctx.entities).forEach(id => {
    const e = ctx.entities[id];
    if (id === keep.id || mergeIds.indexOf(id) !== -1 || e.isVoid) return;
    if (gone[e.name]) ids.push(id);
  });
  ids.forEach(id => {
    try { _storeSync_toSettings(id, true); }
    catch (err) { warnings.push('SETTINGS not updated for ' + ctx.entities[id].name + ' (' + err.message + ')'); }
  });
}

function smt_reconcile_(unmappedId, storeId, notes, warnings) {
  const r = store_reconcileUnmapped(unmappedId, storeId, notes);
  if (!r || !r.success) warnings.push('CONFIG_UNMAPPED_STORES not updated (' + ((r && r.message) || 'unknown error') + ')');
}

function smt_recordMerge_(fromId, fromName, intoId, intoName, notes) {
  const sheet = smt_ensureSheet_(SMT_MERGES_SHEET, SMT_MERGES_HEADERS,
    'Written by Admin → Tools → Store Name Matching. A merged Store ID hands all its visits to the Into Store ID. Do not edit by hand.');
  sheet.appendRow(['MERGE-' + Utilities.getUuid(), fromId, fromName, intoId, intoName, new Date(),
    typeof sl_getCurrentUser === 'function' ? sl_getCurrentUser() : '', notes || '']);
}

/**
 * smt_readMerges_()
 * {mergedStoreId: intoStoreId} from CONFIG_STORE_MERGES ({} if the sheet
 * doesn't exist). Also used by svt_buildStoreResolver_ (SVMKPI_TABLES.gs).
 */
function smt_readMerges_() {
  const out = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SMT_MERGES_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues().forEach(r => {
    const from = String(r[1] == null ? '' : r[1]).trim().toUpperCase();
    const into = String(r[3] == null ? '' : r[3]).trim().toUpperCase();
    if (from && into && from !== into) out[from] = into;
  });
  return out;
}

/** Follows merges to the store that is still in use (cycle-safe). */
function smt_follow_(merges, id) {
  let cur = id;
  let hops = 0;
  while (cur && merges[cur] && hops < 20) { cur = merges[cur]; hops++; }
  return cur;
}

function smt_ensureSheet_(name, headers, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    try { sheet.protect().setDescription(note).setWarningOnly(true); } catch (e) { /* courtesy warning only */ }
  }
  return sheet;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: SMALL HELPERS
// ═══════════════════════════════════════════════════════════════

/** Uppercase, straight quotes, single spaces — how store names are compared and written. */
function smt_cleanName_(v) {
  return _normalizeEnum(v).replace(/\s+/g, ' ');
}

/**
 * Comparison key for SUGGESTIONS: punctuation and brand/mall words dropped,
 * STA/STO spelled out. "STA. MARIA (F)", "SANTA MARIA" and "STA MARIA" all
 * become "SANTA MARIA". Never used to match anything automatically.
 */
function smt_canonKey_(name) {
  return smt_cleanName_(name)
    .replace(/'S\b/g, 'S')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => SMT_WORD_MAP[w] || w)
    .filter(w => !SMT_DROP_WORDS[w])
    .join(' ');
}

/** 0..1 similarity of two comparison keys. */
function smt_similarity_(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = a.split(' ');
  const B = b.split(' ');
  const inB = {};
  B.forEach(w => { inB[w] = true; });
  const union = {};
  A.concat(B).forEach(w => { union[w] = true; });
  let shared = 0;
  const counted = {};
  A.forEach(w => { if (inB[w] && !counted[w]) { counted[w] = true; shared++; } });
  const jaccard = shared / Object.keys(union).length;
  const sa = A.join('');
  const sb = B.join('');
  if (sa === sb) return 0.95; // "SHANGRI LA" vs "SHANGRILA"
  const edit = 1 - smt_levenshtein_(sa, sb) / Math.max(sa.length, sb.length);
  return Math.max(jaccard, edit * 0.9);
}

function smt_levenshtein_(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Brand implied by a tag or brand word in a store name ('' if none) — a fallback guess only. */
function smt_inferBrand_(name) {
  const n = smt_cleanName_(name);
  if (/\(F\)$|\bFIGARO\b|^F\s|\sF$/.test(n)) return 'FIGARO';
  if (/\bANGEL'?S\b|\(AP\)$/.test(n)) return "ANGEL'S PIZZA";
  return '';
}

/** Every name a store has ever had (current first). */
function smt_entityNames_(e) {
  const names = {};
  if (e.name) names[e.name] = true;
  e.versions.forEach(v => { const n = smt_cleanName_(v.fields && v.fields.storeName); if (n) names[n] = true; });
  return Object.keys(names);
}

/**
 * The Store ID that already owns `name` — in any version (retired ones too)
 * or as a reconciled alias — ignoring stores in `allowed` and anything
 * merged into them; '' if the name is free.
 */
function smt_nameOwner_(ctx, name, allowed) {
  const owners = ctx.nameOwners[name] ? Object.keys(ctx.nameOwners[name]) : [];
  for (let i = 0; i < owners.length; i++) {
    const id = owners[i];
    if (allowed[id] || allowed[smt_follow_(ctx.merges, id)]) continue;
    return id;
  }
  return '';
}

function smt_findUnmappedEntry_(ctx, name) {
  for (let i = 0; i < ctx.unmappedEntries.length; i++) {
    const u = ctx.unmappedEntries[i];
    if (String(u.status || '') === 'UNMAPPED' && smt_cleanName_(u.originalStoreName) === name) return u;
  }
  return null;
}

/** The date a store's start should move back to so `firstVisit` resolves, or null. */
function smt_extendFrom_(e, firstVisit) {
  if (!firstVisit || !e.since || firstVisit.getTime() >= e.since.getTime()) return null;
  return smt_hasVersionOn_(e, firstVisit) ? null : firstVisit;
}

/** Any version of this store (voided ones too) dated exactly `date` — the config engine allows one per date. */
function smt_hasVersionOn_(e, date) {
  return e.versions.some(v => v.effectiveFrom && v.effectiveFrom.getTime() === date.getTime());
}

function smt_label_(e) {
  return e ? e.name + ' (' + e.brand + ')' : '(unknown store)';
}

function smt_rowList_(rows) {
  const nums = rows.map(r => r.rowNum);
  return nums.slice(0, 5).join(', ') + (nums.length > 5 ? ' …' : '');
}

function smt_span_(rows) {
  const s = { first: null, last: null };
  rows.forEach(r => smt_widen_(s, r.date));
  return s;
}

function smt_widen_(s, date) {
  if (!date) return;
  if (!s.first || date.getTime() < s.first.getTime()) s.first = date;
  if (!s.last || date.getTime() > s.last.getTime()) s.last = date;
}

function smt_countBy_(rows, field) {
  const out = {};
  rows.forEach(r => { if (r[field]) out[r[field]] = (out[r[field]] || 0) + 1; });
  return out;
}

/** Most frequent key of a {key: count} map ('' if empty; ties → alphabetical). */
function smt_top_(counts) {
  let best = '';
  Object.keys(counts || {}).sort().forEach(k => { if (!best || counts[k] > counts[best]) best = k; });
  return best;
}

function smt_addDays_(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function smt_ymd_(date) {
  return date ? _store_dateToStr(date) : '';
}
