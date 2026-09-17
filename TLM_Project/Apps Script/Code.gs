/**
 * TL TRACKER — Team Leader Monitoring
 * Rebuilt version with HTML forms for data entry.
 *
 * MASTER_LOG IS READ/WRITTEN BY FIXED COLUMN POSITION (see the COL
 * constant below), not by header name. This matches how the real,
 * live production script (the one this file was reconciled against)
 * has always worked, and it's a deliberate choice, not a shortcut:
 * the real MASTER_LOG's header row text is inconsistent — a blank
 * header, trailing spaces ("Batch # ", "TL ENTRY AVERAGE "), a typo
 * ("CERTFICATION  GRADE"), a stray colon ("CERT BY:"), and names that
 * don't match what this project's UI calls the same field ("RESULT"
 * is Status, "STATUS" is Final Status) — so header-name lookup against
 * it is fragile in a way fixed positions aren't. UNIFORM_LOG and
 * UNIFORM_INVENTORY are this project's own tabs with headers it fully
 * controls, so those two still use header-name lookup (getHeaderMap)
 * — reorder-safe, and there's no drift risk to guard against.
 *
 * WHAT THIS FIXES vs. the old script pasted in the sheet:
 *  1. Deadlines are always real Date objects computed in script
 *     (Date of Entry + 3 months on entry, +2 months on each EXTEND) —
 *     this is what stops the "4627300%" style corruption, which happens
 *     when a date serial number lands in a percent-formatted text cell.
 *  2. Duplicate/lookup matching uses Full Name + Mother Store + Date of
 *     Entry together (a composite key), not name alone — two people who
 *     share a name, or one person re-entering after quitting, no longer
 *     collide. (The live script's submitTLCertification and its onEdit
 *     sync both matched by name only — that collision risk is why this
 *     project uses the composite key everywhere instead.)
 *  3. Certification/Extend/Fail writes only touch Cert Grade / Exam
 *     Grade / Average when the form actually sent a value — the live
 *     script overwrote all three unconditionally on every update, which
 *     could blank out a previously-recorded grade on a later EXTEND.
 *  4. FAILED / QUIT / DISQUALIFIED still save whatever grade was entered,
 *     so the outcome and the score that produced it live in one place.
 *  5. Store names are normalized (trim, collapse spaces, uppercase) on
 *     every save, so "PETRON" and "PETRON " (or "DONA"/"DOÑA SOLEDAD")
 *     can't split into two different stores in your summaries.
 *  6. No onEdit two-way sync to separate PROBATIONARY/CERTIFIED tabs.
 *     The live script's onEdit(e) kept MASTER_LOG in sync with those
 *     two tabs (and vice versa) by name-only matching, one column at a
 *     time. MASTER_LOG is the master data holder — everything else
 *     derives from it — so that sync is no longer needed and dropping
 *     it removes a second name-collision risk along with it, not just
 *     the first one in point 2.
 *
 * INSTALL
 *  1. Open the spreadsheet → Extensions → Apps Script.
 *  2. Delete whatever is in Code.gs, paste this file's contents in.
 *  3. Add one HTML file (+ icon → HTML): name it exactly TLForm.html,
 *     paste in its contents.
 *  4. Save, reload the spreadsheet. A "🍕 TL Tracker" menu appears.
 *  5. First run of any menu item will ask you to authorize — approve it.
 *  6. Run "🍕 TL Tracker → Set / Change Access PIN" once to set the PIN
 *     phones will need to unlock the form.
 *  7. Deploy → New deployment → type "Web app" → Execute as "Me",
 *     "Who has access" → "Anyone" → Deploy. Copy the web app URL and
 *     open "🍕 TL Tracker → Show Phone App Link" any time to see it
 *     again. On a phone, open that URL in the browser and use
 *     "Add to Home Screen" so it behaves like an app icon.
 *     (Anyone with the URL can reach the PIN screen — the PIN is what
 *     actually gates entry, not the link itself. Re-deploy — "Manage
 *     deployments" → pencil icon → "New version" — any time you edit
 *     Code.gs or TLForm.html, otherwise the phone link keeps serving
 *     the old version.)
 *
 * SHEET SETUP
 *  Run "🍕 TL Tracker → Set Up Sheets (first-time only)" to create both
 *  of the tabs below automatically — only on a spreadsheet that doesn't
 *  have a MASTER_LOG yet (it never touches an existing one). If you're
 *  connecting this script to the REAL, already-populated MASTER_LOG
 *  instead, header text doesn't matter at all: every MASTER_LOG read/
 *  write in this file goes by fixed column position (see the COL
 *  constant below), column A through W, in this exact order:
 *
 *  MASTER_LOG (A-W, fixed position, header text irrelevant):
 *   A: (timestamp) | B: Date of Entry | C: Batch # | D: Mother Store |
 *   E: Full Name | F: Mother Station | G: Support Store | H: Status |
 *   I: Uniform Release | J: Entry By | K: ISTV Grade | L: TechVal FP |
 *   M: TechVal PM | N: TL-Entry Food Prep Exam |
 *   O: TL-Entry Pizza Maker Exam | P: TL Entry Average |
 *   Q: Certification Deadline | R: Cert By | S: Date Certified |
 *   T: Certification Grade | U: Exam Grade | V: Average | W: Final Status
 *
 *  UNIFORM_LOG (one row per piece handed out — its own tracking, not
 *  crammed into MASTER_LOG's "Uniform Release" cell):
 *   Timestamp | TL Key | Full Name | Mother Store | Size | Quantity |
 *   DR # | Given By | Notes
 *
 *  UNIFORM_INVENTORY (one row per delivery received from the supplier —
 *  lets "Refresh Store Summary" compute stock on hand as Delivered minus
 *  Issued, per size):
 *   Timestamp | Size | Qty Received | Delivery Ref | Logged By
 */

const SHEET_NAME = 'MASTER_LOG';
const UNIFORM_SHEET_NAME = 'UNIFORM_LOG';
const UNIFORM_INVENTORY_SHEET_NAME = 'UNIFORM_INVENTORY';
const STATUS_VALUES = ['PROBATIONARY', 'EXTENDED', 'CERTIFIED', 'FAILED', 'QUIT', 'DISQUALIFIED', 'PROMOTION'];
const OPEN_STATUSES = ['PROBATIONARY', 'EXTENDED']; // statuses eligible for the Update/Certify form
const UNIFORM_SIZES = ['XSMALL', 'SMALL', 'MEDIUM', 'LARGE', 'XLARGE', 'XXLARGE'];
const PIN_PROPERTY_KEY = 'TL_TRACKER_PIN';
const LOCK_WAIT_MS = 10000; // how long a phone submit waits for another one to finish

// Spreadsheet ID of the SVMI Command Center — its SETTINGS tab (Store |
// Brand | Region) is the canonical, company-wide store roster. TL Tracker
// reads it so the Reports tab's Store Coverage view can show every real
// store (including ones with zero active TL right now), instead of only
// whatever store names happen to already appear in MASTER_LOG. Set via
// "🍕 TL Tracker → Link SVMI Store List" — see setSvmiLink().
const SVMI_LINK_PROPERTY_KEY = 'SVMI_SPREADSHEET_ID';
const SVMI_STORE_CACHE_KEY = 'svmi_store_list_v1';
const SVMI_STORE_CACHE_SECONDS = 21600; // 6 hours — SETTINGS rarely changes day to day

// MASTER_LOG's real, fixed column layout (1-based, matches getRange).
// Confirmed against a full export of the live production spreadsheet —
// see the file header comment above for why this is fixed-position
// instead of header-name lookup. Column A ("timestamp") has no usable
// header text on the real sheet, hence no name in the comment block above.
const COL = {
  TIMESTAMP: 1,
  ENTRY_DATE: 2,
  BATCH: 3,
  MOTHER_STORE: 4,
  FULL_NAME: 5,
  MOTHER_STATION: 6,
  SUPPORT_STORE: 7,
  STATUS: 8,
  UNIFORM_RELEASE: 9,
  ENTRY_BY: 10,
  ISTV_GRADE: 11,
  TECHVAL_FP: 12,
  TECHVAL_PM: 13,
  ENTRY_FOOD_PREP: 14,
  ENTRY_PIZZA_MAKER: 15,
  ENTRY_AVERAGE: 16,
  CERT_DEADLINE: 17,
  CERT_BY: 18,
  DATE_CERTIFIED: 19,
  CERT_GRADE: 20,
  EXAM_GRADE: 21,
  AVERAGE: 22,
  FINAL_STATUS: 23
};
const MASTER_LOG_LAST_COL = 23; // A through W

// =====================================================================
// MENU
// =====================================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍕 TL Tracker')
    .addItem('Open TL Form', 'showTLForm')
    .addSeparator()
    .addItem('Refresh Store Summary', 'refreshStoreSummary')
    .addItem('Set Up Sheets (first-time only)', 'setupSheets')
    .addItem('Migrate Legacy Logs into MASTER_LOG (one-time)', 'migrateLegacyLogs')
    .addItem('Audit & Fix MASTER_LOG (one-time)', 'auditAndFixMasterLog')
    .addSeparator()
    .addItem('Link SVMI Store List (Settings)…', 'setSvmiLink')
    .addItem('Refresh SVMI Store List Cache', 'refreshSvmiStoreListCache')
    .addSeparator()
    .addItem('Set / Change Access PIN', 'setAccessPin')
    .addItem('Show Phone App Link', 'showWebAppUrl')
    .addToUi();
}

// Single dialog, with a New Entry / Certify & Update switch inside it.
// Used from the desktop Sheets menu — phones use the web app (doGet) instead.
function showTLForm() {
  const html = HtmlService.createHtmlOutputFromFile('TLForm').setWidth(480).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'TL Tracker');
}

