// Unit tests for KPI 2026's "keep historical data" guarantee: someone
// removed from the visitor roster (SETTINGS!F) who still has real
// MASTER_LOG visit history must keep showing up in the KPI 2026 sheet
// and report, not silently disappear on the next rebuild.
//
// Runs the REAL Apps Script code (SVMKPI_KPI_REBUILD.gs + SVMKPI_REPORTS.gs)
// in a Node vm sandbox, same pattern as risk-scoring.test.js. SpreadsheetApp
// is backed by an in-memory cell store (a generic Range mock that records
// setValue()/setFormula() and fakes just enough "evaluation" to read a
// =TRIM(SETTINGS!F<n>) name formula back — full SUMPRODUCT evaluation is
// out of scope (that needs a real Sheets engine), so these tests check
// structure (who gets a row, whether their name is a live formula or a
// literal, what search term their week formula embeds) rather than the
// exact numeric totals a live rebuild would produce.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const kpiSrc     = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_KPI_REBUILD.gs'), 'utf8');
const reportsSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_REPORTS.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

// ── In-memory Sheet/Range mock ──────────────────────────────────────
// Cells store {value, formula}. Reading resolves a small set of formula
// shapes we actually need ("=TRIM(SETTINGS!F<n>)" and literal strings);
// anything else (SUMPRODUCT/SUM totals) reads back as the formula text
// itself, since we're not evaluating spreadsheet formulas here.
function makeSheet(settingsSheet) {
  const cells = {};
  const key = (r, c) => r + ',' + c;

  function resolveFormula(f) {
    const m = /^=TRIM\(SETTINGS!F(\d+)\)$/.exec(f);
    if (m) return settingsSheet.rawGet(Number(m[1]), 6);
    return f; // SUMPRODUCT/SUM/etc — not evaluated, returned as-is
  }
  function displayOf(cell) {
    if (!cell) return '';
    if (cell.formula != null) return String(resolveFormula(cell.formula));
    return cell.value == null ? '' : String(cell.value);
  }

  function makeRange(row, col, numRows, numCols) {
    // Real implementations for the handful of methods this test cares
    // about (reading/writing cell content); every other chained styling
    // call (.setBackground(), .setBorder(), .merge(), ...) is unknown to
    // this mock on purpose — a Proxy no-ops anything not listed here and
    // returns the range itself, so new styling calls in the real .gs code
    // never need a matching stub added here.
    const range = {};
    let proxy; // declared here so the setters below can return the proxy, not the bare object
    range.setValue = (v) => {
      for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) cells[key(row + r, col + c)] = { value: v, formula: null };
      return proxy;
    };
    range.setFormula = (f) => { cells[key(row, col)] = { value: null, formula: f }; return proxy; };
    range.setValues = (rows) => {
      rows.forEach((rowArr, ri) => rowArr.forEach((v, ci) => { cells[key(row + ri, col + ci)] = { value: v, formula: null }; }));
      return proxy;
    };
    range.setFormulas = (rows) => {
      rows.forEach((rowArr, ri) => rowArr.forEach((f, ci) => { cells[key(row + ri, col + ci)] = { value: null, formula: f }; }));
      return proxy;
    };
    range.getValue = () => { const c = cells[key(row, col)]; return c && c.formula != null ? resolveFormula(c.formula) : (c ? c.value : ''); };
    range.getValues = () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const rowArr = [];
        for (let c = 0; c < numCols; c++) { const cell = cells[key(row + r, col + c)]; rowArr.push(cell && cell.formula != null ? resolveFormula(cell.formula) : (cell ? cell.value : '')); }
        out.push(rowArr);
      }
      return out;
    };
    range.getDisplayValues = () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const rowArr = [];
        for (let c = 0; c < numCols; c++) rowArr.push(displayOf(cells[key(row + r, col + c)]));
        out.push(rowArr);
      }
      return out;
    };
    proxy = new Proxy(range, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string') return undefined;
        return () => proxy; // any unlisted method: no-op, chainable
      },
    });
    return proxy;
  }

  const sheet = {
    _cells: cells,
    clear() { Object.keys(cells).forEach(k => delete cells[k]); },
    clearFormats() {},
    getMaxRows() { return 1000; },
    getMaxColumns() { return 200; },
    getLastRow() {
      let max = 0;
      Object.keys(cells).forEach(k => { const r = parseInt(k.split(',')[0], 10); if (cells[k] && (cells[k].value != null && cells[k].value !== '' || cells[k].formula != null) && r > max) max = r; });
      return max;
    },
    getRange(row, col, numRows, numCols) { return makeRange(row, col, numRows || 1, numCols || 1); },
    // test helper: read a raw written cell's formula text (not evaluated)
    rawFormula(row, col) { const c = cells[key(row, col)]; return c ? c.formula : null; },
    rawCell(row, col) { return cells[key(row, col)] || null; },
  };
  // Same rationale as makeRange()'s Proxy: any sheet-level layout/format
  // call this test doesn't care about (setRowHeight, insertRowsAfter,
  // setFrozenColumns, ...) no-ops and returns the sheet, chainable.
  let proxy;
  proxy = new Proxy(sheet, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      return () => proxy;
    },
  });
  return proxy;
}

