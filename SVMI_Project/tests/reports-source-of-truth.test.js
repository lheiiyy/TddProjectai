// SVMI Reports Tab — source-of-truth fix + Additional Purpose
// (see reviews/013-reports-source-of-truth.md and DECISIONS.md D-036).
//
// Proves getExecutiveSummaryReport() (SVMKPI_REPORTS.gs):
//   1. Computes every metric/dimension DIRECTLY from MASTER_LOG (Data
//      Records) — never from the EXECUTIVE SUMMARY sheet, a KPI sheet, or
//      any other generated/cached report.
//   2. Additional Purpose is calculated from Data Records, respects the
//      selected reporting year, is never hardcoded, and needs no report
//      sheet.
//   3. The report dataset (`records`) exposes Additional Purpose/Visitor/
//      Brand/Store as real, filterable fields — not display-only labels —
//      alongside the rest of the relevant Data Record fields.
//   4. The selected year is a pure read filter: switching years changes
//      the result but never mutates MASTER_LOG, and needs no per-year
//      report/KPI sheet to exist.
//   5. Existing metrics (Total Visits/Store Visits/TLTC/Failed QA/MS/
//      Curing-Support/NCR/Provincial) still compute correctly.
//
// Runs the REAL Apps Script code (SVMKPI_CORE/REPORTING_YEAR/LAYOUT/
// REPORTS.gs) in a Node vm sandbox — same generic writable-Sheet-mock
// pattern already used by purpose-report-surfaces.test.js et al.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc    = APPS('SVMKPI_CORE.gs');
const yearSrc    = APPS('SVMKPI_REPORTING_YEAR.gs');
const layoutSrc  = APPS('SVMKPI_LAYOUT.gs');
const riskCfgSrc = APPS('SVMKPI_RISK_CONFIG.gs');
const riskSrc    = APPS('SVMKPI_RISK.gs');
const reportsSrc = APPS('SVMKPI_REPORTS.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Generic writable Sheet mock (established pattern, verbatim from
// purpose-report-surfaces.test.js) ─────────────────────────────────────
function _colLetterToNum(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}
function _parseA1(a1) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
  if (!m) return null;
  const col1 = _colLetterToNum(m[1]);
  const row1 = Number(m[2]);
  if (!m[3]) return { row: row1, col: col1, numRows: 1, numCols: 1 };
  const col2 = _colLetterToNum(m[3]);
  const row2 = Number(m[4]);
  return { row: row1, col: col1, numRows: row2 - row1 + 1, numCols: col2 - col1 + 1 };
}
function makeWritableSheet() {
  const cells = {};
  let maxRow = 0;
  const key = (r, c) => r + ',' + c;
  function setCell(r, c, v) { cells[key(r, c)] = v; if (r > maxRow) maxRow = r; }
  function getCell(r, c) { const v = cells[key(r, c)]; return v == null ? '' : v; }
  function makeRange(row, col, numRows, numCols) {
    const range = {};
    let proxy;
    range.setValue = (v) => { setCell(row, col, v); return proxy; };
    range.setValues = (rows) => { rows.forEach((rowArr, ri) => rowArr.forEach((v, ci) => setCell(row + ri, col + ci, v))); return proxy; };
    range.setFormula = (f) => { setCell(row, col, f); return proxy; };
    range.setFormulas = (rows) => { rows.forEach((rowArr, ri) => rowArr.forEach((f, ci) => setCell(row + ri, col + ci, f))); return proxy; };
    range.getValue = () => getCell(row, col);
    range.getDisplayValue = () => String(getCell(row, col));
    range.getValues = () => { const out = []; for (let r = 0; r < numRows; r++) { const rowArr = []; for (let c = 0; c < numCols; c++) rowArr.push(getCell(row + r, col + c)); out.push(rowArr); } return out; };
    range.getDisplayValues = () => range.getValues().map(r => r.map(String));
    proxy = new Proxy(range, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => proxy; } });
    return proxy;
  }
  const sheet = {
    getLastRow: () => maxRow,
    getMaxRows: () => Math.max(maxRow, 10),
    getMaxColumns: () => 200,
    insertRowsAfter: () => {}, insertColumnsAfter: () => {},
    getRange: (rowOrA1, col, numRows, numCols) => {
      if (typeof rowOrA1 === 'string') {
        const parsed = _parseA1(rowOrA1);
        if (parsed) return makeRange(parsed.row, parsed.col, parsed.numRows, parsed.numCols);
      }
      return makeRange(rowOrA1, col, numRows || 1, numCols || 1);
    },
    clear: () => {}, clearFormats: () => {}, setRowHeight: () => {}, setColumnWidth: () => {},
    setFrozenRows: () => {}, setFrozenColumns: () => {},
    appendRow: (rowArr) => { const r = maxRow + 1; rowArr.forEach((v, i) => setCell(r, i + 1, v)); },
  };
  let sproxy;
  sproxy = new Proxy(sheet, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => sproxy; } });
  return sproxy;
}
function makeSpreadsheetMock() {
  const sheets = {};
  return { getSheetByName: (name) => sheets[name] || null, insertSheet: (name) => { const s = makeWritableSheet(); sheets[name] = s; return s; } };
}