// =====================================================================
// PHONE / WEB APP ENTRY POINT
// =====================================================================
// Deploy this project as a Web App (Deploy → New deployment → Web app).
// Whoever opens the resulting URL — on a phone or anywhere else — gets
// this same form full-page, gated by the PIN screen built into TLForm.html.
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('TLForm')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setTitle('TL Tracker')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function setAccessPin() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Set Access PIN', 'Enter the PIN phones will need to unlock the TL Tracker form (4+ digits/characters):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const pin = resp.getResponseText().trim();
  if (pin.length < 4) {
    ui.alert('PIN must be at least 4 characters. Nothing was saved — run this again.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(PIN_PROPERTY_KEY, pin);
  ui.alert('PIN saved. Anyone opening the phone link will need this PIN to get in.');
}

function verifyPin(pin) {
  const stored = PropertiesService.getScriptProperties().getProperty(PIN_PROPERTY_KEY);
  if (!stored) throw new Error('No PIN has been set up yet — ask the sheet owner to run "Set / Change Access PIN" from the desktop menu.');
  return (pin || '').trim() === stored;
}

function showWebAppUrl() {
  const ui = SpreadsheetApp.getUi();
  try {
    const url = ScriptApp.getService().getUrl();
    if (!url) throw new Error('not deployed');
    ui.alert('Phone App Link', 'Open this on a phone browser and use "Add to Home Screen":\n\n' + url, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Not deployed yet', 'Go to Deploy → New deployment → type "Web app" → Execute as "Me" → Who has access "Anyone" → Deploy. Then run this again to see the link.', ui.ButtonSet.OK);
  }
}

// =====================================================================
// ONE-TIME SETUP
// =====================================================================
function setupSheets() {
  setupMasterLogHeaders_();
  setupUniformLogHeaders_();
  setupUniformInventoryHeaders_();
  SpreadsheetApp.getUi().alert('MASTER_LOG, UNIFORM_LOG, and UNIFORM_INVENTORY are set up. You can now use the TL Tracker menu.');
}

function setupMasterLogHeaders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  // Cosmetic only — every actual read/write against MASTER_LOG goes by
  // fixed column position (COL, above), not this header text. This only
  // ever runs when the sheet is brand new (see the guard below), so it
  // never touches the real, already-populated MASTER_LOG's header row.
  const headers = [
    '', 'Date of Entry', 'Batch #', 'Mother Store', 'Full Name',
    'Mother Station', 'Support Store', 'Status', 'Uniform Release',
    'Entry By', 'ISTV Grade', 'TechVal FP', 'TechVal PM',
    'TL-Entry Food Prep Exam', 'TL-Entry Pizza Maker Exam',
    'TL Entry Average', 'Certification Deadline', 'Cert By',
    'Date Certified', 'Certification Grade', 'Exam Grade', 'Average',
    'Final Status'
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }

  // Status column dropdown validation
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, COL.STATUS, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

// A separate event log — one row per uniform piece handed out — instead of
// cramming every release into one free-text MASTER_LOG cell. Keeps size,
// quantity, DR # and who gave it queryable on their own, the way the old
// sheet's separate size/DR# tables were clearly trying to do by hand.
function setupUniformLogHeaders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(UNIFORM_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(UNIFORM_SHEET_NAME);

  const headers = [
    'Timestamp', 'TL Key', 'Full Name', 'Mother Store', 'Size',
    'Quantity', 'DR #', 'Given By', 'Notes'
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.hideColumns(2); // TL Key is bookkeeping only, not for humans to edit
  }

  const headerMap = getHeaderMap(sheet);
  if (headerMap['Size'] != null) {
    const sizeCol = headerMap['Size'] + 1;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(UNIFORM_SIZES, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, sizeCol, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  }
}

function getUniformSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(UNIFORM_SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + UNIFORM_SHEET_NAME + '" not found. Run "Set Up Sheets" first.');
  return sheet;
}

// One row per delivery received from the supplier — separate from UNIFORM_LOG
// (which is what goes OUT to trainees) so "stock on hand" can be computed as
// Delivered minus Issued instead of hand-tallied in a side table.
function setupUniformInventoryHeaders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(UNIFORM_INVENTORY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(UNIFORM_INVENTORY_SHEET_NAME);

  const headers = ['Timestamp', 'Size', 'Qty Received', 'Delivery Ref', 'Logged By'];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }

  const headerMap = getHeaderMap(sheet);
  if (headerMap['Size'] != null) {
    const sizeCol = headerMap['Size'] + 1;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(UNIFORM_SIZES, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, sizeCol, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  }
}

function getUniformInventorySheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(UNIFORM_INVENTORY_SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + UNIFORM_INVENTORY_SHEET_NAME + '" not found. Run "Set Up Sheets" first.');
  return sheet;
}

// =====================================================================
// SHARED HELPERS
// =====================================================================
function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found. Run "Set Up MASTER_LOG Headers" first.');
  return sheet;
}

// Used for UNIFORM_LOG and UNIFORM_INVENTORY only — this project's own
// tabs, with header text it fully controls. NOT used for MASTER_LOG;
// see the COL constant and the file header comment for why.
function getHeaderMap(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const key = h.toString().trim();
    if (key) map[key] = i; // 0-based index
  });
  return map;
}

function toUpperSafe(value) {
  return value ? value.toString().toUpperCase().trim() : '';
}

// Collapses internal whitespace and uppercases, so "PETRON " / "PETRON  "
// and "Dona Soledad" / "Doña Soledad" don't silently become two stores.
// Accented vowels are folded to plain ASCII for matching purposes only —
// display text keeps whatever the user typed, trimmed and upper-cased.
function normalizeStore(value) {
  if (!value) return '';
  return value
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizeStoreKey(value) {
  return normalizeStore(value)
    .replace(/Ñ/g, 'N')
    .replace(/Á|À|Â/g, 'A')
    .replace(/É|È|Ê/g, 'E')
    .replace(/Í|Ì|Î/g, 'I')
    .replace(/Ó|Ò|Ô/g, 'O')
    .replace(/Ú|Ù|Û/g, 'U');
}

function toPercent(val) {
  if (val === '' || val === null || val === undefined || isNaN(val)) return '';
  return Number(val) / 100;
}

function average_(values) {
  const nums = values.filter(v => v !== '' && v !== null && v !== undefined && !isNaN(v)).map(Number);
  if (nums.length === 0) return '';
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.round((sum / nums.length) * 10000) / 10000; // keep as fraction, e.g. 0.9123
}

function addMonths(date, months) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

// Builds a stable composite key so two different people who share a name
// (or one person re-entering after quitting) don't collide.
function makeKey_(name, store, dateOfEntry) {
  const d = (dateOfEntry instanceof Date) ? Utilities.formatDate(dateOfEntry, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(dateOfEntry);
  return toUpperSafe(name) + '||' + normalizeStoreKey(store) + '||' + d;
}

// Shared MASTER_LOG row lookup, used anywhere a form needs to find one
// person by their composite key (currently: uniform releases).
function findMasterRowByKey_(key) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Could not find that trainee — the sheet may have changed. Reopen the form and try again.');
  const data = sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues();
  for (let i = 0; i < data.length; i++) {
    const name = data[i][COL.FULL_NAME - 1];
    const store = data[i][COL.MOTHER_STORE - 1];
    const entryDate = data[i][COL.ENTRY_DATE - 1];
    if (makeKey_(name, store, entryDate) === key) {
      return { sheet: sheet, sheetRow: i + 2, name: name, store: normalizeStore(store) };
    }
  }
  throw new Error('Could not find that trainee — the sheet may have changed. Reopen the form and try again.');
}

// =====================================================================
// DROPDOWN DATA FOR THE HTML FORMS
// =====================================================================
function getStoreList() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, COL.MOTHER_STORE, lastRow - 1, 1).getValues();
  const seen = {};
  const stores = [];
  values.forEach(row => {
    const norm = normalizeStore(row[0]);
    if (norm && !seen[norm]) {
      seen[norm] = true;
      stores.push(norm);
    }
  });
  return stores.sort();
}

// Returns trainees currently PROBATIONARY or EXTENDED, for the Update form's
// name picker. Each entry carries the composite key so submitCertification
// can find the exact row even if two people share a name.
function getOpenTLList() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues();

  const result = [];
  data.forEach(row => {
    const status = toUpperSafe(row[COL.STATUS - 1]);
    if (OPEN_STATUSES.indexOf(status) === -1) return;
    const name = row[COL.FULL_NAME - 1];
    const store = row[COL.MOTHER_STORE - 1];
    const entryDate = row[COL.ENTRY_DATE - 1];
    result.push({
      key: makeKey_(name, store, entryDate),
      label: name + ' — ' + normalizeStore(store) + ' (' + status + ')',
      status: status
    });
  });
  return result;
}

// Count of open trainees (PROBATIONARY/EXTENDED) whose Certification Deadline
// has already passed — drives the past-due warning badge on the burger menu
// and mode indicator, so it's visible before opening the Monitoring tab.
function getOverdueCount_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const now = new Date();
  let count = 0;
  sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues().forEach(row => {
    const status = toUpperSafe(row[COL.STATUS - 1]);
    if (OPEN_STATUSES.indexOf(status) === -1) return;
    const deadline = row[COL.CERT_DEADLINE - 1];
    if (deadline instanceof Date && deadline < now) count++;
  });
  return count;
}

// Everyone in MASTER_LOG regardless of status, for the Uniform tab's picker —
// uniforms get handed out to certified TLs too, not just open trainees.
function getAllTLList() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues();

  return data.map(row => {
    const name = row[COL.FULL_NAME - 1];
    const store = row[COL.MOTHER_STORE - 1];
    const entryDate = row[COL.ENTRY_DATE - 1];
    const status = toUpperSafe(row[COL.STATUS - 1]);
    if (!name) return null;
    return {
      key: makeKey_(name, store, entryDate),
      label: name + ' — ' + normalizeStore(store) + ' (' + status + ')'
    };
  }).filter(x => x);
}

// col is a 1-based MASTER_LOG column number (a COL.* constant).
function distinctColumnValues_(col) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  const seen = {};
  const out = [];
  values.forEach(row => {
    const norm = toUpperSafe(row[0]);
    if (norm && !seen[norm]) {
      seen[norm] = true;
      out.push(norm);
    }
  });
  return out.sort();
}

function getStationList() {
  return distinctColumnValues_(COL.MOTHER_STATION);
}

function getBatchList() {
  return distinctColumnValues_(COL.BATCH);
}

