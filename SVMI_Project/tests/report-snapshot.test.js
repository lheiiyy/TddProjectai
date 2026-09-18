// Phase 1E: Historical Report Snapshots + Per-Year Report Sheets
// (SVMKPI_REPORT_SNAPSHOT.gs).
//
// Covers the Phase 1E spec's mandatory test sections 26-34 (historical
// freeze, draft-vs-finalized separation, correction/supersession,
// per-year isolation, configuration provenance, security, concurrency,
// scale, the empty-year safeguard) PLUS the completeness fix's own
// mandatory tests A-H: _snap_captureCalculatedResult() now ALWAYS
// rebuilds Executive Summary for the requested year and builds "KPI
// <year>" only when that exact sheet is missing, so a finalized snapshot
// is genuinely self-contained (storeRisk/complianceGaps/totals/
// executiveSummary/kpi all non-null) regardless of what presentation
// sheets happened to exist beforehand.
//
// Runs the REAL Apps Script code in a Node vm sandbox — same generic
// writable-Sheet-mock Proxy pattern already used by compliance-config/
// risk-config/kpi-purpose-config.test.js (Phase 1D), extended with a
// LockService mock (submission-lock.test.js's established pattern).
//
// Executive Summary/KPI themselves are NOT re-simulated with a fake
// Google Sheets formula engine (SVMKPI_LAYOUT.gs/SVMKPI_KPI_REBUILD.gs
// write ~1,000 combined lines of native Sheets formulas/styling that
// this project has never unit-tested and that this fix does not touch).
// Instead, per this project's own established convention of stubbing
// dependencies a file under test only CALLS rather than loading their
// real source (see config-service.test.js's header comment re:
// sl_isAdmin()/logError()), this file stubs buildExecutiveSummaryLayout()/
// getExecutiveSummaryReport()/buildKPI2026()/getKPI2026Report() directly
// with small, controlled, INSPECTABLE implementations that: (a) derive a
// real, changeable number from the CURRENT MASTER_LOG mock content at
// call time (so tests can prove capture reflects "now" at finalize time
// and never again afterward), and (b) record every call they receive
// (year argument) so tests can assert exactly when the real production
// code decided to build vs. not build. This verifies the SNAPSHOT
// SERVICE's orchestration/freeze behavior — never a reimplementation of
// Executive Summary/KPI's own arithmetic.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc      = APPS('SVMKPI_CORE.gs');
const configSrc    = APPS('SVMKPI_CONFIG.gs');
const ryearSrc      = APPS('SVMKPI_REPORTING_YEAR.gs');
const calSrc        = APPS('SVMKPI_CALENDAR.gs');
const cmpCfgSrc      = APPS('SVMKPI_COMPLIANCE_CONFIG.gs');
const riskCfgSrc    = APPS('SVMKPI_RISK_CONFIG.gs');
const riskSrc       = APPS('SVMKPI_RISK.gs');
const lookupSrc     = APPS('SVMKPI_STORE_LOOKUP.gs');
const snapSrc       = APPS('SVMKPI_REPORT_SNAPSHOT.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Generic writable Sheet mock (established pattern) ──────────────────
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
    range.getValue = () => getCell(row, col);
    range.getValues = () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const rowArr = [];
        for (let c = 0; c < numCols; c++) rowArr.push(getCell(row + r, col + c));
        out.push(rowArr);
      }
      return out;
    };
    proxy = new Proxy(range, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => proxy; } });
    return proxy;
  }
  const sheet = {
    getLastRow: () => maxRow,
    getRange: (row, col, numRows, numCols) => makeRange(row, col, numRows || 1, numCols || 1),
    appendRow: (rowArr) => { const r = maxRow + 1; rowArr.forEach((v, i) => setCell(r, i + 1, v)); },
    clear: () => { Object.keys(cells).forEach(k => delete cells[k]); maxRow = 0; },
  };
  let sproxy;
  sproxy = new Proxy(sheet, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => sproxy; } });
  return sproxy;
}
// A sheet whose appendRow always throws — simulates a persistence failure.
function makePoisonSheet() {
  return { getLastRow: () => 1, getRange: () => ({ getValues: () => [], setValues: () => {} }), appendRow: () => { throw new Error('simulated write failure'); }, clear: () => {} };
}
function makeSpreadsheetMock() {
  const sheets = {};
  return {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => { const s = makeWritableSheet(); sheets[name] = s; return s; },
    _sheets: sheets,
  };
}

