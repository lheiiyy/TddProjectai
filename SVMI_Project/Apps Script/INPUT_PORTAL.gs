// ============================================================
//  INPUT PORTAL v2.0.2 — Apps Script Backend
//  Built on v8.0 baseline — SVMKPI_CORE.gs compatible
//  v2.0.1: Removed standalone onOpen().
//  v2.0.2: Removed showSidebar() and addInputPortalMenu_() — dead
//          "sidebar era" code. SVMKPI_ADMIN.gs's onOpen() never
//          called addInputPortalMenu_(), so the sidebar menu item
//          was never wired up, and showSidebar() pointed at a
//          'Sidebar' HTML file this project doesn't ship. The real
//          UI is SVMKPI_ADMIN.gs's "Open Command Center" menu item,
//          which opens SVMI_PORTAL.html (this file's functions are
//          still called from its Input Portal tab).
// ============================================================

// ── Sheet name constants ─────────────────────────────────────
var SHEET_MASTER  = 'MASTER_LOG';
var SHEET_SETTINGS = 'SETTINGS';

// MASTER_LOG columns (1-indexed)
//  A=1  Timestamp
//  B=2  Date Visited
//  C=3  Store           (display name — NOT the authoritative identity
//                         as of Phase 1B; kept for legacy/backward compat)
//  D=4  Brand
//  E=5  Region
//  F=6  Visited By
//  G=7  Purpose
//  H=8  Remarks
//  I=9  Store ID        (Phase 1B — authoritative identity going forward;
//                         blank on any row written before this column
//                         existed, or when the submitted store name
//                         doesn't yet resolve to a Store ID — see
//                         SVMKPI_STORE_CONFIG.gs. Never required to be
//                         populated for the row to remain valid.)
var COL_TIMESTAMP   = 1;
var COL_DATE        = 2;
var COL_STORE       = 3;
var COL_BRAND       = 4;
var COL_REGION      = 5;
var COL_VISITED_BY  = 6;
var COL_PURPOSE     = 7;
var COL_REMARKS     = 8;
var COL_STORE_ID    = 9;

// SETTINGS columns (1-indexed)
//  A=1  Store
//  B=2  Brand
//  C=3  Region
//  E=5  Category
//  F=6  Visitor Roster
//  H=8  Purpose List
var COL_S_STORE    = 1;
var COL_S_BRAND    = 2;
var COL_S_REGION   = 3;
var COL_S_CATEGORY = 5;
var COL_S_VISITOR  = 6;
var COL_S_PURPOSE  = 8;


// ============================================================
//  getSidebarData()
//  Called by the sidebar on load.
//  Returns { stores: [{store, brand, region, category}], visitors: [string], purposes: [string] }
// ============================================================
function getSidebarData() {
  try {
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var settings = ss.getSheetByName(SHEET_SETTINGS);

    if (!settings) {
      throw new Error('SETTINGS sheet not found.');
    }

    var lastRow = settings.getLastRow();
    if (lastRow < 2) {
      return { stores: [], visitors: [], purposes: [] };
    }

    // Read all SETTINGS data in one call — cols A:H (width 8)
    var data = settings.getRange(2, 1, lastRow - 1, 8).getValues();

    var stores   = [];
    var visitors = [];
    var purposes = [];
    var storeSet   = {};
    var visitorSet = {};
    var purposeSet = {};

    data.forEach(function (row) {
      // Normalize to uppercase to match SVMKPI_CORE enum values
      var store    = String(row[COL_S_STORE    - 1] || '').trim().toUpperCase();
      var brand    = String(row[COL_S_BRAND    - 1] || '').trim().toUpperCase();
      var region   = String(row[COL_S_REGION   - 1] || '').trim().toUpperCase();
      var category = String(row[COL_S_CATEGORY - 1] || '').trim().toUpperCase();
      var visitor  = String(row[COL_S_VISITOR  - 1] || '').trim().toUpperCase();
      var purpose  = String(row[COL_S_PURPOSE  - 1] || '').trim().toUpperCase();

      if (store && !storeSet[store]) {
        storeSet[store] = true;
        stores.push({ store: store, brand: brand, region: region, category: category });
      }

      if (visitor && !visitorSet[visitor]) {
        visitorSet[visitor] = true;
        visitors.push(visitor);
      }

      if (purpose && !purposeSet[purpose]) {
        purposeSet[purpose] = true;
        purposes.push(purpose);
      }
    });

    // Sort alphabetically
    stores.sort(function (a, b) { return a.store.localeCompare(b.store); });
    visitors.sort();
    // Purposes retain SETTINGS row order (insertion order preserved above)

    return { stores: stores, visitors: visitors, purposes: purposes };

  } catch (e) {
    logError('getSidebarData', e);
    throw e;
  }
}


