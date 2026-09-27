// ============================================================
// SVMKPI_STORE_CONFIG.gs
// Store Visit Monitoring KPI — Immutable Store Identity +
// Historical Store Attributes (Phase 1B)
// ------------------------------------------------------------
// Contains:
//   1. Store ID generation
//   2. Store CRUD (create/update/activate/deactivate) — thin wrappers
//      over SVMKPI_CONFIG.gs's generic versioned-configuration engine
//   3. Historical resolution (resolveStoreAsOf) + operational queries
//   4. SETTINGS -> Store ID migration + UNMAPPED tracking
// ------------------------------------------------------------
// SCOPE: this file establishes Store ID as the authoritative store
// identity and makes historical store attributes reproducible. It does
// NOT touch the reporting/risk/compliance/KPI engines, and does NOT
// rewrite MASTER_LOG — INPUT_PORTAL.gs's processSubmissionAsync() adds
// one new column (Store ID) to what it already writes, nothing more.
//
// STORE ID DESIGN: 'STR-' + Utilities.getUuid() — Apps Script's built-in
// RFC4122 UUID generator. Chosen because:
//   - globally unique with no shared counter/sequence state, so minting
//     one never needs a lock (unlike a "next available number" scheme,
//     which would race under concurrent creates);
//   - independent of row number, array position, and Store Name by
//     construction — nothing about it can change if the store is
//     renamed, reordered, or its CONFIG_STORES row moves;
//   - a UUID is a completely standard choice for a future PostgreSQL
//     primary/business key (native UUID column type).
// Once minted, a Store ID is never reassigned: store_update() requires
// the ID to already have at least one existing version and never allows
// it to be swapped for a different one on an existing entity — creating
// a version for a different ID is definitionally creating a DIFFERENT
// store, not renaming this one. See _store_generateId() below.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: STORE ID GENERATION
// ═══════════════════════════════════════════════════════════════

function _store_generateId() {
  return 'STR-' + Utilities.getUuid();
}

function _store_normalizeId(storeId) {
  return String(storeId || '').trim().toUpperCase();
}

function _store_today() {
  return _cfg_today();
}

function _store_dateToStr(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: STORE CRUD — every mutation admin-gated, first statement
// ═══════════════════════════════════════════════════════════════

/**
 * store_create(fields, effectiveFromStr, reason, options, explicitStoreId)
 * Creates a BRAND NEW store. Mints a fresh, immutable Store ID unless
 * `explicitStoreId` is supplied (used only by store_migrateFromSettings()
 * below, which needs the ID it generated during mapping to be the one
 * actually written) — and even then, rejects if that ID already has any
 * existing version (a duplicate-ID create attempt is an error, not a
 * silent update; use store_update() to modify an existing store).
 * @returns {{success:boolean, message?:string, storeId?:string, versionId?:string, version?:number}}
 */
function store_create(fields, effectiveFromStr, reason, options, explicitStoreId) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

  const storeId = _store_normalizeId(explicitStoreId ? explicitStoreId : _store_generateId());
  const existing = cfg_getConfiguration(CFG_AREA.STORES, storeId);
  if (existing.length > 0) {
    return { success: false, message: 'Store ID already exists: ' + storeId + '. Use store_update() to modify an existing store.' };
  }

  const withDefaults = Object.assign({ status: CFG_STATUS.ACTIVE }, fields || {});
  const result = cfg_createConfiguration(CFG_AREA.STORES, storeId, withDefaults, effectiveFromStr, null, reason, options);
  if (!result.success) return result;
  return Object.assign({}, result, { storeId });
}

/**
 * store_update(storeId, fields, effectiveFromStr, reason, options)
 * Adds a new version to an EXISTING store — the only way to change any
 * store attribute (Store Name, Brand, Region, Category, Status). Store ID
 * itself can never change: it's the entity being versioned, not a field
 * on the version. If `fields.storeId` is present and disagrees with
 * `storeId`, that's rejected explicitly (defensive — no current caller
 * does this, since Store ID was deliberately never made a domain field
 * in CFG_AREA_SCHEMAS.STORES, but a future UI mistake should fail loudly,
 * not silently ignore the mismatch).
 * @returns {{success:boolean, message?:string, versionId?:string, version?:number}}
 */