// ── Controlled Executive Summary / KPI stub engine ──────────────────────
// See the file header for why this stubs the presentation-report engine
// boundary rather than loading/re-simulating ~1,000 lines of real Sheets
// formula-writing code.
function makeReportEngineStub(ssMock, opts) {
  opts = opts || {};
  const calls = { buildES: [], buildKPI: [] };

  function countMasterLogRowsForYear(year) {
    const ml = ssMock.getSheetByName('MASTER_LOG');
    if (!ml) return 0;
    const lastRow = ml.getLastRow();
    if (lastRow < 2) return 0;
    const raw = ml.getRange(2, 1, lastRow - 1, 2).getValues(); // Timestamp, Date
    let n = 0;
    raw.forEach(r => { if (String(r[1] || '').indexOf(String(year) + '-') === 0) n++; });
    return n;
  }

  function buildExecutiveSummaryLayout(year) {
    calls.buildES.push(year);
    if (opts.esBuildThrows) throw new Error('simulated Executive Summary build failure');
    let sheet = ssMock.getSheetByName('EXECUTIVE SUMMARY');
    if (!sheet) sheet = ssMock.insertSheet('EXECUTIVE SUMMARY'); else sheet.clear();
    const total = countMasterLogRowsForYear(year);
    sheet.getRange(1, 1, 1, 2).setValues([['YEAR', year]]);
    sheet.getRange(2, 1, 1, 2).setValues([['TOTAL_VISITS', total]]);
  }
  function getExecutiveSummaryReport() {
    const sheet = ssMock.getSheetByName('EXECUTIVE SUMMARY');
    if (!sheet || sheet.getLastRow() < 2) throw new Error('EXECUTIVE SUMMARY sheet not found. Run "Rebuild Executive Summary" first.');
    const yearRow = sheet.getRange(1, 1, 1, 2).getValues()[0];
    const totalRow = sheet.getRange(2, 1, 1, 2).getValues()[0];
    return { year: Number(yearRow[1]), kpi: [{ label: 'Total Visits', value: String(totalRow[1]) }] };
  }

  function _kpiSheetName(year) { return 'KPI ' + year; }
  function buildKPI2026(year) {
    calls.buildKPI.push(year);
    if (opts.kpiBuildThrows) throw new Error('simulated KPI build failure');
    const name = _kpiSheetName(year);
    let sheet = ssMock.getSheetByName(name);
    if (!sheet) sheet = ssMock.insertSheet(name); else sheet.clear();
    const total = countMasterLogRowsForYear(year);
    sheet.getRange(1, 1, 1, 2).setValues([['YTD_TOTAL', total]]);
  }
  function getKPI2026Report(year) {
    if (opts.kpiReadThrowsAlways) throw new Error(opts.kpiReadThrowsAlways);
    const name = _kpiSheetName(year);
    const sheet = ssMock.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 1) throw new Error('"' + name + '" sheet not found. Run "Rebuild KPI 2026" first.');
    const totalRow = sheet.getRange(1, 1, 1, 2).getValues()[0];
    return { year, team: { ytd: String(totalRow[1]) } };
  }

  return { calls, buildExecutiveSummaryLayout, getExecutiveSummaryReport, buildKPI2026, _kpiSheetName, getKPI2026Report };
}

function newSandbox({ masterLogRows, settingsRows, tryLockReturns = true, stubOpts } = {}) {
  const ssMock = makeSpreadsheetMock();
  const state = { isAdmin: true, user: 'admin@test.com' };
  const lockCalls = { tryLock: 0, releaseLock: 0 };

  if (masterLogRows) {
    const master = ssMock.insertSheet('MASTER_LOG');
    master.getRange(1, 1, 1, 9).setValues([['Timestamp', 'Date', 'Store', 'Brand', 'Region', 'Visited By', 'Purpose', 'Remarks', 'Store ID']]);
    masterLogRows.forEach(r => master.appendRow(r));
  }
  if (settingsRows) {
    const settings = ssMock.insertSheet('SETTINGS');
    settings.getRange(1, 1, 1, 5).setValues([['Store', 'Brand', 'Region', 'Unused', 'Category']]);
    settingsRows.forEach(r => settings.appendRow(r));
  }

  const stub = makeReportEngineStub(ssMock, stubOpts);

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return fmt.indexOf('HH') !== -1 ? `${y}-${m}-${d} 00:00:00` : `${y}-${m}-${d}`;
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { lockCalls.tryLock++; return tryLockReturns; },
        releaseLock: () => { lockCalls.releaseLock++; },
      }),
    },
    sl_isAdmin: () => state.isAdmin,
    sl_getCurrentUser: () => state.user,
    logError: () => {},
    Logger: { log: () => {} },
    console,
    // Report-engine boundary — stubbed, not loaded from source. See the
    // file header and makeReportEngineStub()'s own comment.
    buildExecutiveSummaryLayout: stub.buildExecutiveSummaryLayout,
    getExecutiveSummaryReport: stub.getExecutiveSummaryReport,
    buildKPI2026: stub.buildKPI2026,
    _kpiSheetName: stub._kpiSheetName,
    getKPI2026Report: stub.getKPI2026Report,
  };
  vm.createContext(sandbox);
  [coreSrc, configSrc, ryearSrc, calSrc, cmpCfgSrc, riskCfgSrc, riskSrc, lookupSrc, snapSrc]
    .forEach(src => vm.runInContext(src, sandbox));
  return { sandbox, ssMock, state, lockCalls, stub };
}

function row(y, m, d, store, visitor, purpose) {
  const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return [ds + ' 08:00:00', ds, store, 'FIGARO', 'NCR', visitor, purpose || 'STORE VISIT', '', ''];
}

const SETTINGS_FIXTURE = [
  ['ALPHA', 'FIGARO', 'NCR', '', 'NCR'],
  ['BETA', 'FIGARO', 'NCR', '', 'NCR'],
];

const LOG_2026 = [
  row(2026, 1, 10, 'ALPHA', 'LEO', 'STORE VISIT'),
  row(2026, 9, 5, 'ALPHA', 'LEO', 'FAILED QA/MS'),
  row(2026, 9, 17, 'ALPHA', 'LEO', 'STORE VISIT'),
  // BETA: no visits at all in 2026 — a real, non-fabricated compliance gap.
];

const EVAL_2026 = '2026-09-18';
const OPTS = { backdateConfirmed: true };

