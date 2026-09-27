// ============================================================
// SVMKPI_CORE.gs
// Store Visit Monitoring KPI — Core Engine
// Source of truth: STORE_VISIT_MONITORING_KPI_BIBLE_v1.0
// ------------------------------------------------------------
// Contains:
//   1. Constants
//   2. Shared Helpers
//   3. Populate Functions
//   4. Validator
//   5. Refresh Engine
//   6. Debug Functions
// ------------------------------------------------------------
// Does NOT contain:
//   - Layout / formatting code       → SVMKPI_LAYOUT.gs
//   - Menu / UI / trigger code       → SVMKPI_ADMIN.gs
//   - Rebuild functions
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS
// ═══════════════════════════════════════════════════════════════

// ── Sheet names ───────────────────────────────────────────────
const SHEET = {
  MASTER_LOG: 'MASTER_LOG',
  SUMMARY:    'EXECUTIVE SUMMARY',
  SETTINGS:   'SETTINGS',
};

// ── MASTER_LOG column indices (1-based) ───────────────────────
const COL = {
  TIMESTAMP:   1,  // A
  DATE:        2,  // B
  STORE:       3,  // C
  BRAND:       4,  // D
  REGION:      5,  // E
  VISITOR:     6,  // F
  PURPOSE:     7,  // G
};

// ── Approved enum values (single source of truth) ─────────────
const APPROVED_BRANDS = [
  "ANGEL'S PIZZA",
  'APEX',
  'FIGARO',
  "TIEN MA'S",
  'KOOBIDEH',
];

const APPROVED_REGIONS = [
  'NCR',
  'PROVINCIAL',
  'FRANCHISE',
];

const APPROVED_PURPOSES = [
  'STORE VISIT',
  'TLTC',
  'FAILED QA/MS',
  'CURING/SUPPORT',
];

// ── Executive Summary cell addresses (Bible §4) ───────────────
const CELL = {
  // KPI row 7
  KPI_TOTAL:    'C7',
  KPI_STORE:    'D7',
  KPI_TLTC:     'E7',
  KPI_FAILED:   'F7',
  KPI_CURING:   'G7',
  KPI_NCR:      'H7',
  KPI_PROV:     'I7',

  // Monthly — data start
  MONTHLY_DATA_ROW:   11,   // rows 11–22
  MONTHLY_DATA_COL:   4,    // col D (brand 0)
  MONTHLY_TOTAL_COL:  9,    // col I
  MONTHLY_GT_ROW:     23,
  MONTHLY_GT_COL:     4,    // D23:I23

  // Region rows 27–29, total 31
  REGION_START_ROW:   27,
  REGION_VISIT_COL:   4,    // D
  REGION_PCT_COL:     5,    // E
  REGION_TOTAL_ROW:   31,

  // Purpose rows 27–30, total 31
  PURPOSE_START_ROW:  27,
  PURPOSE_COUNT_COL:  8,    // H
  PURPOSE_PCT_COL:    9,    // I
  PURPOSE_TOTAL_ROW:  31,

  // Top Stores rows 35–44
  STORES_START_ROW:   35,
  STORES_NAME_COL:    4,    // D
  STORES_COUNT_COL:   5,    // E
  STORES_LIMIT:       10,

  // Leaderboard rows 35–46
  LEADER_START_ROW:   35,
  LEADER_NAME_COL:    8,    // H
  LEADER_COUNT_COL:   9,    // I
  LEADER_LIMIT:       12,

  // Brand Performance rows 50–54, total 55
  BRAND_START_ROW:    50,
  BRAND_NAME_COL:     3,    // C (read-only — set by layout)
  BRAND_TOTAL_COL:    4,    // D
  BRAND_PCT_COL:      5,    // E
  BRAND_PEAK_MO_COL:  6,    // F
  BRAND_PEAK_CT_COL:  7,    // G
  BRAND_TOTAL_ROW:    55,
};

// Month names indexed 0–11
const MONTH_NAMES = [
  'JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
  'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER',
];

// Data year — update annually or derive from config cell
const DATA_YEAR = 2026;


// ═══════════════════════════════════════════════════════════════
// SECTION 2: SHARED HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * _normalizeEnum(value)
 * Single normalization entry point for all enum comparisons.
 * All APPROVED_BRANDS / APPROVED_REGIONS / APPROVED_PURPOSES
 * checks must go through this function.
 * @param {*} value - Raw cell value
 * @returns {string} Trimmed, uppercased string
 */