// Trainer initials/names pulled from what's actually been typed into
// Entry By / Cert By so far — no hardcoded roster to keep in sync.
function getTrainerList() {
  const entryBy = distinctColumnValues_(COL.ENTRY_BY);
  const certBy = distinctColumnValues_(COL.CERT_BY);
  const seen = {};
  const out = [];
  entryBy.concat(certBy).forEach(name => {
    // Split combined values like "CHARLIE | JAMES" so each name is its own suggestion
    name.split('|').map(s => s.trim()).forEach(n => {
      if (n && !seen[n]) { seen[n] = true; out.push(n); }
    });
  });
  return out.sort();
}

// One round trip to populate the whole merged form instead of five.
function getFormBootstrapData() {
  return {
    stores: getStoreList(),
    stations: getStationList(),
    batches: getBatchList(),
    trainers: getTrainerList(),
    openList: getOpenTLList(),
    allList: getAllTLList(),
    uniformSizes: UNIFORM_SIZES,
    inventorySummary: getInventorySummary(),
    overdueCount: getOverdueCount_()
  };
}

// Stock on hand per size = total received (UNIFORM_INVENTORY) minus total
// issued (UNIFORM_LOG). Shown on the Stock tab so whoever's about to log a
// delivery — or hand out a piece — can see what's actually left.
function getInventorySummary() {
  const delivered = {};
  const issued = {};
  UNIFORM_SIZES.forEach(s => { delivered[s] = 0; issued[s] = 0; });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const invSheet = ss.getSheetByName(UNIFORM_INVENTORY_SHEET_NAME);
  if (invSheet) {
    const map = getHeaderMap(invSheet);
    const lastRow = invSheet.getLastRow();
    if (lastRow >= 2) {
      invSheet.getRange(2, 1, lastRow - 1, invSheet.getLastColumn()).getValues().forEach(row => {
        const size = toUpperSafe(row[map['Size']]);
        const qty = Number(row[map['Qty Received']]) || 0;
        if (delivered[size] !== undefined) delivered[size] += qty;
      });
    }
  }

  const uSheet = ss.getSheetByName(UNIFORM_SHEET_NAME);
  if (uSheet) {
    const map = getHeaderMap(uSheet);
    const lastRow = uSheet.getLastRow();
    if (lastRow >= 2) {
      uSheet.getRange(2, 1, lastRow - 1, uSheet.getLastColumn()).getValues().forEach(row => {
        const size = toUpperSafe(row[map['Size']]);
        const qty = Number(row[map['Quantity']]) || 0;
        if (issued[size] !== undefined) issued[size] += qty;
      });
    }
  }

  return UNIFORM_SIZES.map(size => ({
    size: size,
    delivered: delivered[size],
    issued: issued[size],
    onHand: delivered[size] - issued[size]
  }));
}

// =====================================================================
// SVMI STORE LIST — the canonical, company-wide store roster lives in
// the SVMI Command Center's own spreadsheet (SETTINGS tab: Store |
// Brand | Region), not in TL Tracker's MASTER_LOG. Reading it here lets
// the Reports tab show every real store — including the ones with zero
// active TL right now, which never showed up before because that list
// was only ever built from whichever store names already had a
// MASTER_LOG row.
// =====================================================================

function setSvmiLink() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    'Link SVMI Store List',
    'Paste the SVMI Command Center spreadsheet\'s URL (or just its ID) — the one with the SETTINGS tab listing every store, brand, and region. The Reports tab\'s Store Coverage view will read that list from here on.',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const raw = resp.getResponseText().trim();
  if (!raw) { ui.alert('Nothing entered — link not changed.'); return; }

  const id = extractSpreadsheetId_(raw);
  if (!id) {
    ui.alert('Could not find a spreadsheet ID in that text. Paste the full URL (the one with /d/.../edit in it) or just the ID by itself.');
    return;
  }

  try {
    const ss = SpreadsheetApp.openById(id);
    const settings = ss.getSheetByName('SETTINGS');
    if (!settings) throw new Error('That spreadsheet has no "SETTINGS" tab.');
    if (settings.getLastRow() < 2) throw new Error('Its SETTINGS tab has no store rows yet.');
  } catch (err) {
    ui.alert('Could not link that spreadsheet: ' + err.message + '\n\nMake sure this script\'s owner also has access to it, then try again.');
    return;
  }

  PropertiesService.getScriptProperties().setProperty(SVMI_LINK_PROPERTY_KEY, id);
  clearSvmiStoreListCache_();
  ui.alert('Linked. The Reports tab\'s Store Coverage view will now show every store from that spreadsheet\'s SETTINGS tab.');
}

function refreshSvmiStoreListCache() {
  clearSvmiStoreListCache_();
  SpreadsheetApp.getUi().alert('Store list cache cleared — the next Reports tab load will re-read SVMI\'s SETTINGS tab fresh.');
}

function clearSvmiStoreListCache_() {
  CacheService.getScriptCache().remove(SVMI_STORE_CACHE_KEY);
}

// Pulls a spreadsheet ID out of a pasted URL, or accepts a bare ID.
function extractSpreadsheetId_(text) {
  const match = text.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

// Returns { list: [{name, brand, region}], usingFallback, fallbackMessage }.
// list is deduped by store name (a store with more than one brand row in
// SETTINGS — e.g. a shared location — gets its brands joined with " / ").
// Cached for SVMI_STORE_CACHE_SECONDS so every Reports tab load doesn't
// re-read another spreadsheet's 1000+ row SETTINGS tab.
function getCanonicalStoreList_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(SVMI_STORE_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through and rebuild */ }
  }

  const svmiId = PropertiesService.getScriptProperties().getProperty(SVMI_LINK_PROPERTY_KEY);
  let result;
  if (!svmiId) {
    result = {
      list: [],
      usingFallback: true,
      fallbackMessage: 'No SVMI store list linked yet — run "🍕 TL Tracker → Link SVMI Store List" from the menu. Showing only stores that already have TL Tracker data, so stores with no trainees yet won\'t appear.'
    };
  } else {
    try {
      const settings = SpreadsheetApp.openById(svmiId).getSheetByName('SETTINGS');
      if (!settings) throw new Error('linked spreadsheet has no "SETTINGS" tab');
      const lastRow = settings.getLastRow();
      if (lastRow < 2) throw new Error('its SETTINGS tab has no store rows');

      const data = settings.getRange(2, 1, lastRow - 1, 3).getValues(); // A: Store, B: Brand, C: Region
      const byName = new Map();
      data.forEach(row => {
        const name = String(row[0] || '').trim().toUpperCase();
        if (!name) return;
        const brand = String(row[1] || '').trim().toUpperCase();
        const region = String(row[2] || '').trim().toUpperCase();
        if (!byName.has(name)) byName.set(name, { name: name, brands: [], region: region });
        const rec = byName.get(name);
        if (brand && rec.brands.indexOf(brand) === -1) rec.brands.push(brand);
        if (!rec.region && region) rec.region = region;
      });

      const list = Array.from(byName.values())
        .map(r => ({ name: r.name, brand: r.brands.join(' / '), region: r.region }))
        .sort((a, b) => a.name.localeCompare(b.name));

      result = { list: list, usingFallback: false, fallbackMessage: '' };
    } catch (err) {
      result = {
        list: [],
        usingFallback: true,
        fallbackMessage: 'Could not read the linked SVMI store list (' + err.message + '). Showing only stores that already have TL Tracker data.'
      };
    }
  }

  cache.put(SVMI_STORE_CACHE_KEY, JSON.stringify(result), SVMI_STORE_CACHE_SECONDS);
  return result;
}

