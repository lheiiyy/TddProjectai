// ============================================================
// SVMKPI_TABLES.gs
// Phase C — normalized visit tables inside the spreadsheet.
// ------------------------------------------------------------
// MASTER_LOG stays the audit trail (one wide row per submission). This
// module keeps two derived tables in the same workbook, shaped exactly like
// database/migrations/008_store_visits.sql so a later move to PostgreSQL is
// a straight copy:
//
//   STORE_VISITS          one row per visit  (Visit ID, Date, Store ID,
//                         Purpose ID, Remarks, Recorded At, Store Name as
//                         recorded, Source Row)
//   STORE_VISIT_VISITORS  one row per visitor per visit (Visit ID, Visitor ID)
//
// Full design: SVMI_Project/PHASE_C_TABLES.md.
//
// Entry points
//   portal_rebuildVisitTables()  admin, System Tools — rewrite both tables
//                                from MASTER_LOG (also the repair path)
//   portal_checkVisitTables()    admin, System Tools — read-only comparison
//   svt_recordVisitFromRow_(n)   called by processSubmissionAsync()
//                                (INPUT_PORTAL.gs) right after it appends
//                                MASTER_LOG row n, inside the same lock
//
// Every other function ends in "_" so google.script.run cannot call it
// (Apps Script treats a trailing underscore as private).
//
// Reads MASTER_LOG A:I only. Never writes to MASTER_LOG.
// Uses: _parseDateCell, _normalizeEnum, _normalizeVisitors, APPROVED_PURPOSES
// (SVMKPI_CORE.gs); cfg_getConfiguration, CFG_AREA (SVMKPI_CONFIG.gs);
// store_getUnmappedStores (SVMKPI_STORE_CONFIG.gs); smt_readMerges_
// (SVMKPI_STORE_MATCH.gs); sl_isAdmin (SVMKPI_ACCESS.gs); logError
// (INPUT_PORTAL.gs) — all typeof-guarded where a unit-test sandbox might not
// load them.
// ============================================================

const SVT_SHEET = {
  VISITS:         'STORE_VISITS',
  VISIT_VISITORS: 'STORE_VISIT_VISITORS',
};

const SVT_VISIT_HEADERS = [
  'Visit ID', 'Date Visited', 'Store ID', 'Purpose ID', 'Remarks',
  'Recorded At', 'Store Name (as recorded)', 'Source Row',
];
const SVT_VV_HEADERS = ['Visit ID', 'Visitor ID'];

// 0-based positions inside one STORE_VISITS row
const SVT_V = { ID: 0, DATE: 1, STORE_ID: 2, PURPOSE: 3, REMARKS: 4, RECORDED_AT: 5, STORE_NAME: 6, SOURCE_ROW: 7 };

// MASTER_LOG A:I, 0-based (A Timestamp … H Remarks, I Store ID)
const SVT_ML = { TS: 0, DATE: 1, STORE: 2, BRAND: 3, VISITORS: 5, PURPOSE: 6, REMARKS: 7, STORE_ID: 8 };
const SVT_ML_WIDTH = 9;

const SVT_CHUNK = 5000; // rows per setValues call on rebuild


// ═══════════════════════════════════════════════════════════════
// SECTION 1: PUBLIC ENTRY POINTS (System Tools)
// ═══════════════════════════════════════════════════════════════

/**
 * portal_rebuildVisitTables()
 * Admin only. Rewrites STORE_VISITS and STORE_VISIT_VISITORS from MASTER_LOG.
 * Safe to run any time: Visit IDs are derived from row content, so the same
 * MASTER_LOG always produces the same IDs. Holds the submission lock while
 * it runs, so a submission made during a long rebuild is told to retry.
 * @returns {{success:boolean, message:string}}
 */
function portal_rebuildVisitTables() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    return svt_rebuildVisitTables_();
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_checkVisitTables()
 * Admin only, read-only. Compares MASTER_LOG with the two tables.
 * @returns {{success:boolean, message:string, errors:object[], stats:object}}
 */
