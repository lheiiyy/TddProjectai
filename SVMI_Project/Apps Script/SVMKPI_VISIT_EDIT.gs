// ============================================================
// SVMKPI_VISIT_EDIT.gs
// F8 (v31) — edit / void / restore a logged visit. Admin only.
// ------------------------------------------------------------
// Leo's decisions (2026-10-07): L1 delete = VOID (restorable), L2 a reason
// is required on every edit / void / restore.
//
//   EDIT    rewrites the MASTER_LOG row's B:I in place (the submission
//           timestamp in A never changes) and replaces that visit in the
//           visit tables.
//   VOID    moves the whole MASTER_LOG row into VISIT_CORRECTIONS and
//           deletes it from MASTER_LOG and the visit tables — so it is gone
//           from EVERY report, including the KPI sheet's formulas and the
//           duplicate check (the right visit can be logged again).
//   RESTORE puts a voided row back at the end of MASTER_LOG, unchanged
//           (same timestamp, same Visit ID), and back into the tables.
//
// VISIT_CORRECTIONS keeps one row per action: who, when, why, the row
// before and after (A:I as text). It is the record of every change.
//
// Safety:
//   * every portal_ function re-checks sl_isAdmin() and needs a reason;
//   * the caller sends the row's submission timestamp too — if the row at
//     that number is no longer that visit (rows added/deleted meanwhile),
//     nothing is changed;
//   * the same script lock as visit submissions, so a submission and an
//     edit can never interleave;
//   * MASTER_LOG rows 2–13 share their row with Leo's leaderboard (I2:J13):
//     those visits can be edited (column I left alone) but not voided,
//     because deleting the row would shift the leaderboard.
// ============================================================

const VE_SHEET = 'VISIT_CORRECTIONS';
const VE_HEADERS = ['Correction ID', 'At', 'By', 'Action', 'MASTER_LOG Row', 'Reason', 'Before (A:I)', 'After (A:I)', 'Refers To'];
const VE_COL = { ID: 0, AT: 1, BY: 2, ACTION: 3, ROW: 4, REASON: 5, BEFORE: 6, AFTER: 7, REFERS: 8 };
const VE_ACTION = { EDIT: 'EDIT', VOID: 'VOID', RESTORE: 'RESTORE' };
const VE_LEADERBOARD_LAST_ROW = 13;


// ═══════════════════════════════════════════════════════════════
// SECTION 1: PUBLIC ENTRY POINTS (admin only)
// ═══════════════════════════════════════════════════════════════

/**
 * One visit's current values, for the edit form.
 * @param {number} row MASTER_LOG row
 * @param {string} tsKey the row's submission timestamp ('yyyy-MM-dd HH:mm:ss')
 */
function portal_getVisitForEdit(row, tsKey) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    const master = ve_master_();
    const v = ve_readRow_(master, row);
    if (!v || ve_tsKey_(v[SVT_ML.TS]) !== String(tsKey || '')) return ve_moved_();
    const storeId = svt_storeIdCell_(v[SVT_ML.STORE_ID]);
    const d = _parseDateCell(v[SVT_ML.DATE]);
    return {
      success: true,
      row: Number(row),
      tsKey: ve_tsKey_(v[SVT_ML.TS]),
      dateVisited: d ? ve_ymd_(d) : '',
      storeId,
      store: _normalizeEnum(v[SVT_ML.STORE]),
      brand: _normalizeEnum(v[SVT_ML.BRAND]),
      visitors: _normalizeVisitors(v[SVT_ML.VISITORS]),
      purpose: _normalizeEnum(v[SVT_ML.PURPOSE]),
      remarks: String(v[SVT_ML.REMARKS] == null ? '' : v[SVT_ML.REMARKS]),
      canVoid: !ve_isLeaderboardRow_(master, row),
    };
  } catch (e) {
    return ve_fail_('portal_getVisitForEdit', e);
  }
}

/**
 * Edit a visit. `changes` = {dateVisited:'yyyy-MM-dd', storeId, visitors:[...], purpose, remarks}.
 */