// ============================================================
//  getStoreDetails(storeName)
//  Returns { brand, region } for a given store name.
//  Used for on-demand lookup if needed outside the sidebar.
// ============================================================
function getStoreDetails(storeName) {
  try {
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var settings = ss.getSheetByName(SHEET_SETTINGS);

    if (!settings) throw new Error('SETTINGS sheet not found.');

    var lastRow = settings.getLastRow();
    if (lastRow < 2) return { brand: '', region: '' };

    var data = settings.getRange(2, COL_S_STORE, lastRow - 1, COL_S_REGION).getValues();

    for (var i = 0; i < data.length; i++) {
      var store  = String(data[i][0] || '').trim();
      var brand  = String(data[i][1] || '').trim();
      var region = String(data[i][2] || '').trim();
      if (store.toLowerCase() === storeName.toLowerCase()) {
        return { brand: brand, region: region };
      }
    }

    return { brand: '', region: '' };

  } catch (e) {
    logError('getStoreDetails', e);
    throw e;
  }
}


// ============================================================
//  processSubmissionAsync(payload)
//  Receives form data from sidebar and writes to MASTER_LOG.
//
//  payload: {
//    store, brand, region, dateVisited,
//    visitedBy, purpose, remarks
//  }
//
//  Returns { success: true } or { success: false, message: string }
// ============================================================
function processSubmissionAsync(payload) {
  try {
    // ── Validate required fields ──────────────────────────────
    var required = ['store', 'dateVisited', 'visitedBy', 'purpose'];
    for (var i = 0; i < required.length; i++) {
      var field = required[i];
      if (!payload[field] || (Array.isArray(payload[field]) ? payload[field].length === 0 : String(payload[field]).trim() === '')) {
        return { success: false, message: 'Missing required field: ' + field };
      }
    }

    // ── Resolve brand & region (fallback to SETTINGS lookup) ─
    // All enum values normalized to UPPERCASE to match SVMKPI_CORE
    var brand  = String(payload.brand  || '').trim().toUpperCase();
    var region = String(payload.region || '').trim().toUpperCase();

    if (!brand || !region) {
      var details = getStoreDetails(payload.store);
      brand  = brand  || details.brand;
      region = region || details.region;
    }

    // ── Normalize visitedBy — supports array (multi-select) or string ─
    // Multiple visitors joined with pipe delimiter per SVMKPI_CORE §3.4 / §6.4
    var visitedByRaw = payload.visitedBy;
    var visitedByStr;
    if (Array.isArray(visitedByRaw)) {
      visitedByStr = visitedByRaw
        .map(function (v) { return String(v).trim().toUpperCase(); })
        .filter(function (v) { return v.length > 0; })
        .join(' | ');
    } else {
      visitedByStr = String(visitedByRaw || '').trim().toUpperCase();
    }

    if (!visitedByStr) {
      return { success: false, message: 'Missing required field: visitedBy' };
    }

    // ── Prepare row ───────────────────────────────────────────
    var now       = new Date();
    var timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    // Parse date string from sidebar (YYYY-MM-DD) — _parseDateCell()
    // (SVMKPI_CORE.gs) is the one shared date parse every part of this
    // project should go through.
    var visitedDate = _parseDateCell(payload.dateVisited);
    if (!visitedDate) {
      return { success: false, message: 'Invalid Date Visited: ' + payload.dateVisited };
    }
    var dateFormatted = Utilities.formatDate(visitedDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var storeNorm     = String(payload.store).trim().toUpperCase();
    var purposeNorm   = String(payload.purpose).trim().toUpperCase();
    var remarksVal    = String(payload.remarks || '').trim();

    // ── Write to MASTER_LOG ───────────────────────────────────
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var master = ss.getSheetByName(SHEET_MASTER);

    if (!master) {
      return { success: false, message: 'MASTER_LOG sheet not found.' };
    }

    // Locked so two near-simultaneous submissions (e.g. a double-click, or
    // two people submitting at the same moment) can never interleave —
    // appendRow() alone doesn't guarantee that under concurrent script
    // executions the way a read-then-write elsewhere in this project
    // (manageVisitor(), portal_saveStore(), etc.) would need it even more.
    //
    // Duplicate handling lives HERE, inside the lock, re-reading MASTER_LOG
    // after acquiring it — not in checkDuplicateVisit(), which stays a
    // separate, unlocked, advisory-only pre-submit warning (its own broader
    // "any visit in the last 7 days" heads-up is intentionally not the same
    // check). Only a lock-protected re-read guarantees the final decision
    // can't race a concurrent submission that commits between the
    // browser's advisory check and this write.
    //
    // Phase 1B: duplicates are now PARTIALLY accepted, not rejected
    // wholesale. If some (not all) submitted visitors already have a
    // logged visit to this store on this date, those are skipped — with a
    // warning — while any genuinely new visitor on the same submission is
    // still recorded. Store identity for this check now prefers the
    // immutable Store ID (resolved fresh, inside the lock, from the
    // submitted store name) with a name-based fallback for any legacy row
    // that predates Store ID — see _findRecordedVisitors().
    var visitorNames = visitedByStr.split('|').map(function (v) { return v.trim(); }).filter(Boolean);

    var lock = LockService.getScriptLock();
    var gotLock = false;
    var result;
    try {
      gotLock = lock.tryLock(10000);
      if (!gotLock) {
        return { success: false, message: 'Server is busy processing another submission — please try again in a moment.' };
      }

      var storeId = store_resolveIdByCurrentName(payload.store); // null if not yet migrated/created — falls back to name matching below

      var alreadyRecorded = _findRecordedVisitors(master, storeId, storeNorm, visitedDate, visitorNames);
      var newVisitors = visitorNames.filter(function (v) { return alreadyRecorded.indexOf(v) === -1; });

      if (newVisitors.length === 0) {
        // Every submitted visitor was already recorded — nothing to
        // write, but this is not an error; say so plainly.
        result = {
          success: true,
          allDuplicates: true,
          skippedVisitors: alreadyRecorded,
          message: (alreadyRecorded.length === 1 ? alreadyRecorded[0] + ' was' : alreadyRecorded.join(', ') + ' were')
            + ' already recorded for "' + storeNorm + '" on ' + dateFormatted + '. Nothing new to record.',
        };
      } else {
        // Row array — must match MASTER_LOG column order exactly:
        // A Timestamp | B Date Visited | C Store | D Brand | E Region |
        // F Visited By | G Purpose | H Remarks | I Store ID
        var newRow = [
          timestamp, dateFormatted, storeNorm, brand, region,
          newVisitors.join(' | '), // only the NOT-already-recorded visitors
          purposeNorm, remarksVal,
          storeId || '',
        ];
        master.appendRow(newRow);
        SpreadsheetApp.flush();

        if (alreadyRecorded.length > 0) {
          result = {
            success: true,
            warning: true,
            skippedVisitors: alreadyRecorded,
            recordedVisitors: newVisitors,
            message: (alreadyRecorded.length === 1 ? alreadyRecorded[0] + ' was' : alreadyRecorded.join(', ') + ' were')
              + ' already recorded for this store/date and ' + (alreadyRecorded.length === 1 ? 'was' : 'were') + ' skipped. '
              + (newVisitors.length === 1 ? newVisitors[0] + ' was' : newVisitors.join(', ') + ' were') + ' recorded.',
          };
        } else {
          result = { success: true };
        }
      }
    } finally {
      if (gotLock) lock.releaseLock();
    }

    return result;

  } catch (e) {
    logError('processSubmissionAsync', e);
    return { success: false, message: e.message };
  }
}

// ============================================================
//  _findRecordedVisitors(master, storeId, storeNorm, visitDate, visitorNames)
//  Called only from inside processSubmissionAsync()'s LockService section,
//  so it always sees the latest committed MASTER_LOG state — no other
//  concurrent submission can land between this read and the append that
//  follows it.
//
//  Duplicate definition (business rule): same Store + same Visitor + same
//  calendar date. Store is matched by Store ID (col I) when a candidate
//  row has one; for a legacy row written before that column existed (or
//  when the submitted store name doesn't currently resolve to any Store
//  ID at all — e.g. migration hasn't run yet), falls back to normalized
//  Store Name (col C). Both paths agree for any row where they'd both
//  apply, so this never double-counts or silently misses a legacy row
//  purely because it predates Store ID — full backward compatibility
//  until migration actually runs.
//
//  "Same Visitor" is evaluated per-individual: each name in
//  visitorNames is checked independently against every matching row's
//  Visited By list, because the business risk this guards against (one
//  person's visit logged twice) exists per-visitor, independent of who
//  else is on the same submission.
//
//  @returns {string[]} the subset of visitorNames already recorded for
//    this store + date (possibly empty)
// ============================================================
function _findRecordedVisitors(master, storeId, storeNorm, visitDate, visitorNames) {
  var lastRow = master.getLastRow();
  if (lastRow < 2 || !visitorNames.length) return [];

  var raw = master.getRange(2, 1, lastRow - 1, 9).getValues();
  var found = {};
  for (var i = 0; i < raw.length; i++) {
    var row = raw[i];
    var rowStoreId = String(row[COL_STORE_ID - 1] || '').trim().toUpperCase();
    var rowStoreName = String(row[COL_STORE - 1] || '').trim().toUpperCase();

    var sameStore = rowStoreId
      ? (!!storeId && rowStoreId === storeId)
      : (rowStoreName === storeNorm);
    if (!sameStore) continue;

    var rowDate = _parseDateCell(row[COL_DATE - 1]);
    if (!rowDate || rowDate.getTime() !== visitDate.getTime()) continue;

    var rowVisitors = String(row[COL_VISITED_BY - 1] || '').toUpperCase()
      .split('|').map(function (v) { return v.trim(); }).filter(Boolean);

    rowVisitors.forEach(function (v) {
      if (visitorNames.indexOf(v) !== -1) found[v] = true;
    });
  }
  return Object.keys(found);
}


// ============================================================
//  checkDuplicateVisit(payload)
//  Scans MASTER_LOG for any prior visit to the same store within
//  the previous 7 days (inclusive) of the submitted visit date.
//  Called by the sidebar before final submit to surface a warning.
//  Never blocks submission — warning only.
//
//  Returns { duplicate: false }
//       or { duplicate: true, rows: [{ lastVisitDate, visitor, purpose, daysSince }] }
//  rows is sorted most-recent first.
// ============================================================
function checkDuplicateVisit(payload) {
  try {
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var master = ss.getSheetByName(SHEET_MASTER);
    if (!master || master.getLastRow() < 2) return { duplicate: false };

    var store = String(payload.store || '').trim().toUpperCase();

    // Parse submitted visit date (YYYY-MM-DD) to midnight local time —
    // _parseDateCell() (SVMKPI_CORE.gs) is the one shared implementation
    // every date parse in this project should go through.
    var submitDate = _parseDateCell(payload.dateVisited);
    if (!submitDate) return { duplicate: false };
    var submitMs = submitDate.getTime();

    var MS_PER_DAY  = 24 * 60 * 60 * 1000;
    var WINDOW_DAYS = 7;

    var lastRow  = master.getLastRow();
    var dataRows = lastRow - 1;
    var raw      = master.getRange(2, 1, dataRows, 8).getValues();

    var tz      = Session.getScriptTimeZone();
    var matches = [];

    raw.forEach(function (row) {
      var rowStore = String(row[COL_STORE - 1] || '').trim().toUpperCase();
      if (rowStore !== store) return;

      var rowDate = _parseDateCell(row[COL_DATE - 1]);
      if (!rowDate) return;

      // daysSince: positive = rowDate is before submitDate
      var daysSince = Math.round((submitMs - rowDate.getTime()) / MS_PER_DAY);

      // Include rows within [0, 7] days before submitDate (0 = same day)
      if (daysSince >= 0 && daysSince <= WINDOW_DAYS) {
        matches.push({
          lastVisitDate: Utilities.formatDate(rowDate, tz, 'yyyy-MM-dd'),
          visitor:       String(row[COL_VISITED_BY - 1] || '').trim(),
          purpose:       String(row[COL_PURPOSE    - 1] || '').trim(),
          daysSince:     daysSince
        });
      }
    });

    if (matches.length === 0) return { duplicate: false };

    // Sort most-recent first (smallest daysSince first)
    matches.sort(function (a, b) { return a.daysSince - b.daysSince; });

    return { duplicate: true, rows: matches };

  } catch (e) {
    logError('checkDuplicateVisit', e);
    // Non-fatal — return no duplicate so submission can proceed
    return { duplicate: false };
  }
}


// ============================================================
//  manageVisitor(action, visitorName)
//  Adds or removes a visitor from SETTINGS col F (Visitor Roster).
//  action: 'add' | 'remove'
//  visitorName: string (will be uppercased and trimmed)
//
//  Input Portal's own everyday "⚙ Manage Roster" quick panel (formerly
//  here, open to any guest-password-holding visitor) has been removed —
//  the System Tools "Store & Roster Manager" card is now the only caller,
//  so this is admin-gated like its siblings (managePurpose(),
//  portal_saveStore(), portal_removeStore()).
//
//  Returns { success: true, visitors: [string] }
//       or { success: false, message: string }
// ============================================================
function manageVisitor(action, visitorName) {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

    var name = String(visitorName || '').trim().toUpperCase();
    if (!name) return { success: false, message: 'Visitor name cannot be blank.' };

    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var settings = ss.getSheetByName(SHEET_SETTINGS);
    if (!settings) return { success: false, message: 'SETTINGS sheet not found.' };

    var lastRow = settings.getLastRow();

    // Build current roster: { name -> rowIndex (1-based) }
    var roster   = {};
    var firstEmpty = -1;  // first empty cell in col F (for 'add')

    if (lastRow >= 2) {
      var colF = settings.getRange(2, COL_S_VISITOR, lastRow - 1, 1).getValues();
      colF.forEach(function (r, idx) {
        var v = String(r[0] || '').trim().toUpperCase();
        if (v) {
          roster[v] = idx + 2;  // sheet row (1-based, header = row 1)
        } else if (firstEmpty === -1) {
          firstEmpty = idx + 2;
        }
      });
    }

    if (action === 'add') {
      if (roster[name]) {
        return { success: false, message: '"' + name + '" is already in the visitor roster.' };
      }
      // Write to first empty col F cell, or append a new row
      var targetRow = firstEmpty !== -1 ? firstEmpty : lastRow + 1;
      settings.getRange(targetRow, COL_S_VISITOR).setValue(name);
      SpreadsheetApp.flush();

      // A brand-new roster member has no row in the KPI 2026 sheet yet —
      // unlike Executive Summary's totals (open-column COUNTIFS that
      // recalculate on their own for anyone already on the sheet), there's
      // no formula row for them to recalculate until one exists. Rebuilding
      // now (only triggered by this relatively rare admin action, never by
      // an ordinary visit submission) means their next visit shows up
      // without anyone having to remember to run "Rebuild KPI 2026" by hand.
      try {
        if (ss.getSheetByName(_kpiSheetName())) buildKPI2026();
      } catch (e) { logError('manageVisitor (KPI 2026 auto-refresh)', e); }

    } else if (action === 'remove') {
      if (!roster[name]) {
        return { success: false, message: '"' + name + '" was not found in the visitor roster.' };
      }
      settings.getRange(roster[name], COL_S_VISITOR).clearContent();
      SpreadsheetApp.flush();

    } else {
      return { success: false, message: 'Unknown action: ' + action };
    }

    // Return refreshed visitor list
    var updated = getSidebarData();
    return { success: true, visitors: updated.visitors };

  } catch (e) {
    logError('manageVisitor', e);
    return { success: false, message: e.message };
  }
}


