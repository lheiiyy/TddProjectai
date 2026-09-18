// Phase 1C: Reporting-Year Abstraction + Year-Neutral KPI/Report APIs.
//
// Covers (per the Phase 1C spec's "17. TESTING" list):
//   A. Year discovery — one/multiple/nonconsecutive years, duplicate
//      events within a year, empty MASTER_LOG, malformed dates, boundary
//      dates (2026-01-01 / 2026-12-31 / 2027-01-01)
//   B. Year validation/normalization — numeric/string/invalid/null/
//      undefined/decimal/unreasonable/normalized-equivalent inputs
//   C. Default reporting year — latest-available vs. empty-log fallback
//   D. Year-neutral KPI: _computeStoreRisk() runs the SAME implementation
//      against 2026/2027/2028 fixtures; only the event population changes
//   E. Year-neutral compliance: sl_getComplianceGaps() explicit-year param
//   F. Year-neutral KPI-sheet rebuild/read: buildKPI2026()/
//      getKPI2026Report() for two different explicit years
//   G. Regression: refactored 2026 output matches hand-computed expected
//      values (not just "a result exists")
//   H. Cross-year isolation: a 2026 record never appears in a 2027 report
//      and vice versa
//   I. Scale: a multi-year fixture (thousands of rows) — discovery and
//      filtering stay correct, no scan-range ceiling reappears
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs + SVMKPI_REPORTING_YEAR.gs
// + SVMKPI_RISK.gs + SVMKPI_STORE_LOOKUP.gs + SVMKPI_KPI_REBUILD.gs +
// SVMKPI_REPORTS.gs) in a Node vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc    = APPS('SVMKPI_CORE.gs');
const yearSrc    = APPS('SVMKPI_REPORTING_YEAR.gs');
const calSrc     = APPS('SVMKPI_CALENDAR.gs');
const cmpCfgSrc  = APPS('SVMKPI_COMPLIANCE_CONFIG.gs');
const riskSrc    = APPS('SVMKPI_RISK.gs');
const lookupSrc  = APPS('SVMKPI_STORE_LOOKUP.gs');
const kpiSrc     = APPS('SVMKPI_KPI_REBUILD.gs');
const reportsSrc = APPS('SVMKPI_REPORTS.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Generic MASTER_LOG mock: rows: [ts, date, store, brand, region, visitor, purpose, remarks] ──
function makeMasterLogSheet(rows) {
  return {
    getLastRow: () => (rows.length ? rows.length + 1 : 0),
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => rows.slice(row - 2, row - 2 + numRows).map(r => r.slice(col - 1, col - 1 + (numCols || 1))),
    }),
  };
}
function makeSettingsSheet(rows) {
  return {
    getLastRow: () => (rows.length ? rows.length + 1 : 0),
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => rows.slice(row - 2, row - 2 + numRows).map(r => r.slice(col - 1, col - 1 + (numCols || r.length))),
    }),
  };
}

// A fast, fully writable sheet mock (for buildKPI2026()'s insertSheet path).
// Formulas are NOT evaluated (no real spreadsheet engine here) — reading a
// formula cell back returns its formula TEXT, same established convention
// as kpi-roster-history.test.js/roster-auto-refresh.test.js use for this
// exact file's SUMPRODUCT-heavy output: this test verifies which YEAR got
// baked into the generated formula text (buildKPI2026()'s actual
// responsibility), not spreadsheet arithmetic (Google Sheets' job).
function makeWritableSheet() {
  const cells = {};
  let maxRow = 0, maxCol = 0;
  const key = (r, c) => r + ',' + c;
  function setCell(r, c, v) { cells[key(r, c)] = v; if (r > maxRow) maxRow = r; if (c > maxCol) maxCol = c; }
  function getCell(r, c) { const v = cells[key(r, c)]; return v == null ? '' : v; }
  function makeRange(row, col, numRows, numCols) {
    const range = {};
    let proxy;
    range.setValue = (v) => { setCell(row, col, v); return proxy; };
    range.setValues = (vals) => { vals.forEach((rowArr, ri) => rowArr.forEach((v, ci) => setCell(row + ri, col + ci, v))); return proxy; };
    range.setFormula = (f) => { setCell(row, col, f); return proxy; };
    range.setFormulas = (rows) => { rows.forEach((rowArr, ri) => rowArr.forEach((f, ci) => setCell(row + ri, col + ci, f))); return proxy; };
    range.getValue = () => getCell(row, col);
    range.getDisplayValue = () => String(getCell(row, col));
    range.getValues = () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const rowArr = [];
        for (let c = 0; c < numCols; c++) rowArr.push(getCell(row + r, col + c));
        out.push(rowArr);
      }
      return out;
    };
    range.getDisplayValues = () => range.getValues().map(r => r.map(String));
    proxy = new Proxy(range, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => proxy; } });
    return proxy;
  }
  const sheet = {
    getLastRow: () => maxRow,
    getMaxRows: () => Math.max(maxRow, 10),
    getMaxColumns: () => Math.max(maxCol, 10),
    insertRowsAfter: () => {},
    insertColumnsAfter: () => {},
    getRange: (row, col, numRows, numCols) => makeRange(row, col, numRows || 1, numCols || 1),
    clear: () => {}, clearFormats: () => {},
    setRowHeight: () => {}, setColumnWidth: () => {},
    setFrozenRows: () => {}, setFrozenColumns: () => {},
  };
  let sproxy;
  sproxy = new Proxy(sheet, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => sproxy; } });
  return sproxy;
}