function portal_editVisit(row, tsKey, changes, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const why = String(reason || '').trim();
  if (!why) return { success: false, message: 'A reason is required.' };
  return ve_locked_(() => {
    const master = ve_master_();
    const before = ve_readRow_(master, row);
    if (!before || ve_tsKey_(before[SVT_ML.TS]) !== String(tsKey || '')) return ve_moved_();

    const c = changes || {};
    const date = _parseDateCell(c.dateVisited);
    if (!date) return { success: false, message: 'Date Visited is not a valid date.' };
    const storeId = String(c.storeId || '').trim().toUpperCase();
    const info = storeId ? svd_storeLookup_(null)(storeId) : null;
    if (!info) return { success: false, message: 'Pick a store from the list.' };
    const visitors = (Array.isArray(c.visitors) ? c.visitors : [])
      .map(v => String(v || '').trim().toUpperCase()).filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
    if (!visitors.length) return { success: false, message: 'Pick at least one visitor.' };
    const purpose = String(c.purpose || '').trim().toUpperCase();
    if (!purpose) return { success: false, message: 'Pick a purpose.' };
    const remarks = String(c.remarks == null ? '' : c.remarks).trim();

    // Column I: only where it is blank or already a Store ID (leaderboard rows keep their text).
    const rawI = String(before[SVT_ML.STORE_ID] == null ? '' : before[SVT_ML.STORE_ID]).trim();
    const colIFree = rawI === '' || /^STR-/i.test(rawI);
    const after = before.slice();
    after[SVT_ML.DATE] = ve_ymd_(date);
    after[SVT_ML.STORE] = info.name;
    after[SVT_ML.BRAND] = info.brand;
    after[4] = info.region;                       // E Region
    after[SVT_ML.VISITORS] = visitors.join(' | ');
    after[SVT_ML.PURPOSE] = purpose;
    after[SVT_ML.REMARKS] = remarks;
    if (colIFree) after[SVT_ML.STORE_ID] = storeId;

    const beforeTxt = ve_rowText_(before), afterTxt = ve_rowText_(after);
    if (beforeTxt === afterTxt) return { success: true, unchanged: true, message: 'Nothing changed.' };

    master.getRange(row, 2, 1, SVT_ML_WIDTH - 1).setValues([after.slice(1, SVT_ML_WIDTH)]);
    SpreadsheetApp.flush();
    ve_tablesReplaceRow_(row);
    const id = ve_log_(VE_ACTION.EDIT, row, why, beforeTxt, afterTxt, '');
    if (typeof svmiAuditSystem_ === 'function') svmiAuditSystem_('VISIT', 'EDIT', 'MASTER_LOG row ' + row + ' · ' + id, why);
    return { success: true, correctionId: id, message: 'Visit updated.' };
  });
}

/** Void a visit: the row moves to VISIT_CORRECTIONS and leaves every report. */
function portal_voidVisit(row, tsKey, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const why = String(reason || '').trim();
  if (!why) return { success: false, message: 'A reason is required.' };
  return ve_locked_(() => {
    const master = ve_master_();
    const before = ve_readRow_(master, row);
    if (!before || ve_tsKey_(before[SVT_ML.TS]) !== String(tsKey || '')) return ve_moved_();
    if (ve_isLeaderboardRow_(master, row)) {
      return { success: false, message: 'MASTER_LOG row ' + row + ' shares its row with the leaderboard in I2:J13 — removing it would shift the leaderboard. Edit this visit instead.' };
    }
    const beforeTxt = ve_rowText_(before);
    const id = ve_log_(VE_ACTION.VOID, row, why, beforeTxt, '', '');
    master.deleteRow(row);
    SpreadsheetApp.flush();
    ve_tablesRemoveRow_(row);
    if (typeof svmiAuditSystem_ === 'function') svmiAuditSystem_('VISIT', 'VOID', 'MASTER_LOG row ' + row + ' · ' + id, why);
    return { success: true, correctionId: id, message: 'Visit voided — it no longer counts anywhere. It can be restored.' };
  });
}