// One row per store — every store SVMI knows about, PLUS any store name
// that shows up in MASTER_LOG but isn't in SVMI's list (flagged, not
// hidden — that's a data-quality signal, likely a typo'd store name).
// Shared by getExecutiveSummary() (for its coverage KPI tiles) and
// getStoreCoverageReport() (the Reports tab's full, filterable table).
function buildStoreCoverage_() {
  const canonical = getCanonicalStoreList_();
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();

  const perStore = {};
  const ensure = (name) => {
    if (!perStore[name]) {
      perStore[name] = { name: name, brand: '', region: '', inCanonicalList: false, total: 0 };
      STATUS_VALUES.forEach(s => perStore[name][s] = 0);
    }
    return perStore[name];
  };

  canonical.list.forEach(s => {
    const rec = ensure(s.name);
    rec.brand = s.brand;
    rec.region = s.region;
    rec.inCanonicalList = true;
  });

  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues().forEach(row => {
      const name = row[COL.FULL_NAME - 1];
      if (!name) return;
      const store = normalizeStore(row[COL.MOTHER_STORE - 1]);
      if (!store) return;
      const status = toUpperSafe(row[COL.STATUS - 1]);
      const rec = ensure(store);
      rec.total++;
      if (rec[status] !== undefined) rec[status]++;
    });
  }

  const stores = Object.keys(perStore).map(name => {
    const r = perStore[name];
    const activeTL = (r.PROBATIONARY || 0) + (r.EXTENDED || 0) + (r.CERTIFIED || 0);
    return {
      name: r.name, brand: r.brand, region: r.region, inCanonicalList: r.inCanonicalList,
      activeTL: activeTL, total: r.total,
      probationary: r.PROBATIONARY || 0, extended: r.EXTENDED || 0, certified: r.CERTIFIED || 0,
      failed: r.FAILED || 0, quit: r.QUIT || 0, disqualified: r.DISQUALIFIED || 0, promotion: r.PROMOTION || 0
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const brandsSeen = {}, regionsSeen = {};
  stores.forEach(s => {
    if (s.brand) s.brand.split(' / ').forEach(b => { brandsSeen[b] = true; });
    if (s.region) regionsSeen[s.region] = true;
  });

  return {
    stores: stores,
    brands: Object.keys(brandsSeen).sort(),
    regions: Object.keys(regionsSeen).sort(),
    totalStores: stores.length,
    storesWithActiveTL: stores.filter(s => s.activeTL > 0).length,
    storesWithNoActiveTL: stores.filter(s => s.activeTL === 0).length,
    unlistedCount: stores.filter(s => !s.inCanonicalList).length,
    usingFallback: canonical.usingFallback,
    fallbackMessage: canonical.fallbackMessage
  };
}

// Called from TLForm.html's Reports tab ("🏬 Store Coverage" view).
function getStoreCoverageReport() {
  return buildStoreCoverage_();
}

// =====================================================================
// EXECUTIVE SUMMARY & TRAINERS MONITORING — the web app's two read-only
// report tabs. Both compute live from MASTER_LOG on every load instead
// of relying on the desktop-only "Refresh Store Summary" sheet, so a
// trainer or exec opening the phone link always sees the current state.
// =====================================================================

// Grade cells were written under two different scales over this file's
// life (fraction 0-1 for most fields, raw 0-100 for TL Entry Average) —
// read defensively so a report never shows "93%" as "9300%" or vice versa.
function toDisplayPercent_(value) {
  if (value === '' || value === null || value === undefined || isNaN(value)) return null;
  const n = Number(value);
  const pct = n <= 1 ? n * 100 : n;
  return Math.round(pct * 10) / 10;
}

function average0_(nums) {
  const clean = nums.filter(n => n !== null && n !== undefined && !isNaN(n));
  if (!clean.length) return null;
  return Math.round((clean.reduce((a, b) => a + b, 0) / clean.length) * 10) / 10;
}

// One aggregate snapshot for the "📊 Reports" tab's Overview sub-view:
// status breakdown, certification rate, overdue count, average scores,
// and store-coverage KPIs (full detail lives in getStoreCoverageReport(),
// the Store Coverage sub-view). Reuses the same MASTER_LOG pass "Refresh
// Store Summary" does, just returned as JSON instead of written to a sheet.
function getExecutiveSummary() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const tz = Session.getScriptTimeZone();
  const now = new Date();

  const statusCounts = {};
  STATUS_VALUES.forEach(s => statusCounts[s] = 0);
  let total = 0;
  let overdueCount = 0;
  const entryScores = [];
  const finalScores = [];

  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues().forEach(row => {
      const name = row[COL.FULL_NAME - 1];
      if (!name) return;
      total++;

      const status = toUpperSafe(row[COL.STATUS - 1]);
      if (statusCounts[status] !== undefined) statusCounts[status]++;

      const deadline = row[COL.CERT_DEADLINE - 1];
      if (OPEN_STATUSES.indexOf(status) !== -1 && deadline instanceof Date && deadline < now) overdueCount++;

      const entryAvg = toDisplayPercent_(row[COL.ENTRY_AVERAGE - 1]);
      if (entryAvg !== null) entryScores.push(entryAvg);
      const finalAvg = toDisplayPercent_(row[COL.AVERAGE - 1]);
      if (finalAvg !== null) finalScores.push(finalAvg);
    });
  }

  const certified = statusCounts['CERTIFIED'] || 0;
  const closedOutcomes = certified + (statusCounts['FAILED'] || 0) + (statusCounts['QUIT'] || 0) + (statusCounts['DISQUALIFIED'] || 0);
  const certRate = closedOutcomes > 0 ? Math.round((certified / closedOutcomes) * 1000) / 10 : null;

  const coverage = buildStoreCoverage_();

  return {
    generatedAt: Utilities.formatDate(now, tz, 'dd MMM yyyy, h:mm a'),
    total: total,
    statusCounts: statusCounts,
    openCount: (statusCounts['PROBATIONARY'] || 0) + (statusCounts['EXTENDED'] || 0),
    overdueCount: overdueCount,
    certRate: certRate,
    avgEntryScore: average0_(entryScores),
    avgFinalScore: average0_(finalScores),
    totalStoreCount: coverage.totalStores,
    storeCount: coverage.storesWithActiveTL,
    storeCoverageGap: coverage.storesWithNoActiveTL,
    storeCoverageFallback: coverage.usingFallback,
    uniform: getInventorySummary()
  };
}

// Every trainee, flattened into one row per person for the "🔎 Monitoring"
// tab's client-side search/filter — no server round-trip per keystroke.
function getMonitoringList() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const tz = Session.getScriptTimeZone();
  const now = new Date();

  return sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues()
    .map(row => {
      const name = row[COL.FULL_NAME - 1];
      if (!name) return null;
      const store = row[COL.MOTHER_STORE - 1];
      const entryDate = row[COL.ENTRY_DATE - 1];
      const status = toUpperSafe(row[COL.STATUS - 1]);
      const deadline = row[COL.CERT_DEADLINE - 1];
      const isOverdue = OPEN_STATUSES.indexOf(status) !== -1 && deadline instanceof Date && deadline < now;
      return {
        key: makeKey_(name, store, entryDate),
        fullName: name,
        motherStore: normalizeStore(store),
        motherStation: row[COL.MOTHER_STATION - 1] || '',
        batch: row[COL.BATCH - 1] || '',
        status: status,
        entryDate: (entryDate instanceof Date) ? Utilities.formatDate(entryDate, tz, 'dd MMM yyyy') : '',
        deadline: (deadline instanceof Date) ? Utilities.formatDate(deadline, tz, 'dd MMM yyyy') : '',
        deadlineSort: (deadline instanceof Date) ? deadline.getTime() : null, // for chronological sort — the display string above isn't lexically sortable
        isOverdue: isOverdue,
        entryBy: row[COL.ENTRY_BY - 1] || '',
        certBy: row[COL.CERT_BY - 1] || '',
        finalScore: toDisplayPercent_(row[COL.AVERAGE - 1]),
        finalStatus: row[COL.FINAL_STATUS - 1] || ''
      };
    })
    .filter(x => x)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// Past uniform releases for one trainee, most recent first — shown in the
// Uniform tab so whoever's handing out the next piece can see what this
// person already has before giving them more.
function getUniformHistory(key) {
  const sheet = getUniformSheet_();
  const map = getHeaderMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const tz = Session.getScriptTimeZone();

  return data
    .filter(row => row[map['TL Key']] === key)
    .map(row => ({
      date: (row[map['Timestamp']] instanceof Date) ? Utilities.formatDate(row[map['Timestamp']], tz, 'dd MMM yyyy') : '',
      size: row[map['Size']],
      quantity: row[map['Quantity']],
      drNumber: row[map['DR #']],
      givenBy: row[map['Given By']]
    }))
    .reverse();
}

// Full current record for one open trainee, so the Certify/Update panel
// can show what's already on file (current status, deadline, grades so
// far) before the user changes anything.
function getTLDetails(key) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (makeKey_(row[COL.FULL_NAME - 1], row[COL.MOTHER_STORE - 1], row[COL.ENTRY_DATE - 1]) === key) {
      const deadline = row[COL.CERT_DEADLINE - 1];
      const tz = Session.getScriptTimeZone();
      return {
        fullName: row[COL.FULL_NAME - 1],
        motherStore: normalizeStore(row[COL.MOTHER_STORE - 1]),
        motherStation: row[COL.MOTHER_STATION - 1],
        status: toUpperSafe(row[COL.STATUS - 1]),
        uniformRelease: row[COL.UNIFORM_RELEASE - 1],
        currentDeadline: (deadline instanceof Date) ? Utilities.formatDate(deadline, tz, 'dd MMM yyyy') : '(not a valid date on file)',
        nextExtendedDeadline: (deadline instanceof Date) ? Utilities.formatDate(addMonths(deadline, 2), tz, 'dd MMM yyyy') : '(will default to today + 2 months)',
        tlEntryAverage: row[COL.ENTRY_AVERAGE - 1],
        istvGrade: row[COL.ISTV_GRADE - 1]
      };
    }
  }
  throw new Error('Could not find that trainee — the sheet may have changed. Reopen the form and try again.');
}

