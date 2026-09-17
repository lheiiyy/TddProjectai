// Unit test for the "adding data should show up automatically" fix:
// manageVisitor('add', name) (INPUT_PORTAL.gs) must rebuild the KPI 2026
// sheet right away if it already exists, since a brand-new roster member
// has no formula row yet for their future visits to recalculate into —
// unlike Executive Summary's open-column COUNTIFS, there's nothing for
// them to "recalculate" until buildKPI2026() creates their row.
//
// Runs the REAL Apps Script code (INPUT_PORTAL.gs + SVMKPI_KPI_REBUILD.gs +
// SVMKPI_REPORTS.gs) in a Node vm sandbox, same approach as
// kpi-roster-history.test.js, but with a single generic writable Sheet
// mock shared by both SETTINGS and the KPI 2026 sheet (manageVisitor()
// writes to SETTINGS, so the read-only SETTINGS mock the other file uses
// isn't enough here).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const inputSrc   = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'INPUT_PORTAL.gs'), 'utf8');
const kpiSrc      = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_KPI_REBUILD.gs'), 'utf8');
const reportsSrc  = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_REPORTS.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

// ── Generic writable Sheet/Range mock (cells: {row,col} -> {value, formula}) ──
function makeSheet(resolveSettingsRef) {
  const cells = {};
  const key = (r, c) => r + ',' + c;

  function resolveFormula(f) {
    const m = /^=TRIM\(SETTINGS!F(\d+)\)$/.exec(f);
    if (m && resolveSettingsRef) return resolveSettingsRef(Number(m[1]));
    return f;
  }
  function displayOf(cell) {
    if (!cell) return '';
    if (cell.formula != null) return String(resolveFormula(cell.formula));
    return cell.value == null ? '' : String(cell.value);
  }

  function makeRange(row, col, numRows, numCols) {
    const range = {};
    let proxy;
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
    range.clearContent = () => { for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) delete cells[key(row + r, col + c)]; return proxy; };
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
        return () => proxy;
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
  };
  let sproxy;
  sproxy = new Proxy(sheet, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      return () => sproxy;
    },
  });
  return sproxy;
}

// ── Scenario: SETTINGS already has LEO on the roster + one MASTER_LOG
//    visit; manageVisitor('add', 'BEA') should immediately create a KPI
//    2026 row for BEA too, since the sheet already exists ──────────────
console.log('\n── manageVisitor(\'add\', ...) auto-rebuilds an existing KPI 2026 sheet ──');

const sheetsByName = {};
const settingsSheet = makeSheet();
// Seed LEO on the roster (row 2, col 6) directly in the mock's cell store.
settingsSheet.getRange(2, 6).setValue('LEO');

const sandbox = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => {
        if (name === 'SETTINGS') return settingsSheet;
        return sheetsByName[name] || null;
      },
      insertSheet: (name) => { const s = makeSheet((row) => settingsSheet.getRange(row, 6).getValue()); sheetsByName[name] = s; return s; },
    }),
    flush: () => {},
  },
  SHEET: { SETTINGS: 'SETTINGS', MASTER_LOG: 'MASTER_LOG' },
  DATA_YEAR: 2026,
  _getSheet: () => ({}),
  _getData: () => ({ dates: [], rawVisitors: [] }), // no visits yet in this scenario
  Logger: { log: () => {} },
  console,
};
vm.createContext(sandbox);
vm.runInContext(inputSrc, sandbox);
vm.runInContext(kpiSrc, sandbox);
vm.runInContext(reportsSrc, sandbox);

// Build the KPI 2026 sheet once, before BEA is ever added — mirrors an
// admin having rebuilt it earlier with only LEO on the roster.
sandbox.buildKPI2026();
check('KPI 2026 sheet exists with just LEO before BEA is added',
  !!sandbox.getSidebarData, true);

const beforeAdd = sandbox.getKPI2026Report();
check('before adding BEA: only 1 visitor row (LEO)',
  beforeAdd.visitors.length === 1 && beforeAdd.visitors[0].name === 'LEO',
  JSON.stringify(beforeAdd.visitors.map(v => v.name)));

const result = sandbox.manageVisitor('add', 'BEA');
check('manageVisitor add succeeds', result && result.success === true, JSON.stringify(result));

const afterAdd = sandbox.getKPI2026Report();
check('after adding BEA: KPI 2026 was auto-rebuilt and now has 2 visitor rows',
  afterAdd.visitors.length === 2, JSON.stringify(afterAdd.visitors.map(v => v.name)));
check('BEA now has her own row, with no rebuild ever run by hand',
  afterAdd.visitors.map(v => v.name).includes('BEA'), afterAdd.visitors.map(v => v.name).join(','));

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
