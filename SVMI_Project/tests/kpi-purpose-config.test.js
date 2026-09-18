// Phase 1D: Versioned KPI Weight/Target Configuration (SVMKPI_KPI_CONFIG.gs)
// + Deliberate Purpose KPI/Risk Configuration (SVMKPI_PURPOSE_CONFIG.gs).
//
// Covers the Phase 1D spec's "24. TESTING — KPI" and "25. TESTING —
// PURPOSES", plus relevant parts of "27. TESTING — CONFIGURATION
// SECURITY". KPI has no live calculation to compare against (documented
// gap — see SVMKPI_KPI_CONFIG.gs's header and DEPLOY.md), so "existing
// KPI outputs remain equivalent" here means the pure visit-count tracker
// (buildKPI2026()/getKPI2026Report()) is untouched by this file's
// existence, which the "2026/2027/2028" check below confirms directly.
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs + SVMKPI_CONFIG.gs +
// SVMKPI_REPORTING_YEAR.gs + SVMKPI_KPI_CONFIG.gs + SVMKPI_RISK_CONFIG.gs
// + SVMKPI_RISK.gs + SVMKPI_PURPOSE_CONFIG.gs + SVMKPI_KPI_REBUILD.gs +
// SVMKPI_REPORTS.gs) in a Node vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc      = APPS('SVMKPI_CORE.gs');
const configSrc    = APPS('SVMKPI_CONFIG.gs');
const yearSrc      = APPS('SVMKPI_REPORTING_YEAR.gs');
const kpiCfgSrc    = APPS('SVMKPI_KPI_CONFIG.gs');
const riskCfgSrc   = APPS('SVMKPI_RISK_CONFIG.gs');
const riskSrc      = APPS('SVMKPI_RISK.gs');
const purposeSrc   = APPS('SVMKPI_PURPOSE_CONFIG.gs');
const kpiSrc       = APPS('SVMKPI_KPI_REBUILD.gs');
const reportsSrc   = APPS('SVMKPI_REPORTS.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
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
    getRange: (row, col, numRows, numCols) => makeRange(row, col, numRows || 1, numCols || 1),
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

function newSandbox(masterLogRows, settingsF) {
  const ssMock = makeSpreadsheetMock();
  const state = { isAdmin: true };
  const master = ssMock.insertSheet('MASTER_LOG');
  master.getRange(1, 1, 1, 8).setValues([['Timestamp', 'Date', 'Store', 'Brand', 'Region', 'Visited By', 'Purpose', 'Remarks']]);
  (masterLogRows || []).forEach(r => master.appendRow(r));
  const settings = ssMock.insertSheet('SETTINGS');
  (settingsF || []).forEach((name, i) => settings.getRange(2 + i, 6).setValue(name));

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
    sl_isAdmin: () => state.isAdmin,
    sl_getCurrentUser: () => 'admin@test.com',
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(configSrc, sandbox);
  vm.runInContext(yearSrc, sandbox);
  vm.runInContext(kpiCfgSrc, sandbox);
  vm.runInContext(riskCfgSrc, sandbox);
  vm.runInContext(riskSrc, sandbox);
  vm.runInContext(purposeSrc, sandbox);
  vm.runInContext(kpiSrc, sandbox);
  vm.runInContext(reportsSrc, sandbox);
  return { sandbox, state };
}

function row(y, m, d, store, visitor, purpose) {
  const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return [ds + ' 08:00:00', ds, store, 'FIGARO', 'NCR', visitor, purpose || 'STORE VISIT', ''];
}
const TODAY = '2026-09-18';

// ═══════════════════════════════════════════════════════════════
// KPI CONFIGURATION
// ═══════════════════════════════════════════════════════════════

console.log('\n── KPI: create, resolve, weight/target validation ──');
{
  const { sandbox } = newSandbox([]);
  const created = sandbox.kpi_create('Visit Frequency', { targetValue: 4, targetType: 'COUNT', weight: 1, purposeRef: 'STORE VISIT' }, TODAY, 'setup', {});
  check('kpi_create succeeds', created.success, JSON.stringify(created));
  const resolved = sandbox.resolveKPIConfigurationAsOf('Visit Frequency', TODAY);
  eq('resolves targetValue/targetType/weight/purposeRef', { targetValue: resolved.targetValue, targetType: resolved.targetType, weight: resolved.weight, purposeRef: resolved.purposeRef }, { targetValue: 4, targetType: 'COUNT', weight: 1, purposeRef: 'STORE VISIT' });
}

console.log('\n── KPI: invalid weight (non-numeric) is rejected ──');
{
  const { sandbox } = newSandbox([]);
  const r = sandbox.kpi_create('Bad Weight KPI', { targetValue: 1, weight: 'not-a-number' }, TODAY, 'x', {});
  check('rejected', r.success === false && /Weight must be numeric/.test(r.message), JSON.stringify(r));
}

console.log('\n── KPI: invalid target (PERCENTAGE out of 0-100 range) is rejected ──');
{
  const { sandbox } = newSandbox([]);
  const r = sandbox.kpi_create('Bad Target KPI', { targetValue: 150, targetType: 'PERCENTAGE' }, TODAY, 'x', {});
  check('rejected', r.success === false && /between 0 and 100/.test(r.message), JSON.stringify(r));
}

console.log('\n── KPI: invalid targetType is rejected ──');
{
  const { sandbox } = newSandbox([]);
  const r = sandbox.kpi_create('Bad Type KPI', { targetValue: 1, targetType: 'BOGUS' }, TODAY, 'x', {});
  check('rejected', r.success === false && /Target Type must be one of/.test(r.message), JSON.stringify(r));
}

console.log('\n── KPI: effective-date boundary / historical configuration resolution ──');
{
  const { sandbox } = newSandbox([]);
  sandbox.kpi_create('Boundary KPI', { targetValue: 1, weight: 1 }, '2026-01-01', 'v1', { backdateConfirmed: true });
  sandbox.kpi_create('Boundary KPI', { targetValue: 2, weight: 2 }, '2027-01-01', 'v2', { backdateConfirmed: true });
  eq('2026 resolves v1', sandbox.resolveKPIConfigurationAsOf('Boundary KPI', '2026-06-01').targetValue, 1);
  eq('2027 resolves v2', sandbox.resolveKPIConfigurationAsOf('Boundary KPI', '2027-06-01').targetValue, 2);
}

console.log('\n── KPI: no duplicate configuration (same Effective From rejected, matching Phase 1A\'s generic rule) ──');
{
  const { sandbox } = newSandbox([]);
  sandbox.kpi_create('Dup KPI', { targetValue: 1 }, TODAY, 'v1', {});
  const dup = sandbox.kpi_create('Dup KPI', { targetValue: 2 }, TODAY, 'v2', {});
  check('rejected — exact same Effective From already exists', dup.success === false, JSON.stringify(dup));
}

console.log('\n── KPI: missing configuration is handled safely (returns null, never throws) ──');
{
  const { sandbox } = newSandbox([]);
  let threw = false, result;
  try { result = sandbox.resolveKPIConfigurationAsOf('Never Configured KPI', TODAY); } catch (e) { threw = true; }
  check('no throw', !threw);
  check('returns null', result === null);
}

console.log('\n── KPI: buildKPI2026()/getKPI2026Report() — the SAME visit-count tracker works across 2026/2027/2028, untouched by CONFIG_KPI\'s existence ──');
{
  const masterLogRows = [
    row(2026, 1, 10, 'ALPHA', 'LEO'),
    row(2027, 2, 5, 'ALPHA', 'LEO'),
    row(2028, 3, 1, 'ALPHA', 'LEO'),
  ];
  const { sandbox } = newSandbox(masterLogRows, []);
  sandbox.kpi_create('Irrelevant KPI', { targetValue: 999, weight: 999 }, TODAY, 'should not affect the tracker', {});

  [2026, 2027, 2028].forEach(yr => {
    const build = sandbox.buildKPI2026(yr);
    check('year ' + yr + ': build succeeds', build.success, JSON.stringify(build));
    const report = sandbox.getKPI2026Report(yr);
    eq('year ' + yr + ': report carries the requested year', report.year, yr);
    check('year ' + yr + ': LEO appears with his one visit that year, unaffected by CONFIG_KPI', report.visitors.some(v => v.name === 'LEO'), JSON.stringify(report.visitors.map(v => v.name)));
  });
}


// ═══════════════════════════════════════════════════════════════
// PURPOSE CONFIGURATION
// ═══════════════════════════════════════════════════════════════

console.log('\n── Purpose: an existing (legacy) purpose is reported exists+active, with risk config via the legacy fallback ──');
{
  const { sandbox } = newSandbox([]);
  const status = sandbox.purpose_getConfigurationStatus('STORE VISIT', TODAY);
  check('exists (legacy APPROVED_PURPOSES membership, no CONFIG_PURPOSES row needed)', status.exists === true, JSON.stringify(status));
  check('active', status.active === true, JSON.stringify(status));
  check('hasRiskConfig true — via the hardcoded RISK_PURPOSE_SCORE fallback', status.hasRiskConfig === true, JSON.stringify(status));
  check('hasKpiConfig false — no CONFIG_KPI row references it (the documented KPI gap)', status.hasKpiConfig === false, JSON.stringify(status));
  check('not "valid" (missing KPI config) but IS "incomplete"', status.valid === false && status.incomplete === true, JSON.stringify(status));
}

console.log('\n── Purpose: a brand-new purpose can be created ──');
{
  const { sandbox } = newSandbox([]);
  const created = sandbox.purpose_create('BRAND NEW PURPOSE', {}, TODAY, 'new purpose, no config yet', {});
  check('purpose_create succeeds', created.success, JSON.stringify(created));
}

console.log('\n── Purpose: a new purpose WITHOUT deliberate KPI/risk configuration is never silently treated as configured ──');
{
  const { sandbox } = newSandbox([]);
  sandbox.purpose_create('UNCONFIGURED PURPOSE', {}, TODAY, 'x', {});
  const status = sandbox.purpose_getConfigurationStatus('UNCONFIGURED PURPOSE', TODAY);
  check('exists (a CONFIG_PURPOSES row was created)', status.exists === true, JSON.stringify(status));
  check('hasRiskConfig is false — no inheritance from any other purpose', status.hasRiskConfig === false, JSON.stringify(status));
  check('hasKpiConfig is false', status.hasKpiConfig === false, JSON.stringify(status));
  check('not valid — genuinely incomplete', status.valid === false && status.incomplete === true, JSON.stringify(status));
}

console.log('\n── Purpose: deliberate KPI configuration works ──');
{
  const { sandbox } = newSandbox([]);
  sandbox.purpose_create('KPI-LINKED PURPOSE', {}, TODAY, 'x', {});
  sandbox.kpi_create('Linked KPI', { targetValue: 1, purposeRef: 'KPI-LINKED PURPOSE' }, TODAY, 'link it', {});
  const status = sandbox.purpose_getConfigurationStatus('KPI-LINKED PURPOSE', TODAY);
  check('hasKpiConfig is now true', status.hasKpiConfig === true, JSON.stringify(status));
}

console.log('\n── Purpose: deliberate risk configuration works ──');
{
  const { sandbox } = newSandbox([]);
  sandbox.purpose_create('RISK-CONFIGURED PURPOSE', { riskWeight: -3 }, TODAY, 'deliberate risk weight', {});
  const status = sandbox.purpose_getConfigurationStatus('RISK-CONFIGURED PURPOSE', TODAY);
  check('hasRiskConfig is now true', status.hasRiskConfig === true, JSON.stringify(status));
  const resolved = sandbox.risk_resolvePurposeWeight('RISK-CONFIGURED PURPOSE', TODAY);
  eq('resolves the deliberate weight, sourced from PURPOSE_CONFIG', resolved, { weight: -3, source: 'PURPOSE_CONFIG' });
}

console.log('\n── Purpose: no automatic inheritance — two independently-created new purposes never share a weight ──');
{
  const { sandbox } = newSandbox([]);
  sandbox.purpose_create('FIRST NEW PURPOSE', { riskWeight: -5 }, TODAY, 'x', {});
  sandbox.purpose_create('SECOND NEW PURPOSE', {}, TODAY, 'x', {}); // deliberately no riskWeight
  const first = sandbox.risk_resolvePurposeWeight('FIRST NEW PURPOSE', TODAY);
  const second = sandbox.risk_resolvePurposeWeight('SECOND NEW PURPOSE', TODAY);
  eq('FIRST has its own configured weight', first, { weight: -5, source: 'PURPOSE_CONFIG' });
  check('SECOND has NO weight at all — never silently copied FIRST\'s -5', second === null, JSON.stringify(second));
}


// ═══════════════════════════════════════════════════════════════
// SECURITY
// ═══════════════════════════════════════════════════════════════

console.log('\n── Security: non-admin rejected on KPI and Purpose mutations ──');
{
  const { sandbox, state } = newSandbox([]);
  state.isAdmin = false;
  check('kpi_create rejected', sandbox.kpi_create('X', { targetValue: 1 }, TODAY, 'x', {}).success === false);
  check('purpose_create rejected', sandbox.purpose_create('Y', {}, TODAY, 'x', {}).success === false);
  state.isAdmin = true;
  const realKpi = sandbox.kpi_create('X', { targetValue: 1 }, TODAY, 'x', {});
  const realPurpose = sandbox.purpose_create('Y', {}, TODAY, 'x', {});
  state.isAdmin = false;
  check('kpi_deactivate rejected', sandbox.kpi_deactivate(realKpi.versionId, 'x').success === false);
  check('purpose_deactivate rejected', sandbox.purpose_deactivate(realPurpose.versionId, 'x').success === false);
}

console.log('\n── Security: spoofed isAdmin/role fields cannot bypass either service ──');
{
  const { sandbox, state } = newSandbox([]);
  state.isAdmin = false;
  const kpiAttempt = sandbox.kpi_create('Z', { targetValue: 1, isAdmin: true, role: 'ADMIN' }, TODAY, 'x', {});
  const purposeAttempt = sandbox.purpose_create('W', { isAdmin: true, role: 'ADMIN' }, TODAY, 'x', {});
  check('kpi_create still rejected', kpiAttempt.success === false, JSON.stringify(kpiAttempt));
  check('purpose_create still rejected', purposeAttempt.success === false, JSON.stringify(purposeAttempt));
}

console.log('\n── Security: invalid configuration never creates an audit-success record (KPI + Purpose) ──');
{
  const { sandbox } = newSandbox([]);
  const beforeKpi = sandbox.cfg_getAuditLog('KPI', 'INVALID KPI').length;
  const invalidKpi = sandbox.kpi_create('Invalid KPI', { targetValue: 1, targetType: 'BOGUS' }, TODAY, 'x', {});
  check('invalid KPI rejected', invalidKpi.success === false);
  eq('no KPI audit entry written', sandbox.cfg_getAuditLog('KPI', 'INVALID KPI').length, beforeKpi);

  const beforePurpose = sandbox.cfg_getAuditLog('PURPOSES', 'INVALID PURPOSE').length;
  const invalidPurpose = sandbox.purpose_create('Invalid Purpose', { riskWeight: 'not-a-number' }, TODAY, 'x', {});
  check('invalid Purpose rejected', invalidPurpose.success === false);
  eq('no Purpose audit entry written', sandbox.cfg_getAuditLog('PURPOSES', 'INVALID PURPOSE').length, beforePurpose);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