function store_update(storeId, fields, effectiveFromStr, reason, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

  const id = _store_normalizeId(storeId);
  if (!id) return { success: false, message: 'Store ID cannot be blank.' };

  if (fields && fields.storeId != null && _store_normalizeId(fields.storeId) !== id) {
    return { success: false, message: 'Store ID cannot be changed. Create a new store instead of retargeting an existing one.' };
  }

  const existing = cfg_getConfiguration(CFG_AREA.STORES, id);
  if (existing.length === 0) {
    return { success: false, message: 'Store ID not found: ' + id + '. Use store_create() for a new store.' };
  }

  return cfg_createConfiguration(CFG_AREA.STORES, id, fields, effectiveFromStr, null, reason, options);
}

function _store_setOperationalStatus(storeId, newStatus, reason, effectiveFromStr, options) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

  const id = _store_normalizeId(storeId);
  const asOfStr = effectiveFromStr || _store_dateToStr(_store_today());
  const asOf = _parseDateCell(asOfStr);
  if (!asOf) return { success: false, message: 'Invalid Effective From date.' };

  const current = resolveStoreAsOf(id, asOfStr) || resolveStoreAsOf(id, _store_dateToStr(_store_today()));
  if (!current) return { success: false, message: 'Store not found: ' + id };

  const fields = Object.assign({}, current.fields, { status: newStatus });
  return store_update(id, fields, asOfStr, reason, options);
}

/** store_activate(storeId, reason, effectiveFromStr, options) — admin-gated. */
function store_activate(storeId, reason, effectiveFromStr, options) {
  return _store_setOperationalStatus(storeId, CFG_STATUS.ACTIVE, reason, effectiveFromStr, options);
}