function makeSettingsSheet(rows) {
  // rows: [store, brand, region, _unused, category, visitor][]
  const lastRow = rows.length + 1;
  return {
    getLastRow: () => lastRow,
    getRange: (row, col, numRows) => ({
      getValues: () => rows.slice(row - 2, row - 2 + numRows).map(r => [r[col - 1]]),
    }),
    rawGet(row, col) {
      const r = rows[row - 2];
      return r ? r[col - 1] : '';
    },
  };
}

// masterLogRows: {date: 'YYYY-MM-DD', visitedBy: 'NAME1|NAME2'}[]
function newSandbox(settingsRows, masterLogRows) {
  const settingsSheet = makeSettingsSheet(settingsRows);
  const kpiSheetsByName = {};

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => {
          if (name === 'SETTINGS') return settingsSheet;
          if (kpiSheetsByName[name]) return kpiSheetsByName[name];
          return null;
        },
        insertSheet: (name) => { const s = makeSheet(settingsSheet); kpiSheetsByName[name] = s; return s; },
      }),
      flush: () => {},
    },
    SHEET: { SETTINGS: 'SETTINGS', MASTER_LOG: 'MASTER_LOG' },
    DATA_YEAR: 2026,
    MASTER_LOG_MAX_ROW: 200000, // normally SVMKPI_CORE.gs; this sandbox doesn't load that file
    // Phase 1C: buildKPI2026()/getKPI2026Report() fall back to
    // getDefaultReportingYear() (SVMKPI_REPORTING_YEAR.gs) when no year is
    // passed; this sandbox doesn't load that file either, so stub the
    // same fixed answer DATA_YEAR used to give directly.
    getDefaultReportingYear: () => 2026,
    _getSheet: (name) => ({ __name: name }),
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  const SDate = vm.runInContext('Date', sandbox);
  // Stubbed rather than loading SVMKPI_CORE.gs: this test only needs
  // _getData()'s {dates, rawVisitors} shape, built straight from the
  // masterLogRows fixture. Assigned after createContext so it can use the
  // sandbox's own Date constructor (see risk-scoring.test.js's note on why).
  sandbox._getData = () => ({
    dates: masterLogRows.map(r => new SDate(r.date + 'T00:00:00')),
    rawVisitors: masterLogRows.map(r => r.visitedBy),
  });
  vm.runInContext(kpiSrc, sandbox);
  vm.runInContext(reportsSrc, sandbox);
  return { sandbox, getKpiSheet: () => kpiSheetsByName['KPI 2026'] };
}