// =====================================================================
// NEW ENTRY (called from TLForm.html, "New Entry" mode)
// =====================================================================
function submitNewEntry(form) {
  if (!form.entryDate) throw new Error('Date of Entry is required.');
  if (!form.fullName) throw new Error('Full Name is required.');
  if (!form.motherStore) throw new Error('Mother Store is required.');

  // Several phones can submit at nearly the same moment — a lock keeps
  // the duplicate-check-then-append below from racing another submit.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('The sheet is busy with another submission — please try again in a few seconds.');
  }

  try {
    const sheet = getSheet_();

    const entryDate = new Date(form.entryDate);
    const store = normalizeStore(form.motherStore);
    const name = toUpperSafe(form.fullName);

    // Guard against re-adding someone already open under the same store+date
    const existing = getOpenTLList().filter(t => t.key === makeKey_(name, store, entryDate));
    if (existing.length > 0) {
      throw new Error('This person already has an open PROBATIONARY/EXTENDED record for this store and entry date.');
    }

    const techGrades = [form.techValFp, form.techValPm, form.entryFoodPrepExam, form.entryPizzaMakerExam].map(v => v === '' ? '' : Number(v));
    const entryAverage = average_(techGrades.length ? techGrades : []);

    const hasUniform = form.uniformSize && UNIFORM_SIZES.indexOf(form.uniformSize) !== -1;
    const uniformQty = hasUniform ? (form.uniformQty ? Number(form.uniformQty) : 1) : 0;
    const uniformSummary = hasUniform
      ? uniformQty + ' ' + form.uniformSize + (form.uniformDr ? ' (DR#' + form.uniformDr + ')' : '')
      : '';

    const row = new Array(MASTER_LOG_LAST_COL).fill('');
    row[COL.TIMESTAMP - 1] = new Date();
    row[COL.ENTRY_DATE - 1] = entryDate;
    row[COL.BATCH - 1] = toUpperSafe(form.batch);
    row[COL.MOTHER_STORE - 1] = store;
    row[COL.FULL_NAME - 1] = name;
    row[COL.MOTHER_STATION - 1] = toUpperSafe(form.motherStation);
    row[COL.SUPPORT_STORE - 1] = normalizeStore(form.supportStore);
    row[COL.STATUS - 1] = 'PROBATIONARY';
    row[COL.UNIFORM_RELEASE - 1] = uniformSummary;
    row[COL.ENTRY_BY - 1] = toUpperSafe(form.entryBy);
    row[COL.ISTV_GRADE - 1] = toPercent(form.istvGrade);
    row[COL.TECHVAL_FP - 1] = toPercent(form.techValFp);
    row[COL.TECHVAL_PM - 1] = toPercent(form.techValPm);
    row[COL.ENTRY_FOOD_PREP - 1] = toPercent(form.entryFoodPrepExam);
    row[COL.ENTRY_PIZZA_MAKER - 1] = toPercent(form.entryPizzaMakerExam);
    row[COL.ENTRY_AVERAGE - 1] = entryAverage;
    row[COL.CERT_DEADLINE - 1] = addMonths(entryDate, 3);

    sheet.appendRow(row);

    // Give the initial uniform its own UNIFORM_LOG row too, so it shows up
    // in that person's uniform history alongside anything given out later.
    if (hasUniform) {
      const key = makeKey_(name, store, entryDate);
      const uSheet = getUniformSheet_();
      const uMap = getHeaderMap(uSheet);
      const uRow = new Array(uSheet.getLastColumn()).fill('');
      uRow[uMap['Timestamp']] = new Date();
      uRow[uMap['TL Key']] = key;
      uRow[uMap['Full Name']] = name;
      uRow[uMap['Mother Store']] = store;
      uRow[uMap['Size']] = form.uniformSize;
      uRow[uMap['Quantity']] = uniformQty;
      uRow[uMap['DR #']] = form.uniformDr || '';
      uRow[uMap['Given By']] = toUpperSafe(form.entryBy);
      uRow[uMap['Notes']] = 'Initial issue on entry';
      uSheet.appendRow(uRow);
    }

    return 'Saved: ' + name + ' (' + store + ') — deadline ' +
      Utilities.formatDate(addMonths(entryDate, 3), Session.getScriptTimeZone(), 'dd MMM yyyy');
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// CERTIFICATION / STATUS UPDATE (called from TLForm.html, "Certify / Update" mode)
// =====================================================================
function submitCertification(form) {
  if (!form.key) throw new Error('Please pick a trainee from the list.');
  if (STATUS_VALUES.indexOf(form.newStatus) === -1) throw new Error('Invalid status.');
  if (['CERTIFIED', 'FAILED', 'QUIT', 'DISQUALIFIED', 'PROMOTION'].indexOf(form.newStatus) !== -1 && !form.certBy) {
    throw new Error('Please record who certified/closed this (Cert By) before saving a final outcome.');
  }

  // Several phones can update at nearly the same moment — a lock keeps
  // the row lookup below from going stale between reading and writing.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('The sheet is busy with another submission — please try again in a few seconds.');
  }

  try {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues();

    let rowIndex = -1;
    for (let i = 0; i < data.length; i++) {
      const name = data[i][COL.FULL_NAME - 1];
      const store = data[i][COL.MOTHER_STORE - 1];
      const entryDate = data[i][COL.ENTRY_DATE - 1];
      if (makeKey_(name, store, entryDate) === form.key) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex === -1) throw new Error('Could not find that trainee — the sheet may have changed. Reopen the form and try again.');

    const sheetRow = rowIndex + 2; // +1 header, +1 to go from 0-based to 1-based

    // Uniform releases have their own "👕 Uniform" tab/action now (submitUniformRelease) —
    // that's what keeps size/qty/DR# queryable instead of piling into one text cell.

    sheet.getRange(sheetRow, COL.STATUS).setValue(form.newStatus);

    const certGrade = form.certGrade === '' ? '' : Number(form.certGrade) / 100;
    const examOnly = form.examGradeInput === '' ? '' : Number(form.examGradeInput) / 100;
    const finalAverage = average_([certGrade, examOnly].map(v => v === '' ? '' : v * 100)); // average_ expects raw numbers

    if (form.newStatus === 'CERTIFIED' || form.newStatus === 'PROMOTION') {
      if (form.certBy) sheet.getRange(sheetRow, COL.CERT_BY).setValue(toUpperSafe(form.certBy));
      sheet.getRange(sheetRow, COL.DATE_CERTIFIED).setValue(new Date());
      if (form.certGrade !== '') sheet.getRange(sheetRow, COL.CERT_GRADE).setValue(certGrade);
      if (form.examGradeInput !== '') sheet.getRange(sheetRow, COL.EXAM_GRADE).setValue(examOnly);
      if (finalAverage !== '') sheet.getRange(sheetRow, COL.AVERAGE).setValue(finalAverage / 100);
    }

    if (form.newStatus === 'EXTENDED') {
      const deadlineCell = sheet.getRange(sheetRow, COL.CERT_DEADLINE);
      if (form.deadlineOverride) {
        // User picked an exact new deadline instead of the +2 month default.
        deadlineCell.setValue(new Date(form.deadlineOverride));
      } else {
        const oldDeadline = deadlineCell.getValue();
        const base = (oldDeadline instanceof Date) ? oldDeadline : new Date(); // never blocks on a bad cell — falls back to today
        deadlineCell.setValue(addMonths(base, 2));
      }
      if (form.certBy) sheet.getRange(sheetRow, COL.CERT_BY).setValue(toUpperSafe(form.certBy));
      if (form.certGrade !== '') sheet.getRange(sheetRow, COL.CERT_GRADE).setValue(certGrade);
      if (form.examGradeInput !== '') sheet.getRange(sheetRow, COL.EXAM_GRADE).setValue(examOnly);
      if (finalAverage !== '') sheet.getRange(sheetRow, COL.AVERAGE).setValue(finalAverage / 100);
    }

    // FAILED / QUIT / DISQUALIFIED — still capture whatever grade was entered,
    // so the score that produced the outcome isn't lost in a side table.
    if (['FAILED', 'QUIT', 'DISQUALIFIED'].indexOf(form.newStatus) !== -1) {
      if (form.certBy) sheet.getRange(sheetRow, COL.CERT_BY).setValue(toUpperSafe(form.certBy));
      sheet.getRange(sheetRow, COL.DATE_CERTIFIED).setValue(new Date());
      if (form.certGrade !== '') sheet.getRange(sheetRow, COL.CERT_GRADE).setValue(certGrade);
      if (form.examGradeInput !== '') sheet.getRange(sheetRow, COL.EXAM_GRADE).setValue(examOnly);
      if (finalAverage !== '') sheet.getRange(sheetRow, COL.AVERAGE).setValue(finalAverage / 100);
    }

    if (form.finalStatus) {
      sheet.getRange(sheetRow, COL.FINAL_STATUS).setValue(toUpperSafe(form.finalStatus));
    }

    return 'Updated: row set to ' + form.newStatus;
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// ADMIN EDIT (called from TLForm.html, "🛠️ Admin" mode) — direct,
// unrestricted read/write of one MASTER_LOG row by its composite key,
// for correcting mistakes (typo'd name/store, wrong grade, etc.) that
// New Entry and Certify/Update don't cover since they're deliberately
// narrow (Certify only touches fields relevant to the status change
// being made). This bypasses those guardrails on purpose, so it's
// reachable from the app but not tied to a form workflow.
// =====================================================================

// Full raw record for one trainee, any status — unlike getTLDetails()
// (open trainees only, summary fields only), this returns every column
// in an edit-friendly shape for the Admin panel's form fields.
function getAdminRecordDetails(key) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const tz = Session.getScriptTimeZone();
  const data = sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues();

  const asDateInput = (v) => (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : '';

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (makeKey_(row[COL.FULL_NAME - 1], row[COL.MOTHER_STORE - 1], row[COL.ENTRY_DATE - 1]) === key) {
      return {
        key: key,
        entryDate: asDateInput(row[COL.ENTRY_DATE - 1]),
        batch: row[COL.BATCH - 1] || '',
        motherStore: row[COL.MOTHER_STORE - 1] || '',
        fullName: row[COL.FULL_NAME - 1] || '',
        motherStation: row[COL.MOTHER_STATION - 1] || '',
        supportStore: row[COL.SUPPORT_STORE - 1] || '',
        status: row[COL.STATUS - 1] || '',
        uniformRelease: row[COL.UNIFORM_RELEASE - 1] || '',
        entryBy: row[COL.ENTRY_BY - 1] || '',
        istvGrade: toDisplayPercent_(row[COL.ISTV_GRADE - 1]),
        techValFp: toDisplayPercent_(row[COL.TECHVAL_FP - 1]),
        techValPm: toDisplayPercent_(row[COL.TECHVAL_PM - 1]),
        entryFoodPrepExam: toDisplayPercent_(row[COL.ENTRY_FOOD_PREP - 1]),
        entryPizzaMakerExam: toDisplayPercent_(row[COL.ENTRY_PIZZA_MAKER - 1]),
        entryAverage: row[COL.ENTRY_AVERAGE - 1], // always raw 0-100 on this column, never a fraction — see toDisplayPercent_'s comment
        certDeadline: asDateInput(row[COL.CERT_DEADLINE - 1]),
        certBy: row[COL.CERT_BY - 1] || '',
        dateCertified: asDateInput(row[COL.DATE_CERTIFIED - 1]),
        certGrade: toDisplayPercent_(row[COL.CERT_GRADE - 1]),
        examGrade: toDisplayPercent_(row[COL.EXAM_GRADE - 1]),
        average: toDisplayPercent_(row[COL.AVERAGE - 1]),
        finalStatus: row[COL.FINAL_STATUS - 1] || ''
      };
    }
  }
  throw new Error('Could not find that trainee — the sheet may have changed. Reopen the form and try again.');
}

// Overwrites every editable column (B-W) of one MASTER_LOG row. Unlike
// submitNewEntry/submitCertification, every field is optional here and
// written exactly as given — this is for fixing what's already on file,
// not for the guarded new-record/status-change flows.
function submitAdminEdit(form) {
  if (!form.key) throw new Error('Please pick a record to edit.');
  if (!form.entryDate) throw new Error('Date of Entry is required.');
  if (!form.fullName) throw new Error('Full Name is required.');
  if (!form.motherStore) throw new Error('Mother Store is required.');
  if (STATUS_VALUES.indexOf(form.status) === -1) throw new Error('Invalid status.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('The sheet is busy with another submission — please try again in a few seconds.');
  }

  try {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues();

    let sheetRow = -1;
    for (let i = 0; i < data.length; i++) {
      if (makeKey_(data[i][COL.FULL_NAME - 1], data[i][COL.MOTHER_STORE - 1], data[i][COL.ENTRY_DATE - 1]) === form.key) {
        sheetRow = i + 2;
        break;
      }
    }
    if (sheetRow === -1) throw new Error('Could not find that trainee — the sheet may have changed. Reopen the form and try again.');

    const toDate = (v) => v ? new Date(v) : '';
    const toFractionOrBlank = (v) => (v === '' || v === null || v === undefined) ? '' : toPercent(v);

    const row = new Array(MASTER_LOG_LAST_COL).fill('');
    row[COL.ENTRY_DATE - 1] = toDate(form.entryDate);
    row[COL.BATCH - 1] = toUpperSafe(form.batch);
    row[COL.MOTHER_STORE - 1] = normalizeStore(form.motherStore);
    row[COL.FULL_NAME - 1] = toUpperSafe(form.fullName);
    row[COL.MOTHER_STATION - 1] = toUpperSafe(form.motherStation);
    row[COL.SUPPORT_STORE - 1] = normalizeStore(form.supportStore);
    row[COL.STATUS - 1] = form.status;
    row[COL.UNIFORM_RELEASE - 1] = form.uniformRelease || '';
    row[COL.ENTRY_BY - 1] = toUpperSafe(form.entryBy);
    row[COL.ISTV_GRADE - 1] = toFractionOrBlank(form.istvGrade);
    row[COL.TECHVAL_FP - 1] = toFractionOrBlank(form.techValFp);
    row[COL.TECHVAL_PM - 1] = toFractionOrBlank(form.techValPm);
    row[COL.ENTRY_FOOD_PREP - 1] = toFractionOrBlank(form.entryFoodPrepExam);
    row[COL.ENTRY_PIZZA_MAKER - 1] = toFractionOrBlank(form.entryPizzaMakerExam);
    row[COL.ENTRY_AVERAGE - 1] = form.entryAverage === '' ? '' : Number(form.entryAverage); // raw scale — see getAdminRecordDetails
    row[COL.CERT_DEADLINE - 1] = toDate(form.certDeadline);
    row[COL.CERT_BY - 1] = toUpperSafe(form.certBy);
    row[COL.DATE_CERTIFIED - 1] = toDate(form.dateCertified);
    row[COL.CERT_GRADE - 1] = toFractionOrBlank(form.certGrade);
    row[COL.EXAM_GRADE - 1] = toFractionOrBlank(form.examGrade);
    row[COL.AVERAGE - 1] = toFractionOrBlank(form.average);
    row[COL.FINAL_STATUS - 1] = toUpperSafe(form.finalStatus);

    // Column A (Timestamp) is left untouched — it records when the row
    // was first created, not when it was last edited.
    sheet.getRange(sheetRow, 2, 1, MASTER_LOG_LAST_COL - 1).setValues([row.slice(1)]);

    return 'Saved changes to ' + row[COL.FULL_NAME - 1] + ' (' + row[COL.MOTHER_STORE - 1] + ').';
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// UNIFORM RELEASE (called from TLForm.html, "👕 Uniform" mode)
// =====================================================================
function submitUniformRelease(form) {
  if (!form.key) throw new Error('Please pick a trainee.');
  if (UNIFORM_SIZES.indexOf(form.size) === -1) throw new Error('Please pick a valid size.');
  if (!form.givenBy) throw new Error('Please record who gave the uniform (Given By).');
  const qty = form.quantity ? Number(form.quantity) : 1;
  if (!qty || qty < 1) throw new Error('Quantity must be at least 1.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('The sheet is busy with another submission — please try again in a few seconds.');
  }

  try {
    const found = findMasterRowByKey_(form.key);

    // One row per piece handed out, in its own log.
    const uSheet = getUniformSheet_();
    const uMap = getHeaderMap(uSheet);
    const uRow = new Array(uSheet.getLastColumn()).fill('');
    uRow[uMap['Timestamp']] = new Date();
    uRow[uMap['TL Key']] = form.key;
    uRow[uMap['Full Name']] = found.name;
    uRow[uMap['Mother Store']] = found.store;
    uRow[uMap['Size']] = form.size;
    uRow[uMap['Quantity']] = qty;
    uRow[uMap['DR #']] = form.drNumber || '';
    uRow[uMap['Given By']] = toUpperSafe(form.givenBy);
    uRow[uMap['Notes']] = form.notes || '';
    uSheet.appendRow(uRow);

    // Roll a compact summary into MASTER_LOG's Uniform Release cell too, so
    // a glance at the main log still shows the latest without opening UNIFORM_LOG.
    const summary = qty + ' ' + form.size + (form.drNumber ? ' (DR#' + form.drNumber + ')' : '');
    const cell = found.sheet.getRange(found.sheetRow, COL.UNIFORM_RELEASE);
    const existing = cell.getValue().toString().trim();
    cell.setValue(existing ? existing + ' | ' + summary : summary);

    return 'Logged ' + qty + ' ' + form.size + ' for ' + found.name + '.';
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// UNIFORM DELIVERY (called from TLForm.html, "📦 Stock" mode) — stock
// coming IN from the supplier, separate from UNIFORM_LOG (stock going OUT
// to trainees), so on-hand can be computed instead of guessed.
// =====================================================================
function submitUniformDelivery(form) {
  if (UNIFORM_SIZES.indexOf(form.size) === -1) throw new Error('Please pick a valid size.');
  const qty = form.quantity ? Number(form.quantity) : 0;
  if (!qty || qty < 1) throw new Error('Quantity received must be at least 1.');
  if (!form.loggedBy) throw new Error('Please record who logged this delivery.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('The sheet is busy with another submission — please try again in a few seconds.');
  }

  try {
    const sheet = getUniformInventorySheet_();
    const map = getHeaderMap(sheet);
    const row = new Array(sheet.getLastColumn()).fill('');
    row[map['Timestamp']] = new Date();
    row[map['Size']] = form.size;
    row[map['Qty Received']] = qty;
    row[map['Delivery Ref']] = form.deliveryRef || '';
    row[map['Logged By']] = toUpperSafe(form.loggedBy);
    sheet.appendRow(row);

    return 'Logged delivery: ' + qty + ' ' + form.size + '.';
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// STORE SUMMARY — computed in script instead of a fragile formula
// (this is what a broken #ERROR! cell usually comes from)
// =====================================================================
function refreshStoreSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('No data yet.');
    return;
  }
  const data = sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues();

  const perStoreActive = {};
  const statusCounts = {};
  STATUS_VALUES.forEach(s => statusCounts[s] = 0);

  data.forEach(row => {
    const store = normalizeStore(row[COL.MOTHER_STORE - 1]);
    const status = toUpperSafe(row[COL.STATUS - 1]);
    if (!store) return;
    if (statusCounts[status] !== undefined) statusCounts[status]++;
    if (OPEN_STATUSES.indexOf(status) !== -1 || status === 'CERTIFIED') {
      perStoreActive[store] = (perStoreActive[store] || 0) + 1;
    }
  });

  // Tab name lookup is case-sensitive, and some copies of this sheet have it
  // as "SUMMARY" (all caps) rather than "Summary" — check both before
  // creating a brand-new tab and leaving a stale duplicate behind.
  let summarySheet = findSheetByCandidates_(ss, ['Summary', 'SUMMARY']);
  if (!summarySheet) summarySheet = ss.insertSheet('Summary');
  summarySheet.clear();

  summarySheet.getRange(1, 1, 1, 2).setValues([['STORE', 'ACTIVE TL']]).setFontWeight('bold');
  const storeRows = Object.keys(perStoreActive).sort().map(s => [s, perStoreActive[s]]);
  if (storeRows.length) summarySheet.getRange(2, 1, storeRows.length, 2).setValues(storeRows);

  summarySheet.getRange(1, 4, 1, 2).setValues([['STATUS', 'COUNT']]).setFontWeight('bold');
  const statusRows = STATUS_VALUES.map(s => [s, statusCounts[s]]);
  summarySheet.getRange(2, 4, statusRows.length, 2).setValues(statusRows);
  summarySheet.getRange(2 + statusRows.length, 4, 1, 2).setValues([['TOTAL', data.length]]);

  // Uniform pieces given out, by size — pulled from UNIFORM_LOG instead of
  // hand-tallied, so it can't drift out of sync the way a manual table would.
  const uSheet = ss.getSheetByName(UNIFORM_SHEET_NAME);
  if (uSheet) {
    const uMap = getHeaderMap(uSheet);
    const uLastRow = uSheet.getLastRow();
    const sizeCounts = {};
    UNIFORM_SIZES.forEach(s => sizeCounts[s] = 0);
    let totalPieces = 0;
    if (uLastRow >= 2) {
      uSheet.getRange(2, 1, uLastRow - 1, uSheet.getLastColumn()).getValues().forEach(row => {
        const size = toUpperSafe(row[uMap['Size']]);
        const qty = Number(row[uMap['Quantity']]) || 0;
        if (sizeCounts[size] !== undefined) sizeCounts[size] += qty;
        totalPieces += qty;
      });
    }
    summarySheet.getRange(1, 7, 1, 2).setValues([['UNIFORM SIZE', 'PIECES GIVEN']]).setFontWeight('bold');
    const sizeRows = UNIFORM_SIZES.map(s => [s, sizeCounts[s]]);
    summarySheet.getRange(2, 7, sizeRows.length, 2).setValues(sizeRows);
    summarySheet.getRange(2 + sizeRows.length, 7, 1, 2).setValues([['TOTAL', totalPieces]]);

    // Stock on hand by size — Delivered (UNIFORM_INVENTORY) minus Issued (UNIFORM_LOG).
    const stock = getInventorySummary();
    summarySheet.getRange(1, 10, 1, 4).setValues([['UNIFORM SIZE', 'DELIVERED', 'ISSUED', 'ON HAND']]).setFontWeight('bold');
    const stockRows = stock.map(s => [s.size, s.delivered, s.issued, s.onHand]);
    summarySheet.getRange(2, 10, stockRows.length, 4).setValues(stockRows);
    const totalDelivered = stock.reduce((a, s) => a + s.delivered, 0);
    const totalIssued = stock.reduce((a, s) => a + s.issued, 0);
    summarySheet.getRange(2 + stockRows.length, 10, 1, 4).setValues([['TOTAL', totalDelivered, totalIssued, totalDelivered - totalIssued]]);

    // DR # by store — pulled straight from UNIFORM_LOG's own DR # column
    // (a dedicated field now, not text buried in a free-form cell), so this
    // list can't drift out of sync with what was actually logged.
    const drByStore = {};
    if (uLastRow >= 2) {
      uSheet.getRange(2, 1, uLastRow - 1, uSheet.getLastColumn()).getValues().forEach(row => {
        const store = normalizeStore(row[uMap['Mother Store']]);
        const dr = row[uMap['DR #']] ? row[uMap['DR #']].toString().trim() : '';
        if (!store || !dr) return;
        if (!drByStore[store]) drByStore[store] = [];
        if (drByStore[store].indexOf(dr) === -1) drByStore[store].push(dr);
      });
    }
    summarySheet.getRange(1, 15, 1, 2).setValues([['STORE', 'DR #S']]).setFontWeight('bold');
    const drRows = Object.keys(drByStore).sort().map(s => [s, drByStore[s].join(' | ')]);
    if (drRows.length) summarySheet.getRange(2, 15, drRows.length, 2).setValues(drRows);
  }

  SpreadsheetApp.getUi().alert('Store summary refreshed on the "Summary" tab.');
}

// =====================================================================
// ONE-TIME MIGRATION — pulls the old sheet's separate probationary/
// certified log tabs into MASTER_LOG under this script's own headers,
// so New Entry / Certify / Reports / Monitoring all see real history
// instead of starting from an empty sheet.
//
// Safe to run more than once: every row it's about to add is checked
// against MASTER_LOG's existing Full Name + Mother Store + Date of
// Entry (the same composite key submitNewEntry/submitCertification
// use) and skipped if already present — so re-running after a partial
// run, or after the source tabs changed, never duplicates anyone.
// It only ever APPENDS to MASTER_LOG; the source tabs are never
// edited or deleted.
// =====================================================================

// Case/whitespace-tolerant header map for a source tab whose exact
// header spelling isn't guaranteed — trims like getHeaderMap, but also
// keys everything uppercase so callers can match without worrying
// about "Full name" vs "FULL NAME" vs a trailing space.
function getHeaderMapCI_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const key = h.toString().trim().toUpperCase();
    if (key) map[key] = i;
  });
  return map;
}

// Reads one cell from a source row by trying a list of candidate header
// names (in order) against a case-insensitive header map — tolerates
// the source tab spelling a header slightly differently than expected.
function pickCell_(row, ciMap, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const idx = ciMap[candidates[i].toUpperCase()];
    if (idx != null) return row[idx];
  }
  return '';
}

// Finds the first sheet in this spreadsheet whose name matches one of
// several candidate spellings — the exact tab name in a given copy of
// this sheet isn't always the same (e.g. "PROBATIONARY" vs
// "PROBATIONARY LOG").
function findSheetByCandidates_(ss, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const sheet = ss.getSheetByName(candidates[i]);
    if (sheet) return sheet;
  }
  return null;
}

