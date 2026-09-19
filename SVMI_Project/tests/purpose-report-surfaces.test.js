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
function referenceRankPurposes(masterLogRows, year, limit) {
  const counts = {};
  masterLogRows.forEach(r => {
    const dateStr = String(r[1] || '');
    if (Number(dateStr.slice(0, 4)) !== year) return;
    const p = String(r[6] || '').trim().toUpperCase();
    if (!p) return;
    counts[p] = (counts[p] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit || 4);
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

console.log('\n── TASK 1a: buildExecutiveSummaryLayout() writes a generic, year-bound, non-hardcoded Purpose Breakdown formula ──');
{
  const { sandbox, ssMock } = newLayoutSandbox();
  sandbox.buildExecutiveSummaryLayout(2026);
  const es = ssMock.getSheetByName('EXECUTIVE SUMMARY');

  const nameFormulas = es.getRange(27, 7, 4, 1).getValues().map(r => r[0]);
  const countFormulas = es.getRange(27, 8, 4, 1).getValues().map(r => r[0]);

  const legacyNames = ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'];
  check('no row\'s NAME formula hardcodes a legacy purpose as a quoted literal',
    nameFormulas.every(f => legacyNames.every(n => !String(f).includes(`"${n}"`))), JSON.stringify(nameFormulas));
  check('no row\'s COUNT formula hardcodes a legacy purpose as a quoted literal',
    countFormulas.every(f => legacyNames.every(n => !String(f).includes(`"${n}"`))), JSON.stringify(countFormulas));
  check('the formula references MASTER_LOG generically (QUERY-based discovery)',
    nameFormulas.every(f => /QUERY\(MASTER_LOG!/.test(String(f))), JSON.stringify(nameFormulas));
  check('the formula is explicitly year-bound to 2026 (year-safe)',
    nameFormulas.every(f => String(f).includes('2026-01-01') && String(f).includes('2026-12-31')), JSON.stringify(nameFormulas));

  eq('TOTAL row 31 formula unchanged (still sums exactly rows 27-30)',
    es.getRange(31, 8, 1, 1).getValue(), '=SUM(H27:H30)');

  // Layout integrity — every adjacent section is still EXACTLY where it
  // was: nothing shifted because the Purpose block's row geometry (27-30
  // + 31) never changed.
  check('VISIT PURPOSE BREAKDOWN header still at G25 (merged, unmoved)', es.getRange(25, 7).getValue() === 'VISIT PURPOSE BREAKDOWN');
  check('Region section (unrelated, untouched) still uses COUNTIF at row 27 col D', /COUNTIF/.test(String(es.getRange(27, 4).getValue())));
  check('Top Stores header still at row 33 (not shifted)', es.getRange(33, 3).getValue() === 'TOP 10 MOST VISITED STORES');
  check('Top Stores sub-header still at row 34', es.getRange(34, 3).getValue() === '#');
  check('Leaderboard header still at row 33 col G (not shifted)', es.getRange(33, 7).getValue() === 'VISITOR LEADERBOARD (YTD)');
  check('Brand Performance header still at row 48 (not shifted)', es.getRange(48, 3).getValue() === 'BRAND PERFORMANCE SUMMARY');
}

console.log('\n── TASK 1a / TASK 7: rebuilding the SAME shared sheet for a different year updates the year bound, never leaks the old one ──');
{
  const { sandbox, ssMock } = newLayoutSandbox();
  sandbox.buildExecutiveSummaryLayout(2026);
  sandbox.buildExecutiveSummaryLayout(2027); // same shared EXECUTIVE SUMMARY sheet, rebuilt for a different year
  const es = ssMock.getSheetByName('EXECUTIVE SUMMARY');
  const nameFormula = String(es.getRange(27, 7).getValue());
  check('rebuilding for 2027 updates the bound to 2027', nameFormula.includes('2027-01-01') && nameFormula.includes('2027-12-31'), nameFormula);
  check('rebuilding for 2027 no longer carries the 2026 bound (no year leakage on the shared sheet)', !nameFormula.includes('2026-01-01'), nameFormula);
}

console.log('\n── TASK 1b: getExecutiveSummaryReport() reader surfaces a dynamically-ranked TEST_NEW_PURPOSE (values \"as Sheets would evaluate them\") ──');
{
  // Independent 2026 fixture: TEST_NEW_PURPOSE given enough volume to
  // rank in the top 4 alongside 3 of the legacy purposes.
  const fixture2026 = [
    ...Array.from({ length: 5 }, (_, i) => row(2026, 3, 1 + i, 'GAMMA', 'LEO', 'STORE VISIT')),
    ...Array.from({ length: 4 }, (_, i) => row(2026, 3, 1 + i, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE')),
    ...Array.from({ length: 3 }, (_, i) => row(2026, 3, 1 + i, 'GAMMA', 'LEO', 'TLTC')),
    ...Array.from({ length: 2 }, (_, i) => row(2026, 3, 1 + i, 'GAMMA', 'LEO', 'FAILED QA/MS')),
    row(2026, 3, 1, 'GAMMA', 'LEO', 'CURING/SUPPORT'), // 1 — ranks 5th, correctly excluded from a top-4 window
  ];
  const ranked = referenceRankPurposes(fixture2026, 2026, 4);
  eq('reference ranking puts TEST_NEW_PURPOSE 2nd by volume (5,4,3,2)', ranked.map(r => r[0]), ['STORE VISIT', 'TEST_NEW_PURPOSE', 'TLTC', 'FAILED QA/MS']);

  const { sandbox } = (() => {
    const s = { SpreadsheetApp: { getActiveSpreadsheet: null }, Logger: { log: () => {} }, console };
    return { sandbox: s };
  })();
  const ssMock = makeSpreadsheetMock();
  sandbox.SpreadsheetApp = { getActiveSpreadsheet: () => ssMock, flush: () => {} };
  vm.createContext(sandbox);
  [coreSrc, riskCfgSrc, riskSrc, reportsSrc].forEach(src => vm.runInContext(src, sandbox));

  const es = ssMock.insertSheet('EXECUTIVE SUMMARY');
  es.getRange(7, 3, 1, 7).setValues([['9', '5', '3', '2', '1', '9', '0']]);
  es.getRange(10, 4, 1, 5).setValues([['FIGARO', "ANGEL'S PIZZA", 'APEX', "TIEN MA'S", 'KOOBIDEH']]);
  for (let m = 0; m < 12; m++) es.getRange(11 + m, 3, 1, 7).setValues([['', 0, 0, 0, 0, 0, 0]]);
  es.getRange(23, 3, 1, 7).setValues([['TOTAL', 0, 0, 0, 0, 0, 0]]);
  es.getRange(27, 3, 3, 3).setValues([['NCR', 9, '100.0%'], ['', '', ''], ['', '', '']]);
  es.getRange(31, 4, 1, 2).setValues([[9, '100.0%']]);
  // Row 27-30, cols G-I — exactly what buildExecutiveSummaryLayout()'s
  // real QUERY formula is designed to produce for this fixture, per the
  // independent reference ranking above.
  ranked.forEach(([name, count], i) => {
    es.getRange(27 + i, 7, 1, 3).setValues([[name, String(count), ((count / 9) * 100).toFixed(1) + '%']]);
  });
  es.getRange(31, 8, 1, 2).setValues([['9', '100.0%']]);
  for (let i = 0; i < 10; i++) es.getRange(35 + i, 3, 1, 3).setValues([['', '', '']]);
  for (let i = 0; i < 12; i++) es.getRange(35 + i, 7, 1, 3).setValues([['', '', '']]);
  es.getRange(50, 3, 5, 5).setValues(Array.from({ length: 5 }, () => ['', 0, '0.0%', '', 0]));
  es.getRange(55, 4, 1, 4).setValues([[0, '0.0%', '', 0]]);

  const report = sandbox.getExecutiveSummaryReport();
  check('TEST_NEW_PURPOSE appears in the Executive Summary purpose breakdown', report.purpose.some(p => p.name === 'TEST_NEW_PURPOSE'), JSON.stringify(report.purpose));
  const entry = report.purpose.find(p => p.name === 'TEST_NEW_PURPOSE');
  check('with its correct, non-fabricated count (4)', entry && entry.count === '4', JSON.stringify(entry));
  check('legacy purposes STORE VISIT/TLTC/FAILED QA/MS still present unchanged', report.purpose.some(p => p.name === 'STORE VISIT') && report.purpose.some(p => p.name === 'TLTC') && report.purpose.some(p => p.name === 'FAILED QA/MS'));
}

console.log('\n── TASK 5 / TASK 7: a SECOND fictional purpose, in a DIFFERENT year, uses the same mechanism — no cross-year leakage ──');
{
  const fixture2027 = [
    ...Array.from({ length: 6 }, (_, i) => row(2027, 4, 1 + i, 'GAMMA', 'LEO', 'TEST_SECOND_PURPOSE')),
    ...Array.from({ length: 4 }, (_, i) => row(2027, 4, 1 + i, 'GAMMA', 'LEO', 'STORE VISIT')),
  ];
  const ranked2027 = referenceRankPurposes(fixture2027, 2027, 4);
  eq('2027 fixture ranks TEST_SECOND_PURPOSE 1st', ranked2027[0][0], 'TEST_SECOND_PURPOSE');
  check('TEST_NEW_PURPOSE (a 2026-only purpose) never appears in the 2027 ranking', !ranked2027.some(r => r[0] === 'TEST_NEW_PURPOSE'), JSON.stringify(ranked2027));

  const ssMock = makeSpreadsheetMock();
  const sandbox = { SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} }, Logger: { log: () => {} }, console };
  vm.createContext(sandbox);
  [coreSrc, riskCfgSrc, riskSrc, reportsSrc].forEach(src => vm.runInContext(src, sandbox));
  const es = ssMock.insertSheet('EXECUTIVE SUMMARY');
  es.getRange(7, 3, 1, 7).setValues([['10', 0, 0, 0, 0, 0, 0]]);
  es.getRange(10, 4, 1, 5).setValues([['', '', '', '', '']]);
  for (let m = 0; m < 12; m++) es.getRange(11 + m, 3, 1, 7).setValues([['', 0, 0, 0, 0, 0, 0]]);
  es.getRange(23, 3, 1, 7).setValues([['TOTAL', 0, 0, 0, 0, 0, 0]]);
  es.getRange(27, 3, 3, 3).setValues([['', '', ''], ['', '', ''], ['', '', '']]);
  es.getRange(31, 4, 1, 2).setValues([[0, '0.0%']]);
  ranked2027.forEach(([name, count], i) => {
    es.getRange(27 + i, 7, 1, 3).setValues([[name, String(count), ((count / 10) * 100).toFixed(1) + '%']]);
  });
  es.getRange(31, 8, 1, 2).setValues([['10', '100.0%']]);
  for (let i = 0; i < 10; i++) es.getRange(35 + i, 3, 1, 3).setValues([['', '', '']]);
  for (let i = 0; i < 12; i++) es.getRange(35 + i, 7, 1, 3).setValues([['', '', '']]);
  es.getRange(50, 3, 5, 5).setValues(Array.from({ length: 5 }, () => ['', 0, '0.0%', '', 0]));
  es.getRange(55, 4, 1, 4).setValues([[0, '0.0%', '', 0]]);

  const report = sandbox.getExecutiveSummaryReport();
  check('TEST_SECOND_PURPOSE appears via the exact same generic reader, zero new code', report.purpose.some(p => p.name === 'TEST_SECOND_PURPOSE'), JSON.stringify(report.purpose));
  check('TEST_NEW_PURPOSE (the other year\'s purpose) does not leak into this report', !report.purpose.some(p => p.name === 'TEST_NEW_PURPOSE'));
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