function _normalizeEnum(value) {
  return String(value == null ? '' : value)
    .replace(/[\u2018\u2019\u02BC\u00B4`]/g, "'")
    .trim()
    .toUpperCase();
}

/**
 * _normalizeVisitors(rawValue)
 * Single pipe-split entry point for col F (Visited By).
 * Splits on "|", normalizes each token via _normalizeEnum(),
 * discards empty tokens.
 * @param {*} rawValue - Raw cell value from col F
 * @returns {string[]} Array of individual normalized visitor names
 */
function _normalizeVisitors(rawValue) {
  const raw = _normalizeEnum(rawValue);
  if (!raw) return [];
  return raw.split('|')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

/**
 * _countIf(arr, value)
 * Count occurrences of a normalized value in a normalized array.
 * @param {string[]} arr   - Pre-normalized array (output of _getData)
 * @param {string}   value - Value to count (will be normalized before compare)
 * @returns {number}
 */
function _countIf(arr, value) {
  const target = _normalizeEnum(value);
  return arr.reduce((n, v) => n + (v === target ? 1 : 0), 0);
}

/**
 * _countIfs(data, monthIndex, brand)
 * Count rows matching a specific month (0-based) and brand.
 * @param {object} data        - Parsed data object from _getData()
 * @param {number} monthIndex  - 0-based month (0 = January)
 * @param {string} brand       - Brand name (normalized before compare)
 * @returns {number}
 */
function _countIfs(data, monthIndex, brand) {
  const target = _normalizeEnum(brand);
  let count = 0;
  for (let i = 0; i < data.dates.length; i++) {
    const d = data.dates[i];
    if (!(d instanceof Date) || isNaN(d)) continue;
    if (d.getFullYear() !== DATA_YEAR) continue;
    if (d.getMonth() !== monthIndex) continue;
    if (data.brands[i] !== target) continue;
    count++;
  }
  return count;
}

/**
 * _aggregateList(arr)
 * Count occurrences of each value in an array.
 * Returns array sorted by count desc, then name asc for tie-break.
 * @param {string[]} arr
 * @returns {{ name: string, total: number }[]}
 */
function _aggregateList(arr) {
  const map = {};
  arr.forEach(v => {
    if (!v) return;
    map[v] = (map[v] || 0) + 1;
  });
  return Object.entries(map)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * _aggregateVisitors(rawVisitors)
 * Splits pipe-delimited visitor strings, normalizes each name,
 * aggregates individual counts, returns sorted ranked list.
 * Implements the visitor counting rule from Bible §3.4 / §6.4.
 * @param {string[]} rawVisitors - Raw col F values (NOT pre-split)
 * @returns {{ name: string, total: number }[]}
 */
function _aggregateVisitors(rawVisitors) {
  const map = {};
  rawVisitors.forEach(raw => {
    _normalizeVisitors(raw).forEach(name => {
      map[name] = (map[name] || 0) + 1;
    });
  });
  return Object.entries(map)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * _getSheet(name)
 * Retrieve a sheet by name. Throws with a clear message if missing.
 * @param {string} name
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function _getSheet(name) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('SVMKPI: Sheet not found — "' + name + '"');
  return sheet;
}

/**
 * _getData(masterLog)
 * Read all data from MASTER_LOG once. Normalize all enum columns.
 * All populate functions receive this object — none read MASTER_LOG directly.
 * Returns the data shape defined in Bible §7.2.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} masterLog
 * @returns {object} Parsed data object
 */
function _getData(masterLog) {
  const lastRow = masterLog.getLastRow();
  if (lastRow < 2) {
    return {
      timestamps: [], dates: [], stores: [], brands: [],
      regions: [], rawVisitors: [], purposes: [], totalRows: 0,
    };
  }

  const dataRows = lastRow - 1;
  const raw = masterLog.getRange(2, 1, dataRows, 7).getValues();

  const timestamps  = [];
  const dates       = [];
  const stores      = [];
  const brands      = [];
  const regions     = [];
  const rawVisitors = [];
  const purposes    = [];

  raw.forEach(row => {
    timestamps .push(row[COL.TIMESTAMP - 1]);
    dates      .push(row[COL.DATE      - 1] instanceof Date ? row[COL.DATE - 1] : new Date(row[COL.DATE - 1]));
    stores     .push(String(row[COL.STORE   - 1]).trim());
    brands     .push(_normalizeEnum(row[COL.BRAND   - 1]));
    regions    .push(_normalizeEnum(row[COL.REGION  - 1]));
    rawVisitors.push(row[COL.VISITOR - 1]);           // raw — split deferred to _aggregateVisitors
    purposes   .push(_normalizeEnum(row[COL.PURPOSE - 1]));
  });

  return { timestamps, dates, stores, brands, regions, rawVisitors, purposes, totalRows: dataRows };
}

/**
 * _log(msg)
 * Centralized logging. Prefixes all messages with SVMKPI tag.
 * @param {string} msg
 */
function _log(msg) {
  Logger.log('[SVMKPI] ' + msg);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: POPULATE FUNCTIONS
// ═══════════════════════════════════════════════════════════════
// Rules (Bible §5):
//   - Write values only. Never modify formatting, merges, or structure.
//   - Use shared helpers exclusively. No direct MASTER_LOG reads.
//   - All use the data object returned by _getData().

/**
 * populateKPI(sheet, data)
 * Writes KPI card values to C7:I7.
 * Bible §5.1
 */
function populateKPI(sheet, data) {
  const total = data.totalRows;
  sheet.getRange(CELL.KPI_TOTAL) .setValue(total);
  sheet.getRange(CELL.KPI_STORE) .setValue(_countIf(data.purposes, 'STORE VISIT'));
  sheet.getRange(CELL.KPI_TLTC)  .setValue(_countIf(data.purposes, 'TLTC'));
  sheet.getRange(CELL.KPI_FAILED).setValue(_countIf(data.purposes, 'FAILED QA/MS'));
  sheet.getRange(CELL.KPI_CURING).setValue(_countIf(data.purposes, 'CURING/SUPPORT'));
  sheet.getRange(CELL.KPI_NCR)   .setValue(_countIf(data.regions,  'NCR'));
  sheet.getRange(CELL.KPI_PROV)  .setValue(_countIf(data.regions,  'PROVINCIAL'));
}

/**
 * populateMonthly(sheet, data)
 * Writes monthly brand matrix D11:I22 and grand total D23:I23.
 * Bible §5.2
 * Batch-writes each row as a single setValues() call for performance.
 */
function populateMonthly(sheet, data) {
  const brandCount = APPROVED_BRANDS.length;   // 5

  // Build monthly matrix [12 rows × 6 cols: D–H (brands) + I (total)]
  for (let m = 0; m < 12; m++) {
    const row = CELL.MONTHLY_DATA_ROW + m;
    const counts = APPROVED_BRANDS.map(brand => _countIfs(data, m, brand));
    const rowTotal = counts.reduce((s, v) => s + v, 0);
    // Write brand cells D–H + total cell I as one range
    sheet.getRange(row, CELL.MONTHLY_DATA_COL, 1, brandCount + 1)
      .setValues([[...counts, rowTotal]]);
  }

  // Grand Total row 23: SUM each brand column + overall total
  const gtCounts = APPROVED_BRANDS.map((_, bi) => {
    let sum = 0;
    for (let m = 0; m < 12; m++) {
      const row = CELL.MONTHLY_DATA_ROW + m;
      // Re-read from sheet to keep single source of truth
      sum += Number(sheet.getRange(row, CELL.MONTHLY_DATA_COL + bi).getValue());
    }
    return sum;
  });
  const gtTotal = gtCounts.reduce((s, v) => s + v, 0);
  sheet.getRange(CELL.MONTHLY_GT_ROW, CELL.MONTHLY_GT_COL, 1, brandCount + 1)
    .setValues([[...gtCounts, gtTotal]]);
}

/**
 * populateRegion(sheet, data)
 * Writes region visit counts and % share to D27:E29 and D31:E31.
 * Bible §5.3
 */
function populateRegion(sheet, data) {
  const total = data.totalRows;

  APPROVED_REGIONS.forEach((region, i) => {
    const row   = CELL.REGION_START_ROW + i;
    const count = _countIf(data.regions, region);
    const pct   = total > 0 ? count / total : 0;
    sheet.getRange(row, CELL.REGION_VISIT_COL).setValue(count);
    sheet.getRange(row, CELL.REGION_PCT_COL)  .setValue(pct);
  });

  // Total row 31
  const regionTotal = APPROVED_REGIONS.reduce((s, r) => s + _countIf(data.regions, r), 0);
  sheet.getRange(CELL.REGION_TOTAL_ROW, CELL.REGION_VISIT_COL).setValue(regionTotal);
  sheet.getRange(CELL.REGION_TOTAL_ROW, CELL.REGION_PCT_COL)  .setValue(total > 0 ? regionTotal / total : 0);
}

/**
 * populatePurpose(sheet, data)
 * Writes purpose counts and % share to H27:I30 and H31:I31.
 * Bible §5.4
 */
function populatePurpose(sheet, data) {
  const total = data.totalRows;

  APPROVED_PURPOSES.forEach((purpose, i) => {
    const row   = CELL.PURPOSE_START_ROW + i;
    const count = _countIf(data.purposes, purpose);
    const pct   = total > 0 ? count / total : 0;
    sheet.getRange(row, CELL.PURPOSE_COUNT_COL).setValue(count);
    sheet.getRange(row, CELL.PURPOSE_PCT_COL)  .setValue(pct);
  });

  // Total row 31
  const purposeTotal = APPROVED_PURPOSES.reduce((s, p) => s + _countIf(data.purposes, p), 0);
  sheet.getRange(CELL.PURPOSE_TOTAL_ROW, CELL.PURPOSE_COUNT_COL).setValue(purposeTotal);
  sheet.getRange(CELL.PURPOSE_TOTAL_ROW, CELL.PURPOSE_PCT_COL)  .setValue(total > 0 ? purposeTotal / total : 0);
}

/**
 * populateTopStores(sheet, data)
 * Writes top 10 stores (name + count) to D35:E44.
 * Bible §5.5
 * Col C (rank numbers) is never touched.
 */
function populateTopStores(sheet, data) {
  const ranked = _aggregateList(data.stores).slice(0, CELL.STORES_LIMIT);

  for (let i = 0; i < CELL.STORES_LIMIT; i++) {
    const row   = CELL.STORES_START_ROW + i;
    const entry = ranked[i];
    sheet.getRange(row, CELL.STORES_NAME_COL) .setValue(entry ? entry.name  : '');
    sheet.getRange(row, CELL.STORES_COUNT_COL).setValue(entry ? entry.total : '');
  }
}

/**
 * populateLeaderboard(sheet, data)
 * Writes top 12 visitors (name + count) to H35:I46.
 * Applies pipe-split + normalization via _aggregateVisitors().
 * Bible §5.6
 * Col G (rank numbers) is never touched.
 */
function populateLeaderboard(sheet, data) {
  const roster = _getApprovedVisitors();
  const ranked = _aggregateVisitors(data.rawVisitors)
    .filter(entry => roster.has(entry.name))
    .slice(0, CELL.LEADER_LIMIT);

  for (let i = 0; i < CELL.LEADER_LIMIT; i++) {
    const row   = CELL.LEADER_START_ROW + i;
    const entry = ranked[i];
    sheet.getRange(row, CELL.LEADER_NAME_COL) .setValue(entry ? entry.name  : '');
    sheet.getRange(row, CELL.LEADER_COUNT_COL).setValue(entry ? entry.total : '');
  }
}

/**
 * populateBrandPerformance(sheet, data)
 * Writes brand total, % share, peak month, peak count to D50:G54.
 * Writes grand total row to D55:G55.
 * Bible §5.7
 * Col C (brand names) is never touched — owned by layout.
 */
function populateBrandPerformance(sheet, data) {
  const total = data.totalRows;

  // Build monthly counts per brand for peak calculation
  // Structure: monthlyCounts[brandIndex][monthIndex] = count
  const monthlyCounts = APPROVED_BRANDS.map((brand, bi) =>
    Array.from({ length: 12 }, (_, m) => _countIfs(data, m, brand))
  );

  APPROVED_BRANDS.forEach((brand, bi) => {
    const row        = CELL.BRAND_START_ROW + bi;
    const brandTotal = monthlyCounts[bi].reduce((s, v) => s + v, 0);
    const pct        = total > 0 ? brandTotal / total : 0;
    const peakCount  = Math.max(...monthlyCounts[bi]);
    const peakIndex  = monthlyCounts[bi].indexOf(peakCount);
    const peakMonth  = brandTotal > 0 ? MONTH_NAMES[peakIndex] : '';

    sheet.getRange(row, CELL.BRAND_TOTAL_COL)  .setValue(brandTotal);
    sheet.getRange(row, CELL.BRAND_PCT_COL)    .setValue(pct).setNumberFormat('0.00%');
    sheet.getRange(row, CELL.BRAND_PEAK_MO_COL).setValue(peakMonth);
    sheet.getRange(row, CELL.BRAND_PEAK_CT_COL).setValue(brandTotal > 0 ? peakCount : '');
  });

  // Grand total row 55
  const grandTotal = APPROVED_BRANDS.reduce((s, _, bi) =>
    s + monthlyCounts[bi].reduce((ms, v) => ms + v, 0), 0);
  const allPeaks   = APPROVED_BRANDS.map((_, bi) => Math.max(...monthlyCounts[bi]));
  const maxPeak    = Math.max(...allPeaks);

  sheet.getRange(CELL.BRAND_TOTAL_ROW, CELL.BRAND_TOTAL_COL)  .setValue(grandTotal);
  sheet.getRange(CELL.BRAND_TOTAL_ROW, CELL.BRAND_PCT_COL)    .setValue(total > 0 ? grandTotal / total : 0).setNumberFormat('0.00%');
  sheet.getRange(CELL.BRAND_TOTAL_ROW, CELL.BRAND_PEAK_MO_COL).setValue('');
  sheet.getRange(CELL.BRAND_TOTAL_ROW, CELL.BRAND_PEAK_CT_COL).setValue(grandTotal > 0 ? maxPeak : '');
}


/**
 * _getApprovedVisitors()
 * Reads the official visitor roster from SETTINGS!F:F.
 * Header row 1 is skipped; data starts row 2.
 * @returns {Set<string>} normalized (TRIM+UPPER, apostrophe-safe) roster names
 */
function _getApprovedVisitors() {
  const sheet   = _getSheet(SHEET.SETTINGS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();

  const values = sheet.getRange(2, 6, lastRow - 1, 1).getValues();  // col F
  const roster = new Set();
  values.forEach(([v]) => {
    const name = _normalizeEnum(v);
    if (name) roster.add(name);
  });
  return roster;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: VALIDATOR
// ═══════════════════════════════════════════════════════════════

/**
 * validateMasterLog()
 * Scans MASTER_LOG for data quality issues.
 * Read-only — never writes to MASTER_LOG.
 * Uses same shared helpers as populate functions.
 * Bible §6.1 / §6.2
 *
 * @returns {{ valid: boolean, errors: ValidationError[], summary: string }}
 *
 * ValidationError shape:
 *   { row, col, field, value, rule, message }
 */
function validateMasterLog() {
  const log     = _getSheet(SHEET.MASTER_LOG);
  const lastRow = log.getLastRow();
  const errors  = [];

  if (lastRow < 2) {
    return { valid: true, errors: [], summary: 'MASTER_LOG is empty — no rows to validate.' };
  }

  const dataRows = lastRow - 1;
  const raw      = log.getRange(2, 1, dataRows, 7).getValues();

  raw.forEach((row, idx) => {
    const r          = idx + 2;   // sheet row number (1-indexed, header = row 1)
    const timestamp  = row[COL.TIMESTAMP - 1];
    const date       = row[COL.DATE      - 1];
    const store      = row[COL.STORE     - 1];
    const brand      = row[COL.BRAND     - 1];
    const region     = row[COL.REGION    - 1];
    const visitor    = row[COL.VISITOR   - 1];
    const purpose    = row[COL.PURPOSE   - 1];

    const err = (col, field, value, rule, message) =>
      errors.push({ row: r, col, field, value: String(value), rule, message });

    // A — Timestamp
    if (!timestamp) err('A', 'Timestamp', timestamp, 'BLANK_TIMESTAMP',
      'Timestamp is blank. Row may be corrupt.');

    // B — Date Visited
    if (!date) {
      err('B', 'Date Visited', date, 'BLANK_DATE', 'Date Visited is required.');
    } else if (!(date instanceof Date) || isNaN(date.getTime())) {
      err('B', 'Date Visited', date, 'INVALID_DATE', 'Date Visited is not a valid date.');
    }

    // C — Store
    if (!String(store).trim()) err('C', 'Store', store, 'BLANK_STORE',
      'Store name is required.');

    // D — Brand
    const normBrand = _normalizeEnum(brand);
    if (!normBrand) {
      err('D', 'Brand', brand, 'BLANK_BRAND', 'Brand is required.');
    } else if (!APPROVED_BRANDS.includes(normBrand)) {
      err('D', 'Brand', brand, 'INVALID_BRAND',
        'Brand value "' + normBrand + '" is not in the approved list.');
    }

    // E — Region
    const normRegion = _normalizeEnum(region);
    if (!normRegion) {
      err('E', 'Region', region, 'BLANK_REGION', 'Region is required.');
    } else if (!APPROVED_REGIONS.includes(normRegion)) {
      err('E', 'Region', region, 'INVALID_REGION',
        'Region value "' + normRegion + '" is not in the approved list.');
    }

    // F — Visited By
    const normVisitorRaw = _normalizeEnum(visitor);
    if (!normVisitorRaw) {
      err('F', 'Visited By', visitor, 'BLANK_VISITOR', 'Visited By is required.');
    } else {
      const tokens = _normalizeVisitors(visitor);
      if (tokens.length === 0) {
        err('F', 'Visited By', visitor, 'BLANK_VISITOR_TOKEN',
          'Visited By produced no valid names after pipe-split.');
      }
    }

    // G — Purpose
    const normPurpose = _normalizeEnum(purpose);
    if (!normPurpose) {
      err('G', 'Purpose', purpose, 'BLANK_PURPOSE', 'Purpose is required.');
    } else if (!APPROVED_PURPOSES.includes(normPurpose)) {
      err('G', 'Purpose', purpose, 'INVALID_PURPOSE',
        'Purpose value "' + normPurpose + '" is not in the approved list.');
    }
  });

  const valid   = errors.length === 0;
  const summary = valid
    ? 'Validation passed. ' + dataRows + ' rows checked. No errors found.'
    : 'Validation failed. ' + errors.length + ' error(s) found across ' + dataRows + ' rows.';

  return { valid, errors, summary };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: REFRESH ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * refreshDashboard()
 * Orchestrates all populate functions in sequence.
 * Steps 1–3 abort on failure. Steps 4–10 are non-aborting.
 * This is the sole externally-called function for data refresh.
 * Bible §7.1
 */
function refreshDashboard() {
  // Steps 1–3: abort on failure
  const masterLog = _getSheet(SHEET.MASTER_LOG);     // step 1
  const summary   = _getSheet(SHEET.SUMMARY);        // step 2
  const data      = _getData(masterLog);              // step 3

  _log('Refresh started. ' + data.totalRows + ' rows loaded from MASTER_LOG.');

  const failed = [];

  const _run = (name, fn) => {
    try {
      fn();
      _log(name + ' ✓');
    } catch (e) {
      failed.push(name);
      _log(name + ' ✗ — ' + e.message);
    }
  };

  _run('populateKPI',              () => populateKPI(summary, data));              // step 4
  _run('populateMonthly',          () => populateMonthly(summary, data));          // step 5
  _run('populateRegion',           () => populateRegion(summary, data));           // step 6
  _run('populatePurpose',          () => populatePurpose(summary, data));          // step 7
  _run('populateTopStores',        () => populateTopStores(summary, data));        // step 8
  _run('populateLeaderboard',      () => populateLeaderboard(summary, data));      // step 9
  _run('populateBrandPerformance', () => populateBrandPerformance(summary, data)); // step 10

  SpreadsheetApp.flush();  // step 11

  // step 12: log result
  if (failed.length === 0) {
    _log('Refresh complete. All sections OK.');
  } else {
    _log('Refresh complete. Sections failed: ' + failed.join(', '));
  }

  return { success: failed.length === 0, failed };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6: DEBUG FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * debugAll()
 * Runs all debug checks and logs results.
 * Called by SVMKPI_ADMIN.gs via menuRunDebug().
 */
function debugAll() {
  _log('=== DEBUG START ===');
  debugConstants();
  debugData();
  debugValidator();
  debugVisitorCounting();
  _log('=== DEBUG END ===');
}

/**
 * debugConstants()
 * Logs all approved value lists to confirm they loaded correctly.
 */
function debugConstants() {
  _log('--- Constants ---');
  _log('APPROVED_BRANDS ('   + APPROVED_BRANDS.length   + '): ' + APPROVED_BRANDS.join(' | '));
  _log('APPROVED_REGIONS ('  + APPROVED_REGIONS.length  + '): ' + APPROVED_REGIONS.join(' | '));
  _log('APPROVED_PURPOSES (' + APPROVED_PURPOSES.length + '): ' + APPROVED_PURPOSES.join(' | '));
  _log('DATA_YEAR: ' + DATA_YEAR);
}

/**
 * debugData()
 * Reads MASTER_LOG and logs a summary of the parsed data object.
 */
function debugData() {
  _log('--- Data Load ---');
  try {
    const log  = _getSheet(SHEET.MASTER_LOG);
    const data = _getData(log);
    _log('totalRows: '    + data.totalRows);
    _log('dates (first 3): ' + data.dates.slice(0, 3).map(d => d instanceof Date ? d.toISOString().slice(0, 10) : String(d)).join(', '));
    _log('brands (first 3): ' + data.brands.slice(0, 3).join(', '));
    _log('regions (first 3): ' + data.regions.slice(0, 3).join(', '));
    _log('purposes (first 3): ' + data.purposes.slice(0, 3).join(', '));
    _log('rawVisitors (first 3): ' + data.rawVisitors.slice(0, 3).map(v => String(v)).join(' // '));
  } catch (e) {
    _log('Data load failed: ' + e.message);
  }
}

/**
 * debugValidator()
 * Runs validateMasterLog() and logs the summary + first 10 errors.
 */
function debugValidator() {
  _log('--- Validator ---');
  try {
    const result = validateMasterLog();
    _log(result.summary);
    result.errors.slice(0, 10).forEach(e => {
      _log('  Row ' + e.row + ' Col ' + e.col + ' [' + e.rule + ']: ' + e.message + ' (value: "' + e.value + '")');
    });
    if (result.errors.length > 10) {
      _log('  ... and ' + (result.errors.length - 10) + ' more errors.');
    }
  } catch (e) {
    _log('Validator failed: ' + e.message);
  }
}

/**
 * debugVisitorCounting()
 * Tests pipe-split, normalization, and aggregation with synthetic data.
 * Validates the visitor counting rule from Bible §3.4.
 */
function debugVisitorCounting() {
  _log('--- Visitor Counting ---');

  const testCases = [
    { input: 'LEO',        expected: ['LEO'] },
    { input: 'LEO|YANA',   expected: ['LEO', 'YANA'] },
    { input: ' Leo | yana ', expected: ['LEO', 'YANA'] },
    { input: 'LEO||JOSH',  expected: ['LEO', 'JOSH'] },
    { input: '',            expected: [] },
    { input: '|',           expected: [] },
  ];

  let passed = 0;
  testCases.forEach(({ input, expected }) => {
    const result = _normalizeVisitors(input);
    const ok     = JSON.stringify(result) === JSON.stringify(expected);
    _log('  _normalizeVisitors("' + input + '") → ' + JSON.stringify(result) + (ok ? ' ✓' : ' ✗ expected ' + JSON.stringify(expected)));
    if (ok) passed++;
  });

  // Aggregate test: LEO|YANA, LEO, YANA|JOSH → LEO=2, YANA=2, JOSH=1
  const aggInput   = ['LEO|YANA', 'LEO', 'YANA|JOSH'];
  const aggResult  = _aggregateVisitors(aggInput);
  const aggExpect  = [{ name: 'LEO', total: 2 }, { name: 'YANA', total: 2 }, { name: 'JOSH', total: 1 }];
  const aggOk      = JSON.stringify(aggResult) === JSON.stringify(aggExpect);
  _log('  _aggregateVisitors test → ' + JSON.stringify(aggResult) + (aggOk ? ' ✓' : ' ✗'));
  if (aggOk) passed++;

  _log('  ' + passed + '/' + (testCases.length + 1) + ' visitor tests passed.');
}