function portal_checkVisitTables() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.', errors: [] };
  try {
    return svt_checkVisitTables_();
  } catch (e) {
    return { success: false, message: e.message, errors: [] };
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: REBUILD
// ═══════════════════════════════════════════════════════════════

function svt_rebuildVisitTables_() {
  const t0 = Date.now();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: 'A submission is in progress — try again in a moment.' };
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const master = ss.getSheetByName('MASTER_LOG');
    if (!master) return { success: false, message: 'MASTER_LOG sheet not found.' };

    const raw = svt_readMasterLog_(master);
    const built = svt_buildRows_(raw, svt_buildStoreResolver_(), 2);

    svt_writeTable_(ss, SVT_SHEET.VISITS, SVT_VISIT_HEADERS, built.visits);
    svt_writeTable_(ss, SVT_SHEET.VISIT_VISITORS, SVT_VV_HEADERS, built.links);
    SpreadsheetApp.flush();

    const unmapped = built.visits.filter(v => !v[SVT_V.STORE_ID]).length;
    if (typeof _perfLog === 'function') _perfLog('svt_rebuildVisitTables', t0, built.visits.length + ' visits');
    return {
      success: true,
      message: 'Rebuilt from MASTER_LOG: ' + built.visits.length + ' visits, '
        + built.links.length + ' visitor links'
        + (unmapped ? ' · ' + unmapped + ' with no Store ID (see Check Visit Tables)' : '') + '.',
    };
  } finally {
    lock.releaseLock();
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: DUAL-WRITE (called by processSubmissionAsync)
// ═══════════════════════════════════════════════════════════════

/**
 * svt_recordVisitFromRow_(rowNumber)
 * Mirrors one just-appended MASTER_LOG row into the two tables. Called from
 * inside processSubmissionAsync()'s lock, right after the append.
 *
 * Never throws and never blocks the submission: the visit is already safe in
 * MASTER_LOG. A failure is written to the error log and shows up as
 * "missing" in Check Visit Tables; Rebuild Visit Tables repairs it.
 *
 * Does nothing until the tables exist (first Rebuild Visit Tables) — writing
 * only new rows into a table that lacks the history would look complete
 * while being wrong.
 *
 * Reads the row back from MASTER_LOG instead of using the in-memory values,
 * so the Visit ID is computed from exactly what a later rebuild will see
 * (Sheets turns the timestamp/date strings into Date values on write).
 * @param {number} rowNumber 1-based MASTER_LOG row
 * @returns {{success:boolean, skipped?:boolean, visitId?:string}}
 */
function svt_recordVisitFromRow_(rowNumber) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const visits = ss.getSheetByName(SVT_SHEET.VISITS);
    const links  = ss.getSheetByName(SVT_SHEET.VISIT_VISITORS);
    if (!visits || !links) return { success: true, skipped: true };

    const master = ss.getSheetByName('MASTER_LOG');
    const row = master.getRange(rowNumber, 1, 1, SVT_ML_WIDTH).getValues()[0];

    // The portal resolves Store ID before writing (column I), so the full
    // resolver (one CONFIG_STORES read) is only built for the rare row
    // whose store name has no Store ID yet.
    const hasId = svt_storeIdCell_(row[SVT_ML.STORE_ID]) !== '';
    const resolve = hasId ? svt_idFromColumnOnly_ : svt_buildStoreResolver_();

    const built = svt_buildRows_([row], resolve, rowNumber);
    if (!built.visits.length) return { success: true, skipped: true };

    svt_appendRows_(visits, built.visits, SVT_VISIT_HEADERS.length);
    if (built.links.length) svt_appendRows_(links, built.links, SVT_VV_HEADERS.length);
    return { success: true, visitId: built.visits[0][SVT_V.ID] };
  } catch (e) {
    if (typeof logError === 'function') logError('svt_recordVisitFromRow_', e);
    return { success: false };
  }
}