/** store_deactivate(storeId, reason, effectiveFromStr, options) — admin-gated. */
function store_deactivate(storeId, reason, effectiveFromStr, options) {
  return _store_setOperationalStatus(storeId, CFG_STATUS.INACTIVE, reason, effectiveFromStr, options);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: HISTORICAL RESOLUTION + OPERATIONAL QUERIES (read-only)
// ═══════════════════════════════════════════════════════════════

/**
 * resolveStoreAsOf(storeId, dateStr)
 * THE authoritative resolver — every future consumer that needs "what
 * were this store's attributes on this date" should call this, never
 * re-derive it from CONFIG_STORES rows directly. Thin wrapper over
 * cfg_resolveConfigurationAsOf(), shaped for store-specific callers.
 * @param {string} storeId
 * @param {string} [dateStr] - 'YYYY-MM-DD'; omit for "as of today"
 * @returns {{storeId, versionId, versionNum, effectiveFrom, effectiveTo, fields:{storeName,brand,region,category,status}}|null}
 */
function resolveStoreAsOf(storeId, dateStr) {
  const id = _store_normalizeId(storeId);
  if (!id) return null;
  const resolved = cfg_resolveConfigurationAsOf(CFG_AREA.STORES, id, dateStr);
  if (!resolved) return null;
  return {
    storeId: resolved.entityId,
    versionId: resolved.versionId,
    versionNum: resolved.versionNum,
    effectiveFrom: resolved.effectiveFrom,
    effectiveTo: resolved.effectiveTo,
    fields: resolved.fields,
  };
}

/**
 * store_getById(storeId)
 * Current (as-of-today) attributes for a store, or null if the ID is
 * unknown or has no version effective today (e.g. its only version is
 * future-dated). Does NOT filter by operational status — an inactive
 * store still resolves here; use store_isOperational()/
 * store_getOperationalList() for operational-screen filtering.
 */
function store_getById(storeId) {
  return resolveStoreAsOf(storeId, _store_dateToStr(_store_today()));
}

/**
 * store_isOperational(storeId, dateStr)
 * Whether the store should appear on a current operational screen (e.g.
 * Input Portal's store picker) as of the given date (default: today).
 * A store with no resolvable configuration at all is not operational.
 */
function store_isOperational(storeId, dateStr) {
  const resolved = resolveStoreAsOf(storeId, dateStr || _store_dateToStr(_store_today()));
  if (!resolved) return false;
  return String((resolved.fields && resolved.fields.status) || CFG_STATUS.ACTIVE).toUpperCase() !== CFG_STATUS.INACTIVE;
}

/**
 * _store_listEntityIds()
 * Every distinct Store ID that has at least one CONFIG_STORES version —
 * not filtered by status. Internal; used to build the operational list
 * and for migration/lookup helpers.
 */
function _store_listEntityIds() {
  const all = cfg_getConfiguration(CFG_AREA.STORES);
  const seen = {};
  const ids = [];
  all.forEach(v => { if (!seen[v.entityId]) { seen[v.entityId] = true; ids.push(v.entityId); } });
  return ids;
}

/**
 * store_getOperationalList(dateStr)
 * Current operational stores only — ACTIVE as of the given date (default
 * today). This is what Input Portal's store picker should eventually
 * consume; it deliberately does NOT return inactive stores. Historical
 * queries must NOT use this — they should call resolveStoreAsOf()/
 * store_getById() directly with a known Store ID, which remains
 * resolvable regardless of current operational status (inactive stores
 * are never globally filtered out of the underlying data, only out of
 * this one operational-list view).
 * @returns {{storeId, storeName, brand, region, category}[]} sorted by name
 */
function store_getOperationalList(dateStr) {
  const asOfStr = dateStr || _store_dateToStr(_store_today());
  const out = [];
  _store_listEntityIds().forEach(id => {
    const resolved = resolveStoreAsOf(id, asOfStr);
    if (!resolved) return;
    if (String((resolved.fields && resolved.fields.status) || CFG_STATUS.ACTIVE).toUpperCase() === CFG_STATUS.INACTIVE) return;
    out.push({
      storeId: id,
      storeName: resolved.fields.storeName,
      brand: resolved.fields.brand,
      region: resolved.fields.region,
      category: resolved.fields.category,
    });
  });
  return out.sort((a, b) => String(a.storeName).localeCompare(String(b.storeName)));
}

/**
 * store_resolveIdByCurrentName(storeName)
 * Given a store NAME as it's known TODAY, returns its Store ID — used by
 * INPUT_PORTAL.gs at submission time (the Input Portal form still submits
 * a store name, not an ID; the server resolves it) and by the duplicate-
 * detection fallback for legacy MASTER_LOG rows that predate the Store ID
 * column. Matches only an EXACT normalized-name match against a store
 * that resolves as operational-or-not today — never fuzzy/partial, same
 * discipline as store_migrateFromSettings() below. Returns null if no
 * current store has this exact name.
 */
function store_resolveIdByCurrentName(storeName) {
  const target = String(storeName || '').trim().toUpperCase();
  if (!target) return null;
  const todayStr = _store_dateToStr(_store_today());
  const ids = _store_listEntityIds();
  for (let i = 0; i < ids.length; i++) {
    const resolved = resolveStoreAsOf(ids[i], todayStr);
    if (resolved && String(resolved.fields.storeName || '').trim().toUpperCase() === target) {
      return ids[i];
    }
  }
  return null;
}

/**
 * _storeSync_toSettings(storeId)
 * Phase 1G — called by SVMKPI_CONFIG.gs's _cfg_syncLegacyMirror() after
 * every successful CONFIG_STORES mutation for this Store ID (create,
 * update, activate, deactivate, or rollback). Keeps the legacy SETTINGS
 * sheet's store row (cols A/B/C/D/E) looking like a correct, derived
 * snapshot of this store's CURRENT resolved attributes — SETTINGS is no
 * longer independently editable (Store & Roster Manager is gone; Admin →
 * Configuration → Stores is the only place a store is created or
 * changed), so this is the one thing that writes to it now, and only ever
 * to mirror what CONFIG_STORES already says.
 *
 * Reuses portal_saveStore()/portal_removeStore() (INPUT_PORTAL.gs) as the
 * actual cell-level writers rather than re-implementing that logic here —
 * both are already tested, admin-gated, and already trigger Store
 * Health's own auto-refresh. typeof-guarded so a test sandbox that loads
 * this file without INPUT_PORTAL.gs (e.g. store-identity.test.js) never
 * hits a ReferenceError.
 *
 * Renamed stores: a store's Store ID never changes, but its storeName
 * CAN across versions — every distinct name this entity has EVER had
 * (from cfg_getConfiguration()'s full history) is reconciled here: any
 * name that isn't the current, operationally-active one is removed from
 * SETTINGS, and the current one (if operationally active) is written —
 * so an old name never lingers as a stale, orphaned SETTINGS row.
 */
function _storeSync_toSettings(storeId) {
  if (typeof portal_saveStore !== 'function' || typeof portal_removeStore !== 'function') return;

  const id = _store_normalizeId(storeId);
  const history = cfg_getConfiguration(CFG_AREA.STORES, id);
  const everyName = {};
  history.forEach(v => {
    const n = String((v.fields && v.fields.storeName) || '').trim().toUpperCase();
    if (n) everyName[n] = true;
  });

  const current = store_getById(id); // resolved as of today, or null
  const currentName = current ? String((current.fields && current.fields.storeName) || '').trim().toUpperCase() : null;
  const isOperational = !!current && String((current.fields && current.fields.status) || CFG_STATUS.ACTIVE).toUpperCase() !== CFG_STATUS.INACTIVE;

  Object.keys(everyName).forEach(name => {
    if (isOperational && name === currentName) return; // written below instead of removed
    portal_removeStore(name); // harmless no-op if this name has no SETTINGS row
  });

  if (isOperational && currentName) {
    portal_saveStore(currentName, current.fields.brand, current.fields.region, current.fields.category);
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: MIGRATION — SETTINGS store roster -> Store ID, plus
// UNMAPPED tracking for MASTER_LOG rows that can't be confidently mapped
// ═══════════════════════════════════════════════════════════════

const CFG_UNMAPPED_SHEET = 'CONFIG_UNMAPPED_STORES';
const CFG_UNMAPPED_COL = {
  UNMAPPED_ID:      1, // A
  ORIGINAL_NAME:    2, // B — the raw/normalized MASTER_LOG store reference
  OCCURRENCE_COUNT: 3, // C — how many MASTER_LOG rows carry this reference
  FIRST_SEEN:       4, // D
  LAST_SEEN:        5, // E
  STATUS:           6, // F — UNMAPPED | RECONCILED
  RESOLVED_STORE_ID:7, // G — blank until reconciled
  DETECTED_AT:      8, // H
  RECONCILED_AT:    9, // I
  RECONCILED_BY:   10, // J
  NOTES:           11, // K
};

function _store_ensureUnmappedSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG_UNMAPPED_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CFG_UNMAPPED_SHEET);
    const headers = ['Unmapped ID', 'Original Store Name', 'Occurrence Count', 'First Seen', 'Last Seen', 'Status', 'Resolved Store ID', 'Detected At', 'Reconciled At', 'Reconciled By', 'Notes'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sheet;
}

/**
 * store_recordUnmapped(originalStoreName, firstSeen, lastSeen, occurrenceCount)
 * Records (or updates the occurrence stats for) one historical store
 * reference that store_migrateFromSettings() could not confidently map
 * to a Store ID. One row per distinct unmapped NAME, not per MASTER_LOG
 * row — at MASTER_LOG scale (thousands of rows) a name is very likely to
 * repeat, and the reconciliation workflow this sets up for later cares
 * about "which unresolved store names exist," not a row-by-row log.
 * Never invents a Store ID and never discards the original name.
 */
function store_recordUnmapped(originalStoreName, firstSeen, lastSeen, occurrenceCount) {
  const sheet = _store_ensureUnmappedSheet();
  const name = String(originalStoreName || '').trim().toUpperCase();
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const raw = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
    for (let i = 0; i < raw.length; i++) {
      if (String(raw[i][CFG_UNMAPPED_COL.ORIGINAL_NAME - 1] || '').trim().toUpperCase() === name
          && String(raw[i][CFG_UNMAPPED_COL.STATUS - 1] || '') === 'UNMAPPED') {
        // Already tracked and still unresolved — refresh its stats rather
        // than creating a duplicate tracking row for the same name.
        const rowNum = i + 2;
        sheet.getRange(rowNum, CFG_UNMAPPED_COL.OCCURRENCE_COUNT).setValue(occurrenceCount);
        sheet.getRange(rowNum, CFG_UNMAPPED_COL.FIRST_SEEN).setValue(firstSeen || '');
        sheet.getRange(rowNum, CFG_UNMAPPED_COL.LAST_SEEN).setValue(lastSeen || '');
        return { success: true, unmappedId: raw[i][CFG_UNMAPPED_COL.UNMAPPED_ID - 1], updated: true };
      }
    }
  }

  const unmappedId = 'UNMAPPED-' + Utilities.getUuid();
  sheet.appendRow([
    unmappedId, name, occurrenceCount, firstSeen || '', lastSeen || '',
    'UNMAPPED', '', new Date(), '', '', '',
  ]);
  return { success: true, unmappedId, updated: false };
}

/**
 * store_getUnmappedStores(status)
 * Read-only. Lists tracked unmapped-store entries, optionally filtered
 * by status ('UNMAPPED' or 'RECONCILED'); omit for all.
 */
function store_getUnmappedStores(status) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG_UNMAPPED_SHEET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const raw = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  const out = [];
  raw.forEach(row => {
    const rStatus = String(row[CFG_UNMAPPED_COL.STATUS - 1] || '');
    if (status && rStatus !== status) return;
    out.push({
      unmappedId: row[CFG_UNMAPPED_COL.UNMAPPED_ID - 1],
      originalStoreName: row[CFG_UNMAPPED_COL.ORIGINAL_NAME - 1],
      occurrenceCount: row[CFG_UNMAPPED_COL.OCCURRENCE_COUNT - 1],
      firstSeen: row[CFG_UNMAPPED_COL.FIRST_SEEN - 1],
      lastSeen: row[CFG_UNMAPPED_COL.LAST_SEEN - 1],
      status: rStatus,
      resolvedStoreId: row[CFG_UNMAPPED_COL.RESOLVED_STORE_ID - 1],
      detectedAt: row[CFG_UNMAPPED_COL.DETECTED_AT - 1],
      reconciledAt: row[CFG_UNMAPPED_COL.RECONCILED_AT - 1],
      reconciledBy: row[CFG_UNMAPPED_COL.RECONCILED_BY - 1],
      notes: row[CFG_UNMAPPED_COL.NOTES - 1],
    });
  });
  return out;
}