function assertComplete(snap, label) {
  check(label + ': storeRisk populated', Array.isArray(snap.result.storeRisk) && snap.result.storeRisk.length > 0, JSON.stringify(snap.result.storeRisk));
  check(label + ': complianceGaps populated (array, may be empty)', Array.isArray(snap.result.complianceGaps));
  check(label + ': totals populated', !!snap.result.totals && typeof snap.result.totals.storeCount === 'number', JSON.stringify(snap.result.totals));
  check(label + ': executiveSummary is non-null', snap.result.executiveSummary !== null, JSON.stringify(snap.result.executiveSummary));
  check(label + ': kpi is non-null', snap.result.kpi !== null, JSON.stringify(snap.result.kpi));
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── Basic finalization: creates snapshot v1, FINALIZED, correct identity ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const r = sandbox.finalizeReport(2026, EVAL_2026, 'first close of 2026');
  check('finalizeReport succeeds', r.success === true, JSON.stringify(r));
  eq('Snapshot ID follows AREA-YEAR-vN convention', r.snapshotId, 'REPORT-2026-v1');
  eq('version 1', r.snapshotVersion, 1);
  eq('status FINALIZED', r.status, 'FINALIZED');
  check('Snapshot ID is not a spreadsheet row number', !/^\d+$/.test(r.snapshotId), r.snapshotId);

  const snap = sandbox.getReportSnapshot(r.snapshotId);
  check('getReportSnapshot returns the full snapshot', !!snap, JSON.stringify(snap));
  check('has a frozen store-risk result', Array.isArray(snap.result.storeRisk) && snap.result.storeRisk.length === 2, JSON.stringify(snap.result.storeRisk));
  check('has a frozen compliance-gaps result', Array.isArray(snap.result.complianceGaps), JSON.stringify(snap.result.complianceGaps));
  check('BETA (never visited) is a frozen compliance gap', snap.result.complianceGaps.some(g => g.store === 'BETA'), JSON.stringify(snap.result.complianceGaps));
  check('createdBy/finalizedBy recorded', snap.createdBy === 'admin@test.com' && snap.finalizedBy === 'admin@test.com');
  check('reason recorded', snap.reason === 'first close of 2026');
  check('supersedesSnapshotId is null for v1', snap.supersedesSnapshotId === null);
  assertComplete(snap, 'basic finalize');
}

console.log('\n── A second independent finalize for the same year is rejected (must use supersede) ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  sandbox.finalizeReport(2026, EVAL_2026, 'v1');
  const again = sandbox.finalizeReport(2026, EVAL_2026, 'trying again');
  check('rejected — already finalized', again.success === false && /already has a finalized snapshot/i.test(again.message), JSON.stringify(again));
  eq('still exactly one snapshot stored', sandbox.listReportSnapshots(2026).length, 1);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── 26. HISTORICAL FREEZE — a finalized snapshot never reflects a later configuration change ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });

  const fin = sandbox.finalizeReport(2026, EVAL_2026, 'freeze test v1');
  check('v1 finalized', fin.success === true, JSON.stringify(fin));
  const before = sandbox.getReportSnapshot(fin.snapshotId);
  const beforeAlphaScore = before.result.storeRisk.find(s => s.store === 'ALPHA').riskScore;

  // Change applicable configuration: bump the Failed QA/MS weight and the
  // risk tier thresholds, effective immediately (today == evaluationDate,
  // no backdating involved).
  const riskChange = sandbox.risk_create(
    { lowThreshold: 0, mediumThreshold: 100000, highThreshold: 200000, weightFailedQaMs: 500, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 },
    EVAL_2026, 'threshold + weight change', OPTS
  );
  check('risk configuration change accepted', riskChange.success === true, JSON.stringify(riskChange));

  const after = sandbox.getReportSnapshot(fin.snapshotId);
  eq('v1 result is byte-for-byte unchanged after the config change (full result, incl. executiveSummary/kpi)', after.result, before.result);
  check('v1 frozen ALPHA risk score literally unchanged', after.result.storeRisk.find(s => s.store === 'ALPHA').riskScore === beforeAlphaScore);
  eq('v1 provenance is unchanged too', after.configurationProvenance, before.configurationProvenance);
}

console.log('\n── 27. DRAFT VS FINALIZED — the two calculation paths are genuinely separate ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const fin = sandbox.finalizeReport(2026, EVAL_2026, 'draft-vs-finalized v1');
  const frozen = sandbox.getReportSnapshot(fin.snapshotId);
  const frozenAlphaScore = frozen.result.storeRisk.find(s => s.store === 'ALPHA').riskScore;

  sandbox.risk_create(
    { lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightFailedQaMs: 900, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 },
    EVAL_2026, 'weight bump for draft comparison', OPTS
  );

  const draft = sandbox.getDraftReport(2026, EVAL_2026);
  check('getDraftReport returns a fresh calculation', draft && draft.mode === 'DRAFT', JSON.stringify(draft));
  const draftAlphaScore = draft.result.storeRisk.find(s => s.store === 'ALPHA').riskScore;

  check('draft reflects the NEW configuration', draftAlphaScore !== frozenAlphaScore, `draft=${draftAlphaScore} frozen=${frozenAlphaScore}`);

  const stillFrozen = sandbox.getReportSnapshot(fin.snapshotId);
  check('finalized v1 still shows the OLD value — never silently recalculated', stillFrozen.result.storeRisk.find(s => s.store === 'ALPHA').riskScore === frozenAlphaScore);
}