function svt_idFromColumnOnly_(name, colIStoreId) {
  return svt_storeIdCell_(colIStoreId);
}

/**
 * Column I as a Store ID, or '' when it holds anything else. Old sheets used
 * column I for a list of names ("NAME" header: CHARLIE, LEO, …) — that text
 * is not a Store ID and must not hide the row's real store.
 */
function svt_storeIdCell_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return /^STR-/.test(s) ? s : '';
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: CHECK (read-only)
// ═══════════════════════════════════════════════════════════════

function svt_checkVisitTables_() {
  const t0 = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const visitsSheet = ss.getSheetByName(SVT_SHEET.VISITS);
  const linksSheet  = ss.getSheetByName(SVT_SHEET.VISIT_VISITORS);
  if (!visitsSheet || !linksSheet) {
    return { success: false, message: 'Visit tables not created yet — run Rebuild Visit Tables first.', errors: [], stats: {} };
  }
  const master = ss.getSheetByName('MASTER_LOG');
  if (!master) return { success: false, message: 'MASTER_LOG sheet not found.', errors: [], stats: {} };

  const expected = svt_buildRows_(svt_readMasterLog_(master), svt_buildStoreResolver_(), 2);
  const actualVisits = svt_readTable_(visitsSheet, SVT_VISIT_HEADERS.length);
  const actualLinks  = svt_readTable_(linksSheet, SVT_VV_HEADERS.length);

  const tz = Session.getScriptTimeZone();
  const dateKey = v => {
    const d = _parseDateCell(v);
    return d ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(v == null ? '' : v).trim();
  };

  const actualById = {};
  let duplicateIds = 0;
  actualVisits.forEach(r => {
    const id = String(r[SVT_V.ID] || '').trim();
    if (!id) return;
    if (actualById[id]) duplicateIds++;
    actualById[id] = r;
  });

  const errors = [];
  const expectedIds = {};
  let missing = 0, outdated = 0;
  expected.visits.forEach(v => {
    const id = v[SVT_V.ID];
    expectedIds[id] = true;
    const a = actualById[id];
    if (!a) {
      missing++;
      if (errors.length < 20) errors.push({ row: v[SVT_V.SOURCE_ROW], message: 'Not in STORE_VISITS (' + v[SVT_V.STORE_NAME] + ')' });
      return;
    }
    const sameStore   = String(a[SVT_V.STORE_ID] || '').trim().toUpperCase() === v[SVT_V.STORE_ID];
    const samePurpose = String(a[SVT_V.PURPOSE] || '').trim().toUpperCase() === v[SVT_V.PURPOSE];
    const sameDate    = dateKey(a[SVT_V.DATE]) === dateKey(v[SVT_V.DATE]);
    if (!sameStore || !samePurpose || !sameDate) {
      outdated++;
      if (errors.length < 20) errors.push({ row: v[SVT_V.SOURCE_ROW], message: 'Outdated in STORE_VISITS (' + id + ')' });
    }
  });
  const extra = Object.keys(actualById).filter(id => !expectedIds[id]).length;

  const linkKey = l => String(l[0] || '').trim() + '|' + String(l[1] || '').trim().toUpperCase();
  const expectedLinks = {};
  expected.links.forEach(l => { expectedLinks[linkKey(l)] = true; });
  const actualLinkKeys = {};
  actualLinks.forEach(l => { if (String(l[0] || '').trim()) actualLinkKeys[linkKey(l)] = true; });
  const missingLinks = Object.keys(expectedLinks).filter(k => !actualLinkKeys[k]).length;
  const extraLinks   = Object.keys(actualLinkKeys).filter(k => !expectedLinks[k]).length;

  // Data-quality notes (do not make the tables "out of sync")
  const unmappedNames = {};
  let unmapped = 0, badDates = 0;
  expected.visits.forEach(v => {
    if (!v[SVT_V.STORE_ID]) { unmapped++; unmappedNames[v[SVT_V.STORE_NAME] || '(blank)'] = true; }
    if (!(v[SVT_V.DATE] instanceof Date)) badDates++;
  });
  const knownVisitors = svt_knownIds_('VISITORS');
  const knownPurposes = svt_knownIds_('PURPOSES');
  (typeof APPROVED_PURPOSES !== 'undefined' ? APPROVED_PURPOSES : []).forEach(p => { if (knownPurposes) knownPurposes[p] = true; });
  const unknownVisitors = {}, unknownPurposes = {};
  if (knownVisitors) expected.links.forEach(l => { if (!knownVisitors[l[1]]) unknownVisitors[l[1]] = true; });
  if (knownPurposes) expected.visits.forEach(v => { if (v[SVT_V.PURPOSE] && !knownPurposes[v[SVT_V.PURPOSE]]) unknownPurposes[v[SVT_V.PURPOSE]] = true; });

  const stats = {
    masterLogVisits: expected.visits.length, tableVisits: actualVisits.length,
    masterLogLinks: expected.links.length, tableLinks: actualLinks.length,
    missing, extra, outdated, duplicateIds, missingLinks, extraLinks,
    unmapped, unmappedNames: Object.keys(unmappedNames).slice(0, 10), badDates,
    unknownVisitors: Object.keys(unknownVisitors).slice(0, 10),
    unknownPurposes: Object.keys(unknownPurposes).slice(0, 10),
  };

  const inSync = !missing && !extra && !outdated && !duplicateIds && !missingLinks && !extraLinks;
  const notes = [];
  if (unmapped) notes.push(unmapped + ' visit(s) with no Store ID: ' + stats.unmappedNames.join(', '));
  if (badDates) notes.push(badDates + ' visit(s) with an unreadable date');
  if (stats.unknownVisitors.length) notes.push('visitor(s) not in CONFIG_VISITORS: ' + stats.unknownVisitors.join(', '));
  if (stats.unknownPurposes.length) notes.push('purpose(s) not configured: ' + stats.unknownPurposes.join(', '));
  notes.forEach(n => { if (errors.length < 25) errors.push({ row: '—', message: n }); });

  const message = inSync
    ? 'In sync: ' + stats.tableVisits + ' visits, ' + stats.tableLinks + ' visitor links match MASTER_LOG'
      + (notes.length ? ' · ' + notes.length + ' data note(s) below' : '') + '.'
    : 'Out of sync — ' + missing + ' missing, ' + extra + ' extra, ' + outdated + ' outdated visits; '
      + missingLinks + ' missing / ' + extraLinks + ' extra visitor links'
      + (duplicateIds ? '; ' + duplicateIds + ' duplicate IDs' : '')
      + '. Run Rebuild Visit Tables to repair.';

  if (typeof _perfLog === 'function') _perfLog('svt_checkVisitTables', t0, expected.visits.length + ' visits');
  return { success: inSync, message, errors, stats };
}

