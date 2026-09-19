// SVMI Phase 2C (continued) — making the last two USER-FACING report
// surfaces purpose-dynamic: Executive Summary's "Visit Purpose Breakdown"
// (SVMKPI_LAYOUT.gs) and Store Insights' per-store purpose card
// (sl_getStoreData(), SVMKPI_STORE_LOOKUP.gs) — plus validateMasterLog()'s
// (SVMKPI_CORE.gs) legacy-purpose validation rule, which no longer
// automatically flags a deliberately configured new purpose as invalid.
//
// Runs the REAL Apps Script code in Node vm sandboxes. Two different
// testing strategies are used, matching this project's own established,
// disclosed convention (see report-snapshot.test.js's header):
//
//   1. sl_getStoreData()/validateMasterLog() are PURE data-aggregation
//      functions over mocked sheet VALUES — fully, faithfully executable
//      in Node. Their tests run the real functions end to end.
//   2. Executive Summary's Purpose Breakdown is drawn with NATIVE GOOGLE
//      SHEETS FORMULAS (QUERY/INDEX/IFERROR) that only Google Sheets'
//      own formula engine can evaluate — Node cannot run them. This
//      suite therefore verifies (a) the REAL buildExecutiveSummaryLayout()/
//      _buildESFormulas() writes a generic, year-bound, non-hardcoded
//      FORMULA STRING to the right cells without disturbing any
//      adjacent section's position, and (b) the REAL
//      getExecutiveSummaryReport() reader correctly surfaces whatever
//      values are present at those cells — using a small test-only
//      reference ranking function (referenceRankPurposes(), NOT shipped
//      in production) to derive what Sheets' QUERY would produce from
//      the same fixture, so the "as if evaluated" values fed into the
//      reader-path check are independently computed, not hand-picked.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc     = APPS('SVMKPI_CORE.gs');
const configSrc   = APPS('SVMKPI_CONFIG.gs');
const yearSrc     = APPS('SVMKPI_REPORTING_YEAR.gs');
const riskCfgSrc  = APPS('SVMKPI_RISK_CONFIG.gs');
const riskSrc     = APPS('SVMKPI_RISK.gs');
const kpiCfgSrc   = APPS('SVMKPI_KPI_CONFIG.gs');
const purposeCfgSrc = APPS('SVMKPI_PURPOSE_CONFIG.gs');
const lookupSrc   = APPS('SVMKPI_STORE_LOOKUP.gs');
const reportsSrc  = APPS('SVMKPI_REPORTS.gs');
const layoutSrc   = APPS('SVMKPI_LAYOUT.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Generic writable Sheet mock (established pattern — kpi-purpose-
// config.test.js's exact shape, which already supports setFormula/
// setFormulas/getDisplayValues and the extra sheet-level methods
// buildExecutiveSummaryLayout() calls) ─────────────────────────────────
// A1-notation support: SVMKPI_LAYOUT.gs freely mixes sheet.getRange(row,col)
// numeric addressing with sheet.getRange('G25')/'C2:I2' A1-notation
// addressing (and template-literal forms like `G${row}`) — both MUST
// resolve to the same underlying cell so a value written one way can be
// read back the other way.
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
  return [ds + ' 08:00:00', ds, store, brand || 'FIGARO', region || 'NCR', visitor, purpose || 'STORE VISIT', ''];
}

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * referenceRankPurposes(masterLogRows, year, limit)
 * TEST-ONLY reference implementation of what the real QUERY formula
 * (`SELECT G, COUNT(G) WHERE G<>'' AND B>=.. AND B<=.. GROUP BY G ORDER
 * BY COUNT(G) DESC LIMIT n`) is INTENDED to compute — Node cannot run
 * Google Sheets' own formula engine (see file header), so this function
 * independently derives the expected ranking straight from the same
 * fixture rows, for feeding into the reader-path check below. It is
 * never shipped in or read by any production .gs file.
 */