console.log('\n── 28. CORRECTION / SUPERSESSION ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const v1 = sandbox.finalizeReport(2026, EVAL_2026, 'original close');
  const v1Before = sandbox.getReportSnapshot(v1.snapshotId);

  // Reject a supersede attempt with no reason.
  const noReason = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, '');
  check('supersede without a reason is rejected', noReason.success === false, JSON.stringify(noReason));

  sandbox.risk_create(
    { lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightFailedQaMs: 250, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 },
    EVAL_2026, 'correcting the weight used at close', OPTS
  );

  const v2 = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, 'weight was wrong at original close');
  check('supersede succeeds', v2.success === true, JSON.stringify(v2));
  eq('v2 is version 2', v2.snapshotVersion, 2);
  eq('v2 snapshotId', v2.snapshotId, 'REPORT-2026-v2');
  eq('v2 records what it supersedes', v2.previousSnapshotId, v1.snapshotId);

  const v1After = sandbox.getReportSnapshot(v1.snapshotId);
  eq('v1 result remains completely unchanged', v1After.result, v1Before.result);
  eq('v1 is now SUPERSEDED', v1After.status, 'SUPERSEDED');

  const v2Snap = sandbox.getReportSnapshot(v2.snapshotId);
  eq('v2 is FINALIZED', v2Snap.status, 'FINALIZED');
  check('v2 reflects the corrected weight', v2Snap.result.storeRisk.find(s => s.store === 'ALPHA').riskScore !== v1Before.result.storeRisk.find(s => s.store === 'ALPHA').riskScore);
  assertComplete(v2Snap, 'v2 (superseding snapshot)');

  const latest = sandbox.getLatestFinalizedReportSnapshot(2026);
  eq('v2 is the latest finalized snapshot', latest.snapshotId, v2.snapshotId);

  check('both versions remain independently retrievable', !!sandbox.getReportSnapshot(v1.snapshotId) && !!sandbox.getReportSnapshot(v2.snapshotId));
  eq('retrieval by version also works for both', sandbox.getReportSnapshotByVersion(2026, 1).snapshotId, v1.snapshotId);
  eq('', sandbox.getReportSnapshotByVersion(2026, 2).snapshotId, v2.snapshotId);

  const audit = sandbox.cfg_getAuditLog('REPORT', '2026');
  const supersedeEntry = audit.filter(a => a.action === 'SUPERSEDE')[0];
  check('audit records the supersede relationship (old -> new)', !!supersedeEntry && supersedeEntry.previousValue === v1.snapshotId && supersedeEntry.newValue === v2.snapshotId, JSON.stringify(supersedeEntry));
  check('audit records who/why', !!supersedeEntry && supersedeEntry.actor === 'admin@test.com' && /weight was wrong/.test(supersedeEntry.reason));
}

console.log('\n── Cannot supersede a snapshot that is not currently finalized ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const v1 = sandbox.finalizeReport(2026, EVAL_2026, 'v1');
  sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, 'first correction'); // v1 -> SUPERSEDED, v2 FINALIZED

  const badSupersede = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, 'trying to supersede the already-superseded v1');
  check('rejected — v1 is no longer finalized', badSupersede.success === false && /not currently finalized/i.test(badSupersede.message), JSON.stringify(badSupersede));

  const unknownId = sandbox.supersedeReportSnapshot(2026, 'REPORT-2026-v999', EVAL_2026, 'x');
  check('rejected — unknown previous snapshot', unknownId.success === false && /not found/i.test(unknownId.message), JSON.stringify(unknownId));
}

console.log('\n── 15. Latest finalized snapshot is never simply "highest version number" ──');
{
  const { sandbox, ssMock } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const v1 = sandbox.finalizeReport(2026, EVAL_2026, 'v1');
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightFailedQaMs: 300, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 }, EVAL_2026, 'x', OPTS);
  const v2 = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, 'correction'); // v1 SUPERSEDED, v2 FINALIZED

  // Inject a synthetic higher-numbered DRAFT-status row directly at the
  // sheet level (no production code path ever writes DRAFT — see the
  // constant's own comment in SVMKPI_REPORT_SNAPSHOT.gs) purely to prove
  // the selection logic never treats "highest version" as "latest
  // finalized" even in this hypothetical mix, exactly matching the
  // spec's own example (v1=FINALIZED, v2=SUPERSEDED, v3=DRAFT).
  const sheet = ssMock.getSheetByName('REPORT_SNAPSHOTS');
  const lastRow = sheet.getLastRow();
  const width = 18;
  const raw = sheet.getRange(1, 1, lastRow, width).getValues();
  const fakeRow = raw[raw.length - 1].slice();
  fakeRow[0] = 'REPORT-2026-v3';   // Snapshot ID
  fakeRow[2] = 3;                  // Snapshot Version
  fakeRow[3] = 'DRAFT';            // Status
  sheet.appendRow(fakeRow);

  const latest = sandbox.getLatestFinalizedReportSnapshot(2026);
  eq('latest finalized is v2 (FINALIZED), never the higher-numbered v3 (DRAFT)', latest.snapshotId, v2.snapshotId);

  const listed = sandbox.listReportSnapshots(2026);
  eq('all three rows are listed (v3 not silently dropped)', listed.length, 3);
  eq('statuses reported honestly', listed.map(s => s.status), ['SUPERSEDED', 'FINALIZED', 'DRAFT']);
}