/** Set of entity IDs ever configured for a CONFIG area, or null if unavailable. */
function svt_knownIds_(area) {
  if (typeof cfg_getConfiguration !== 'function' || typeof CFG_AREA === 'undefined' || !CFG_AREA[area]) return null;
  try {
    const out = {};
    cfg_getConfiguration(CFG_AREA[area]).forEach(v => { if (v.entityId) out[String(v.entityId).trim().toUpperCase()] = true; });
    return out;
  } catch (e) {
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: ROW BUILDING (shared by rebuild, dual-write, check)
// ═══════════════════════════════════════════════════════════════

/**
 * svt_buildRows_(raw, resolveStoreId, firstRowNumber)
 * @param {Array[]} raw MASTER_LOG rows, columns A:I
 * @param {function(string, string): string} resolveStoreId (storeName, columnIStoreId, brand) -> Store ID or ''
 * @param {number} firstRowNumber MASTER_LOG row number of raw[0]
 * @returns {{visits: Array[], links: Array[]}}
 */
function svt_buildRows_(raw, resolveStoreId, firstRowNumber) {
  const tz = Session.getScriptTimeZone();
  const visits = [];
  const links = [];
  const seen = {};

  raw.forEach((r, i) => {
    const storeName = String(r[SVT_ML.STORE] == null ? '' : r[SVT_ML.STORE]).trim();
    const visitorsRaw = r[SVT_ML.VISITORS];
    // A row with no store, no date and no visitors is an empty line, not a visit.
    if (!storeName && !String(r[SVT_ML.DATE] || '').trim() && !String(visitorsRaw || '').trim()) return;

    const base = svt_visitIdFromFingerprint_(svt_fingerprint_(r, tz));
    seen[base] = (seen[base] || 0) + 1;
    const id = seen[base] > 1 ? base + '-' + seen[base] : base;

    const date = _parseDateCell(r[SVT_ML.DATE]);
    visits.push([
      id,
      date || '',
      resolveStoreId(storeName, r[SVT_ML.STORE_ID], r[SVT_ML.BRAND]),
      _normalizeEnum(r[SVT_ML.PURPOSE]),
      r[SVT_ML.REMARKS] == null ? '' : String(r[SVT_ML.REMARKS]),
      r[SVT_ML.TS] == null ? '' : r[SVT_ML.TS],
      _normalizeEnum(storeName),
      firstRowNumber + i,
    ]);

    const unique = {};
    _normalizeVisitors(visitorsRaw).forEach(name => {
      if (unique[name]) return;
      unique[name] = true;
      links.push([id, name]);
    });
  });

  return { visits, links };
}

/**
 * Content fingerprint of one MASTER_LOG row: timestamp | date | store |
 * visitors | purpose (remarks left out so fixing a typo there keeps the ID).
 * Dates are formatted, so a Date value and its "yyyy-MM-dd" string give
 * the same fingerprint.
 */
function svt_fingerprint_(r, tz) {
  const ts = r[SVT_ML.TS];
  const tsKey = ts instanceof Date && !isNaN(ts.getTime())
    ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd HH:mm:ss')
    : String(ts == null ? '' : ts).trim();
  const d = _parseDateCell(r[SVT_ML.DATE]);
  const dateKey = d ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(r[SVT_ML.DATE] == null ? '' : r[SVT_ML.DATE]).trim();
  return [
    tsKey,
    dateKey,
    _normalizeEnum(r[SVT_ML.STORE]),
    _normalizeVisitors(r[SVT_ML.VISITORS]).join('|'),
    _normalizeEnum(r[SVT_ML.PURPOSE]),
  ].join('\u001F');
}

function svt_visitIdFromFingerprint_(fp) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, fp, Utilities.Charset.UTF_8);
  let hex = '';
  for (let i = 0; i < 10; i++) hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  return 'V-' + hex.toUpperCase();
}