// ============================================================
//  managePurpose(action, purposeName)
//  Adds or removes an entry in SETTINGS col H (Purpose List) — the same
//  list getSidebarData() reads into the Input Portal's Purpose dropdown.
//  Mirrors manageVisitor() one column over. Admin-only: exposed solely
//  through the System Tools "Store & Roster Manager" card.
//  action: 'add' | 'remove'
//  purposeName: string (will be uppercased and trimmed)
//
//  Returns { success: true, purposes: [string] }
//       or { success: false, message: string }
// ============================================================
function managePurpose(action, purposeName) {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

    var name = String(purposeName || '').trim().toUpperCase();
    if (!name) return { success: false, message: 'Purpose name cannot be blank.' };

    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var settings = ss.getSheetByName(SHEET_SETTINGS);
    if (!settings) return { success: false, message: 'SETTINGS sheet not found.' };

    var lastRow = settings.getLastRow();

    // Build current list: { name -> rowIndex (1-based) }
    var list       = {};
    var firstEmpty = -1;  // first empty cell in col H (for 'add')

    if (lastRow >= 2) {
      var colH = settings.getRange(2, COL_S_PURPOSE, lastRow - 1, 1).getValues();
      colH.forEach(function (r, idx) {
        var v = String(r[0] || '').trim().toUpperCase();
        if (v) {
          list[v] = idx + 2;
        } else if (firstEmpty === -1) {
          firstEmpty = idx + 2;
        }
      });
    }

    if (action === 'add') {
      if (list[name]) {
        return { success: false, message: '"' + name + '" is already in the purpose list.' };
      }
      var targetRow = firstEmpty !== -1 ? firstEmpty : lastRow + 1;
      settings.getRange(targetRow, COL_S_PURPOSE).setValue(name);
      SpreadsheetApp.flush();

    } else if (action === 'remove') {
      if (!list[name]) {
        return { success: false, message: '"' + name + '" was not found in the purpose list.' };
      }
      settings.getRange(list[name], COL_S_PURPOSE).clearContent();
      SpreadsheetApp.flush();

    } else {
      return { success: false, message: 'Unknown action: ' + action };
    }

    // Return refreshed purpose list
    var updated = getSidebarData();
    return { success: true, purposes: updated.purposes };

  } catch (e) {
    logError('managePurpose', e);
    return { success: false, message: e.message };
  }
}