/** Voided visits not restored yet, newest first. */
function portal_listVoidedVisits() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    const rows = ve_readLog_();
    const restored = {};
    rows.forEach(r => { if (r[VE_COL.ACTION] === VE_ACTION.RESTORE) restored[r[VE_COL.REFERS]] = true; });
    const out = rows.filter(r => r[VE_COL.ACTION] === VE_ACTION.VOID && !restored[r[VE_COL.ID]]).map(r => {
      const v = ve_parseRowText_(r[VE_COL.BEFORE]);
      return {
        correctionId: r[VE_COL.ID],
        at: ve_tsKey_(r[VE_COL.AT]).slice(0, 16),
        by: String(r[VE_COL.BY] || ''),
        reason: String(r[VE_COL.REASON] || ''),
        submitted: String(v[SVT_ML.TS] || '').slice(0, 16),
        visited: String(v[SVT_ML.DATE] || ''),
        store: String(v[SVT_ML.STORE] || ''),
        brand: String(v[SVT_ML.BRAND] || ''),
        visitors: _normalizeVisitors(v[SVT_ML.VISITORS]),
        purpose: String(v[SVT_ML.PURPOSE] || ''),
        remarks: String(v[SVT_ML.REMARKS] || ''),
      };
    }).reverse();
    return { success: true, rows: out };
  } catch (e) {
    return ve_fail_('portal_listVoidedVisits', e);
  }
}

/** Put a voided visit back (end of MASTER_LOG, same values). */
function portal_restoreVisit(correctionId, reason) {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  const why = String(reason || '').trim();
  if (!why) return { success: false, message: 'A reason is required.' };
  return ve_locked_(() => {
    const rows = ve_readLog_();
    const target = rows.filter(r => r[VE_COL.ID] === correctionId && r[VE_COL.ACTION] === VE_ACTION.VOID)[0];
    if (!target) return { success: false, message: 'Voided visit not found.' };
    if (rows.some(r => r[VE_COL.ACTION] === VE_ACTION.RESTORE && r[VE_COL.REFERS] === correctionId)) {
      return { success: false, message: 'Already restored.' };
    }
    const values = ve_parseRowText_(target[VE_COL.BEFORE]);
    const master = ve_master_();
    master.appendRow(values);
    SpreadsheetApp.flush();
    const newRow = master.getLastRow();
    if (typeof svt_recordVisitFromRow_ === 'function') svt_recordVisitFromRow_(newRow);
    const id = ve_log_(VE_ACTION.RESTORE, newRow, why, '', ve_rowText_(values), correctionId);
    if (typeof svmiAuditSystem_ === 'function') svmiAuditSystem_('VISIT', 'RESTORE', 'MASTER_LOG row ' + newRow + ' · ' + id + ' (undoes ' + correctionId + ')', why);
    return { success: true, correctionId: id, row: newRow, message: 'Visit restored.' };
  });
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: HELPERS (private)
// ═══════════════════════════════════════════════════════════════

function ve_master_() {
  const master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG');
  if (!master) throw new Error('MASTER_LOG sheet not found.');
  return master;
}

function ve_readRow_(master, row) {
  const r = Number(row);
  if (!(r >= 2) || r > master.getLastRow()) return null;
  return master.getRange(r, 1, 1, SVT_ML_WIDTH).getValues()[0];
}

/** Submission timestamp as 'yyyy-MM-dd HH:mm:ss' — the same text whether the cell holds a Date or a string. */
function ve_tsKey_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p2 = n => String(n).padStart(2, '0');
    return v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate()) + ' ' + p2(v.getHours()) + ':' + p2(v.getMinutes()) + ':' + p2(v.getSeconds());
  }
  return String(v == null ? '' : v).trim();
}