// A date cell from the old sheet may already be a real Date (most
// likely, if Sheets auto-parsed it on entry) or plain text like
// "11 Feb 2026" — handle both, and never throw on a bad/blank cell.
function parseDateCell_(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// The old sheet's grade cells show up as "89%" text, a 0-1 fraction, or
// a bare 89 depending on how they were typed — normalize all three to
// the fraction MASTER_LOG's percent-formatted columns expect, or to the
// raw 0-100 scale for the one column (TL Entry Average) this script has
// always stored unscaled. Never throws on blank/unparseable input.
function gradeForStorage_(value, keepRaw) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value.toString().replace('%', '').trim());
  if (isNaN(num)) return '';
  const fraction = num > 1 ? num / 100 : num; // "89" or "89%" -> 0.89; already-0.89 passes through
  return keepRaw ? Math.round(fraction * 10000) / 100 : Math.round(fraction * 10000) / 10000;
}

// NOTE: as of the real MASTER_LOG audit, this function's original premise
// (MASTER_LOG needs backfilling from PROBATIONARY/CERTIFIED) is likely
// moot — the real MASTER_LOG already holds all ~270 real people. Left in
// place because it's harmless and idempotent (every row is checked
// against MASTER_LOG's existing composite key and skipped if present),
// so running it again costs nothing if it turns out there's nobody left
// to add. Its target-write side below now uses COL (fixed position),
// same as the rest of this file; its source-read side still uses
// getHeaderMapCI_/pickCell_ because PROBATIONARY/CERTIFIED are different
// tabs with their own header text, unrelated to MASTER_LOG's.
function migrateLegacyLogs() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const probSheet = findSheetByCandidates_(ss, ['PROBATIONARY', 'PROBATIONARY LOG']);
  const certSheet = findSheetByCandidates_(ss, ['CERTIFIED', 'CERTIFIED LOG', 'CERTIFICATION LOG']);

  if (!probSheet && !certSheet) {
    ui.alert('Nothing to migrate', 'Couldn\'t find a tab named "PROBATIONARY" or "CERTIFIED" (or "...LOG") in this spreadsheet. If your legacy tabs use different names, tell Claude the exact names and this function can be adjusted.', ui.ButtonSet.OK);
    return;
  }

  const resp = ui.alert(
    'Migrate legacy logs into MASTER_LOG?',
    'Found: ' + (probSheet ? '"' + probSheet.getName() + '" ' : '(no probationary tab) ') +
    (certSheet ? 'and "' + certSheet.getName() + '"' : '(no certified tab)') +
    '.\n\nThis will APPEND every row from those tabs into MASTER_LOG. It never edits or deletes the source tabs, and skips anyone already in MASTER_LOG. Continue?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const masterSheet = getSheet_();
  const masterLastRow = masterSheet.getLastRow();

  const existingKeys = {};
  if (masterLastRow >= 2) {
    masterSheet.getRange(2, 1, masterLastRow - 1, MASTER_LOG_LAST_COL).getValues().forEach(row => {
      const name = row[COL.FULL_NAME - 1];
      if (!name) return;
      existingKeys[makeKey_(name, row[COL.MOTHER_STORE - 1], row[COL.ENTRY_DATE - 1])] = true;
    });
  }

  let added = 0, skipped = 0, blankRows = 0;
  const newRows = [];

  if (probSheet) {
    const ciMap = getHeaderMapCI_(probSheet);
    const lastRow = probSheet.getLastRow();
    if (lastRow >= 2) {
      probSheet.getRange(2, 1, lastRow - 1, probSheet.getLastColumn()).getValues().forEach(srcRow => {
        const name = pickCell_(srcRow, ciMap, ['Full name', 'Full Name']);
        if (!name) { blankRows++; return; }
        const entryDate = parseDateCell_(pickCell_(srcRow, ciMap, ['Date of Entry']));
        const store = pickCell_(srcRow, ciMap, ['Mother Store']);
        const key = makeKey_(name, store, entryDate);
        if (existingKeys[key]) { skipped++; return; }
        existingKeys[key] = true;

        const row = new Array(MASTER_LOG_LAST_COL).fill('');
        row[COL.TIMESTAMP - 1] = new Date();
        row[COL.ENTRY_DATE - 1] = entryDate || '';
        row[COL.BATCH - 1] = toUpperSafe(pickCell_(srcRow, ciMap, ['Batch #']));
        row[COL.MOTHER_STORE - 1] = normalizeStore(store);
        row[COL.FULL_NAME - 1] = name;
        row[COL.MOTHER_STATION - 1] = toUpperSafe(pickCell_(srcRow, ciMap, ['Mother Station']));
        row[COL.SUPPORT_STORE - 1] = normalizeStore(pickCell_(srcRow, ciMap, ['Support Store']));
        row[COL.STATUS - 1] = toUpperSafe(pickCell_(srcRow, ciMap, ['Result']));
        row[COL.UNIFORM_RELEASE - 1] = pickCell_(srcRow, ciMap, ['Uniform Release']);
        row[COL.ENTRY_BY - 1] = toUpperSafe(pickCell_(srcRow, ciMap, ['Entry By']));
        row[COL.ISTV_GRADE - 1] = gradeForStorage_(pickCell_(srcRow, ciMap, ['ISTV Grade']), false);
        row[COL.TECHVAL_FP - 1] = gradeForStorage_(pickCell_(srcRow, ciMap, ['TechVal FP']), false);
        row[COL.TECHVAL_PM - 1] = gradeForStorage_(pickCell_(srcRow, ciMap, ['TechVal PM']), false);
        row[COL.ENTRY_FOOD_PREP - 1] = gradeForStorage_(pickCell_(srcRow, ciMap, ['TL-Entry Food Prep Exam']), false);
        row[COL.ENTRY_PIZZA_MAKER - 1] = gradeForStorage_(pickCell_(srcRow, ciMap, ['TL-Entry Pizza Maker Exam']), false);
        row[COL.ENTRY_AVERAGE - 1] = gradeForStorage_(pickCell_(srcRow, ciMap, ['TL Entry Average']), false);
        const deadline = parseDateCell_(pickCell_(srcRow, ciMap, ['Certification Deadline']));
        if (deadline) row[COL.CERT_DEADLINE - 1] = deadline;
        newRows.push(row);
        added++;
      });
    }
  }

  if (certSheet) {
    const ciMap = getHeaderMapCI_(certSheet);
    const lastRow = certSheet.getLastRow();
    if (lastRow >= 2) {
      certSheet.getRange(2, 1, lastRow - 1, certSheet.getLastColumn()).getValues().forEach(srcRow => {
        const name = pickCell_(srcRow, ciMap, ['Full name', 'Full Name']);
        if (!name) { blankRows++; return; }
        const entryDate = parseDateCell_(pickCell_(srcRow, ciMap, ['Date of Entry']));
        const store = pickCell_(srcRow, ciMap, ['Mother Store']);
        const key = makeKey_(name, store, entryDate);
        if (existingKeys[key]) { skipped++; return; }
        existingKeys[key] = true;

        const row = new Array(MASTER_LOG_LAST_COL).fill('');
        row[COL.TIMESTAMP - 1] = new Date();
        row[COL.ENTRY_DATE - 1] = entryDate || '';
        row[COL.BATCH - 1] = toUpperSafe(pickCell_(srcRow, ciMap, ['Batch #']));
        row[COL.MOTHER_STORE - 1] = normalizeStore(store);
        row[COL.FULL_NAME - 1] = name;
        row[COL.MOTHER_STATION - 1] = toUpperSafe(pickCell_(srcRow, ciMap, ['Mother Station']));
        row[COL.SUPPORT_STORE - 1] = normalizeStore(pickCell_(srcRow, ciMap, ['Support Store']));
        row[COL.STATUS - 1] = toUpperSafe(pickCell_(srcRow, ciMap, ['Result']));
        row[COL.UNIFORM_RELEASE - 1] = pickCell_(srcRow, ciMap, ['Uniform Release']);
        row[COL.CERT_BY - 1] = toUpperSafe(pickCell_(srcRow, ciMap, ['Cert By:', 'Cert By']));
        const dateCertified = parseDateCell_(pickCell_(srcRow, ciMap, ['Date Certified']));
        if (dateCertified) row[COL.DATE_CERTIFIED - 1] = dateCertified;
        row[COL.CERT_GRADE - 1] = gradeForStorage_(pickCell_(srcRow, ciMap, ['Certfication Grade', 'Certification Grade']), false);
        row[COL.EXAM_GRADE - 1] = gradeForStorage_(pickCell_(srcRow, ciMap, ['Exam Grade']), false);
        row[COL.AVERAGE - 1] = gradeForStorage_(pickCell_(srcRow, ciMap, ['Average']), false);
        row[COL.FINAL_STATUS - 1] = toUpperSafe(pickCell_(srcRow, ciMap, ['Signed Appointment Letter']));
        newRows.push(row);
        added++;
      });
    }
  }

  if (newRows.length) {
    masterSheet.getRange(masterSheet.getLastRow() + 1, 1, newRows.length, MASTER_LOG_LAST_COL).setValues(newRows);
  }

  ui.alert(
    'Migration finished',
    'Added ' + added + ' row(s) to MASTER_LOG.' +
    (skipped ? ' Skipped ' + skipped + ' already present.' : '') +
    (blankRows ? ' Skipped ' + blankRows + ' blank/placeholder row(s) with no name.' : '') +
    '\n\nSpot-check a few rows in MASTER_LOG before relying on Reports/Monitoring — this is a best-effort column mapping off text-based headers, not a guaranteed 1:1 copy.',
    ui.ButtonSet.OK
  );
}