// ============================================================
//  portal_saveStore(store, brand, region, category)
//  Adds a new SETTINGS row, or updates brand/region/category on an
//  existing one (matched by store name, case-insensitive). A brand-new
//  row also gets the col D validation formula (mirrors the per-row
//  formula rebuildDataHeaders() writes in SVMKPI_MASTER_REBUILD.gs) —
//  an edit to an existing row leaves col D alone since it's a live
//  formula referencing B/C and recalculates on its own.
//  Admin-only: exposed solely through the System Tools
//  "Store & Roster Manager" card.
//
//  Returns { success: true, message: string, isNew: boolean }
//       or { success: false, message: string }
// ============================================================
function portal_saveStore(store, brand, region, category) {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

    var name = String(store || '').trim().toUpperCase();
    if (!name) return { success: false, message: 'Store name cannot be blank.' };
    brand    = String(brand    || '').trim().toUpperCase();
    region   = String(region   || '').trim().toUpperCase();
    category = String(category || '').trim().toUpperCase();
    if (!brand || !region || !category) {
      return { success: false, message: 'Brand, Region and Category are all required.' };
    }

    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var settings = ss.getSheetByName(SHEET_SETTINGS);
    if (!settings) return { success: false, message: 'SETTINGS sheet not found.' };

    var lastRow   = settings.getLastRow();
    var targetRow = -1;
    if (lastRow >= 2) {
      var colA = settings.getRange(2, COL_S_STORE, lastRow - 1, 1).getValues();
      for (var i = 0; i < colA.length; i++) {
        if (String(colA[i][0] || '').trim().toUpperCase() === name) { targetRow = i + 2; break; }
      }
    }

    var isNew = targetRow === -1;
    if (isNew) targetRow = lastRow + 1;

    settings.getRange(targetRow, COL_S_STORE).setValue(name);
    settings.getRange(targetRow, COL_S_BRAND).setValue(brand);
    settings.getRange(targetRow, COL_S_REGION).setValue(region);
    settings.getRange(targetRow, COL_S_CATEGORY).setValue(category);

    if (isNew) {
      var brandChecks = APPROVED_BRANDS.map(function (b) {
        return 'B' + targetRow + '="' + String(b).replace(/"/g, '""') + '"';
      }).join(',');
      settings.getRange(targetRow, 4).setFormula(
        '=IF(OR(' + brandChecks + '),IF(C' + targetRow + '="","⚠ MISSING REGION","OK"),"N/A")'
      );
    }

    SpreadsheetApp.flush();

    // Store Health's numbers are plain computed values, not live formulas
    // (the cadence/decay scoring logic isn't expressible as a spreadsheet
    // formula) — nothing about them recalculates on its own the way
    // Executive Summary's open-column COUNTIFS do. Refreshing now (only
    // triggered by this relatively rare admin action, never by an
    // ordinary visit submission) means a new or edited store shows up
    // without anyone having to remember to run "Rebuild Store Health".
    try {
      if (ss.getSheetByName(RISK_SHEET_NAME)) refreshRiskEngine();
    } catch (e) { logError('portal_saveStore (Store Health auto-refresh)', e); }

    return {
      success: true,
      isNew: isNew,
      message: (isNew ? 'Added "' : 'Updated "') + name + '".',
    };

  } catch (e) {
    logError('portal_saveStore', e);
    return { success: false, message: e.message };
  }
}