function ve_ymd_(d) {
  const p2 = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

/** A:I as JSON text, dates as text (so a restore writes back exactly what was there). */
function ve_rowText_(row) {
  return JSON.stringify(row.slice(0, SVT_ML_WIDTH).map((v, i) => {
    if (v instanceof Date) return i === SVT_ML.TS ? ve_tsKey_(v) : ve_ymd_(v);
    return v == null ? '' : v;
  }));
}

function ve_parseRowText_(txt) {
  try {
    const a = JSON.parse(String(txt || '[]'));
    while (a.length < SVT_ML_WIDTH) a.push('');
    return a.slice(0, SVT_ML_WIDTH);
  } catch (e) {
    return new Array(SVT_ML_WIDTH).fill('');
  }
}

/** True for a row in 2..13 while the leaderboard (non-Store-ID text in I2:I13) is there. */
function ve_isLeaderboardRow_(master, row) {
  if (Number(row) > VE_LEADERBOARD_LAST_ROW) return false;
  const last = Math.min(master.getLastRow(), VE_LEADERBOARD_LAST_ROW);
  if (last < 2) return false;
  return master.getRange(2, 9, last - 1, 2).getValues()
    .some(r => [r[0], r[1]].some(v => { const s = String(v == null ? '' : v).trim(); return s !== '' && !/^STR-/i.test(s); }));
}

function ve_moved_() {
  return { success: false, moved: true, message: 'This visit changed or moved since the list was loaded — reload the list and try again.' };
}

function ve_fail_(where, e) {
  if (typeof logError === 'function') logError(where, e);
  return { success: false, message: e.message };
}

function ve_locked_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { success: false, message: 'A visit is being saved right now — try again in a moment.' };
  try {
    return fn();
  } catch (e) {
    return ve_fail_('visit edit', e);
  } finally {
    lock.releaseLock();
  }
}

function ve_sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(VE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(VE_SHEET);
    sh.getRange(1, 1, 1, VE_HEADERS.length).setValues([VE_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ve_readLog_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(VE_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, VE_HEADERS.length).getValues()
    .map(r => r.map((v, i) => (i === VE_COL.AT ? v : String(v == null ? '' : v))));
}

function ve_log_(action, row, reason, before, after, refersTo) {
  const sh = ve_sheet_();
  const id = 'VC-' + (typeof Utilities !== 'undefined' && Utilities.getUuid ? Utilities.getUuid().slice(0, 8).toUpperCase() : String(Date.now()));
  const by = (typeof sl_getCurrentUser === 'function') ? String(sl_getCurrentUser() || '') : '';
  sh.appendRow([id, new Date(), by, action, Number(row), reason, before, after, refersTo || '']);
  return id;
}

/** Visit-table rows whose Source Row is `row`, removed; rows below moved up by one (the MASTER_LOG row was deleted). */
function ve_tablesRemoveRow_(row) {
  ve_tablesRewrite_(row, true);
}

/** Visit-table rows for MASTER_LOG row `row` rebuilt from the row as it is now. */
function ve_tablesReplaceRow_(row) {
  ve_tablesRewrite_(row, false);
  if (typeof svt_recordVisitFromRow_ === 'function') svt_recordVisitFromRow_(row);
}

function ve_tablesRewrite_(row, shiftUp) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const vs = ss.getSheetByName(SVT_SHEET.VISITS);
  const vv = ss.getSheetByName(SVT_SHEET.VISIT_VISITORS);
  if (!vs || !vv) return;
  const r = Number(row);
  const visits = svt_readTable_(vs, SVT_VISIT_HEADERS.length);
  const gone = {};
  const keep = [];
  visits.forEach(v => {
    const src = Number(v[SVT_V.SOURCE_ROW]) || 0;
    if (src === r) { gone[String(v[SVT_V.ID])] = true; return; }
    if (shiftUp && src > r) v[SVT_V.SOURCE_ROW] = src - 1;
    keep.push(v);
  });
  const links = svt_readTable_(vv, SVT_VV_HEADERS.length).filter(l => !gone[String(l[0])]);
  ve_rewriteTable_(vs, keep, SVT_VISIT_HEADERS.length, visits.length);
  ve_rewriteTable_(vv, links, SVT_VV_HEADERS.length, null);
}

function ve_rewriteTable_(sheet, rows, width, oldCount) {
  const last = sheet.getLastRow();
  if (last >= 2) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
}