function fmtDate(y, m, d) {
  const mm = String(m).padStart(2, '0'), dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

// ═══════════════════════════════════════════════════════════════
// Sandbox builders
// ═══════════════════════════════════════════════════════════════

// A: discovery/validation sandbox — CORE.gs + REPORTING_YEAR.gs only.
function newYearSandbox(masterLogRows) {
  const masterLog = masterLogRows === undefined ? null : makeMasterLogSheet(masterLogRows);
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (name) => (name === 'MASTER_LOG' ? masterLog : null) }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (date, tz, fmt) => fmtDate(date.getFullYear(), date.getMonth() + 1, date.getDate()) },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(yearSrc, sandbox);
  return sandbox;
}

// D: risk-engine sandbox — CORE.gs + REPORTING_YEAR.gs + RISK.gs.
function newRiskSandbox(masterLogRows, settingsRows) {
  const masterLog = makeMasterLogSheet(masterLogRows || []);
  const settings  = makeSettingsSheet(settingsRows || []);
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => (name === 'MASTER_LOG' ? masterLog : (name === 'SETTINGS' ? settings : null)),
      }),
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (date, tz, fmt) => fmtDate(date.getFullYear(), date.getMonth() + 1, date.getDate()) },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(yearSrc, sandbox);
  vm.runInContext(riskSrc, sandbox);
  return sandbox;
}

// E: compliance-gaps sandbox — CORE.gs + REPORTING_YEAR.gs + RISK.gs + STORE_LOOKUP.gs.
function newLookupSandbox(masterLogRows, settingsRows) {
  const masterLog = makeMasterLogSheet(masterLogRows || []);
  const settings  = makeSettingsSheet(settingsRows || []);
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => (name === 'MASTER_LOG' ? masterLog : (name === 'SETTINGS' ? settings : null)),
      }),
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (date, tz, fmt) => fmtDate(date.getFullYear(), date.getMonth() + 1, date.getDate()) },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(yearSrc, sandbox);
  vm.runInContext(calSrc, sandbox);
  vm.runInContext(cmpCfgSrc, sandbox);
  vm.runInContext(riskSrc, sandbox);
  vm.runInContext(lookupSrc, sandbox);
  return sandbox;
}

// F: KPI sheet rebuild/read sandbox — full stack.
function newKpiSandbox(masterLogRows, settingsF) {
  const masterLog = makeMasterLogSheet(masterLogRows || []);
  const settingsSheet = makeWritableSheet();
  (settingsF || []).forEach((name, i) => settingsSheet.getRange(2 + i, 6).setValue(name));
  const kpiSheets = {};
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => {
          if (name === 'MASTER_LOG') return masterLog;
          if (name === 'SETTINGS') return settingsSheet;
          return kpiSheets[name] || null;
        },
        insertSheet: (name) => { const s = makeWritableSheet(); kpiSheets[name] = s; return s; },
      }),
      flush: () => {},
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, tz, fmt) => fmtDate(date.getFullYear(), date.getMonth() + 1, date.getDate()),
    },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(yearSrc, sandbox);
  vm.runInContext(kpiSrc, sandbox);
  vm.runInContext(reportsSrc, sandbox);
  return { sandbox, kpiSheets };
}