/**
 * Store ID resolver, built once per run (one CONFIG_STORES read, one
 * CONFIG_UNMAPPED_STORES read, one CONFIG_STORE_MERGES read). Order:
 * MASTER_LOG column I → a name that belongs to exactly one Store ID in any
 * CONFIG_STORES version → a RECONCILED unmapped entry → '' (never guessed).
 * Whatever it finds, a Store ID that was merged into another one (Store Name
 * Matching, SVMKPI_STORE_MATCH.gs) is followed to the store it was merged
 * into — so a name shared only by a store and its merged duplicate is not
 * ambiguous.
 */
function svt_buildStoreResolver_() {
  const idsByName = {};
  const brandsById = {};
  if (typeof cfg_getConfiguration === 'function' && typeof CFG_AREA !== 'undefined') {
    cfg_getConfiguration(CFG_AREA.STORES).forEach(v => {
      const name = _normalizeEnum(v.fields && v.fields.storeName);
      if (!name || !v.entityId) return;
      const eid = String(v.entityId).trim().toUpperCase();
      (idsByName[name] = idsByName[name] || {})[eid] = true;
      const b = _normalizeEnum(v.fields && v.fields.brand);
      if (b) (brandsById[eid] = brandsById[eid] || {})[b] = true;
    });
  }
  const reconciled = {};
  if (typeof store_getUnmappedStores === 'function') {
    store_getUnmappedStores('RECONCILED').forEach(u => {
      const name = _normalizeEnum(u.originalStoreName);
      const id = String(u.resolvedStoreId || '').trim().toUpperCase();
      if (name && id) reconciled[name] = id;
    });
  }
  const mergedInto = typeof smt_readMerges_ === 'function' ? smt_readMerges_() : {};
  const follow = id => {
    let cur = id, hops = 0;
    while (cur && mergedInto[cur] && hops < 20) { cur = mergedInto[cur]; hops++; }
    return cur;
  };
  return function (storeName, columnIStoreId, brand) {
    const fromColumn = svt_storeIdCell_(columnIStoreId);
    if (fromColumn) return follow(fromColumn);
    const name = _normalizeEnum(storeName);
    const owners = {};
    (idsByName[name] ? Object.keys(idsByName[name]) : []).forEach(id => { owners[follow(id)] = true; });
    let ids = Object.keys(owners);
    // Two stores of different brands may share a name: the row's Brand column decides.
    const wantBrand = _normalizeEnum(brand);
    if (ids.length > 1 && wantBrand) {
      const sameBrand = ids.filter(id => brandsById[id] && brandsById[id][wantBrand]);
      if (sameBrand.length === 1) ids = sameBrand;
    }
    // The row's brand must be one the store has had: a Figaro visit to
    // "ZAMBOANGA" is not a visit to the only ZAMBOANGA in CONFIG_STORES if
    // that one is Angel's Pizza. Never guess — leave it unmapped so Store
    // Name Matching offers to set up the missing store. (Blank brand = no check.)
    if (ids.length === 1 && wantBrand && brandsById[ids[0]] && !brandsById[ids[0]][wantBrand]) ids = [];
    if (ids.length === 1) return ids[0];
    if (reconciled[name]) return follow(reconciled[name]);
    return '';
  };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6: SHEET I/O
// ═══════════════════════════════════════════════════════════════

function svt_readMasterLog_(master) {
  const last = master.getLastRow();
  if (last < 2) return [];
  return master.getRange(2, 1, last - 1, SVT_ML_WIDTH).getValues();
}

function svt_readTable_(sheet, width) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, width).getValues();
}