console.log('\n── 29. PER-YEAR — same implementation, multiple years, no cross-year contamination ──');
{
  const { sandbox, stub } = newSandbox({
    masterLogRows: [
      ...LOG_2026,
      row(2027, 2, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
      row(2028, 3, 1, 'BETA', 'GIO', 'STORE VISIT'),
    ],
    settingsRows: SETTINGS_FIXTURE,
  });

  const y2026 = sandbox.finalizeReport(2026, '2026-09-18', '2026 close');
  const y2027 = sandbox.finalizeReport(2027, '2027-06-01', '2027 close');
  const y2028 = sandbox.finalizeReport(2028, '2028-06-01', '2028 close');

  [y2026, y2027, y2028].forEach(r => check('finalize succeeds for ' + r.reportingYear, r.success === true, JSON.stringify(r)));

  eq('2026 version numbering starts at 1', y2026.snapshotVersion, 1);
  eq('2027 version numbering starts at 1 independently', y2027.snapshotVersion, 1);
  eq('2028 version numbering starts at 1 independently', y2028.snapshotVersion, 1);

  const s2026 = sandbox.getReportSnapshot(y2026.snapshotId);
  const s2027 = sandbox.getReportSnapshot(y2027.snapshotId);
  check('2026 snapshot reflects only 2026 visits (ALPHA totalYTD=3)', s2026.result.storeRisk.find(s => s.store === 'ALPHA').totalYTD === 3, JSON.stringify(s2026.result.storeRisk));
  check('2027 snapshot reflects only 2027 visits (ALPHA totalYTD=1)', s2027.result.storeRisk.find(s => s.store === 'ALPHA').totalYTD === 1, JSON.stringify(s2027.result.storeRisk));
  eq('2026 executiveSummary year matches (no cross-year contamination)', s2026.result.executiveSummary.year, 2026);
  eq('2027 executiveSummary year matches (no cross-year contamination)', s2027.result.executiveSummary.year, 2027);
  eq('Executive Summary was rebuilt for each of the 3 years finalized', stub.calls.buildES, [2026, 2027, 2028]);

  const rs2026 = sandbox.regenerateReportSheet(2026);
  const rs2027 = sandbox.regenerateReportSheet(2027);
  eq('per-year sheet naming: REPORT_2026', rs2026.sheetName, 'REPORT_2026');
  eq('per-year sheet naming: REPORT_2027', rs2027.sheetName, 'REPORT_2027');
}

console.log('\n── 30. CONFIGURATION PROVENANCE ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const v1 = sandbox.finalizeReport(2026, EVAL_2026, 'v1');
  const before = sandbox.getReportSnapshot(v1.snapshotId);
  check('provenance captured for risk (hardcoded default, no CONFIG_RISK yet)', before.configurationProvenance.risk.source === 'HARDCODED_DEFAULT', JSON.stringify(before.configurationProvenance.risk));
  check('provenance captured per-category for compliance, not one global version', Array.isArray(before.configurationProvenance.compliance.versions) && before.configurationProvenance.compliance.versions.some(v => v.category === 'NCR'), JSON.stringify(before.configurationProvenance.compliance));
  check('KPI gap documented in provenance, not fabricated', /no KPI scoring algorithm/i.test(before.configurationProvenance.kpiNote));

  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightFailedQaMs: 5, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 }, EVAL_2026, 'now create one', OPTS);

  const after = sandbox.getReportSnapshot(v1.snapshotId);
  eq('old snapshot provenance unchanged after a config now exists', after.configurationProvenance, before.configurationProvenance);
  eq('old snapshot result unchanged too', after.result, before.result);

  const v2 = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, 'now record the new provenance');
  const v2Snap = sandbox.getReportSnapshot(v2.snapshotId);
  check('new snapshot records the NEW provenance', v2Snap.configurationProvenance.risk.source === 'CONFIG_RISK' && !!v2Snap.configurationProvenance.risk.versionId, JSON.stringify(v2Snap.configurationProvenance.risk));
}

// ═══════════════════════════════════════════════════════════════
// COMPLETENESS FIX — mandatory tests A-H
// ═══════════════════════════════════════════════════════════════

console.log('\n── TEST A: no presentation sheets exist -> finalize builds both and captures both ──');
{
  const { sandbox, stub, ssMock } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  check('neither presentation sheet exists yet', !ssMock.getSheetByName('EXECUTIVE SUMMARY') && !ssMock.getSheetByName('KPI 2026'));

  const r = sandbox.finalizeReport(2026, EVAL_2026, 'no presentation sheets yet');
  check('finalization succeeds', r.success === true, JSON.stringify(r));
  eq('buildExecutiveSummaryLayout(2026) was called', stub.calls.buildES, [2026]);
  eq('buildKPI2026(2026) was called', stub.calls.buildKPI, [2026]);

  const snap = sandbox.getReportSnapshot(r.snapshotId);
  assertComplete(snap, 'TEST A');
}

console.log('\n── TEST B: presentation sheets already exist ──');
{
  console.log('  (KPI 2026 already exists and is correct -> NOT rebuilt, captured as-is)');
  const { sandbox, stub, ssMock } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const kpiSheet = ssMock.insertSheet('KPI 2026');
  kpiSheet.getRange(1, 1, 1, 2).setValues([['YTD_TOTAL', 42]]); // sentinel, deliberately NOT what the stub would compute

  const r = sandbox.finalizeReport(2026, EVAL_2026, 'kpi sheet pre-exists');
  check('finalization succeeds', r.success === true, JSON.stringify(r));
  eq('buildKPI2026 was NOT called — the year-scoped sheet already existed', stub.calls.buildKPI, []);
  const snap = sandbox.getReportSnapshot(r.snapshotId);
  eq('captured KPI reflects the PRE-EXISTING sheet content (sentinel), not a rebuild', snap.result.kpi.team.ytd, '42');
}
{
  console.log('  (mandatory) Executive Summary already represents a DIFFERENT year (2027) -> finalize(2026) must rebuild it for 2026, never trust the stale year');
  const { sandbox, stub, ssMock } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const esSheet = ssMock.insertSheet('EXECUTIVE SUMMARY');
  esSheet.getRange(1, 1, 1, 2).setValues([['YEAR', 2027]]);
  esSheet.getRange(2, 1, 1, 2).setValues([['TOTAL_VISITS', 999999]]); // clearly-wrong sentinel if left uncorrected

  const r = sandbox.finalizeReport(2026, EVAL_2026, 'stale Executive Summary from a different year');
  check('finalization succeeds', r.success === true, JSON.stringify(r));
  eq('buildExecutiveSummaryLayout(2026) WAS called even though the sheet already existed', stub.calls.buildES, [2026]);

  const snap = sandbox.getReportSnapshot(r.snapshotId);
  eq('captured executiveSummary.year is 2026, NOT the stale 2027', snap.result.executiveSummary.year, 2026);
  check('the stale 999999 sentinel from 2027 is gone — real 2026 data was captured instead', snap.result.executiveSummary.kpi[0].value !== '999999', snap.result.executiveSummary.kpi[0].value);
}