// =====================================================================
// AUDIT & FIX MASTER_LOG — a one-time pass for a specific set of
// data-quality issues found by inspecting a real export of this sheet.
//
// Reads/writes by fixed column position (COL), same as the rest of this
// file — MASTER_LOG's real header row text is inconsistent enough (a
// blank cell, trailing spaces, a typo, a stray colon — see the file
// header comment) that this used to go by case-insensitive header text
// instead; now that COL is the standard everywhere, this uses it too.
//
// Splits findings into two buckets:
//   - Mechanical fixes (no judgment call) are applied automatically
//     once you confirm: a repeated Batch # typo, dates that got stored
//     as literal serial-number text instead of a real date, and a
//     grade cell that held the word "PENDING" instead of a number.
//   - Everything else (a blank Mother Store, an ambiguous Batch #, a
//     status value the new form's dropdown doesn't list) is only
//     reported — never guessed at — because a value going in needs a
//     human decision, not this script's assumption.
// Rows are matched by Full Name + Date of Entry, not row number, so
// this stays correct even if rows get sorted/reordered later. Safe to
// run more than once: anything already fixed is simply skipped.
// =====================================================================

// A bare number (or "12345.0") stored as TEXT in a date column is
// almost always a Sheets/Excel date serial that failed to land as a
// real date — day 0 is Dec 30, 1899, the same epoch Sheets itself
// uses. Falls back to normal date parsing for anything else (e.g. the
// plain string "8/20/26").
function parseFlexibleDate_(value) {
  if (value instanceof Date) return value;
  if (value === '' || value === null || value === undefined) return null;
  const str = value.toString().trim();
  if (str === '') return null;
  const asNumber = Number(str);
  if (!isNaN(asNumber)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + Math.round(asNumber) * 86400000);
  }
  const asDate = new Date(str);
  return isNaN(asDate.getTime()) ? null : asDate;
}