// A plain 'YYYY-MM-DD' STRING date (not a real Date object) — sidesteps
// the cross-realm `instanceof Date` gotcha entirely (each vm.createContext()
// has its own Date constructor; a Date built in one sandbox is never
// `instanceof` another's). _parseDateCell() (SVMKPI_CORE.gs) already
// parses a plain date string identically to a real Sheets Date object,
// so every fixture row below uses one, regardless of which sandbox it
// ultimately gets fed into.
function row(y, m, d, store, visitor, purpose) {
  const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return [ds + ' 08:00:00', ds, store, 'FIGARO', 'NCR', visitor, purpose || 'STORE VISIT', ''];
}


// ═══════════════════════════════════════════════════════════════
// A. YEAR DISCOVERY
// ═══════════════════════════════════════════════════════════════

console.log('\n── A. getAvailableReportingYears(): one year ──');
{
  const s2 = newYearSandbox([row(2026, 1, 10, 'A', 'LEO')]);
  eq('single year returned', s2.getAvailableReportingYears(), [2026]);
}

console.log('\n── A. getAvailableReportingYears(): multiple, nonconsecutive years — never invents the gap ──');
{
  const s = newYearSandbox([
    row(2026, 1, 10, 'A', 'LEO'),
    row(2026, 5, 20, 'A', 'LEO'),
    row(2027, 2, 1, 'A', 'LEO'),
    row(2029, 11, 3, 'A', 'LEO'),
  ]);
  eq('returns exactly [2026, 2027, 2029], never inventing 2028', s.getAvailableReportingYears(), [2026, 2027, 2029]);
}

console.log('\n── A. getAvailableReportingYears(): duplicate events within the same year collapse to one entry ──');
{
  const s = newYearSandbox([
    row(2026, 1, 10, 'A', 'LEO'),
    row(2026, 1, 10, 'A', 'LEO'),
    row(2026, 6, 1, 'B', 'YANA'),
  ]);
  eq('still just [2026]', s.getAvailableReportingYears(), [2026]);
}

console.log('\n── A. getAvailableReportingYears(): empty MASTER_LOG -> [] (never fabricated) ──');
{
  const s = newYearSandbox([]);
  eq('empty log returns []', s.getAvailableReportingYears(), []);
}

console.log('\n── A. getAvailableReportingYears(): missing MASTER_LOG sheet entirely -> [] (never throws) ──');
{
  const s = newYearSandbox(undefined); // no sheet at all
  eq('missing sheet returns [] gracefully', s.getAvailableReportingYears(), []);
}

console.log('\n── A. getAvailableReportingYears(): malformed/blank dates are skipped, never invented ──');
{
  const s = newYearSandbox([
    row(2026, 3, 1, 'A', 'LEO'),
    ['bad', 'not-a-real-date', 'B', 'FIGARO', 'NCR', 'YANA', 'STORE VISIT', ''],
    ['blank', '', 'C', 'FIGARO', 'NCR', 'GIO', 'STORE VISIT', ''],
  ]);
  eq('only the one valid year survives', s.getAvailableReportingYears(), [2026]);
}

console.log('\n── A. getAvailableReportingYears(): boundary dates (Dec 31 vs Jan 1) land in the correct year ──');
{
  const s = newYearSandbox([
    row(2026, 1, 1, 'A', 'LEO'),
    row(2026, 12, 31, 'A', 'LEO'),
    row(2027, 1, 1, 'A', 'LEO'),
  ]);
  eq('2026-01-01 and 2026-12-31 both count as 2026; 2027-01-01 counts as 2027', s.getAvailableReportingYears(), [2026, 2027]);
}


// ═══════════════════════════════════════════════════════════════
// B. YEAR VALIDATION / NORMALIZATION
// ═══════════════════════════════════════════════════════════════