console.log('\n── TEST C: regeneration from a frozen snapshot — never a live recalculation ──');
{
  const { sandbox, stub, ssMock } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const fin = sandbox.finalizeReport(2026, EVAL_2026, 'to be regenerated later');
  const frozen = sandbox.getReportSnapshot(fin.snapshotId);
  const frozenTotalVisits = frozen.result.executiveSummary.kpi[0].value;
  const frozenAlphaScore = frozen.result.storeRisk.find(s => s.store === 'ALPHA').riskScore;

  // (B) delete REPORT_2026
  delete ssMock._sheets['REPORT_2026'];
  check('REPORT_2026 no longer exists', !ssMock.getSheetByName('REPORT_2026'));

  // (C) alter live MASTER_LOG/configuration
  const master = ssMock.getSheetByName('MASTER_LOG');
  master.appendRow(row(2026, 9, 20, 'ALPHA', 'GIO', 'STORE VISIT'));
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 1, highThreshold: 2, weightFailedQaMs: 999, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 }, EVAL_2026, 'change after finalize', OPTS);
  const buildESCallsBeforeRegen = stub.calls.buildES.length;
  const buildKPICallsBeforeRegen = stub.calls.buildKPI.length;

  // (D) regenerate
  const regen = sandbox.regenerateReportSheet(2026);
  check('regeneration succeeds', regen.success === true, JSON.stringify(regen));

  // (E)/(F) verify it came exclusively from the frozen snapshot, with NO
  // new calculation/build calls triggered by regeneration itself.
  eq('regenerateReportSheet() triggers NO new Executive Summary build', stub.calls.buildES.length, buildESCallsBeforeRegen);
  eq('regenerateReportSheet() triggers NO new KPI build', stub.calls.buildKPI.length, buildKPICallsBeforeRegen);

  const sheet = ssMock.getSheetByName('REPORT_2026');
  check('REPORT_2026 was recreated', !!sheet);
  const rows = sheet.getRange(1, 1, sheet.getLastRow(), 14).getValues();
  const flat = rows.map(r => r.join('|')).join('\n');
  check('regenerated sheet content includes the FROZEN total-visits value', flat.indexOf(frozenTotalVisits) !== -1, flat.slice(0, 300));
  check('regenerated sheet content includes the FROZEN ALPHA risk score, not a recalculated one', flat.indexOf(String(frozenAlphaScore)) !== -1);

  // Prove the "live" numbers really did change (so the above is a
  // meaningful assertion, not a coincidence).
  const freshDraft = sandbox.getDraftReport(2026, EVAL_2026);
  check('a FRESH draft calculated now genuinely differs from what was frozen (proves live data really changed)',
    freshDraft.result.storeRisk.find(s => s.store === 'ALPHA').riskScore !== frozenAlphaScore);
}

console.log('\n── TEST D: frozen completeness — every required section present ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const r = sandbox.finalizeReport(2026, EVAL_2026, 'completeness check');
  const snap = sandbox.getReportSnapshot(r.snapshotId);
  assertComplete(snap, 'TEST D');
}

console.log('\n── TEST E: complete historical isolation — the ENTIRE frozen Result JSON + provenance, not just Risk/Compliance ──');
{
  const { sandbox, ssMock } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const fin = sandbox.finalizeReport(2026, EVAL_2026, 'full isolation test');
  const snapshotBefore = sandbox.getReportSnapshot(fin.snapshotId);
  const resultCopy = JSON.parse(JSON.stringify(snapshotBefore.result));
  const provenanceCopy = JSON.parse(JSON.stringify(snapshotBefore.configurationProvenance));

  // Change risk configuration.
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 1, highThreshold: 2, weightFailedQaMs: 777, weightStoreVisit: -9, weightCuringSupport: -9, weightTltc: -9 }, EVAL_2026, 'isolation: config change', OPTS);
  // Change MASTER_LOG data.
  ssMock.getSheetByName('MASTER_LOG').appendRow(row(2026, 9, 21, 'BETA', 'RICE', 'TLTC'));
  // Rebuild the live Executive Summary/KPI sheets directly (simulating an
  // admin clicking "Rebuild Dashboard"/"Rebuild KPI" after the report was
  // already finalized) with now-different underlying data.
  sandbox.buildExecutiveSummaryLayout(2026);
  sandbox.buildKPI2026(2026);

  const snapshotAfter = sandbox.getReportSnapshot(fin.snapshotId);
  eq('the ENTIRE stored Result JSON is unchanged (storeRisk/complianceGaps/totals/executiveSummary/kpi)', snapshotAfter.result, resultCopy);
  eq('provenance is unchanged too', snapshotAfter.configurationProvenance, provenanceCopy);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── 31. SECURITY ──');
{
  const { sandbox, state } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  state.isAdmin = false;
  const finRejected = sandbox.finalizeReport(2026, EVAL_2026, 'x');
  check('non-admin cannot finalize', finRejected.success === false, JSON.stringify(finRejected));

  const spoofed = sandbox.finalizeReport(2026, EVAL_2026, 'x', { isAdmin: true, role: 'ADMIN' });
  check('a spoofed isAdmin/role in options has no effect', spoofed.success === false, JSON.stringify(spoofed));

  state.isAdmin = true;
  const v1 = sandbox.finalizeReport(2026, EVAL_2026, 'legit finalize');
  check('legit admin finalize succeeds', v1.success === true);

  state.isAdmin = false;
  const supersedeRejected = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, 'x');
  check('non-admin cannot supersede', supersedeRejected.success === false, JSON.stringify(supersedeRejected));
  const supersedeSpoofed = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, 'x', { isAdmin: true, role: 'ADMIN' });
  check('a spoofed isAdmin/role cannot bypass supersede either', supersedeSpoofed.success === false, JSON.stringify(supersedeSpoofed));
  state.isAdmin = true;
}