/** Header + all rows, replacing whatever was there. */
function svt_writeTable_(ss, name, headers, rows) {
  let sheet = ss.getSheetByName(name);
  const isNew = !sheet;
  if (!sheet) sheet = ss.insertSheet(name);

  const width = headers.length;
  sheet.getRange(1, 1, 1, width).setValues([headers]).setFontWeight('bold');
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();

  svt_ensureRows_(sheet, rows.length + 1);
  for (let i = 0; i < rows.length; i += SVT_CHUNK) {
    const part = rows.slice(i, i + SVT_CHUNK);
    sheet.getRange(2 + i, 1, part.length, width).setValues(part);
  }

  if (isNew) {
    sheet.setFrozenRows(1);
    if (name === SVT_SHEET.VISITS) sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    try {
      sheet.protect()
        .setDescription('Generated from MASTER_LOG by System Tools → Rebuild Visit Tables. Fix data in MASTER_LOG, then rebuild.')
        .setWarningOnly(true);
    } catch (e) { /* protection is a courtesy warning only */ }
  }
}

function svt_appendRows_(sheet, rows, width) {
  const start = sheet.getLastRow() + 1;
  svt_ensureRows_(sheet, start + rows.length - 1);
  sheet.getRange(start, 1, rows.length, width).setValues(rows);
}

function svt_ensureRows_(sheet, neededRows) {
  const max = sheet.getMaxRows();
  if (typeof max === 'number' && max < neededRows) sheet.insertRowsAfter(max, neededRows - max);
}
