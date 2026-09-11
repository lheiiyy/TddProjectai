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
//  C=3  Store
//  D=4  Brand
//  E=5  Region
//  F=6  Visited By
//  G=7  Purpose
//  H=8  Remarks
var COL_TIMESTAMP   = 1;
var COL_DATE        = 2;
var COL_STORE       = 3;
var COL_BRAND       = 4;
var COL_REGION      = 5;
var COL_VISITED_BY  = 6;
var COL_PURPOSE     = 7;
var COL_REMARKS     = 8;

// SETTINGS columns (1-indexed)
//  A=1  Store
//  B=2  Brand
//  C=3  Region
//  F=6  Visitor Roster
//  H=8  Purpose List
var COL_S_STORE    = 1;
var COL_S_BRAND    = 2;
var COL_S_REGION   = 3;
var COL_S_VISITOR  = 6;
var COL_S_PURPOSE  = 8;


// ============================================================
//  getSidebarData()
//  Called by the sidebar on load.
//  Returns { stores: [{store, brand, region}], visitors: [string], purposes: [string] }
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
      var store   = String(row[COL_S_STORE   - 1] || '').trim().toUpperCase();
      var brand   = String(row[COL_S_BRAND   - 1] || '').trim().toUpperCase();
      var region  = String(row[COL_S_REGION  - 1] || '').trim().toUpperCase();
      var visitor = String(row[COL_S_VISITOR - 1] || '').trim().toUpperCase();
      var purpose = String(row[COL_S_PURPOSE - 1] || '').trim().toUpperCase();

      if (store && !storeSet[store]) {
        storeSet[store] = true;
        stores.push({ store: store, brand: brand, region: region });
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

    // Parse date string from sidebar (YYYY-MM-DD) into a Date object
    var dateParts   = String(payload.dateVisited).split('-');
    var visitedDate = new Date(
      parseInt(dateParts[0], 10),
      parseInt(dateParts[1], 10) - 1,
      parseInt(dateParts[2], 10)
    );
    var dateFormatted = Utilities.formatDate(visitedDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    // Row array — must match MASTER_LOG column order exactly:
    // A Timestamp | B Date Visited | C Store | D Brand | E Region |
    // F Visited By | G Purpose | H Remarks
    var newRow = [
      timestamp,                                            // A
      dateFormatted,                                        // B
      String(payload.store).trim().toUpperCase(),           // C
      brand,                                                // D
      region,                                               // E
      visitedByStr,                                         // F — pipe-delimited if multi
      String(payload.purpose).trim().toUpperCase(),         // G
      String(payload.remarks || '').trim()                  // H — free text, no case change
    ];

    // ── Write to MASTER_LOG ───────────────────────────────────
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var master = ss.getSheetByName(SHEET_MASTER);

    if (!master) {
      return { success: false, message: 'MASTER_LOG sheet not found.' };
    }

    master.appendRow(newRow);

    // Flush to ensure write completes
    SpreadsheetApp.flush();

    return { success: true };

  } catch (e) {
    logError('processSubmissionAsync', e);
    return { success: false, message: e.message };
  }
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

    // Parse submitted visit date (YYYY-MM-DD) to midnight local time
    var dateParts    = String(payload.dateVisited || '').split('-');
    var submitDate   = new Date(
      parseInt(dateParts[0], 10),
      parseInt(dateParts[1], 10) - 1,
      parseInt(dateParts[2], 10)
    );
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

      // Resolve row date to a comparable midnight-local Date
      var rowDateRaw = row[COL_DATE - 1];
      var rowDate;
      if (rowDateRaw instanceof Date && !isNaN(rowDateRaw)) {
        // Sheets Date objects carry time — strip to midnight local
        var formatted = Utilities.formatDate(rowDateRaw, tz, 'yyyy-MM-dd');
        var p = formatted.split('-');
        rowDate = new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10));
      } else {
        var s = String(rowDateRaw || '').trim().substring(0, 10);
        if (!s) return;
        var p2 = s.split('-');
        rowDate = new Date(parseInt(p2[0],10), parseInt(p2[1],10)-1, parseInt(p2[2],10));
      }

      if (isNaN(rowDate.getTime())) return;

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
//  Returns { success: true, visitors: [string] }
//       or { success: false, message: string }
// ============================================================
function manageVisitor(action, visitorName) {
  try {
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