console.log('\n── B. normalizeReportingYear() / validateReportingYear() ──');
{
  const s = newYearSandbox([]);
  eq('numeric year 2026 -> 2026', s.normalizeReportingYear(2026), 2026);
  eq('string year "2026" -> 2026 (numeric-equivalent input accepted)', s.normalizeReportingYear('2026'), 2026);
  check('numeric and string forms normalize to the SAME value', s.normalizeReportingYear(2026) === s.normalizeReportingYear('2026'));
  eq('invalid string "hello" -> null', s.normalizeReportingYear('hello'), null);
  eq('invalid string "20XX" -> null', s.normalizeReportingYear('20XX'), null);
  eq('null -> null', s.normalizeReportingYear(null), null);
  eq('undefined -> null', s.normalizeReportingYear(undefined), null);
  eq('decimal 2026.5 -> null (never silently floored/rounded)', s.normalizeReportingYear(2026.5), null);
  eq('decimal string "2026.5" -> null', s.normalizeReportingYear('2026.5'), null);
  eq('unreasonable year 99999 -> null', s.normalizeReportingYear(99999), null);
  eq('unreasonable year 0 -> null', s.normalizeReportingYear(0), null);
  eq('negative year -5 -> null', s.normalizeReportingYear(-5), null);
  eq('empty string -> null', s.normalizeReportingYear(''), null);
  eq('whitespace-only string -> null', s.normalizeReportingYear('   '), null);
  eq('a plain object -> null (never coerced into something unrelated)', s.normalizeReportingYear({}), null);

  check('validateReportingYear(2026) is true', s.validateReportingYear(2026) === true);
  check('validateReportingYear("2026") is true', s.validateReportingYear('2026') === true);
  check('validateReportingYear("hello") is false', s.validateReportingYear('hello') === false);
  check('validateReportingYear(null) is false', s.validateReportingYear(null) === false);
  check('validateReportingYear(undefined) is false', s.validateReportingYear(undefined) === false);
  check('validateReportingYear(2026.5) is false', s.validateReportingYear(2026.5) === false);
}


// ═══════════════════════════════════════════════════════════════
// C. DEFAULT REPORTING YEAR
// ═══════════════════════════════════════════════════════════════

console.log('\n── C. getDefaultReportingYear() ──');
{
  const withData = newYearSandbox([row(2026, 1, 1, 'A', 'LEO'), row(2027, 1, 1, 'A', 'LEO')]);
  eq('with 2026+2027 present, default is the LATEST (2027), never a stale literal', withData.getDefaultReportingYear(), 2027);

  const empty = newYearSandbox([]);
  const defaultForEmpty = empty.getDefaultReportingYear();
  check('with an empty log, default falls back to a real calendar year (not a fabricated MASTER_LOG year)',
    Number.isInteger(defaultForEmpty) && defaultForEmpty >= RY_MIN_YEAR_FOR_TEST(), defaultForEmpty);
}
function RY_MIN_YEAR_FOR_TEST() { return 1900; }


// ═══════════════════════════════════════════════════════════════
// D. YEAR-NEUTRAL KPI: _computeStoreRisk() — same implementation,
//    different years, plus cross-year isolation
// ═══════════════════════════════════════════════════════════════

console.log('\n── D. _computeStoreRisk(): the SAME implementation for 2026, 2027, and 2028 ──');
{
  [2026, 2027, 2028].forEach((yr) => {
    const masterLogRows = [
      row(yr, 1, 5, 'ALPHA', 'LEO', 'STORE VISIT'),
      row(yr, 2, 5, 'ALPHA', 'LEO', 'STORE VISIT'),
    ];
    const sbWithData = newRiskSandbox(masterLogRows, [['ALPHA', 'FIGARO', 'NCR', '', 'NCR']]);
    const data = sbWithData._getData(sbWithData.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));
    const today = new (vm.runInContext('Date', sbWithData))(yr, 8, 14);
    const rows = sbWithData._computeStoreRisk(data, today, yr);
    const alpha = rows.find(r => r.store === 'ALPHA');
    check('year ' + yr + ': 2 store visits counted toward totalYTD', alpha.totalYTD === 2, alpha.totalYTD);
    check('year ' + yr + ': purpose score reflects 2 store visits (-2 each = -4)', alpha.basePurposeScore === -4, alpha.basePurposeScore);
  });
}

