/**
 * TL TRACKER — Team Leader Monitoring
 * Rebuilt version with HTML forms for data entry.
 *
 * WHAT THIS FIXES vs. the old script pasted in the sheet:
 *  1. Writes by HEADER NAME, not fixed column letters — a reordered/added
 *     column no longer silently corrupts data.
 *  2. Deadlines are always real Date objects computed in script
 *     (Date of Entry + 3 months on entry, +2 months on each EXTEND) —
 *     this is what stops the "4627300%" style corruption, which happens
 *     when a date serial number lands in a percent-formatted text cell.
 *  3. Duplicate lookup uses Full Name + Mother Store + Date of Entry
 *     together, not name alone — two people who share a name, or one
 *     person re-entering after quitting, no longer collide.
 *  4. FAILED / QUIT / DISQUALIFIED still save whatever grade was entered,
 *     so the outcome and the score that produced it live in one place.
 *  5. Store names are normalized (trim, collapse spaces, uppercase) on
 *     every save, so "PETRON" and "PETRON " (or "DONA"/"DOÑA SOLEDAD")
 *     can't split into two different stores in your summaries.
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
 *  of the tabs below automatically. If you're setting up by hand instead,
 *  match these header rows exactly (order doesn't matter — the script
 *  looks columns up by name — but every name must be present):
 *
 *  MASTER_LOG:
 *   Timestamp | Date of Entry | Batch # | Mother Store | Full Name |
 *   Mother Station | Support Store | Status | Uniform Release |
 *   Entry By | ISTV Grade | TechVal FP | TechVal PM |
 *   TL-Entry Food Prep Exam | TL-Entry Pizza Maker Exam |
 *   TL Entry Average | Certification Deadline | Cert By |
 *   Date Certified | Certification Grade | Exam Grade | Average |
 *   Final Status
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

  const headers = [
    'Timestamp', 'Date of Entry', 'Batch #', 'Mother Store', 'Full Name',
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
  const headerMap = getHeaderMap(sheet);
  if (headerMap['Status'] != null) {
    const statusCol = headerMap['Status'] + 1;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(STATUS_VALUES, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, statusCol, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  }
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
  const map = getHeaderMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Could not find that trainee — the sheet may have changed. Reopen the form and try again.');
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < data.length; i++) {
    const name = data[i][map['Full Name']];
    const store = data[i][map['Mother Store']];
    const entryDate = data[i][map['Date of Entry']];
    if (makeKey_(name, store, entryDate) === key) {
      return { sheet: sheet, map: map, sheetRow: i + 2, name: name, store: normalizeStore(store) };
    }
  }
  throw new Error('Could not find that trainee — the sheet may have changed. Reopen the form and try again.');
}

// =====================================================================
// DROPDOWN DATA FOR THE HTML FORMS
// =====================================================================
function getStoreList() {
  const sheet = getSheet_();
  const map = getHeaderMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || map['Mother Store'] == null) return [];
  const values = sheet.getRange(2, map['Mother Store'] + 1, lastRow - 1, 1).getValues();
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
  const map = getHeaderMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const result = [];
  data.forEach(row => {
    const status = toUpperSafe(row[map['Status']]);
    if (OPEN_STATUSES.indexOf(status) === -1) return;
    const name = row[map['Full Name']];
    const store = row[map['Mother Store']];
    const entryDate = row[map['Date of Entry']];
    result.push({
      key: makeKey_(name, store, entryDate),
      label: name + ' — ' + normalizeStore(store) + ' (' + status + ')',
      status: status
    });
  });
  return result;
}

// Everyone in MASTER_LOG regardless of status, for the Uniform tab's picker —
// uniforms get handed out to certified TLs too, not just open trainees.
function getAllTLList() {
  const sheet = getSheet_();
  const map = getHeaderMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return data.map(row => {
    const name = row[map['Full Name']];
    const store = row[map['Mother Store']];
    const entryDate = row[map['Date of Entry']];
    const status = toUpperSafe(row[map['Status']]);
    if (!name) return null;
    return {
      key: makeKey_(name, store, entryDate),
      label: name + ' — ' + normalizeStore(store) + ' (' + status + ')'
    };
  }).filter(x => x);
}

function distinctColumnValues_(headerName) {
  const sheet = getSheet_();
  const map = getHeaderMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || map[headerName] == null) return [];
  const values = sheet.getRange(2, map[headerName] + 1, lastRow - 1, 1).getValues();
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
  return distinctColumnValues_('Mother Station');
}

function getBatchList() {
  return distinctColumnValues_('Batch #');
}

// Trainer initials/names pulled from what's actually been typed into
// Entry By / Cert By so far — no hardcoded roster to keep in sync.
function getTrainerList() {
  const entryBy = distinctColumnValues_('Entry By');
  const certBy = distinctColumnValues_('Cert By');
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
    inventorySummary: getInventorySummary()
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
  const map = getHeaderMap(sheet);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (makeKey_(row[map['Full Name']], row[map['Mother Store']], row[map['Date of Entry']]) === key) {
      const deadline = row[map['Certification Deadline']];
      const tz = Session.getScriptTimeZone();
      return {
        fullName: row[map['Full Name']],
        motherStore: normalizeStore(row[map['Mother Store']]),
        motherStation: row[map['Mother Station']],
        status: toUpperSafe(row[map['Status']]),
        uniformRelease: row[map['Uniform Release']],
        currentDeadline: (deadline instanceof Date) ? Utilities.formatDate(deadline, tz, 'dd MMM yyyy') : '(not a valid date on file)',
        nextExtendedDeadline: (deadline instanceof Date) ? Utilities.formatDate(addMonths(deadline, 2), tz, 'dd MMM yyyy') : '(will default to today + 2 months)',
        tlEntryAverage: row[map['TL Entry Average']],
        istvGrade: row[map['ISTV Grade']]
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
    const map = getHeaderMap(sheet);

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

    const row = new Array(sheet.getLastColumn()).fill('');
    row[map['Timestamp']] = new Date();
    row[map['Date of Entry']] = entryDate;
    row[map['Batch #']] = toUpperSafe(form.batch);
    row[map['Mother Store']] = store;
    row[map['Full Name']] = name;
    row[map['Mother Station']] = toUpperSafe(form.motherStation);
    row[map['Support Store']] = normalizeStore(form.supportStore);
    row[map['Status']] = 'PROBATIONARY';
    row[map['Uniform Release']] = uniformSummary;
    row[map['Entry By']] = toUpperSafe(form.entryBy);
    row[map['ISTV Grade']] = toPercent(form.istvGrade);
    row[map['TechVal FP']] = toPercent(form.techValFp);
    row[map['TechVal PM']] = toPercent(form.techValPm);
    row[map['TL-Entry Food Prep Exam']] = toPercent(form.entryFoodPrepExam);
    row[map['TL-Entry Pizza Maker Exam']] = toPercent(form.entryPizzaMakerExam);
    row[map['TL Entry Average']] = entryAverage;
    row[map['Certification Deadline']] = addMonths(entryDate, 3);

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
    const map = getHeaderMap(sheet);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    let rowIndex = -1;
    for (let i = 0; i < data.length; i++) {
      const name = data[i][map['Full Name']];
      const store = data[i][map['Mother Store']];
      const entryDate = data[i][map['Date of Entry']];
      if (makeKey_(name, store, entryDate) === form.key) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex === -1) throw new Error('Could not find that trainee — the sheet may have changed. Reopen the form and try again.');

    const sheetRow = rowIndex + 2; // +1 header, +1 to go from 0-based to 1-based

    // Uniform releases have their own "👕 Uniform" tab/action now (submitUniformRelease) —
    // that's what keeps size/qty/DR# queryable instead of piling into one text cell.

    sheet.getRange(sheetRow, map['Status'] + 1).setValue(form.newStatus);

    const certGrade = form.certGrade === '' ? '' : Number(form.certGrade) / 100;
    const examOnly = form.examGradeInput === '' ? '' : Number(form.examGradeInput) / 100;
    const finalAverage = average_([certGrade, examOnly].map(v => v === '' ? '' : v * 100)); // average_ expects raw numbers

    if (form.newStatus === 'CERTIFIED' || form.newStatus === 'PROMOTION') {
      if (form.certBy) sheet.getRange(sheetRow, map['Cert By'] + 1).setValue(toUpperSafe(form.certBy));
      sheet.getRange(sheetRow, map['Date Certified'] + 1).setValue(new Date());
      if (form.certGrade !== '') sheet.getRange(sheetRow, map['Certification Grade'] + 1).setValue(certGrade);
      if (form.examGradeInput !== '') sheet.getRange(sheetRow, map['Exam Grade'] + 1).setValue(examOnly);
      if (finalAverage !== '') sheet.getRange(sheetRow, map['Average'] + 1).setValue(finalAverage / 100);
    }

    if (form.newStatus === 'EXTENDED') {
      const deadlineCell = sheet.getRange(sheetRow, map['Certification Deadline'] + 1);
      if (form.deadlineOverride) {
        // User picked an exact new deadline instead of the +2 month default.
        deadlineCell.setValue(new Date(form.deadlineOverride));
      } else {
        const oldDeadline = deadlineCell.getValue();
        const base = (oldDeadline instanceof Date) ? oldDeadline : new Date(); // never blocks on a bad cell — falls back to today
        deadlineCell.setValue(addMonths(base, 2));
      }
      if (form.certBy) sheet.getRange(sheetRow, map['Cert By'] + 1).setValue(toUpperSafe(form.certBy));
      if (form.certGrade !== '') sheet.getRange(sheetRow, map['Certification Grade'] + 1).setValue(certGrade);
      if (form.examGradeInput !== '') sheet.getRange(sheetRow, map['Exam Grade'] + 1).setValue(examOnly);
      if (finalAverage !== '') sheet.getRange(sheetRow, map['Average'] + 1).setValue(finalAverage / 100);
    }

    // FAILED / QUIT / DISQUALIFIED — still capture whatever grade was entered,
    // so the score that produced the outcome isn't lost in a side table.
    if (['FAILED', 'QUIT', 'DISQUALIFIED'].indexOf(form.newStatus) !== -1) {
      if (form.certBy) sheet.getRange(sheetRow, map['Cert By'] + 1).setValue(toUpperSafe(form.certBy));
      sheet.getRange(sheetRow, map['Date Certified'] + 1).setValue(new Date());
      if (form.certGrade !== '') sheet.getRange(sheetRow, map['Certification Grade'] + 1).setValue(certGrade);
      if (form.examGradeInput !== '') sheet.getRange(sheetRow, map['Exam Grade'] + 1).setValue(examOnly);
      if (finalAverage !== '') sheet.getRange(sheetRow, map['Average'] + 1).setValue(finalAverage / 100);
    }

    if (form.finalStatus) {
      sheet.getRange(sheetRow, map['Final Status'] + 1).setValue(toUpperSafe(form.finalStatus));
    }

    return 'Updated: row set to ' + form.newStatus;
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
    const cell = found.sheet.getRange(found.sheetRow, found.map['Uniform Release'] + 1);
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
  const map = getHeaderMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('No data yet.');
    return;
  }
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  const perStoreActive = {};
  const statusCounts = {};
  STATUS_VALUES.forEach(s => statusCounts[s] = 0);

  data.forEach(row => {
    const store = normalizeStore(row[map['Mother Store']]);
    const status = toUpperSafe(row[map['Status']]);
    if (!store) return;
    if (statusCounts[status] !== undefined) statusCounts[status]++;
    if (OPEN_STATUSES.indexOf(status) !== -1 || status === 'CERTIFIED') {
      perStoreActive[store] = (perStoreActive[store] || 0) + 1;
    }
  });

  let summarySheet = ss.getSheetByName('Summary');
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