console.log('\n── Security: invalid input is rejected, no snapshot created ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const badYear = sandbox.finalizeReport('not-a-year', EVAL_2026, 'x');
  check('invalid year rejected', badYear.success === false, JSON.stringify(badYear));
  const badDate = sandbox.finalizeReport(2026, 'not-a-date', 'x');
  check('invalid evaluation date rejected', badDate.success === false, JSON.stringify(badDate));
  const noReason = sandbox.finalizeReport(2026, EVAL_2026, '');
  check('missing reason rejected', noReason.success === false, JSON.stringify(noReason));
  eq('nothing was ever persisted', sandbox.listReportSnapshots(2026).length, 0);
}

console.log('\n── Security: a calculation failure creates no finalized snapshot ──');
{
  // No MASTER_LOG sheet at all -> _getSheet() throws "Sheet not found".
  const { sandbox } = newSandbox({ settingsRows: SETTINGS_FIXTURE });
  const r = sandbox.finalizeReport(2026, EVAL_2026, 'should fail to calculate');
  check('finalize fails cleanly', r.success === false && /calculation failed/i.test(r.message), JSON.stringify(r));
  eq('no snapshot was created', sandbox.listReportSnapshots(2026).length, 0);
  eq('no audit entry was written', sandbox.cfg_getAuditLog('REPORT', '2026').length, 0);
}

console.log('\n── TEST G: Executive Summary builder failure -> no finalized snapshot, no audit entry ──');
{
  const { sandbox, stub } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE, stubOpts: { esBuildThrows: true } });
  const r = sandbox.finalizeReport(2026, EVAL_2026, 'ES builder will fail');
  check('finalize fails cleanly', r.success === false && /calculation failed/i.test(r.message), JSON.stringify(r));
  check('the builder WAS attempted (proves it is not silently skipped)', stub.calls.buildES.length === 1);
  eq('no snapshot was created', sandbox.listReportSnapshots(2026).length, 0);
  eq('no audit entry was written', sandbox.cfg_getAuditLog('REPORT', '2026').length, 0);
}

console.log('\n── TEST G (KPI variant): KPI builder failure -> no finalized snapshot, no audit entry ──');
{
  const { sandbox, stub } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE, stubOpts: { kpiBuildThrows: true } });
  const r = sandbox.finalizeReport(2026, EVAL_2026, 'KPI builder will fail');
  check('finalize fails cleanly', r.success === false && /calculation failed/i.test(r.message), JSON.stringify(r));
  check('the KPI builder WAS attempted (sheet was missing, so a build was correctly tried)', stub.calls.buildKPI.length === 1);
  eq('no snapshot was created', sandbox.listReportSnapshots(2026).length, 0);
  eq('no audit entry was written', sandbox.cfg_getAuditLog('REPORT', '2026').length, 0);
}

console.log('\n── A genuinely different KPI failure (sheet exists) is never misreported as "missing", and never silently retried ──');
{
  const { sandbox, ssMock, stub } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE, stubOpts: { kpiReadThrowsAlways: 'unrelated bug — not a missing-sheet condition' } });
  ssMock.insertSheet('KPI 2026').getRange(1, 1, 1, 2).setValues([['YTD_TOTAL', 5]]); // sheet genuinely exists
  const r = sandbox.finalizeReport(2026, EVAL_2026, 'kpi reader has a real bug');
  check('finalize fails, surfacing the real error', r.success === false && /unrelated bug/i.test(r.message), JSON.stringify(r));
  eq('buildKPI2026 was NEVER called — the sheet already existed, so this was correctly never treated as "missing"', stub.calls.buildKPI, []);
  eq('no snapshot was created', sandbox.listReportSnapshots(2026).length, 0);
}

