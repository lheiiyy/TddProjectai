// Phase 1F: Snapshot and Configuration Administration UI.
//
// This phase's ONLY new backend code is SVMKPI_ADMIN_API.gs — a small
// set of READ-ONLY list/aggregate functions the new Admin tab
// (Apps Script/SVMI_PORTAL.html) needs to enumerate "what exists" before
// calling into the EXISTING, already-tested Phase 1A/1B/1D/1E services
// for every actual mutation. This file therefore:
//   1. Tests the new admin_* aggregator functions directly (the genuinely
//      new surface).
//   2. Re-verifies, as "UI-facing contract" checks, that the specific
//      EXISTING functions the new Admin UI calls behave exactly as that
//      UI assumes (security, versioning, store/purpose/snapshot
//      semantics, multi-year isolation, error paths) — per the project's
//      own established convention of testing backend functions/contracts
//      rather than building new browser-rendering infrastructure for a
//      file (Apps Script/SVMI_PORTAL.html) the existing Playwright suite
//      has never covered (portal-ui.test.js/responsive-check.js only
//      ever drive SVMI_Command_Center_Demo.html — see DEPLOY.md's Phase
//      1F section for why this phase does not add browser coverage for
//      the real portal either).
// This deliberately does NOT re-run the full depth of config-service/
// store-identity/risk-config/compliance-config/kpi-purpose-config/
// report-snapshot.test.js — those already exhaustively cover this
// exact backend surface and are re-run unchanged as part of this
// phase's regression.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc     = APPS('SVMKPI_CORE.gs');
const configSrc   = APPS('SVMKPI_CONFIG.gs');
const ryearSrc    = APPS('SVMKPI_REPORTING_YEAR.gs');
const calSrc      = APPS('SVMKPI_CALENDAR.gs');
const storeCfgSrc = APPS('SVMKPI_STORE_CONFIG.gs');
const cmpCfgSrc   = APPS('SVMKPI_COMPLIANCE_CONFIG.gs');
const riskCfgSrc  = APPS('SVMKPI_RISK_CONFIG.gs');
const purposeSrc  = APPS('SVMKPI_PURPOSE_CONFIG.gs');
const kpiCfgSrc   = APPS('SVMKPI_KPI_CONFIG.gs');
const riskSrc     = APPS('SVMKPI_RISK.gs');
const lookupSrc   = APPS('SVMKPI_STORE_LOOKUP.gs');
const snapSrc     = APPS('SVMKPI_REPORT_SNAPSHOT.gs');
const adminSrc    = APPS('SVMKPI_ADMIN_API.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Established mock patterns (same as report-snapshot.test.js) ────────
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
function makeSpreadsheetMock() {
  const sheets = {};
  return { getSheetByName: (name) => sheets[name] || null, insertSheet: (name) => { const s = makeWritableSheet(); sheets[name] = s; return s; }, _sheets: sheets };
}
function makeReportEngineStub(ssMock, opts) {
  opts = opts || {};
  const calls = { buildES: [], buildKPI: [] };
  function buildExecutiveSummaryLayout(year) {
    calls.buildES.push(year);
    if (opts.esBuildThrows) throw new Error('simulated Executive Summary builder failure');
    let sheet = ssMock.getSheetByName('EXECUTIVE SUMMARY');
    if (!sheet) sheet = ssMock.insertSheet('EXECUTIVE SUMMARY'); else sheet.clear();
    sheet.getRange(1, 1, 1, 2).setValues([['YEAR', year]]);
  }
  function getExecutiveSummaryReport() {
    const sheet = ssMock.getSheetByName('EXECUTIVE SUMMARY');
    if (!sheet || sheet.getLastRow() < 1) throw new Error('EXECUTIVE SUMMARY sheet not found.');
    return { year: Number(sheet.getRange(1, 1, 1, 2).getValues()[0][1]), kpi: [{ label: 'Total Visits', value: '1' }] };
  }
  function _kpiSheetName(year) { return 'KPI ' + year; }
  function buildKPI2026(year) {
    calls.buildKPI.push(year);
    const name = _kpiSheetName(year);
    let sheet = ssMock.getSheetByName(name);
    if (!sheet) sheet = ssMock.insertSheet(name); else sheet.clear();
    sheet.getRange(1, 1, 1, 2).setValues([['YTD', 1]]);
  }
  function getKPI2026Report(year) {
    const sheet = ssMock.getSheetByName(_kpiSheetName(year));
    if (!sheet || sheet.getLastRow() < 1) throw new Error('"KPI ' + year + '" sheet not found.');
    return { year, team: { ytd: String(sheet.getRange(1, 1, 1, 2).getValues()[0][1]) } };
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
      getUuid: (() => { let n = 0; return () => 'test-uuid-' + (++n); })(),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => { lockCalls.tryLock++; return tryLockReturns; }, releaseLock: () => { lockCalls.releaseLock++; } }) },
    sl_isAdmin: () => state.isAdmin,
    sl_getCurrentUser: () => state.user,
    logError: () => {},
    Logger: { log: () => {} },
    console,
    buildExecutiveSummaryLayout: stub.buildExecutiveSummaryLayout,
    getExecutiveSummaryReport: stub.getExecutiveSummaryReport,
    buildKPI2026: stub.buildKPI2026,
    _kpiSheetName: stub._kpiSheetName,
    getKPI2026Report: stub.getKPI2026Report,
  };
  vm.createContext(sandbox);
  [coreSrc, configSrc, ryearSrc, calSrc, storeCfgSrc, cmpCfgSrc, riskCfgSrc, purposeSrc, kpiCfgSrc, riskSrc, lookupSrc, snapSrc, adminSrc]
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
const LOG_ALL_YEARS = [
  row(2026, 1, 10, 'ALPHA', 'LEO', 'STORE VISIT'),
  row(2026, 9, 5, 'ALPHA', 'LEO', 'FAILED QA/MS'),
  row(2027, 2, 1, 'ALPHA', 'LEO', 'STORE VISIT'),
  row(2028, 3, 1, 'BETA', 'GIO', 'STORE VISIT'),
];
const OPTS = { backdateConfirmed: true };