/**
 * store_reconcileUnmapped(unmappedId, resolvedStoreId, notes)
 * Admin-gated. Marks one unmapped-name entry RECONCILED, recording which
 * Store ID it should have been all along, who decided that, and why —
 * NOT a full reconciliation UI (explicitly out of scope this phase), just
 * the one safe mutation that data model needs to support. Does not
 * retroactively rewrite any MASTER_LOG row or CONFIG_STORES version —
 * that backfill, if ever wanted, is a separate, later, deliberate
 * operation, not an automatic side effect of marking this reconciled.
 */
function store_reconcileUnmapped(unmappedId, resolvedStoreId, notes) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

  const id = _store_normalizeId(resolvedStoreId);
  if (cfg_getConfiguration(CFG_AREA.STORES, id).length === 0) {
    return { success: false, message: 'Resolved Store ID does not exist: ' + id };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG_UNMAPPED_SHEET);
  if (!sheet) return { success: false, message: 'No unmapped stores have been recorded yet.' };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: 'Unmapped entry not found: ' + unmappedId };

  const raw = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  for (let i = 0; i < raw.length; i++) {
    if (String(raw[i][CFG_UNMAPPED_COL.UNMAPPED_ID - 1]) === unmappedId) {
      const rowNum = i + 2;
      sheet.getRange(rowNum, CFG_UNMAPPED_COL.STATUS).setValue('RECONCILED');
      sheet.getRange(rowNum, CFG_UNMAPPED_COL.RESOLVED_STORE_ID).setValue(id);
      sheet.getRange(rowNum, CFG_UNMAPPED_COL.RECONCILED_AT).setValue(new Date());
      sheet.getRange(rowNum, CFG_UNMAPPED_COL.RECONCILED_BY).setValue(sl_getCurrentUser());
      sheet.getRange(rowNum, CFG_UNMAPPED_COL.NOTES).setValue(notes || '');
      return { success: true, unmappedId, resolvedStoreId: id };
    }
  }
  return { success: false, message: 'Unmapped entry not found: ' + unmappedId };
}