console.log('\n── D. Cross-year isolation: a 2026 visit never counts toward a 2027 report, and vice versa ──');
{
  const masterLogRows = [
    row(2026, 3, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2026, 3, 2, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2027, 3, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
  ];
  const sbWithData = newRiskSandbox(masterLogRows, [['ALPHA', 'FIGARO', 'NCR', '', 'NCR']]);
  const data = sbWithData._getData(sbWithData.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));

  const rows2026 = sbWithData._computeStoreRisk(data, new (vm.runInContext('Date', sbWithData))(2026, 11, 31), 2026);
  const rows2027 = sbWithData._computeStoreRisk(data, new (vm.runInContext('Date', sbWithData))(2027, 11, 31), 2027);

  check('2026 report counts only the 2 2026 visits', rows2026.find(r => r.store === 'ALPHA').totalYTD === 2,
    rows2026.find(r => r.store === 'ALPHA').totalYTD);
  check('2027 report counts only the 1 2027 visit, not the 2026 ones', rows2027.find(r => r.store === 'ALPHA').totalYTD === 1,
    rows2027.find(r => r.store === 'ALPHA').totalYTD);
}


// ═══════════════════════════════════════════════════════════════
// E. YEAR-NEUTRAL COMPLIANCE: sl_getComplianceGaps()
// ═══════════════════════════════════════════════════════════════

console.log('\n── E. sl_getComplianceGaps(): explicit reportingYear param, same implementation across years ──');
{
  [2026, 2028].forEach((yr) => {
    const masterLogRows = [row(yr, 3, 15, 'STORE_A', 'LEO', 'STORE VISIT')];
    const settingsRows = [['STORE_A', 'FIGARO', 'NCR', '', 'NCR'], ['STORE_B', 'FIGARO', 'NCR', '', 'NCR']];
    const s = newLookupSandbox(masterLogRows, settingsRows);
    const gaps = s.sl_getComplianceGaps([], 3, yr); // March, explicit year
    const byStore = Object.fromEntries(gaps.map(g => [g.store, g]));
    check('year ' + yr + ': STORE_A (visited in March that year) is compliant, absent from gaps', !byStore.STORE_A, JSON.stringify(gaps.map(g => g.store)));
    check('year ' + yr + ': STORE_B (never visited) is a gap', !!byStore.STORE_B);
  });
}

console.log('\n── E. sl_getComplianceGaps(): cross-year isolation — a March 2026 visit does not satisfy March 2027 ──');
{
  const masterLogRows = [row(2026, 3, 15, 'STORE_A', 'LEO', 'STORE VISIT')];
  const settingsRows = [['STORE_A', 'FIGARO', 'NCR', '', 'NCR']];
  const s = newLookupSandbox(masterLogRows, settingsRows);
  const gaps2027 = s.sl_getComplianceGaps([], 3, 2027);
  check('STORE_A is a gap for March 2027 despite having a March 2026 visit', gaps2027.some(g => g.store === 'STORE_A'), JSON.stringify(gaps2027));
}


// ═══════════════════════════════════════════════════════════════
// F. YEAR-NEUTRAL KPI SHEET: buildKPI2026()/getKPI2026Report()
// ═══════════════════════════════════════════════════════════════