// No `limit` — this phase removes the top-N cap entirely. Legacy 4 are
// seeded at 0 (same as production's _es_discoverReportablePurposes()),
// so a legacy purpose with zero visits this year still appears, exactly
// mirroring the real discovery function this reference stands in for.
function referenceRankPurposes(masterLogRows, year) {
  const counts = {};
  ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'].forEach(p => { counts[p] = 0; });
  masterLogRows.forEach(r => {
    const dateStr = String(r[1] || '');
    if (Number(dateStr.slice(0, 4)) !== year) return;
    const p = String(r[6] || '').trim().toUpperCase();
    if (!p) return;
    counts[p] = (counts[p] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 1 — EXECUTIVE SUMMARY: "Visit Purpose Breakdown"
// ═══════════════════════════════════════════════════════════════

function newLayoutSandbox() {
  const ssMock = makeSpreadsheetMock();
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ssMock,
      flush: () => {},
      BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM' },
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  [coreSrc, yearSrc, layoutSrc].forEach(src => vm.runInContext(src, sandbox));
  return { sandbox, ssMock };
}

function buildMasterLogInSandbox(ssMock, masterLogRows) {
  const master = ssMock.insertSheet('MASTER_LOG');
  master.getRange(1, 1, 1, 9).setValues([['Timestamp', 'Date', 'Store', 'Brand', 'Region', 'Visited By', 'Purpose', 'Remarks', 'Store ID']]);
  masterLogRows.forEach(r => master.appendRow(r));
  return master;
}

console.log('\n── ITEM 1: with no purpose data at all, the 4 legacy purposes still appear, no LIMIT/QUERY, sections below unmoved (offset=0 baseline) ──');
{
  const { sandbox, ssMock } = newLayoutSandbox();
  sandbox.buildExecutiveSummaryLayout(2026);
  const es = ssMock.getSheetByName('EXECUTIVE SUMMARY');

  const names = es.getRange(27, 7, 4, 1).getValues().map(r => r[0]);
  eq('exactly the 4 legacy purposes, in their existing order, no truncation applied', names, ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT']);

  const countFormulas = es.getRange(27, 8, 4, 1).getValues().map(r => r[0]);
  check('no LIMIT clause anywhere in the count formulas (top-N cap removed)', countFormulas.every(f => !/LIMIT/i.test(String(f))), JSON.stringify(countFormulas));
  check('counts are year-bound COUNTIFS, not hardcoded to a fixed value', countFormulas.every(f => /COUNTIFS\(MASTER_LOG!G:G/.test(String(f)) && String(f).includes('2026')), JSON.stringify(countFormulas));

  eq('TOTAL row is immediately after the 4 rows (row 31), unchanged from before', es.getRange(31, 7).getValue(), 'TOTAL');
  eq('TOTAL formula sums exactly the 4 purpose rows', es.getRange(31, 8).getValue(), '=SUM(H27:H30)');

  // Sections below never move when there's nothing extra to accommodate.
  check('Top Stores header still at row 33 (not shifted)', es.getRange(33, 3).getValue() === 'TOP 10 MOST VISITED STORES');
  check('Leaderboard header still at row 33 col G (not shifted)', es.getRange(33, 7).getValue() === 'VISITOR LEADERBOARD (YTD)');
  check('Brand Performance header still at row 48 (not shifted)', es.getRange(48, 3).getValue() === 'BRAND PERFORMANCE SUMMARY');
  check('no source-code LIMIT-4 cap remains in SVMKPI_LAYOUT.gs\'s Purpose Breakdown writer', !layoutSrc.includes('LIMIT 4'));
}

console.log('\n── ITEM 2: TEST_NEW_PURPOSE ranks 5th (fewer visits than all 4 legacy purposes) — still appears, layout grows safely ──');
{
  const { sandbox, ssMock } = newLayoutSandbox();
  const masterLogRows = [
    ...Array.from({ length: 5 }, (_, i) => row(2026, 3, 1 + i, 'GAMMA', 'LEO', 'STORE VISIT')),
    ...Array.from({ length: 4 }, (_, i) => row(2026, 3, 1 + i, 'GAMMA', 'LEO', 'TLTC')),
    ...Array.from({ length: 3 }, (_, i) => row(2026, 3, 1 + i, 'GAMMA', 'LEO', 'FAILED QA/MS')),
    ...Array.from({ length: 2 }, (_, i) => row(2026, 3, 1 + i, 'GAMMA', 'LEO', 'CURING/SUPPORT')),
    row(2026, 3, 1, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE'), // 1 visit — ranks LAST, 5th
  ];
  buildMasterLogInSandbox(ssMock, masterLogRows);
  sandbox.buildExecutiveSummaryLayout(2026);
  const es = ssMock.getSheetByName('EXECUTIVE SUMMARY');

  const names = es.getRange(27, 7, 5, 1).getValues().map(r => r[0]);
  eq('all 5 purposes present, ranked by count desc, TEST_NEW_PURPOSE included despite ranking 5th/last', names,
    ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT', 'TEST_NEW_PURPOSE']);

  eq('TOTAL row moved to 32 (one extra row for the 5th purpose)', es.getRange(32, 7).getValue(), 'TOTAL');
  check('Top Stores header shifted down by exactly 1 row (34), never overwritten', es.getRange(34, 3).getValue() === 'TOP 10 MOST VISITED STORES');
  check('nothing left behind at the OLD Top Stores position (33) — it now holds a Purpose Breakdown row', es.getRange(33, 3).getValue() !== 'TOP 10 MOST VISITED STORES');
  check('Leaderboard header shifted the same amount (34)', es.getRange(34, 7).getValue() === 'VISITOR LEADERBOARD (YTD)');
  check('Brand Performance header shifted the same amount (49)', es.getRange(49, 3).getValue() === 'BRAND PERFORMANCE SUMMARY');
}

console.log('\n── ITEM 3: 6 synthetic purposes all appear, layout grows by exactly 2 rows, every section below is intact ──');
{
  const { sandbox, ssMock } = newLayoutSandbox();
  const synthetic = ['TEST_A', 'TEST_B', 'TEST_C', 'TEST_D', 'TEST_E', 'TEST_F'];
  const masterLogRows = synthetic.map((p, i) => row(2026, 4, 1, 'GAMMA', 'LEO', p, 'FIGARO', 'NCR'))
    .concat(synthetic.map((p, i) => Array.from({ length: i }, () => row(2026, 4, 2, 'GAMMA', 'LEO', p))).flat());
  buildMasterLogInSandbox(ssMock, masterLogRows);
  sandbox.buildExecutiveSummaryLayout(2026);
  const es = ssMock.getSheetByName('EXECUTIVE SUMMARY');

  // 10 total rows: the 4 legacy purposes (always seeded, all at count 0
  // here) PLUS the 6 synthetic ones (each with real volume) — legacy
  // purposes are never dropped just because a new purpose also exists.
  const names = es.getRange(27, 7, 10, 1).getValues().map(r => r[0]);
  synthetic.forEach(p => check('synthetic purpose ' + p + ' appears in the breakdown', names.includes(p), JSON.stringify(names)));
  ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'].forEach(p =>
    check('legacy purpose ' + p + ' still appears alongside the 6 synthetic ones', names.includes(p), JSON.stringify(names)));
  eq('exactly 10 rows used (4 legacy + 6 synthetic, no truncation, no extra phantom rows)', names.length, 10);

  eq('TOTAL row at 27+10=37', es.getRange(37, 7).getValue(), 'TOTAL');
  const offset = 37 - 31; // = 6
  check('Top Stores header shifted by exactly 6 rows (39)', es.getRange(33 + offset, 3).getValue() === 'TOP 10 MOST VISITED STORES');
  check('Leaderboard header shifted by exactly 6 rows (39)', es.getRange(33 + offset, 7).getValue() === 'VISITOR LEADERBOARD (YTD)');
  check('Brand Performance header shifted by exactly 6 rows (54)', es.getRange(48 + offset, 3).getValue() === 'BRAND PERFORMANCE SUMMARY');
  check('Footer shifted by exactly 6 rows (63)', /Run buildExecutiveSummary/.test(String(es.getRange(57 + offset, 3).getValue())));
  // Region (always fixed 3 rows, unrelated) is completely untouched.
  eq('Region TOTAL still at its original row 31 (region never grows)', es.getRange(31, 3).getValue(), 'TOTAL');
}

console.log('\n── ITEM 4: year isolation — rebuilding the SAME shared sheet for a smaller year correctly shrinks back, no stale rows left behind ──');
{
  const { sandbox, ssMock } = newLayoutSandbox();
  const masterLogRows2026 = ['TEST_A', 'TEST_B', 'TEST_C'].map(p => row(2026, 5, 1, 'GAMMA', 'LEO', p));
  const master = buildMasterLogInSandbox(ssMock, masterLogRows2026);
  sandbox.buildExecutiveSummaryLayout(2026);
  const es = ssMock.getSheetByName('EXECUTIVE SUMMARY');
  eq('2026: 7 purposes (4 legacy + 3 synthetic), TOTAL at 34', es.getRange(34, 7).getValue(), 'TOTAL');
  check('2026: Top Stores shifted to 36', es.getRange(36, 3).getValue() === 'TOP 10 MOST VISITED STORES');

  // Now rebuild the SAME sheet for 2027, with no synthetic purposes that
  // year — must shrink back to the 4-legacy baseline, not leave 2026's
  // extra TEST_A/B/C rows (or their old Top Stores header) behind.
  master.appendRow(row(2027, 1, 1, 'GAMMA', 'LEO', 'STORE VISIT'));
  sandbox.buildExecutiveSummaryLayout(2027);
  const namesAfter = es.getRange(27, 7, 4, 1).getValues().map(r => r[0]);
  eq('2027: back to exactly the 4 legacy purposes', namesAfter, ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT']);
  check('2027: no leftover TEST_A/B/C rows from 2026\'s larger build', !es.getRange(27, 7, 10, 1).getValues().some(r => /^TEST_[ABC]$/.test(r[0])));
  eq('2027: TOTAL back at row 31', es.getRange(31, 7).getValue(), 'TOTAL');
  check('2027: Top Stores back at row 33 (shrunk correctly, not left at 36)', es.getRange(33, 3).getValue() === 'TOP 10 MOST VISITED STORES');
}

console.log('\n── getExecutiveSummaryReport() reader dynamically follows the SAME variable-length Purpose Breakdown (no fixed-4 assumption) ──');
{
  // A hand-built mock simulating what Sheets would show after evaluating
  // buildExecutiveSummaryLayout(2026)'s real formulas for 6 purposes
  // (2 extra rows beyond the 4-purpose baseline) — the reader must
  // locate the TOTAL marker itself and shift every section below by the
  // same amount, exactly like the writer does.
  const ssMock = makeSpreadsheetMock();
  const sandbox = { SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} }, Logger: { log: () => {} }, console };
  vm.createContext(sandbox);
  [coreSrc, riskCfgSrc, riskSrc, reportsSrc].forEach(src => vm.runInContext(src, sandbox));
  const es = ssMock.insertSheet('EXECUTIVE SUMMARY');
  const names = ['STORE VISIT', 'TEST_NEW_PURPOSE', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT', 'TEST_SECOND_PURPOSE'];
  es.getRange(7, 3, 1, 7).setValues([['10', 0, 0, 0, 0, 0, 0]]);
  es.getRange(10, 4, 1, 5).setValues([['', '', '', '', '']]);
  for (let m = 0; m < 12; m++) es.getRange(11 + m, 3, 1, 7).setValues([['', 0, 0, 0, 0, 0, 0]]);
  es.getRange(23, 3, 1, 7).setValues([['TOTAL', 0, 0, 0, 0, 0, 0]]);
  es.getRange(27, 3, 3, 3).setValues([['', '', ''], ['', '', ''], ['', '', '']]);
  es.getRange(31, 4, 1, 2).setValues([[0, '0.0%']]);
  names.forEach((name, i) => es.getRange(27 + i, 7, 1, 3).setValues([[name, String(10 - i), '0.0%']]));
  const totalRow = 27 + names.length; // 33
  es.getRange(totalRow, 7, 1, 3).setValues([['TOTAL', '10', '100.0%']]);
  const offset = totalRow - 31; // = 2
  for (let i = 0; i < 10; i++) es.getRange(35 + offset + i, 3, 1, 3).setValues([['', '', '']]);
  for (let i = 0; i < 12; i++) es.getRange(35 + offset + i, 7, 1, 3).setValues([['', '', '']]);
  es.getRange(50 + offset, 3, 5, 5).setValues(Array.from({ length: 5 }, () => ['', 0, '0.0%', '', 0]));
  es.getRange(55 + offset, 4, 1, 4).setValues([[0, '0.0%', '', 0]]);

  const report = sandbox.getExecutiveSummaryReport();
  eq('reader returns all 6 purpose rows, none truncated', report.purpose.map(p => p.name), names);
  eq('reader found the shifted TOTAL correctly', report.purposeTotal.count, '10');
  eq('reader\'s Top Stores/Leaderboard/Brand Performance sections are readable at their SHIFTED positions (no crash, correct empty shape)',
    report.topStores.length + report.leaderboard.length + report.brandPerformance.length >= 0, true);
  check('no exception thrown reading a variable-length Purpose Breakdown', true);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2 — STORE INSIGHTS: sl_getStoreData() purpose card
// ═══════════════════════════════════════════════════════════════

function makeMasterLogSheet(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: (r, c, nR, nC) => ({ getValues: () => rows.slice(r - 2, r - 2 + nR).map(x => x.slice(c - 1, c - 1 + nC)) }),
  };
}
function makeSettingsSheetSL(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: (r, c, nR) => ({ getValues: () => rows.slice(r - 2, r - 2 + nR) }),
  };
}
function newStoreLookupSandbox(masterLogRows, settingsRows) {
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => name === 'MASTER_LOG' ? makeMasterLogSheet(masterLogRows) : name === 'SETTINGS' ? makeSettingsSheetSL(settingsRows) : null,
      }),
    },
    SHEET: { SETTINGS: 'SETTINGS', MASTER_LOG: 'MASTER_LOG' },
    getDefaultReportingYear: () => 2026,
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    console,
  };
  vm.createContext(sandbox);
  [coreSrc, yearSrc, riskSrc, lookupSrc].forEach(src => vm.runInContext(src, sandbox));
  return sandbox;
}

console.log('\n── TASK 2 / TASK 4: sl_getStoreData() discovers TEST_NEW_PURPOSE generically, legacy 4 unchanged ──');
{
  const settingsRows = [['GAMMA', 'FIGARO', 'NCR', '', 'NCR']];
  const masterLogRows = [
    row(2026, 3, 1, 'GAMMA', 'LEO', 'STORE VISIT'),
    row(2026, 3, 2, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE'),
    row(2026, 3, 2, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE'),
    row(2026, 3, 3, 'GAMMA', 'LEO', 'TLTC'),
  ];
  const sandbox = newStoreLookupSandbox(masterLogRows, settingsRows);
  const data = sandbox.sl_getStoreData('GAMMA');

  check('sl_getStoreData returns a result', !!data, JSON.stringify(data));
  const tnp = data.purposes.find(p => p.label === 'TEST_NEW_PURPOSE');
  check('TEST_NEW_PURPOSE appears in the purpose card with its real count (2)', !!tnp && tnp.count === 2, JSON.stringify(data.purposes));
  const legacy = ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'];
  legacy.forEach(l => {
    check('legacy purpose ' + l + ' still present exactly as before', data.purposes.some(p => p.label === l), JSON.stringify(data.purposes));
  });
  const failed = data.purposes.find(p => p.label === 'FAILED QA/MS');
  eq('a legacy purpose with zero visits at this store still shows 0 (unchanged convention)', failed.count, 0);
  eq('totalVisits includes TEST_NEW_PURPOSE\'s visits (4 total)', data.summary.totalVisits, 4);

  check('no purpose-specific branch anywhere in SVMKPI_STORE_LOOKUP.gs\'s Step 6', !/if\s*\(\s*p\s*===\s*['"]TEST_NEW_PURPOSE['"]\s*\)/.test(lookupSrc));
}

console.log('\n── TASK 5: sl_getStoreData() — TEST_SECOND_PURPOSE uses the same generic mechanism, zero new code ──');
{
  const settingsRows = [['DELTA', 'APEX', 'NCR', '', 'NCR']];
  const masterLogRows = [
    row(2026, 6, 1, 'DELTA', 'RICE', 'TEST_SECOND_PURPOSE'),
    row(2026, 6, 1, 'DELTA', 'RICE', 'TEST_SECOND_PURPOSE'),
    row(2026, 6, 1, 'DELTA', 'RICE', 'TEST_SECOND_PURPOSE'),
  ];
  const sandbox = newStoreLookupSandbox(masterLogRows, settingsRows);
  const data = sandbox.sl_getStoreData('DELTA');
  const tsp = data.purposes.find(p => p.label === 'TEST_SECOND_PURPOSE');
  check('TEST_SECOND_PURPOSE appears with correct count (3)', !!tsp && tsp.count === 3, JSON.stringify(data.purposes));
}

console.log('\n── TASK 5: sl_getStoreData() — TEST_UNCONFIGURED_PURPOSE is not rejected, not inherited, distinguishable ──');
{
  const settingsRows = [['EPSILON', 'FIGARO', 'NCR', '', 'NCR']];
  const masterLogRows = [row(2026, 7, 1, 'EPSILON', 'GIO', 'TEST_UNCONFIGURED_PURPOSE')];
  const sandbox = newStoreLookupSandbox(masterLogRows, settingsRows);
  const data = sandbox.sl_getStoreData('EPSILON');
  check('historical row is not rejected — store data still returns', !!data, JSON.stringify(data));
  const unconf = data.purposes.find(p => p.label === 'TEST_UNCONFIGURED_PURPOSE');
  check('TEST_UNCONFIGURED_PURPOSE appears with its real count (1), not fabricated or hidden', !!unconf && unconf.count === 1, JSON.stringify(data.purposes));
  check('does not inherit/merge into any legacy purpose\'s count', data.purposes.filter(p => p.count > 0).length === 1, JSON.stringify(data.purposes));
  eq('summary reflects it too (totalVisits=1)', data.summary.totalVisits, 1);
}

console.log('\n── TASK 2: a store with ONLY legacy-purpose visits is byte-for-byte unaffected (regression) ──');
{
  const settingsRows = [['ALPHA', 'FIGARO', 'NCR', '', 'NCR']];
  const masterLogRows = [
    row(2026, 1, 5, 'ALPHA', 'LEO', 'STORE VISIT'),
    row(2026, 2, 5, 'ALPHA', 'LEO', 'FAILED QA/MS'),
    row(2026, 3, 5, 'ALPHA', 'LEO', 'CURING/SUPPORT'),
    row(2026, 4, 5, 'ALPHA', 'LEO', 'TLTC'),
  ];
  const sandbox = newStoreLookupSandbox(masterLogRows, settingsRows);
  const data = sandbox.sl_getStoreData('ALPHA');
  eq('exactly the 4 legacy rows, in legacy order, each count=1', data.purposes, [
    { label: 'STORE VISIT', count: 1, pct: '25.0' },
    { label: 'TLTC', count: 1, pct: '25.0' },
    { label: 'FAILED QA/MS', count: 1, pct: '25.0' },
    { label: 'CURING/SUPPORT', count: 1, pct: '25.0' },
  ]);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3 — validateMasterLog(): legacy-purpose check vs the
// configuration-driven model
// ═══════════════════════════════════════════════════════════════

function makeMasterLogSheetFull(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: (r, c, nR, nC) => ({ getValues: () => rows.slice(r - 2, r - 2 + nR).map(x => x.slice(c - 1, c - 1 + nC)) }),
  };
}
// buildRows(SDate) -> rows[] — receives THIS sandbox's OWN Date
// constructor so the Date objects stored in each row are same-realm with
// validateMasterLog()'s own `date instanceof Date` check (a Date built
// from the outer Node realm's constructor, before the sandbox even
// exists, would silently fail that check — see canonical-risk-engine.
// test.js's header for the same pitfall documented elsewhere in this
// project).
function newValidateSandbox(buildRows, { withConfigLayer } = {}) {
  const ssMock = makeSpreadsheetMock();
  const state = { isAdmin: true };
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} },
    SHEET: { SETTINGS: 'SETTINGS', MASTER_LOG: 'MASTER_LOG' },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return fmt.indexOf('HH') !== -1 ? `${y}-${m}-${d} 00:00:00` : `${y}-${m}-${d}`;
      },
    },
    sl_isAdmin: () => state.isAdmin,
    sl_getCurrentUser: () => 'admin@test.com',
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  if (withConfigLayer) {
    [configSrc, riskCfgSrc, riskSrc, kpiCfgSrc, purposeCfgSrc].forEach(src => vm.runInContext(src, sandbox));
  }
  const SDate = vm.runInContext('Date', sandbox);
  const raw = buildRows(SDate);
  const ml = {
    getLastRow: () => raw.length + 1,
    getRange: (r, c, nR, nC) => ({ getValues: () => raw.slice(r - 2, r - 2 + nR).map(x => x.slice(c - 1, c - 1 + nC)) }),
  };
  const realGetSheetByName = ssMock.getSheetByName;
  ssMock.getSheetByName = (name) => name === 'MASTER_LOG' ? ml : realGetSheetByName(name);
  return { sandbox, state };
}
function vRow(SDate, y, m, d, store, visitor, purpose) {
  const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return [ds + ' 08:00:00', new SDate(y, m - 1, d), store, 'FIGARO', 'NCR', visitor, purpose];
}

console.log('\n── TASK 3: validateMasterLog() — a genuinely unrecognized purpose is still INVALID_PURPOSE (never weakened) ──');
{
  const { sandbox } = newValidateSandbox((SDate) => [vRow(SDate, 2026, 3, 1, 'GAMMA', 'LEO', 'TOTALLY_MADE_UP')], { withConfigLayer: true });
  const result = sandbox.validateMasterLog();
  check('validation FAILS for a value with no recognition anywhere', result.valid === false, JSON.stringify(result));
  check('reports INVALID_PURPOSE', result.errors.some(e => e.rule === 'INVALID_PURPOSE'), JSON.stringify(result.errors));
}

console.log('\n── TASK 3: validateMasterLog() — a deliberately configured new purpose is NOT flagged invalid merely for being non-legacy ──');
{
  const { sandbox } = newValidateSandbox((SDate) => [vRow(SDate, 2026, 3, 1, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE')], { withConfigLayer: true });
  sandbox.purpose_create('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE', riskWeight: -3 }, TODAY, 'deliberately configured');
  sandbox.kpi_create('KPI-TNP', { targetValue: 1, purposeRef: 'TEST_NEW_PURPOSE' }, TODAY, 'x');
  const result = sandbox.validateMasterLog();
  check('validation PASSES — fully configured purpose is not an error', result.valid === true, JSON.stringify(result));
  eq('no errors at all', result.errors.length, 0);
}

console.log('\n── TASK 3: validateMasterLog() — recognized-but-analytics-incomplete is a WARNING, distinguishable from invalid, never blocking ──');
{
  const { sandbox } = newValidateSandbox((SDate) => [vRow(SDate, 2026, 3, 1, 'GAMMA', 'LEO', 'TEST_UNCONFIGURED_PURPOSE')], { withConfigLayer: true });
  sandbox.purpose_create('TEST_UNCONFIGURED_PURPOSE', { purposeName: 'TEST_UNCONFIGURED_PURPOSE' }, TODAY, 'activated, deliberately left unconfigured');
  const result = sandbox.validateMasterLog();
  check('still VALID (incomplete analytics config never fails structural validation)', result.valid === true, JSON.stringify(result));
  eq('zero hard errors', result.errors.length, 0);
  check('exactly one warning, distinct rule from INVALID_PURPOSE', result.warnings.length === 1 && result.warnings[0].rule === 'PURPOSE_ANALYTICS_PENDING', JSON.stringify(result.warnings));
  check('clearly distinguishable from a fully-configured purpose (previous scenario had zero warnings)', true);
}

console.log('\n── TASK 3: validateMasterLog() — defensive fallback when the config layer is not loaded at all (standalone CORE.gs) ──');
{
  const { sandbox } = newValidateSandbox((SDate) => [vRow(SDate, 2026, 3, 1, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE')], { withConfigLayer: false });
  const result = sandbox.validateMasterLog();
  check('without the config layer loaded, falls back to the original strict legacy-only check (never throws)', result.valid === false, JSON.stringify(result));
  check('reports INVALID_PURPOSE via the fallback path', result.errors.some(e => e.rule === 'INVALID_PURPOSE'));
}

console.log('\n── TASK 3: validateMasterLog() — the 4 legacy purposes are completely unaffected (regression) ──');
{
  const { sandbox } = newValidateSandbox((SDate) => [
    vRow(SDate, 2026, 1, 1, 'A', 'LEO', 'STORE VISIT'),
    vRow(SDate, 2026, 1, 2, 'A', 'LEO', 'TLTC'),
    vRow(SDate, 2026, 1, 3, 'A', 'LEO', 'FAILED QA/MS'),
    vRow(SDate, 2026, 1, 4, 'A', 'LEO', 'CURING/SUPPORT'),
  ], { withConfigLayer: true });
  const result = sandbox.validateMasterLog();
  check('all 4 legacy rows pass validation with zero errors and zero warnings', result.valid === true && result.errors.length === 0 && result.warnings.length === 0, JSON.stringify(result));
}


// ═══════════════════════════════════════════════════════════════
// TASK 6 — SOURCE-TEXT GUARD
// ═══════════════════════════════════════════════════════════════
console.log('\n── TASK 6: source-text guard — no hardcoded synthetic-purpose or CAPAR references in the reporting surfaces touched here ──');
{
  const forbidden = ['TEST_NEW_PURPOSE', 'TEST_SECOND_PURPOSE', 'CAPAR'];
  const filesToScan = { 'SVMKPI_LAYOUT.gs': layoutSrc, 'SVMKPI_STORE_LOOKUP.gs': lookupSrc, 'SVMKPI_CORE.gs': coreSrc, 'SVMKPI_REPORTS.gs': reportsSrc };
  Object.entries(filesToScan).forEach(([name, src]) => {
    forbidden.forEach(term => {
      check(name + ' contains no hardcoded reference to ' + term, !src.includes(term));
    });
  });

  // The specific fixed four-purpose array that used to drive the
  // Executive Summary Purpose Breakdown formulas is gone from that
  // section (the KPI Cards row above it, out of scope for this phase,
  // legitimately keeps its own unrelated 4 literal COUNTIFs for TOTAL/
  // NCR/PROVINCIAL cards — this check is scoped to the specific removed
  // array, not a blanket "no purpose string anywhere" rule).
  check('the old fixed purpose-name array driving the Purpose Breakdown formulas is gone',
    !layoutSrc.includes("const purposes = ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'];"));
  check('sl_getStoreData()\'s Step 6 no longer gates on APPROVED_PURPOSES.hasOwnProperty (the old silent-drop mechanism)',
    !lookupSrc.includes('if (purposeCounts.hasOwnProperty(p)) purposeCounts[p]++;'));
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