// ── Scenario: BEA had real visits in 2026 but has since been removed
//    from the roster (SETTINGS!F no longer lists her) ──────────────
console.log('\n── buildKPI2026(): historical-only visitor gets appended ──');
const settingsRows = [
  ['MAKATI - AYALA AVENUE', "ANGEL'S PIZZA", 'NCR', '', 'NCR', 'LEO'],
  ['BGC - HIGH STREET',     'FIGARO',        'NCR', '', 'NCR', 'YANA'],
];
const masterLogRows = [
  { date: '2026-01-05', visitedBy: 'LEO' },
  { date: '2026-02-10', visitedBy: 'BEA' },        // BEA: no longer on the roster
  { date: '2026-03-02', visitedBy: 'YANA|BEA' },   // multi-visitor row, still counts
];

const { sandbox, getKpiSheet } = newSandbox(settingsRows, masterLogRows);
sandbox.buildKPI2026();
const kpiSheet = getKpiSheet();

check('sheet was created', !!kpiSheet);

const DATA_ROW_START = 6;
const nameCellsWritten = [];
for (let row = DATA_ROW_START; row <= DATA_ROW_START + 5; row++) {
  const c = kpiSheet.rawCell(row, 2); // col B
  if (!c) break;
  nameCellsWritten.push(c);
}
check('4 rows written: LEO, YANA (roster, live formulas), BEA (historical, literal), TEAM TOTAL',
  nameCellsWritten.length === 4, JSON.stringify(nameCellsWritten));
check('4th row is TEAM TOTAL', nameCellsWritten[3] && nameCellsWritten[3].value === 'TEAM TOTAL', JSON.stringify(nameCellsWritten[3]));
check('LEO\'s name cell is a live SETTINGS!F formula (still on the roster)',
  /^=TRIM\(SETTINGS!F2\)$/.test((nameCellsWritten[0] || {}).formula || ''), JSON.stringify(nameCellsWritten[0]));
check('YANA\'s name cell is a live SETTINGS!F formula (still on the roster)',
  /^=TRIM\(SETTINGS!F3\)$/.test((nameCellsWritten[1] || {}).formula || ''), JSON.stringify(nameCellsWritten[1]));
check('BEA\'s name cell is a literal value, not a formula (no SETTINGS row to point to anymore)',
  nameCellsWritten[2] && nameCellsWritten[2].formula == null && nameCellsWritten[2].value === 'BEA',
  JSON.stringify(nameCellsWritten[2]));

// Her week formula must search for a literal "BEA", not a SETTINGS!F ref —
// row DATA_ROW_START+2 (3rd visitor), column KPI_MON_START (=3, Jan W1)
const beaWeekFormula = kpiSheet.rawFormula(DATA_ROW_START + 2, 3);
check('BEA\'s week formula embeds her literal name (not a dangling SETTINGS!F reference)',
  beaWeekFormula && beaWeekFormula.includes('"BEA"') && !beaWeekFormula.includes('SETTINGS!F'),
  beaWeekFormula);

console.log('\n── getKPI2026Report(): reads the sheet directly, not SETTINGS!F ──');
// Shrink the roster to just LEO — a stale/behind-schedule roster edit
// made *after* the rebuild above. The report must still show all 3 rows
// plus TEAM TOTAL, since it no longer trusts SETTINGS!F's row count.
const staleSettings = makeSettingsSheet([settingsRows[0]]);
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getSheetByName: (name) => (name === 'SETTINGS' ? staleSettings : (name === 'KPI 2026' ? kpiSheet : null)),
});
const report = sandbox.getKPI2026Report();
const reportNames = report.visitors.map(v => v.name);
check('report still lists all 3 visitors despite a shrunk SETTINGS!F at read time',
  reportNames.length === 3, JSON.stringify(reportNames));
check('BEA (historical-only) is included in the report', reportNames.includes('BEA'), reportNames.join(','));
check('report correctly stops at TEAM TOTAL, not folded into visitors',
  !reportNames.includes('TEAM TOTAL'), reportNames.join(','));
check('team total row was captured', report.team && Array.isArray(report.team.monthly), JSON.stringify(report.team));

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