/**
 * store_migrateFromSettings(settingsStores, masterLogRows)
 * One-time (per environment) migration: mints a Store ID for every
 * current SETTINGS store and maps MASTER_LOG's historical Store-Name
 * references to those IDs — ONLY on an exact normalized-name match.
 * Anything that doesn't match exactly (a typo, a since-renamed store
 * whose old name doesn't appear in current SETTINGS, anything even
 * subtly different) is never guessed — it's recorded via
 * store_recordUnmapped() instead, preserving the original name and every
 * occurrence's date range for later administrator reconciliation.
 *
 * Each new store's initial version is effective from the EARLIEST visit
 * date found for it in MASTER_LOG (if any), never an invented date —
 * this is the honest boundary of what the migration can actually know;
 * it does not claim the store's current attributes were true before the
 * data shows any activity. A store with no MASTER_LOG history at all
 * gets an initial version effective today.
 *
 * Admin-gated. Phase 1G: now safe to re-run — a name that already
 * resolves to a Store ID today (store_resolveIdByCurrentName()) is
 * treated as already migrated and skipped, so running this again after
 * new stores have been added to SETTINGS only migrates the new ones,
 * never creating a duplicate-name entity for one already migrated. (Still
 * never run against the live spreadsheet without a fresh backup — see
 * DEPLOY.md.)
 *
 * A SETTINGS row missing one of store_create()'s own required fields
 * (Store Name/Brand/Region/Category — cfg_validateConfiguration()'s
 * `required` list for CFG_AREA.STORES, SVMKPI_CONFIG.gs) is rejected by
 * store_create() — reported here in `failed`, with the reason, rather
 * than silently vanishing from the result. Fix this by filling in the
 * missing value in SETTINGS and re-running; already-migrated stores are
 * skipped as always. (Note: a non-blank Brand/Region/Category that just
 * isn't in APPROVED_BRANDS/APPROVED_REGIONS/APPROVED_CATEGORIES is NOT
 * currently rejected here — cfg_validateConfiguration() only enforces
 * "not blank" for these fields, not approved-list membership, for
 * CFG_AREA.STORES specifically.)
 *
 * @param {{store:string, brand:string, region:string, category:string}[]} settingsStores
 * @param {{store:string, date:(Date|string)}[]} masterLogRows - only the
 *   fields this function needs, not a full MASTER_LOG row shape
 * @returns {{success:boolean, message?:string, createdStoreIds?:string[], mapping?:object, unmappedCount?:number, alreadyMigrated?:string[], failed?:{name:string, message:string}[]}}
 */