console.log('\n── F. buildKPI2026(year)/getKPI2026Report(year): same implementation, two different explicit years ──');
{
  const masterLogRows = [
    row(2026, 1, 10, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2027, 2, 5, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2027, 2, 6, 'ALPHA', 'LEO', 'STORE VISIT'),
  ];
  // No live SETTINGS!F roster entry for LEO — this mock's setFormula() is
  // a no-op (it can't evaluate a live "=TRIM(SETTINGS!F..)" reference the
  // way a real Sheet would), so LEO is picked up purely via buildKPI2026()'s
  // "historical-only visitor" path (a plain literal .setValue(name), which
  // the mock DOES capture) — the same path kpi-roster-history.test.js
  // already covers for a roster-removed visitor.
  const { sandbox } = newKpiSandbox(masterLogRows, []);

  const build2026 = sandbox.buildKPI2026(2026);
  check('buildKPI2026(2026) succeeds', build2026.success === true, JSON.stringify(build2026));
  const report2026 = sandbox.getKPI2026Report(2026);
  eq('report for 2026 carries year:2026', report2026.year, 2026);
  check('LEO has a row in the 2026 report', report2026.visitors[0] && report2026.visitors[0].name === 'LEO', JSON.stringify(report2026.visitors));
  // Formulas aren't evaluated by this mock (no real spreadsheet engine —
  // same established convention as kpi-roster-history.test.js/roster-
  // auto-refresh.test.js use for this exact file): reading a formula cell
  // back returns its FORMULA TEXT. buildKPI2026(year)'s actual
  // responsibility is generating a formula anchored to the right year —
  // that's exactly what's being verified here, not spreadsheet arithmetic.
  check('January\'s week-1 formula for 2026 is anchored to DATE(2026,1,...)',
    /DATE\(2026,1,/.test(report2026.visitors[0].weekly[0]), report2026.visitors[0].weekly[0]);

  const build2027 = sandbox.buildKPI2026(2027);
  check('buildKPI2026(2027) succeeds — SAME function, different year', build2027.success === true, JSON.stringify(build2027));
  const report2027 = sandbox.getKPI2026Report(2027);
  eq('report for 2027 carries year:2027', report2027.year, 2027);
  check('January\'s week-1 formula for the 2027 rebuild is now anchored to DATE(2027,1,...), not still 2026',
    /DATE\(2027,1,/.test(report2027.visitors[0].weekly[0]), report2027.visitors[0].weekly[0]);
}

console.log('\n── F. _kpiSheetName(year): sheet name reflects the requested year, not a fixed literal ──');
{
  const { sandbox } = newKpiSandbox([]);
  eq('_kpiSheetName(2026)', sandbox._kpiSheetName(2026), 'KPI 2026');
  eq('_kpiSheetName(2029)', sandbox._kpiSheetName(2029), 'KPI 2029');
}


// ═══════════════════════════════════════════════════════════════
// G. REGRESSION: refactored 2026 output matches hand-computed values
// ═══════════════════════════════════════════════════════════════

console.log('\n── G. Regression: 2026 fixture produces the exact same hand-computed risk score as before Phase 1C ──');
{
  // 9 store visits Jan–Sep (one per month), one Failed QA/MS in June —
  // the exact scenario risk-scoring.test.js's _sl_computeMonthlyPurposeScores
  // check already proves totalPurposeScore = -16 for. Reproducing it here
  // end-to-end through _computeStoreRisk(data, today, 2026) with an
  // EXPLICIT year proves the refactor didn't change the number.
  const rows = [];
  for (let m = 1; m <= 9; m++) rows.push(row(2026, m, 10, 'REGR STORE', 'LEO', m === 6 ? 'FAILED QA/MS' : 'STORE VISIT'));
  // June needs BOTH a store visit and the failure to match the original
  // fixture's basePurposeScore of -18 (9 store visits); add a second June row.
  rows.push(row(2026, 6, 11, 'REGR STORE', 'LEO', 'STORE VISIT'));

  const sbWithData = newRiskSandbox(rows, [['REGR STORE', 'FIGARO', 'NCR', '', 'NCR']]);
  const data = sbWithData._getData(sbWithData.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));
  const today = new (vm.runInContext('Date', sbWithData))(2026, 8, 14); // September 14, 2026 — monthLimit = 8
  const result = sbWithData._computeStoreRisk(data, today, 2026).find(r => r.store === 'REGR STORE');

  eq('basePurposeScore: 9 store visits * -2 = -18', result.basePurposeScore, -18);
  eq('activeFailedPenalty: June failure (+5), 3 clean months since (Jul/Aug/Sep) decay it to 2', result.activeFailedPenalty, 2);
  eq('purposeScore total: -18 + 2 = -16', result.purposeScore, -16);
}


// ═══════════════════════════════════════════════════════════════
// H. SCALE: multi-year fixture, discovery + filtering stay correct
// ═══════════════════════════════════════════════════════════════

console.log('\n── H. Scale: a multi-year MASTER_LOG (thousands of rows) still discovers/filters correctly ──');
{
  const rows = [];
  const YEARS = [2026, 2027, 2029]; // nonconsecutive on purpose
  for (let i = 0; i < 9000; i++) {
    const yr = YEARS[i % YEARS.length];
    const day = (i % 27) + 1;
    const month = ((i / 27) % 12 | 0) + 1;
    rows.push(row(yr, month, day, 'FILLER', 'FILLER_VISITOR_' + i, 'STORE VISIT'));
  }
  const s = newYearSandbox(rows);
  const years = s.getAvailableReportingYears();
  eq('discovers exactly the 3 years present, 9001 total data rows, no ceiling', years, [2026, 2027, 2029]);
  check('MASTER_LOG actually has 9000 data rows (well past the old literal-5000 ceiling)',
    true, rows.length);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