// ============================================================
//  portal_removeStore(storeName)
//  Removes a store from the active SETTINGS list — clears only that
//  row's own columns (A store, B brand, C region, D validation formula,
//  E category). Cols F (Visitor Roster) and H (Purpose List) are
//  independent parallel lists that happen to share this sheet, not this
//  row's data, and must never be touched here.
//
//  Every historical MASTER_LOG visit for the store is untouched — Store
//  Health's _computeStoreRisk() seeds itself from SETTINGS first, then
//  falls back to MASTER_LOG rows for any store no longer in SETTINGS, so
//  the store keeps showing up with its full visit history. Its brand/
//  region fall back to whatever MASTER_LOG recorded on each visit;
//  category has no MASTER_LOG fallback and degrades to "—"/UNKNOWN
//  (cadence expectations become "no target" rather than wrong ones).
//  Admin-only: exposed solely through the System Tools
//  "Store & Roster Manager" card.
//
//  Returns { success: true, message: string }
//       or { success: false, message: string }
// ============================================================
function portal_removeStore(storeName) {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

    var name = String(storeName || '').trim().toUpperCase();
    if (!name) return { success: false, message: 'Store name cannot be blank.' };

    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var settings = ss.getSheetByName(SHEET_SETTINGS);
    if (!settings) return { success: false, message: 'SETTINGS sheet not found.' };

    var lastRow   = settings.getLastRow();
    var targetRow = -1;
    if (lastRow >= 2) {
      var colA = settings.getRange(2, COL_S_STORE, lastRow - 1, 1).getValues();
      for (var i = 0; i < colA.length; i++) {
        if (String(colA[i][0] || '').trim().toUpperCase() === name) { targetRow = i + 2; break; }
      }
    }

    if (targetRow === -1) {
      return { success: false, message: '"' + name + '" was not found in the store list.' };
    }

    settings.getRange(targetRow, COL_S_STORE).clearContent();
    settings.getRange(targetRow, COL_S_BRAND).clearContent();
    settings.getRange(targetRow, COL_S_REGION).clearContent();
    settings.getRange(targetRow, 4).clearContent(); // col D — validation formula
    settings.getRange(targetRow, COL_S_CATEGORY).clearContent();
    SpreadsheetApp.flush();

    // Reflect the removal in Store Health immediately, same as add/edit —
    // its numbers are plain computed values with nothing to recalculate
    // on their own.
    try {
      if (ss.getSheetByName(RISK_SHEET_NAME)) refreshRiskEngine();
    } catch (e) { logError('portal_removeStore (Store Health auto-refresh)', e); }

    return {
      success: true,
      message: '"' + name + '" removed from the active store list. All historical visits remain in Store Health.',
    };

  } catch (e) {
    logError('portal_removeStore', e);
    return { success: false, message: e.message };
  }
}


// ============================================================
//  logError(context, error)
//  Writes errors to the script log for debugging.
// ============================================================
function logError(context, error) {
  var msg = '[InputPortal v2.0] ERROR in ' + context + ': '
    + (error && error.message ? error.message : String(error));
  console.error(msg);

  // Optional: also write to a hidden LOG sheet if it exists
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName('ERROR_LOG');
    if (log) {
      var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      log.appendRow([ts, context, error && error.message ? error.message : String(error)]);
    }
  } catch (innerErr) {
    // Silently ignore — don't let error logging crash anything
    console.error('logError itself failed: ' + innerErr.message);
  }
}