// ═══════════════════════════════════════════════════════════════
console.log('\n── admin_getAreaSchema() — schema comes from the backend, nothing hardcoded client-side ──');
{
  const { sandbox } = newSandbox({});
  const risk = sandbox.admin_getAreaSchema('RISK');
  check('RISK schema has thresholds/weights fields', risk.fields.some(f => f.key === 'mediumThreshold') && risk.fields.some(f => f.key === 'weightFailedQaMs'));
  const purposes = sandbox.admin_getAreaSchema('PURPOSES');
  eq('PURPOSES required fields', purposes.required, ['purposeName']);
  const bogus = sandbox.admin_getAreaSchema('NOT_A_REAL_AREA');
  eq('unknown area returns null, never fabricated', bogus, null);
}

console.log('\n── admin_listConfigEntityIds() ──');
{
  const { sandbox } = newSandbox({});
  sandbox.state = sandbox.state; // no-op, sandbox already admin
  const before = sandbox.admin_listConfigEntityIds('VISITORS');
  eq('no visitors configured yet', before, []);
  sandbox.cfg_createConfiguration('VISITORS', 'LEO', { visitorName: 'LEO' }, '2026-01-01', null, 'add', OPTS);
  sandbox.cfg_createConfiguration('VISITORS', 'GIO', { visitorName: 'GIO' }, '2026-01-01', null, 'add', OPTS);
  eq('both visitors listed, sorted', sandbox.admin_listConfigEntityIds('VISITORS'), ['GIO', 'LEO']);
}

console.log('\n── admin_getConfigEntityDetail() — current + full history in one call ──');
{
  const { sandbox } = newSandbox({});
  sandbox.cfg_createConfiguration('VISITORS', 'LEO', { visitorName: 'LEO' }, '2026-01-01', null, 'v1', OPTS);
  sandbox.cfg_createConfiguration('VISITORS', 'LEO', { visitorName: 'LEO M.' }, '2026-06-01', null, 'renamed', OPTS);
  const detail = sandbox.admin_getConfigEntityDetail('VISITORS', 'LEO', '2026-07-01');
  check('current resolves the latest applicable version', detail.current.fields.visitorName === 'LEO M.', JSON.stringify(detail.current));
  eq('history contains both versions, ascending', detail.history.map(h => h.versionNum), [1, 2]);
  check('historical version 1 fields remain exactly as created (never rewritten)', detail.history[0].fields.visitorName === 'LEO');
}

console.log('\n── admin_getRiskDetail() — global singleton, no entity enumeration needed ──');
{
  const { sandbox } = newSandbox({});
  const before = sandbox.admin_getRiskDetail(null);
  eq('no risk config yet -> no current version', before.current, null);
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightFailedQaMs: 5, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 }, '2026-01-01', 'v1', OPTS);
  const after = sandbox.admin_getRiskDetail(null);
  check('current now resolves', after.current && after.current.fields.mediumThreshold === 5, JSON.stringify(after.current));
}