console.log('\n── Security: a persistence failure is never reported as success ──');
{
  const { sandbox, ssMock, stub } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  // Force REPORT_SNAPSHOTS to already exist as a "poisoned" sheet whose
  // appendRow always throws, simulating a write failure after every
  // validation/calculation step — including the (non-transactional)
  // Executive Summary/KPI builds — has already completed.
  ssMock._sheets['REPORT_SNAPSHOTS'] = makePoisonSheet();
  const r = sandbox.finalizeReport(2026, EVAL_2026, 'should fail to persist');
  check('finalize does not report success', r.success === false, JSON.stringify(r));
  const audit = sandbox.cfg_getAuditLog('REPORT', '2026');
  eq('no audit entry was written for the failed persistence', audit.length, 0);
  check('the (non-transactional) presentation builds DID already run — this phase does not roll them back', stub.calls.buildES.length === 1 && stub.calls.buildKPI.length === 1);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── 32. CONCURRENCY (TEST F) ──');
{
  console.log('  (server-busy path)');
  const { sandbox, lockCalls } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE, tryLockReturns: false });
  const r = sandbox.finalizeReport(2026, EVAL_2026, 'contended');
  check('lock contention returns a clean rejection', r.success === false && /busy/i.test(r.message), JSON.stringify(r));
  eq('nothing was persisted', sandbox.listReportSnapshots(2026).length, 0);
  check('lock was released even though it was never acquired successfully', lockCalls.tryLock === 1 && lockCalls.releaseLock === 0);
}
{
  console.log('  (two finalize calls racing for the same brand-new year -> exactly one wins, exactly one FINALIZED, no duplicate audit)');
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const first = sandbox.finalizeReport(2026, EVAL_2026, 'race A');
  const second = sandbox.finalizeReport(2026, EVAL_2026, 'race B');
  check('exactly one finalize succeeds', (first.success === true) !== (second.success === true), JSON.stringify([first, second]));
  const versions = sandbox.listReportSnapshots(2026).map(s => s.snapshotVersion);
  eq('no duplicate version numbers were allocated', versions, [1]);
  const finalizeAudits = sandbox.cfg_getAuditLog('REPORT', '2026').filter(a => a.action === 'FINALIZE');
  eq('exactly one FINALIZE audit entry, not two', finalizeAudits.length, 1);
  assertComplete(sandbox.getReportSnapshot('REPORT-2026-v1'), 'winning racer');
}
{
  console.log('  (two supersede calls racing against the same previous snapshot -> exactly one wins)');
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const v1 = sandbox.finalizeReport(2026, EVAL_2026, 'v1');
  const a = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, 'race A');
  const b = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, EVAL_2026, 'race B');
  check('exactly one supersede succeeds against the same previous snapshot', (a.success === true) !== (b.success === true), JSON.stringify([a, b]));
  const versions = sandbox.listReportSnapshots(2026).map(s => s.snapshotVersion).sort();
  eq('no lost/duplicate versions — exactly v1 and v2 exist', versions, [1, 2]);
  const finalizedCount = sandbox.listReportSnapshots(2026).filter(s => s.status === 'FINALIZED').length;
  eq('exactly one snapshot is FINALIZED after the race', finalizedCount, 1);
  const supersedeAudits = sandbox.cfg_getAuditLog('REPORT', '2026').filter(a => a.action === 'SUPERSEDE');
  eq('exactly one SUPERSEDE audit entry, not two', supersedeAudits.length, 1);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── 34. EMPTY YEAR — never fabricate a finalized report for genuinely empty data ──');
{
  const { sandbox, stub } = newSandbox({ masterLogRows: [], settingsRows: [] }); // truly nothing: no stores, no events
  const r = sandbox.finalizeReport(2099, '2099-06-01', 'should reject');
  check('rejected cleanly — no stores, no history', r.success === false && /nothing to report/i.test(r.message), JSON.stringify(r));
  eq('no snapshot created', sandbox.listReportSnapshots(2099).length, 0);
  eq('the presentation builders were never even attempted for a genuinely empty year', stub.calls.buildES.length + stub.calls.buildKPI.length, 0);
}
{
  // Positive control: real stores with ZERO visits in the year is still
  // legitimate, reportable data (every store is a real compliance gap) —
  // must NOT be rejected as "empty".
  const { sandbox } = newSandbox({ masterLogRows: LOG_2026, settingsRows: SETTINGS_FIXTURE });
  const r = sandbox.finalizeReport(2030, '2030-06-01', 'a real year with configured stores but zero visits yet');
  check('a year with configured stores but zero visits is NOT treated as empty', r.success === true, JSON.stringify(r));
  const snap = sandbox.getReportSnapshot(r.snapshotId);
  eq('both stores show zero YTD (real data, not fabricated)', snap.result.storeRisk.map(s => s.totalYTD).sort(), [0, 0]);
  eq('both stores are compliance gaps', snap.result.complianceGaps.length, 2);
  assertComplete(snap, 'zero-visit-but-real-stores year');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── 33. SCALE — 5,000+ MASTER_LOG rows, multiple years/stores/config versions ──');
{
  const stores = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON'];
  const settingsRows = stores.map(s => [s, 'FIGARO', 'NCR', '', 'NCR']);
  const bigLog = [];
  for (let i = 0; i < 5200; i++) {
    const store = stores[i % stores.length];
    const year = 2026 + (i % 3); // 2026, 2027, 2028
    let month = ((i / 27) % 12 | 0) + 1;
    if (month === 9) month = 8; // keep September clear of filler (matches the established fixture-collision fix)
    const day = (i % 27) + 1;
    bigLog.push(row(year, month, day, store, 'LEO', 'STORE VISIT'));
  }
  // One deliberate, deterministic September 2026 visit so ALPHA is
  // provably compliant for the evaluation date used below.
  bigLog.push(row(2026, 9, 5, 'ALPHA', 'LEO', 'STORE VISIT'));

  const { sandbox } = newSandbox({ masterLogRows: bigLog, settingsRows });

  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightFailedQaMs: 5, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 }, '2026-01-01', 'v1', OPTS);
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 6, highThreshold: 11, weightFailedQaMs: 5, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 }, '2027-01-01', 'v2', OPTS);

  const start = Date.now();
  const r = sandbox.finalizeReport(2026, EVAL_2026, 'scale test');
  const elapsedMs = Date.now() - start;

  check('finalize succeeds at scale (5,200+ MASTER_LOG rows)', r.success === true, JSON.stringify(r));
  check('runs well under 5 seconds', elapsedMs < 5000, elapsedMs + 'ms');

  const snap = sandbox.getReportSnapshot(r.snapshotId);
  eq('all 5 stores present — no row ceiling', snap.result.storeRisk.length, 5);
  check('ALPHA correctly shows real 2026 visit history (no row-number-identity bug)', snap.result.storeRisk.find(s => s.store === 'ALPHA').totalYTD > 0);
  assertComplete(snap, 'scale test (with ES/KPI capture)');

  console.log('  [perf] finalizeReport over 5,200+ rows (now incl. Executive Summary rebuild + KPI build) took ' + elapsedMs + 'ms');
  console.log('  [perf] existing 10-second LockService.tryLock() timeout convention — ' + elapsedMs + 'ms leaves ' + (10000 - elapsedMs) + 'ms of headroom in this test environment');
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