// Collapses "Certification Deadline stored as text (\"46273\") -> real date"
// down to one bucket regardless of which value each row had, so the
// confirmation dialog shows counts per fix TYPE, not one line per row.
function summarizeFixLabels_(fixable) {
  const counts = {};
  fixable.forEach(f => {
    const key = f.label.replace(/"[^"]*"/g, '"..."');
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.keys(counts).map(k => '- ' + k + ' (' + counts[k] + 'x)').join('\n');
}

function auditAndFixMasterLog() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) { ui.alert('No "' + SHEET_NAME + '" tab found.'); return; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { ui.alert('MASTER_LOG has no data rows yet.'); return; }

  // 0-based indices into each data row (COL is 1-based, for getRange).
  const nameCol = COL.FULL_NAME - 1;
  const entryCol = COL.ENTRY_DATE - 1;
  const batchCol = COL.BATCH - 1;
  const deadlineCol = COL.CERT_DEADLINE - 1;
  const dateCertCol = COL.DATE_CERTIFIED - 1;
  const istvCol = COL.ISTV_GRADE - 1;
  const storeCol = COL.MOTHER_STORE - 1;
  const supportCol = COL.SUPPORT_STORE - 1;
  const finalStatusCol = COL.FINAL_STATUS - 1;

  const data = sheet.getRange(2, 1, lastRow - 1, MASTER_LOG_LAST_COL).getValues();
  const tz = Session.getScriptTimeZone();

  const fixable = [];   // {sheetRow, col (1-based), newValue, label, who}
  const flagged = [];   // {who, issue}
  const KNOWN_FINAL_STATUS = ['SIGNED', 'AGENCY', 'FOR REPORTING', 'ON-GOING PROMOTION', 'NOT RETURNED'];

  data.forEach((row, i) => {
    const sheetRow = i + 2;
    const name = row[nameCol];
    if (!name) return;
    const entryVal = row[entryCol];
    const who = name + ' (entry ' + (entryVal instanceof Date ? Utilities.formatDate(entryVal, tz, 'dd MMM yyyy') : entryVal) + ')';

    // 1. Batch # typo / wrong type / ambiguous variant
    if (batchCol != null) {
      const batch = row[batchCol];
      if (!batch) {
        flagged.push({ who: who, issue: 'Batch # is blank' });
      } else {
        const batchStr = batch.toString().trim();
        if (batchStr.toUpperCase() === 'BACTH 10') {
          fixable.push({ sheetRow: sheetRow, col: batchCol + 1, newValue: 'BATCH 10', label: 'Batch # typo "BACTH 10" -> "BATCH 10"', who: who });
        } else if (/^\d+$/.test(batchStr)) {
          fixable.push({ sheetRow: sheetRow, col: batchCol + 1, newValue: 'BATCH ' + batchStr, label: 'Batch # stored as a bare number ("' + batchStr + '") -> "BATCH ' + batchStr + '"', who: who });
        } else if (batchStr.toUpperCase().indexOf('SPECIAL') === 0 && batchStr.toUpperCase() !== 'SPECIAL') {
          flagged.push({ who: who, issue: 'Batch # is "' + batchStr + '" — confirm this is intentional, not a typo of "SPECIAL"' });
        }
      }
    }

    // 2. Certification Deadline / Date Certified stored as text instead of a real date
    [['Certification Deadline', deadlineCol], ['Date Certified', dateCertCol]].forEach(pair => {
      const label = pair[0], col = pair[1];
      if (col == null) return;
      const val = row[col];
      if (val && !(val instanceof Date)) {
        const parsed = parseFlexibleDate_(val);
        if (parsed) {
          fixable.push({ sheetRow: sheetRow, col: col + 1, newValue: parsed, label: label + ' stored as text ("' + val + '") -> real date', who: who });
        } else {
          flagged.push({ who: who, issue: label + ' has an unparseable value: "' + val + '"' });
        }
      }
    });

    // 3. ISTV Grade holding non-numeric placeholder text (e.g. "PENDING")
    if (istvCol != null) {
      const istv = row[istvCol];
      if (istv && typeof istv !== 'number') {
        fixable.push({ sheetRow: sheetRow, col: istvCol + 1, newValue: '', label: 'ISTV Grade held text ("' + istv + '") instead of a number -> cleared to blank', who: who });
      }
    }

    // 4. Blank Mother Store
    if (storeCol != null && !row[storeCol]) {
      const supportVal = supportCol != null ? row[supportCol] : '';
      flagged.push({ who: who, issue: 'Mother Store is blank' + (supportVal ? ' (Support Store says "' + supportVal + '" — check whether that belongs in Mother Store instead)' : '') });
    }

    // 5. Final Status value the new form's dropdown doesn't offer
    if (finalStatusCol != null) {
      const finalStatus = row[finalStatusCol];
      if (finalStatus && KNOWN_FINAL_STATUS.indexOf(finalStatus.toString().trim().toUpperCase()) === -1
          && finalStatus.toString().trim().toUpperCase() !== 'NEW ENTRY') {
        flagged.push({ who: who, issue: 'Final Status is "' + finalStatus + '" — not one of the options TLForm\'s dropdown offers (' + KNOWN_FINAL_STATUS.join(', ') + ')' });
      }
    }
  });

  if (!fixable.length && !flagged.length) {
    ui.alert('No issues found — MASTER_LOG looks clean.');
    return;
  }

  let msg = '';
  if (fixable.length) {
    msg += fixable.length + ' fixable issue(s) will be corrected automatically:\n' + summarizeFixLabels_(fixable) + '\n\n';
  }
  if (flagged.length) {
    msg += flagged.length + ' issue(s) need a human decision and will only be reported, not changed:\n' +
      flagged.slice(0, 15).map(f => '- ' + f.who + ': ' + f.issue).join('\n') +
      (flagged.length > 15 ? '\n...and ' + (flagged.length - 15) + ' more (full list in the finishing alert).' : '');
  }

  if (!fixable.length) {
    ui.alert('Audit & Fix MASTER_LOG', 'Nothing auto-fixable found.\n\n' + msg, ui.ButtonSet.OK);
    return;
  }

  const resp = ui.alert('Audit & Fix MASTER_LOG', msg + '\n\nApply the fixable corrections now?', ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) {
    ui.alert('No changes made.' + (flagged.length ? ' The ' + flagged.length + ' flagged issue(s) above still need manual review.' : ''));
    return;
  }

  fixable.forEach(f => {
    sheet.getRange(f.sheetRow, f.col).setValue(f.newValue);
  });

  ui.alert(
    'Done',
    'Applied ' + fixable.length + ' fix(es) to MASTER_LOG.' +
    (flagged.length ? '\n\n' + flagged.length + ' issue(s) still need manual review:\n' + flagged.map(f => '- ' + f.who + ': ' + f.issue).join('\n') : ''),
    ui.ButtonSet.OK
  );
}