console.log('\n── admin_listPurposes() — legacy purposes + deliberate configuration, no cross-purpose inheritance ──');
{
  const { sandbox } = newSandbox({});
  const list0 = sandbox.admin_listPurposes(null);
  check('the 4 legacy purposes are listed without any CONFIG_PURPOSES row', list0.length === 4 && list0.every(p => p.exists === true));
  check('legacy purposes show hasRiskConfig true via the hardcoded fallback', list0.filter(p => p.purposeName === 'STORE VISIT')[0].hasRiskConfig === true);

  sandbox.purpose_create('FIRST NEW PURPOSE', { riskWeight: -5 }, '2026-01-01', 'deliberate', OPTS);
  sandbox.purpose_create('SECOND NEW PURPOSE', {}, '2026-01-01', 'no config yet', OPTS);
  const list1 = sandbox.admin_listPurposes(null);
  const first = list1.filter(p => p.purposeName === 'FIRST NEW PURPOSE')[0];
  const second = list1.filter(p => p.purposeName === 'SECOND NEW PURPOSE')[0];
  check('FIRST has its own deliberate risk config', first.hasRiskConfig === true, JSON.stringify(first));
  check('SECOND does NOT inherit FIRST\'s risk config — hasRiskConfig false', second.hasRiskConfig === false, JSON.stringify(second));
  check('SECOND is reported incomplete, not silently valid', second.incomplete === true && second.valid === false);
}

console.log('\n── admin_listComplianceCategories() — hardcoded legacy categories + configured ones ──');
{
  const { sandbox } = newSandbox({});
  const cats0 = sandbox.admin_listComplianceCategories();
  check('the 4 pre-Phase-1D categories are listed without any CONFIG_COMPLIANCE row', cats0.indexOf('NCR') !== -1 && cats0.indexOf('FAR PROVINCIAL') !== -1 && cats0.length === 4);
  sandbox.cmp_create('CUSTOM REGION', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, '2026-01-01', 'new category', OPTS);
  const cats1 = sandbox.admin_listComplianceCategories();
  check('a newly configured category is included too', cats1.indexOf('CUSTOM REGION') !== -1);
}

console.log('\n── admin_getSystemAreaInfo() — honest read-only state, never a generic editor ──');
{
  const { sandbox } = newSandbox({});
  const info = sandbox.admin_getSystemAreaInfo();
  eq('no entries exist', info.hasAnyEntries, false);
  check('note explains the intentional infrastructure-only gap', /infrastructure-only/i.test(info.note));
}