function store_migrateFromSettings(settingsStores, masterLogRows) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

  const rows = masterLogRows || [];
  const mapping = {};   // normalized name -> storeId
  const created = [];
  const alreadyMigrated = [];
  const failed = [];

  (settingsStores || []).forEach(s => {
    const name = String(s.store || s.name || '').trim().toUpperCase();
    if (!name || mapping[name]) return;

    const existingId = store_resolveIdByCurrentName(name);
    if (existingId) {
      mapping[name] = existingId;
      alreadyMigrated.push(name);
      return;
    }

    let earliest = null;
    rows.forEach(row => {
      if (String(row.store || '').trim().toUpperCase() !== name) return;
      const d = _parseDateCell(row.date);
      if (d && (!earliest || d.getTime() < earliest.getTime())) earliest = d;
    });
    const effectiveFrom = earliest || _store_today();

    const result = store_create(
      { storeName: s.store || s.name, brand: s.brand, region: s.region, category: s.category, status: CFG_STATUS.ACTIVE },
      _store_dateToStr(effectiveFrom),
      'Migrated from SETTINGS',
      { backdateConfirmed: true }
    );
    if (result.success) {
      mapping[name] = result.storeId;
      created.push(result.storeId);
    } else {
      failed.push({ name: s.store || s.name, message: result.message || 'Unknown error.' });
    }
  });

  // Group MASTER_LOG rows by name to record occurrence stats once per
  // distinct unmapped name, not once per row.
  const unmappedStats = {}; // name -> {count, first, last}
  rows.forEach(row => {
    const name = String(row.store || '').trim().toUpperCase();
    if (!name || mapping[name]) return; // mapped — nothing to track
    const d = _parseDateCell(row.date);
    if (!unmappedStats[name]) unmappedStats[name] = { count: 0, first: null, last: null };
    const stat = unmappedStats[name];
    stat.count++;
    if (d) {
      if (!stat.first || d.getTime() < stat.first.getTime()) stat.first = d;
      if (!stat.last || d.getTime() > stat.last.getTime()) stat.last = d;
    }
  });

  Object.keys(unmappedStats).forEach(name => {
    const stat = unmappedStats[name];
    store_recordUnmapped(name, stat.first ? _store_dateToStr(stat.first) : '', stat.last ? _store_dateToStr(stat.last) : '', stat.count);
  });

  return {
    success: true,
    createdStoreIds: created,
    mapping,
    unmappedCount: Object.keys(unmappedStats).length,
    alreadyMigrated,
    failed,
  };
}