function row(y, m, d, store, visitor, purpose, brand, region) {
  const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return [ds + ' 08:00:00', ds, store, brand || 'FIGARO', region || 'NCR', visitor, purpose || 'STORE VISIT'];
}

function newSandbox() {
  const ssMock = makeSpreadsheetMock();
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ssMock, flush: () => {},
      BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM' },
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  [coreSrc, yearSrc, layoutSrc, riskCfgSrc, riskSrc, reportsSrc].forEach(src => vm.runInContext(src, sandbox));
  return { sandbox, ssMock };
}

function buildMasterLog(ssMock, rows) {
  const master = ssMock.insertSheet('MASTER_LOG');
  master.getRange(1, 1, 1, 9).setValues([['Timestamp', 'Date', 'Store', 'Brand', 'Region', 'Visited By', 'Purpose', 'Remarks', 'Store ID']]);
  rows.forEach(r => master.appendRow(r));
  return master;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 1 — SOURCE-OF-TRUTH: never reads the EXECUTIVE SUMMARY sheet,
// a KPI sheet, or any other generated report as its authoritative source.
// ═══════════════════════════════════════════════════════════════

console.log('\n── SOURCE OF TRUTH: getExecutiveSummaryReport() source text ──');
{
  // Isolate just this function's own body (not the whole file, which
  // still legitimately contains SHEET.SUMMARY/KPI references for
  // getKPI2026Report()/getStoreHealthReport() — those are unmodified and
  // out of scope for this fix) to prove IT specifically no longer touches
  // the EXECUTIVE SUMMARY sheet or any KPI-year sheet. Brace-counted from
  // the signature's own opening "{" to its matching close, so the slice
  // never bleeds into a neighboring function's JSDoc/body.
  const sigStart = reportsSrc.indexOf('function getExecutiveSummaryReport(');
  const braceStart = reportsSrc.indexOf('{', sigStart);
  let depth = 0, i = braceStart;
  for (; i < reportsSrc.length; i++) {
    if (reportsSrc[i] === '{') depth++;
    else if (reportsSrc[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const fnBody = reportsSrc.slice(sigStart, i);
  check('function body found', fnBody.length > 0, fnBody.length);
  check('does not read SHEET.SUMMARY (the EXECUTIVE SUMMARY sheet) at all', !fnBody.includes('SHEET.SUMMARY'));
  check('does not reference a KPI-year sheet name (_kpiSheetName/"KPI 2026")', !/_kpiSheetName|KPI 2026|KPI 2027/.test(fnBody));
  check('does read MASTER_LOG via the canonical _getData() reader', fnBody.includes('_getData(') && fnBody.includes('SHEET.MASTER_LOG'));
  check('never calls SpreadsheetApp\'s write methods (setValue/setValues/setFormula) — read-only', !/\.setValue|\.setValues|\.setFormula/.test(fnBody));
}

console.log('\n── SOURCE OF TRUTH: reader works with NO EXECUTIVE SUMMARY sheet present at all ──');
{
  const { sandbox, ssMock } = newSandbox();
  buildMasterLog(ssMock, [row(2026, 3, 1, 'ALPHA', 'LEO', 'STORE VISIT')]);
  // Deliberately never insertSheet('EXECUTIVE SUMMARY') — the old reader
  // would throw 'EXECUTIVE SUMMARY sheet not found' here.
  let threw = null;
  let report;
  try { report = sandbox.getExecutiveSummaryReport(2026); } catch (e) { threw = e; }
  check('getExecutiveSummaryReport() succeeds with no EXECUTIVE SUMMARY sheet in the spreadsheet at all', threw === null, threw && threw.message);
  check('...and still returns the real Total Visits count from MASTER_LOG', !!report && report.kpi[0].value === '1', JSON.stringify(report && report.kpi));
}

console.log('\n── SOURCE OF TRUTH: a stale/wrong EXECUTIVE SUMMARY sheet is ignored — MASTER_LOG truth wins ──');
{
  const { sandbox, ssMock } = newSandbox();
  buildMasterLog(ssMock, [
    row(2026, 3, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2026, 3, 2, 'ALPHA', 'LEO', 'TLTC'),
  ]);
  // A deliberately WRONG, stale EXECUTIVE SUMMARY sheet — if the reader
  // depended on it at all, these fabricated numbers would leak through.
  const es = ssMock.insertSheet('EXECUTIVE SUMMARY');
  es.getRange(7, 3, 1, 7).setValues([['9999', '9999', '9999', '9999', '9999', '9999', '9999']]);
  const report = sandbox.getExecutiveSummaryReport(2026);
  eq('Total Visits reflects the REAL 2 MASTER_LOG rows, not the fabricated 9999 sitting in the stale sheet', report.kpi[0].value, '2');
  eq('TLTC reflects the real 1 row, not 9999', report.kpi.find(k => k.label === 'TLTC').value, '1');
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2 — ADDITIONAL PURPOSE
// ═══════════════════════════════════════════════════════════════

console.log('\n── ADDITIONAL PURPOSE: calculated from Data Records, correct count, not hardcoded ──');
{
  const { sandbox, ssMock } = newSandbox();
  buildMasterLog(ssMock, [
    row(2026, 3, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2026, 3, 2, 'ALPHA', 'LEO', 'TLTC'),
    row(2026, 3, 3, 'ALPHA', 'LEO', 'FAILED QA/MS'),
    row(2026, 3, 4, 'ALPHA', 'LEO', 'CURING/SUPPORT'),
    row(2026, 3, 5, 'ALPHA', 'LEO', 'SPECIAL_AUDIT'),   // additional
    row(2026, 3, 6, 'ALPHA', 'LEO', 'SPECIAL_AUDIT'),   // additional
    row(2026, 3, 7, 'ALPHA', 'LEO', 'FRANCHISE_REVIEW'), // additional
  ]);
  const report = sandbox.getExecutiveSummaryReport(2026);
  const additional = report.kpi.find(k => k.label === 'Additional Purpose');
  check('Additional Purpose KPI card is present', !!additional);
  eq('Additional Purpose counts exactly the 3 non-legacy-purpose visits (SPECIAL_AUDIT x2 + FRANCHISE_REVIEW x1)', additional.value, '3');
  eq('Total Visits still counts all 7 rows (Additional Purpose is a breakdown, not an exclusion)', report.kpi[0].value, '7');
}

console.log('\n── ADDITIONAL PURPOSE: not hardcoded — changes when the underlying data changes ──');
{
  const { sandbox: sb1, ssMock: ss1 } = newSandbox();
  buildMasterLog(ss1, [row(2026, 3, 1, 'A', 'LEO', 'STORE VISIT')]);
  const before = sb1.getExecutiveSummaryReport(2026).kpi.find(k => k.label === 'Additional Purpose').value;
  eq('zero additional-purpose visits in the baseline fixture', before, '0');

  const { sandbox: sb2, ssMock: ss2 } = newSandbox();
  buildMasterLog(ss2, [
    row(2026, 3, 1, 'A', 'LEO', 'STORE VISIT'),
    row(2026, 3, 2, 'A', 'LEO', 'NEWLY_CONFIGURED_PURPOSE'),
  ]);
  const after = sb2.getExecutiveSummaryReport(2026).kpi.find(k => k.label === 'Additional Purpose').value;
  eq('adding one additional-purpose row changes the count to 1 (proves it is computed, not a fixed literal)', after, '1');

  check('SVMKPI_REPORTS.gs contains no hardcoded reference to either synthetic purpose used in this proof',
    !reportsSrc.includes('NEWLY_CONFIGURED_PURPOSE') && !reportsSrc.includes('SPECIAL_AUDIT') && !reportsSrc.includes('FRANCHISE_REVIEW'));
}

console.log('\n── ADDITIONAL PURPOSE: respects the selected reporting year ──');
{
  const { sandbox, ssMock } = newSandbox();
  buildMasterLog(ssMock, [
    row(2026, 3, 1, 'A', 'LEO', 'STORE VISIT'),
    row(2026, 3, 2, 'A', 'LEO', 'SPECIAL_AUDIT'),   // 2026: 1 additional
    row(2027, 3, 1, 'A', 'LEO', 'STORE VISIT'),
    row(2027, 3, 2, 'A', 'LEO', 'SPECIAL_AUDIT'),
    row(2027, 3, 3, 'A', 'LEO', 'SPECIAL_AUDIT'),   // 2027: 2 additional
  ]);
  const r2026 = sandbox.getExecutiveSummaryReport(2026);
  const r2027 = sandbox.getExecutiveSummaryReport(2027);
  eq('2026 Additional Purpose = 1', r2026.kpi.find(k => k.label === 'Additional Purpose').value, '1');
  eq('2027 Additional Purpose = 2', r2027.kpi.find(k => k.label === 'Additional Purpose').value, '2');
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3 — REQUIRED DIMENSIONS: Additional Purpose / Visitor / Brand /
// Store must exist as real fields in the report dataset, plus the rest of
// the relevant Data Record fields — never a narrowed 4-field dataset.
// ═══════════════════════════════════════════════════════════════

console.log('\n── DIMENSIONS: report.records carries Additional Purpose/Visitor/Brand/Store as real fields, plus the rest of the Data Record ──');
{
  const { sandbox, ssMock } = newSandbox();
  buildMasterLog(ssMock, [
    row(2026, 3, 15, 'ALPHA', 'LEO|YANA', 'SPECIAL_AUDIT', 'APEX', 'PROVINCIAL'),
  ]);
  const report = sandbox.getExecutiveSummaryReport(2026);
  check('records is an array with exactly 1 entry', Array.isArray(report.records) && report.records.length === 1, JSON.stringify(report.records));
  const rec = report.records[0];
  eq('store dimension present and correct', rec.store, 'ALPHA');
  eq('brand dimension present and correct', rec.brand, 'APEX');
  eq('region present and correct (relevant Data Record field, not one of the 4 mandatory dims but preserved anyway)', rec.region, 'PROVINCIAL');
  eq('visitor dimension present, correct, and split into individual names (not a raw pipe-joined string)', rec.visitor, ['LEO', 'YANA']);
  eq('purpose (raw) preserved', rec.purpose, 'SPECIAL_AUDIT');
  eq('additionalPurpose dimension present and true for a non-legacy purpose', rec.additionalPurpose, true);
  check('date field present (relevant Data Record field)', typeof rec.date === 'string' && rec.date.length > 0, rec.date);
  check('the dataset was not narrowed to only the 4 mandatory dimensions — other Data Record fields (date, region, timestamp) are still present',
    ('date' in rec) && ('region' in rec) && ('timestamp' in rec));
}

console.log('\n── DIMENSIONS: additionalPurpose is false for the 4 legacy purposes, true for anything else ──');
{
  const { sandbox, ssMock } = newSandbox();
  buildMasterLog(ssMock, [
    row(2026, 1, 1, 'A', 'LEO', 'STORE VISIT'),
    row(2026, 1, 2, 'A', 'LEO', 'TLTC'),
    row(2026, 1, 3, 'A', 'LEO', 'FAILED QA/MS'),
    row(2026, 1, 4, 'A', 'LEO', 'CURING/SUPPORT'),
    row(2026, 1, 5, 'A', 'LEO', 'SOMETHING_ELSE'),
  ]);
  const records = sandbox.getExecutiveSummaryReport(2026).records;
  ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'].forEach(p => {
    const r = records.find(x => x.purpose === p);
    check(p + ' is NOT flagged as an additional purpose', !!r && r.additionalPurpose === false, JSON.stringify(r));
  });
  const extra = records.find(x => x.purpose === 'SOMETHING_ELSE');
  check('SOMETHING_ELSE IS flagged as an additional purpose', !!extra && extra.additionalPurpose === true, JSON.stringify(extra));
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4 — YEAR SELECTION: pure read filter, non-mutating, no
// per-year report/KPI sheet required.
// ═══════════════════════════════════════════════════════════════

console.log('\n── YEAR SELECTION: two different years produce two different results from the SAME Data Records ──');
{
  const { sandbox, ssMock } = newSandbox();
  const rowsFixture = [
    row(2026, 1, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2026, 2, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2026, 3, 1, 'BETA',  'YANA', 'TLTC'),
    row(2027, 1, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
  ];
  buildMasterLog(ssMock, rowsFixture);

  const r2026 = sandbox.getExecutiveSummaryReport(2026);
  const r2027 = sandbox.getExecutiveSummaryReport(2027);
  eq('2026 Total Visits = 3', r2026.kpi[0].value, '3');
  eq('2027 Total Visits = 1', r2027.kpi[0].value, '1');
  eq('2026 selectedYear echoed back correctly', r2026.selectedYear, 2026);
  eq('2027 selectedYear echoed back correctly', r2027.selectedYear, 2027);
  check('2026 and 2027 produce genuinely different record sets', r2026.records.length !== r2027.records.length,
    JSON.stringify({ y2026: r2026.records.length, y2027: r2027.records.length }));
}

console.log('\n── YEAR SELECTION: switching years never mutates MASTER_LOG ──');
{
  const { sandbox, ssMock } = newSandbox();
  const master = buildMasterLog(ssMock, [
    row(2026, 1, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2027, 1, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
  ]);
  const beforeRows = master.getRange(2, 1, master.getLastRow() - 1, 7).getValues();
  sandbox.getExecutiveSummaryReport(2026);
  sandbox.getExecutiveSummaryReport(2027);
  sandbox.getExecutiveSummaryReport(2026);
  const afterRows = master.getRange(2, 1, master.getLastRow() - 1, 7).getValues();
  eq('MASTER_LOG row count unchanged after three report calls across two different years', afterRows.length, beforeRows.length);
  eq('MASTER_LOG cell contents byte-for-byte unchanged', afterRows, beforeRows);
}

console.log('\n── YEAR SELECTION: omitting year defaults to the latest year actually present (never a hardcoded literal) ──');
{
  const { sandbox, ssMock } = newSandbox();
  buildMasterLog(ssMock, [
    row(2026, 1, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2029, 1, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
  ]);
  const report = sandbox.getExecutiveSummaryReport(); // no year argument
  eq('defaults to 2029 (the latest year present in MASTER_LOG), not a hardcoded 2026', report.selectedYear, 2029);
  eq('availableYears reflects both years actually present, ascending', report.availableYears, [2026, 2029]);
}

console.log('\n── YEAR SELECTION: works correctly with no year-specific report/KPI sheet ever created ──');
{
  const { sandbox, ssMock } = newSandbox();
  buildMasterLog(ssMock, [row(2026, 1, 1, 'ALPHA', 'LEO', 'STORE VISIT')]);
  // Deliberately never insertSheet('KPI 2026') or 'EXECUTIVE SUMMARY'.
  let threw = null;
  try { sandbox.getExecutiveSummaryReport(2026); } catch (e) { threw = e; }
  check('no "KPI 2026 sheet not found" or "EXECUTIVE SUMMARY sheet not found" error — no sheet dependency at all', threw === null, threw && threw.message);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5 — EXISTING METRICS REGRESSION
// ═══════════════════════════════════════════════════════════════

console.log('\n── EXISTING METRICS: Total/Store/TLTC/Failed/Curing/NCR/Provincial all compute correctly against a hand-checked fixture ──');
{
  const { sandbox, ssMock } = newSandbox();
  buildMasterLog(ssMock, [
    row(2026, 1, 5,  'ALPHA', 'LEO',        'STORE VISIT',    'FIGARO', 'NCR'),
    row(2026, 1, 6,  'ALPHA', 'LEO|YANA',   'TLTC',           'FIGARO', 'NCR'),
    row(2026, 2, 1,  'BETA',  'YANA',       'FAILED QA/MS',   'APEX',   'PROVINCIAL'),
    row(2026, 2, 2,  'BETA',  'YANA',       'CURING/SUPPORT', 'APEX',   'PROVINCIAL'),
    row(2026, 3, 1,  'GAMMA', 'LEO',        'STORE VISIT',    'FIGARO', 'FRANCHISE'),
  ]);
  const r = sandbox.getExecutiveSummaryReport(2026);
  eq('Total Visits = 5', r.kpi[0].value, '5');
  eq('Store Visits = 2', r.kpi.find(k => k.label === 'Store Visits').value, '2');
  eq('TLTC = 1', r.kpi.find(k => k.label === 'TLTC').value, '1');
  eq('Failed QA/MS = 1', r.kpi.find(k => k.label === 'Failed QA/MS').value, '1');
  eq('Curing/Support = 1', r.kpi.find(k => k.label === 'Curing/Support').value, '1');
  eq('NCR = 2', r.kpi.find(k => k.label === 'NCR').value, '2');
  eq('Provincial = 2', r.kpi.find(k => k.label === 'Provincial').value, '2');

  eq('Top Stores: ALPHA=2, BETA=2, GAMMA=1, correct ranking', r.topStores.map(s => s.name + ':' + s.visits),
    ['ALPHA:2', 'BETA:2', 'GAMMA:1']);
  eq('Leaderboard: LEO=3 (Jan5,Jan6 split,Mar1), YANA=3 (Jan6 split,Feb1,Feb2) — pipe-split visitor counting rule applied',
    r.leaderboard.map(v => v.name + ':' + v.visits), ['LEO:3', 'YANA:3']);

  const figaro = r.brandPerformance.find(b => b.brand === 'FIGARO');
  eq('Brand Performance: FIGARO total = 3', figaro.total, '3');
  const apex = r.brandPerformance.find(b => b.brand === 'APEX');
  eq('Brand Performance: APEX total = 2', apex.total, '2');

  const janRow = r.monthly.find(m => m.month === 'JANUARY');
  const figaroCol = r.monthBrandLabels.indexOf('FIGARO');
  eq('Monthly by Brand: January FIGARO column = 2', janRow.byBrand[figaroCol], '2');
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