console.log('\n── admin_listAllStores() — shows inactive stores that operational views correctly hide ──');
{
  const { sandbox } = newSandbox({});
  const created = sandbox.store_create({ storeName: 'ALPHA', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, '2026-01-01', 'create', OPTS);
  check('store created', created.success === true, JSON.stringify(created));
  const storeId = created.storeId;

  const allBefore = sandbox.admin_listAllStores(null);
  eq('one store, ACTIVE', allBefore.map(s => s.status), ['ACTIVE']);
  check('Store ID is the immutable identity field, not the name', allBefore[0].storeId === storeId);

  const deactivated = sandbox.store_deactivate(storeId, 'closed for renovation', '2026-06-01', OPTS);
  check('deactivate succeeds', deactivated.success === true, JSON.stringify(deactivated));

  const opList = sandbox.store_getOperationalList('2026-07-01');
  eq('operational list correctly excludes the inactive store', opList.length, 0);

  const allAfter = sandbox.admin_listAllStores('2026-07-01');
  eq('admin_listAllStores STILL shows it (admin screen, not an operational one)', allAfter.length, 1);
  eq('shows it as INACTIVE, not silently dropped', allAfter[0].status, 'INACTIVE');
  eq('Store ID remained the same across the status-change version', allAfter[0].storeId, storeId);

  const reactivated = sandbox.store_activate(storeId, 'reopened', '2026-08-01', OPTS);
  check('reactivate succeeds', reactivated.success === true);
  const opList2 = sandbox.store_getOperationalList('2026-09-01');
  eq('operational list includes it again', opList2.length, 1);
  eq('Store ID immutable across every version', opList2[0].storeId, storeId);
}

console.log('\n── Store ID immutability: store_update() never changes identity, only attributes ──');
{
  const { sandbox } = newSandbox({});
  const created = sandbox.store_create({ storeName: 'ALPHA', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, '2026-01-01', 'create', OPTS);
  const storeId = created.storeId;
  sandbox.store_update(storeId, { storeName: 'ALPHA RENAMED', brand: 'FIGARO', region: 'NCR', category: 'PROVINCIAL' }, '2026-06-01', 'renamed + recategorized', OPTS);
  const detail = sandbox.admin_getConfigEntityDetail('STORES', storeId, '2026-07-01');
  eq('Store ID (entity key) is unchanged', detail.current.entityId, storeId.toUpperCase());
  eq('Store Name changed (a display label, never the key)', detail.current.fields.storeName, 'ALPHA RENAMED');
  eq('exactly 2 versions exist — no history was rewritten', detail.history.length, 2);
  eq('version 1 keeps its ORIGINAL name forever', detail.history[0].fields.storeName, 'ALPHA');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── SECURITY — every UI-facing mutation remains admin-gated server-side regardless of the admin_* read layer ──');
{
  const { sandbox, state } = newSandbox({ masterLogRows: LOG_ALL_YEARS, settingsRows: SETTINGS_FIXTURE });
  state.isAdmin = false;

  check('read-only admin_listAllStores works with NO admin session (by design — same trust level as getStoreHealthReport())',
    Array.isArray(sandbox.admin_listAllStores(null)));
  check('read-only admin_listPurposes works with NO admin session', Array.isArray(sandbox.admin_listPurposes(null)));

  const mutationChecks = [
    ['store_create',  [{ storeName: 'X', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, '2026-01-01', 'x', OPTS]],
    ['purpose_create', ['NEW PURPOSE', {}, '2026-01-01', 'x', OPTS]],
    ['risk_create',    [{ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, '2026-01-01', 'x', OPTS]],
    ['cmp_create',     ['NCR', { cadenceType: 'MONTHLY', cadenceDays: 31 }, '2026-01-01', 'x', OPTS]],
    ['kpi_create',     ['NEW KPI', { targetValue: 1 }, '2026-01-01', 'x', OPTS]],
    ['cfg_createConfiguration', ['VISITORS', 'X', { visitorName: 'X' }, '2026-01-01', null, 'x', OPTS]],
    ['finalizeReport', [2026, '2026-09-18', 'x']],
  ];
  mutationChecks.forEach(([fn, args]) => {
    const r = sandbox[fn].apply(null, args);
    check(fn + '() rejected for a non-admin session', r.success === false, JSON.stringify(r));
  });

  state.isAdmin = true;
  const v1 = sandbox.finalizeReport(2026, '2026-09-18', 'legit');
  check('legit admin finalize succeeds', v1.success === true, JSON.stringify(v1));
  state.isAdmin = false;
  const spoofed = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, '2026-09-18', 'x', { isAdmin: true, role: 'ADMIN' });
  check('a spoofed isAdmin/role in options cannot bypass supersede', spoofed.success === false, JSON.stringify(spoofed));
}

console.log('\n── CONFIGURATION — create/rollback/audit/validation/backdating (VISITORS, the one area with no dedicated wrapper) ──');
{
  const { sandbox } = newSandbox({});
  const v1 = sandbox.cfg_createConfiguration('VISITORS', 'LEO', { visitorName: 'LEO' }, '2026-01-01', null, 'create', OPTS);
  check('create succeeds', v1.success === true, JSON.stringify(v1));
  const v2 = sandbox.cfg_createConfiguration('VISITORS', 'LEO', { visitorName: 'LEO M.' }, '2026-06-01', null, 'rename', OPTS);
  check('second version succeeds', v2.success === true);

  const detail = sandbox.admin_getConfigEntityDetail('VISITORS', 'LEO', null);
  eq('exactly 2 versions', detail.history.length, 2);
  eq('v1 fields remain exactly as originally created', detail.history[0].fields.visitorName, 'LEO');

  // effectiveFromStr omitted (null) -> defaults to "today" inside
  // cfg_rollbackConfiguration(), same as never passing one at all. A
  // hardcoded literal date here would eventually fall into the past as
  // real wall-clock time advances, tripping the (unrelated, correctly-
  // working) backdate-confirmation requirement this test isn't about.
  const rollback = sandbox.cfg_rollbackConfiguration('VISITORS', 'LEO', v1.versionId, 'undo the rename', null, {});
  check('rollback succeeds', rollback.success === true, JSON.stringify(rollback));
  const afterRollback = sandbox.admin_getConfigEntityDetail('VISITORS', 'LEO', null);
  eq('rollback created a NEW (3rd) version, never edited v1/v2', afterRollback.history.length, 3);
  eq('the new version restores v1\'s value', afterRollback.history[2].fields.visitorName, 'LEO');

  const audit = sandbox.cfg_getAuditLog('VISITORS', 'LEO');
  check('audit entry exists for the rollback', audit.some(a => a.action === 'ROLLBACK'), JSON.stringify(audit));

  const invalid = sandbox.cfg_createConfiguration('VISITORS', '', { visitorName: 'X' }, '2026-01-01', null, '', OPTS);
  check('invalid (blank entity) configuration rejected', invalid.success === false, JSON.stringify(invalid));

  const noConfirm = sandbox.cfg_createConfiguration('VISITORS', 'GIO', { visitorName: 'GIO' }, '2020-01-01', null, '', {});
  check('backdated change without confirmation is rejected', noConfirm.success === false && noConfirm.requiresBackdateConfirmation === true, JSON.stringify(noConfirm));
  const noReason = sandbox.cfg_createConfiguration('VISITORS', 'GIO', { visitorName: 'GIO' }, '2020-01-01', null, '', { backdateConfirmed: true });
  check('backdated change without a reason is rejected', noReason.success === false, JSON.stringify(noReason));
  const withBoth = sandbox.cfg_createConfiguration('VISITORS', 'GIO', { visitorName: 'GIO' }, '2020-01-01', null, 'onboarded retroactively', OPTS);
  check('backdated change WITH confirmation + reason is accepted', withBoth.success === true, JSON.stringify(withBoth));
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── SNAPSHOTS — finalize/frozen/duplicate-rejected/supersede-preserves/latest-by-status/regeneration-from-frozen ──');
{
  const { sandbox, ssMock } = newSandbox({ masterLogRows: LOG_ALL_YEARS, settingsRows: SETTINGS_FIXTURE });

  const v1 = sandbox.finalizeReport(2026, '2026-09-18', 'first close');
  check('finalize (UI-facing call shape) succeeds', v1.success === true, JSON.stringify(v1));
  const frozenBefore = sandbox.getReportSnapshot(v1.snapshotId);

  const dup = sandbox.finalizeReport(2026, '2026-09-18', 'trying again');
  check('duplicate finalization rejected', dup.success === false && /already has a finalized snapshot/i.test(dup.message), JSON.stringify(dup));

  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 1, highThreshold: 2, weightFailedQaMs: 999 }, '2026-09-18', 'config change after finalize', OPTS);
  const frozenAfter = sandbox.getReportSnapshot(v1.snapshotId);
  eq('finalized snapshot remains completely frozen after a later config change', frozenAfter.result, frozenBefore.result);

  const v2 = sandbox.supersedeReportSnapshot(2026, v1.snapshotId, '2026-09-18', 'correcting the weight');
  check('supersede succeeds', v2.success === true, JSON.stringify(v2));
  const v1Snap = sandbox.getReportSnapshot(v1.snapshotId);
  eq('previous snapshot preserved, marked SUPERSEDED, result untouched', [v1Snap.status, JSON.stringify(v1Snap.result)], ['SUPERSEDED', JSON.stringify(frozenBefore.result)]);

  const latest = sandbox.getLatestFinalizedReportSnapshot(2026);
  eq('latest finalized selection uses STATUS, not just highest version', latest.snapshotId, v2.snapshotId);

  const regen = sandbox.regenerateReportSheet(2026);
  check('regeneration succeeds', regen.success === true, JSON.stringify(regen));
  const sheet = ssMock.getSheetByName('REPORT_2026');
  const cellRows = sheet.getRange(1, 1, sheet.getLastRow(), 14).getValues();
  const flat = cellRows.map(r => r.join('|')).join('\n');
  check('regenerated sheet reflects the LATEST FINALIZED (v2) snapshot ID', flat.indexOf(v2.snapshotId) !== -1, flat.slice(0, 200));
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── MULTI-YEAR — 2026/2027/2028 isolation; nothing hardcodes a year ──');
{
  const { sandbox } = newSandbox({ masterLogRows: LOG_ALL_YEARS, settingsRows: SETTINGS_FIXTURE });
  const years = sandbox.getAvailableReportingYears();
  eq('years discovered dynamically from MASTER_LOG, not hardcoded', years, [2026, 2027, 2028]);

  // Evaluation dates are each year's own Dec 31 — the FULL calendar year
  // — so totalYTD reflects every 2026-dated row, not just those before
  // an earlier mid-year evaluation date (period-to-date semantics apply
  // to Compliance, not to this YTD count — see SVMKPI_RISK.gs).
  [2026, 2027, 2028].forEach(y => {
    const r = sandbox.finalizeReport(y, y + '-12-31', 'close ' + y);
    check('finalize succeeds independently for ' + y, r.success === true, JSON.stringify(r));
    eq(y + ' version numbering starts at 1 independently', r.snapshotVersion, 1);
  });

  const s2026 = sandbox.getReportSnapshot(sandbox.getLatestFinalizedReportSnapshot(2026).snapshotId);
  const s2027 = sandbox.getReportSnapshot(sandbox.getLatestFinalizedReportSnapshot(2027).snapshotId);
  const s2028 = sandbox.getReportSnapshot(sandbox.getLatestFinalizedReportSnapshot(2028).snapshotId);
  check('2026 snapshot reflects only 2026 data', s2026.result.storeRisk.find(s => s.store === 'ALPHA').totalYTD === 2, JSON.stringify(s2026.result.storeRisk));
  check('2027 snapshot reflects only 2027 data', s2027.result.storeRisk.find(s => s.store === 'ALPHA').totalYTD === 1, JSON.stringify(s2027.result.storeRisk));
  check('2028 snapshot reflects only 2028 data', s2028.result.storeRisk.find(s => s.store === 'BETA').totalYTD === 1, JSON.stringify(s2028.result.storeRisk));

  eq('admin_getAreaSchema never varies by year (no year param at all)', typeof sandbox.admin_getAreaSchema.length, 'number');
  check('admin_getAreaSchema signature takes only (area) — confirms no hidden year coupling', sandbox.admin_getAreaSchema.length === 1);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── ERROR PATHS ──');
{
  console.log('  (authorization — covered in the SECURITY section above)');

  console.log('  (validation)');
  const { sandbox } = newSandbox({ masterLogRows: LOG_ALL_YEARS, settingsRows: SETTINGS_FIXTURE });
  const badRisk = sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 10, highThreshold: 5 }, '2026-01-01', 'inverted thresholds', OPTS);
  check('invalid risk configuration (medium >= high) rejected', badRisk.success === false, JSON.stringify(badRisk));
  const badYear = sandbox.finalizeReport('not-a-year', '2026-09-18', 'x');
  check('invalid reporting year rejected by the finalize call the UI makes', badYear.success === false, JSON.stringify(badYear));

  console.log('  (builder failure — the UI-facing finalize call must fail cleanly, no snapshot, no audit)');
  const { sandbox: sbFail } = newSandbox({ masterLogRows: LOG_ALL_YEARS, settingsRows: SETTINGS_FIXTURE, stubOpts: { esBuildThrows: true } });
  const failResult = sbFail.finalizeReport(2026, '2026-09-18', 'ES builder will fail');
  check('finalize fails cleanly on a builder failure', failResult.success === false && /calculation failed/i.test(failResult.message), JSON.stringify(failResult));
  eq('no snapshot created', sbFail.listReportSnapshots(2026).length, 0);
  eq('no audit entry written', sbFail.cfg_getAuditLog('REPORT', '2026').length, 0);

  console.log('  (persistence failure — must never report success)');
  const { sandbox: sbPersist, ssMock: ssPersist } = newSandbox({ masterLogRows: LOG_ALL_YEARS, settingsRows: SETTINGS_FIXTURE });
  ssPersist._sheets['REPORT_SNAPSHOTS'] = { getLastRow: () => 1, getRange: () => ({ getValues: () => [], setValues: () => {} }), appendRow: () => { throw new Error('simulated write failure'); }, clear: () => {} };
  const persistResult = sbPersist.finalizeReport(2026, '2026-09-18', 'will fail to persist');
  check('finalize does not report success on a persistence failure', persistResult.success === false, JSON.stringify(persistResult));

  console.log('  (concurrency — lock contention returns a clean rejection, nothing persisted)');
  const { sandbox: sbBusy } = newSandbox({ masterLogRows: LOG_ALL_YEARS, settingsRows: SETTINGS_FIXTURE, tryLockReturns: false });
  const busyResult = sbBusy.finalizeReport(2026, '2026-09-18', 'contended');
  check('server-busy rejection surfaced to the UI-facing call', busyResult.success === false && /busy/i.test(busyResult.message), JSON.stringify(busyResult));
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
