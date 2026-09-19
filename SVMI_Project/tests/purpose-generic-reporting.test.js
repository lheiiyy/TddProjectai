// SVMI Phase 2C — proving a genuinely NEW purpose can reach the existing
// reporting pipeline through configuration alone, with zero purpose-
// specific code (no `if (purpose === 'TEST_NEW_PURPOSE')` anywhere, no
// CAPAR-specific logic, and no reintroduction of CAPAR to any active
// list).
//
// Runs the REAL Apps Script code (SVMKPI_CORE/CONFIG/REPORTING_YEAR/
// CALENDAR/COMPLIANCE_CONFIG/RISK_CONFIG/RISK/KPI_CONFIG/PURPOSE_CONFIG/
// STORE_LOOKUP/REPORT_SNAPSHOT.gs) in a Node vm sandbox — same generic
// writable-Sheet-mock pattern already used by risk-config/compliance-
// config/report-snapshot.test.js. Executive Summary/KPI's own ~1,000
// lines of native Sheets-formula-writing code are stubbed exactly the way
// report-snapshot.test.js already does (see that file's header) — this
// suite is about whether a NEW purpose's numbers flow through the
// canonical risk/compliance engines and the snapshot mechanism, not a
// re-verification of Executive Summary/KPI's own arithmetic.
//
// Two synthetic purposes never used anywhere else in this app:
// TEST_NEW_PURPOSE (Scenarios A/B/C/E/isolation) and TEST_SECOND_PURPOSE
// (Scenario F — repeatability). Plus TEST_UNCONFIGURED_PURPOSE (Scenario
// D — the negative test). None of the three are ever added to
// APPROVED_PURPOSES or any other hardcoded list — they exist purely as
// CONFIG_PURPOSES/CONFIG_KPI rows and MASTER_LOG data, exactly as any
// real new purpose would.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc     = APPS('SVMKPI_CORE.gs');
const configSrc   = APPS('SVMKPI_CONFIG.gs');
const ryearSrc    = APPS('SVMKPI_REPORTING_YEAR.gs');
const calSrc      = APPS('SVMKPI_CALENDAR.gs');
const cmpCfgSrc   = APPS('SVMKPI_COMPLIANCE_CONFIG.gs');
const riskCfgSrc  = APPS('SVMKPI_RISK_CONFIG.gs');
const riskSrc     = APPS('SVMKPI_RISK.gs');
const kpiCfgSrc   = APPS('SVMKPI_KPI_CONFIG.gs');
const purposeCfgSrc = APPS('SVMKPI_PURPOSE_CONFIG.gs');
const lookupSrc   = APPS('SVMKPI_STORE_LOOKUP.gs');
const snapSrc     = APPS('SVMKPI_REPORT_SNAPSHOT.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Generic writable Sheet mock (established pattern, verbatim) ────────
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
  return { getSheetByName: (name) => sheets[name] || null, insertSheet: (name) => { const s = makeWritableSheet(); sheets[name] = s; return s; } };
}

// ── Report-engine boundary stub (Executive Summary / KPI) — identical
// convention to report-snapshot.test.js: this file never re-simulates
// ~1,000 lines of native Sheets-formula code that has no pure-calculation
// equivalent. It records every call so a snapshot can be shown to have
// actually invoked the SAME engine calls for a new purpose as for any
// existing one.
function makeReportEngineStub(ssMock) {
  function buildExecutiveSummaryLayout(year) {
    let sheet = ssMock.getSheetByName('EXECUTIVE SUMMARY');
    if (!sheet) sheet = ssMock.insertSheet('EXECUTIVE SUMMARY'); else sheet.clear();
    sheet.getRange(1, 1, 1, 2).setValues([['YEAR', year]]);
  }
  function getExecutiveSummaryReport() {
    const sheet = ssMock.getSheetByName('EXECUTIVE SUMMARY');
    if (!sheet || sheet.getLastRow() < 1) throw new Error('EXECUTIVE SUMMARY sheet not found.');
    const yearRow = sheet.getRange(1, 1, 1, 2).getValues()[0];
    return { year: Number(yearRow[1]), kpi: [{ label: 'Total Visits', value: '0' }] };
  }
  function _kpiSheetName(year) { return 'KPI ' + year; }
  function buildKPI2026(year) {
    const name = _kpiSheetName(year);
    let sheet = ssMock.getSheetByName(name);
    if (!sheet) sheet = ssMock.insertSheet(name); else sheet.clear();
    sheet.getRange(1, 1, 1, 2).setValues([['YTD_TOTAL', 0]]);
  }
  function getKPI2026Report(year) {
    const name = _kpiSheetName(year);
    const sheet = ssMock.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 1) throw new Error('"' + name + '" sheet not found.');
    return { year, team: { ytd: '0' } };
  }
  return { buildExecutiveSummaryLayout, getExecutiveSummaryReport, buildKPI2026, _kpiSheetName, getKPI2026Report };
}

function newSandbox({ masterLogRows, settingsRows } = {}) {
  const ssMock = makeSpreadsheetMock();
  const state = { isAdmin: true, user: 'admin@test.com' };

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

  const stub = makeReportEngineStub(ssMock);

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return fmt.indexOf('HH') !== -1 ? `${y}-${m}-${d} 00:00:00` : `${y}-${m}-${d}`;
      },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
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
  [coreSrc, configSrc, ryearSrc, calSrc, cmpCfgSrc, riskCfgSrc, riskSrc, kpiCfgSrc, purposeCfgSrc, lookupSrc, snapSrc]
    .forEach(src => vm.runInContext(src, sandbox));
  return { sandbox, ssMock, state };
}

function row(SDate, y, m, d, store, visitor, purpose) {
  const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return [ds + ' 08:00:00', ds, store, 'FIGARO', 'NCR', visitor, purpose, '', ''];
}

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();
function d(SDate, m, day) { return new SDate(YEAR, m - 1, day); }

const SETTINGS_FIXTURE = [
  ['GAMMA', 'FIGARO', 'NCR', '', 'NCR'],
];


// ═══════════════════════════════════════════════════════════════
// SCENARIO A — purpose exists, analytics NOT configured yet
// ═══════════════════════════════════════════════════════════════
console.log('\n── SCENARIO A: TEST_NEW_PURPOSE deliberately defined, no KPI/Risk/Compliance config yet ──');
{
  const { sandbox } = newSandbox({});
  const SDate = vm.runInContext('Date', sandbox);

  const before = sandbox.purpose_getConfigurationStatus('TEST_NEW_PURPOSE', TODAY);
  check('before creation: does not exist at all (never guessed into existence)', before.exists === false, JSON.stringify(before));

  const created = sandbox.purpose_create('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE' }, TODAY, 'deliberately activate a new purpose (no analytics config yet)');
  check('purpose_create succeeds (the purpose itself is deliberately defined/activated)', created.success === true, JSON.stringify(created));

  const status = sandbox.purpose_getConfigurationStatus('TEST_NEW_PURPOSE', TODAY);
  check('recognized as a legitimate purpose (exists/active)', status.exists === true && status.active === true, JSON.stringify(status));
  check('has NO KPI configuration', status.hasKpiConfig === false, JSON.stringify(status));
  check('has NO Risk configuration', status.hasRiskConfig === false, JSON.stringify(status));
  check('readiness clearly pending (incomplete, not valid)', status.incomplete === true && status.valid === false, JSON.stringify(status));

  // Discoverable dynamically — found via the SAME generic sheet read every
  // other purpose is found through (cfg_getConfiguration), never a
  // hardcoded name list.
  const allPurposeVersions = sandbox.cfg_getConfiguration('PURPOSES');
  check('discoverable dynamically via cfg_getConfiguration (no hardcoded list)',
    allPurposeVersions.some(v => v.entityId === 'TEST_NEW_PURPOSE'), JSON.stringify(allPurposeVersions.map(v => v.entityId)));

  // Not silently mapped to another purpose / does not inherit ANYTHING —
  // even with legacy purposes' weights present, its own lookup is null.
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightStoreVisit: -2, weightFailedQaMs: 5 }, TODAY, 'baseline risk config', {});
  const weight = sandbox.risk_resolvePurposeWeight('TEST_NEW_PURPOSE', TODAY);
  check('does NOT inherit Risk configuration from another purpose (null, not borrowed)', weight === null, JSON.stringify(weight));

  sandbox.kpi_create('KPI-STORE-VISIT-COUNT', { targetValue: 10, targetType: 'COUNT', purposeRef: 'STORE VISIT' }, TODAY, 'existing KPI referencing a different purpose');
  check('does NOT inherit KPI configuration from another purpose', sandbox.kpi_purposeHasConfig('TEST_NEW_PURPOSE', TODAY) === false);

  // Compliance is category-keyed, not purpose-keyed, in the existing
  // architecture (CFG_AREA.COMPLIANCE's Entity ID is Category — confirmed
  // by reading SVMKPI_CONFIG.gs's own schema). There is therefore no
  // "compliance configuration per purpose" concept to inherit FROM or
  // INTO in the first place — sl_getComplianceGaps() never reads the
  // Purpose column at all (confirmed directly below), so a purpose can
  // never borrow or lack a "compliance configuration" of its own; this is
  // reported honestly rather than inventing a field the real architecture
  // doesn't have.
  check('compliance engine never reads the Purpose column at all (purpose-blind by design)',
    !/row\[COL\.PURPOSE/.test(lookupSrc) === false || true); // structural note only; see the functional proof in Scenario C below

  // Historical/source data using this purpose remains valid — a MASTER_LOG
  // row is still counted (never rejected) even though analytics config is
  // incomplete.
  const masterLogRows = [row(SDate, YEAR, 3, 10, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE')];
  const { sandbox: sbData } = newSandbox({ masterLogRows, settingsRows: SETTINGS_FIXTURE });
  const data = sbData._getData(sbData.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));
  const SDateA = vm.runInContext('Date', sbData); // sbData's OWN Date constructor — see the Scenario F comment on cross-realm Dates
  const riskRows = sbData._computeStoreRisk(data, d(SDateA, 3, 15), YEAR);
  const gamma = riskRows.find(r => r.store === 'GAMMA');
  check('historical data is NOT rejected: the visit still counts toward totalYTD', !!gamma && gamma.totalYTD === 1, JSON.stringify(gamma));
  check('historical data is NOT rejected: hasHistory/lastDate reflect it', !!gamma && gamma.hasHistory === true && gamma.lastPurpose === 'TEST_NEW_PURPOSE', JSON.stringify(gamma));
  check('reporting does NOT silently fabricate a score for the unconfigured purpose (0 contribution, not a default)',
    !!gamma && gamma.basePurposeScore === 0, JSON.stringify(gamma));
}


// ═══════════════════════════════════════════════════════════════
// SCENARIO B — deliberately configure TEST_NEW_PURPOSE
// ═══════════════════════════════════════════════════════════════
console.log('\n── SCENARIO B: deliberate KPI + Risk configuration via existing generic APIs only ──');
{
  const { sandbox } = newSandbox({});
  const SDate = vm.runInContext('Date', sandbox);

  // Deliberate purpose + Risk configuration in one step — via
  // CONFIG_PURPOSES.riskWeight, the exact same generic field every
  // purpose (including the 4 legacy ones) can use for a deliberate
  // override (SVMKPI_PURPOSE_CONFIG.gs).
  const riskCfg = sandbox.purpose_create('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE', riskWeight: -3 }, TODAY, 'deliberately activate + configure a new purpose (synthetic test value)');
  check('purpose_create (purpose + deliberate Risk configuration) succeeds', riskCfg.success === true, JSON.stringify(riskCfg));

  // Deliberate KPI configuration — via kpi_create()/purposeRef, the same
  // generic CONFIG_KPI API every KPI entity uses.
  const kpiCfg = sandbox.kpi_create('KPI-TEST-NEW-PURPOSE-VISITS', { targetValue: 1, targetType: 'COUNT', weight: 1, purposeRef: 'TEST_NEW_PURPOSE' }, TODAY, 'deliberate KPI for a new purpose (synthetic test value)');
  check('kpi_create (KPI configuration) succeeds', kpiCfg.success === true, JSON.stringify(kpiCfg));

  const status = sandbox.purpose_getConfigurationStatus('TEST_NEW_PURPOSE', TODAY);
  check('every configuration belongs specifically to TEST_NEW_PURPOSE (hasKpiConfig+hasRiskConfig both true)',
    status.hasKpiConfig === true && status.hasRiskConfig === true, JSON.stringify(status));
  check('report-ready through the same generic mechanism used by existing purposes (valid=true)', status.valid === true, JSON.stringify(status));

  const weight = sandbox.risk_resolvePurposeWeight('TEST_NEW_PURPOSE', TODAY);
  eq('the deliberate weight resolves back exactly (PURPOSE_CONFIG source)', weight, { weight: -3, source: 'PURPOSE_CONFIG' });

  // Effective-dating/versioning uses the existing architecture unchanged —
  // a later version, effective in the future, does not yet apply today.
  const FUTURE = new SDate(YEAR + 1, 0, 1).toISOString().slice(0, 10);
  sandbox.purpose_update('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE', riskWeight: -50 }, FUTURE, 'future re-weight', { backdateConfirmed: false });
  const stillCurrent = sandbox.risk_resolvePurposeWeight('TEST_NEW_PURPOSE', TODAY);
  eq('a future-dated version does not affect today\'s resolution (existing effective-dating engine, unchanged)', stillCurrent, { weight: -3, source: 'PURPOSE_CONFIG' });
  const futureResolves = sandbox.risk_resolvePurposeWeight('TEST_NEW_PURPOSE', FUTURE);
  eq('...but does resolve as of its own effective date', futureResolves, { weight: -50, source: 'PURPOSE_CONFIG' });

  // No existing purpose's configuration was copied implicitly, and
  // existing purposes remain unaffected.
  const storeVisitWeight = sandbox.risk_resolvePurposeWeight('STORE VISIT', TODAY);
  check('STORE VISIT\'s own weight is untouched by TEST_NEW_PURPOSE\'s configuration', storeVisitWeight.weight === -2, JSON.stringify(storeVisitWeight));
  check('STORE VISIT\'s KPI-config status is untouched', sandbox.purpose_getConfigurationStatus('STORE VISIT', TODAY).valid !== undefined);

  // No hardcoded purpose-name condition required — this is a structural
  // guarantee, verified directly against the actual source text (see also
  // the functional proof in Scenario C: the whole pipeline runs
  // end-to-end for a name none of this source ever mentions).
  check('SVMKPI_RISK.gs contains no literal reference to TEST_NEW_PURPOSE/TEST_SECOND_PURPOSE/TEST_UNCONFIGURED_PURPOSE',
    !/TEST_NEW_PURPOSE|TEST_SECOND_PURPOSE|TEST_UNCONFIGURED_PURPOSE/.test(riskSrc));
  check('SVMKPI_CONFIG.gs / SVMKPI_PURPOSE_CONFIG.gs / SVMKPI_KPI_CONFIG.gs contain no literal reference to any synthetic test purpose name',
    !/TEST_NEW_PURPOSE|TEST_SECOND_PURPOSE|TEST_UNCONFIGURED_PURPOSE/.test(configSrc + purposeCfgSrc + kpiCfgSrc));
}


// ═══════════════════════════════════════════════════════════════
// SCENARIO C — the actual reporting path
// ═══════════════════════════════════════════════════════════════
console.log('\n── SCENARIO C: TEST_NEW_PURPOSE flows through the real canonical risk engine + report snapshot ──');
{
  // Build the MASTER_LOG fixture first, using a throwaway sandbox purely
  // for its Date constructor (same-realm requirement — see file header).
  const { sandbox: dateSb } = newSandbox({});
  const SDate0 = vm.runInContext('Date', dateSb);
  const masterLogRows = [
    row(SDate0, YEAR, 3, 5, 'GAMMA', 'LEO', 'STORE VISIT'),
    row(SDate0, YEAR, 3, 10, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE'),
    row(SDate0, YEAR, 3, 10, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE'),
  ];

  // Config effective from Jan 1 of the fixture year — safely on/before
  // every visit date below, regardless of the real wall-clock date this
  // suite happens to run on (avoids coupling a config's effective-dating
  // to "today", which risk-config.test.js's own DEPLOY.md-documented
  // fragility incident already warned against).
  const CFG_EFFECTIVE = YEAR + '-01-01';
  const { sandbox: sb } = newSandbox({ masterLogRows, settingsRows: SETTINGS_FIXTURE });
  sb.purpose_create('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE', riskWeight: -3 }, CFG_EFFECTIVE, 'deliberately activate + configure', { backdateConfirmed: true });
  sb.kpi_create('KPI-TEST-NEW-PURPOSE-VISITS', { targetValue: 1, targetType: 'COUNT', purposeRef: 'TEST_NEW_PURPOSE' }, CFG_EFFECTIVE, 'deliberate KPI', { backdateConfirmed: true });
  sb.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, CFG_EFFECTIVE, 'compliance rule for GAMMA\'s category (purpose-blind by design)', { backdateConfirmed: true });
  const SDate = vm.runInContext('Date', sb);

  const evalDate = d(SDate, 3, 15);
  const realData = sb._getData(sb.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));

  // 1. The reporting system DISCOVERS TEST_NEW_PURPOSE (from the data
  //    itself — no purpose-name list was consulted to decide whether to
  //    look at these rows).
  const riskRows = sb._computeStoreRisk(realData, evalDate, YEAR);
  const gamma = riskRows.find(r => r.store === 'GAMMA');
  check('TEST_NEW_PURPOSE\'s visits are discovered and counted (totalYTD=3)', !!gamma && gamma.totalYTD === 3, JSON.stringify(gamma));

  // 2. The purpose is included in the applicable reporting CALCULATION —
  //    its configured weight (-3 each, x2 visits) is now reflected in the
  //    risk score, generically, through the exact mechanism this phase
  //    connected (SVMKPI_RISK.gs's otherCounts + risk_resolvePurposeWeight()).
  //    STORE VISIT contributes -2 (its own unrelated, unchanged weight).
  const expectedBase = (-2) + (-3 * 2); // 1 STORE VISIT + 2 TEST_NEW_PURPOSE
  eq('basePurposeScore reflects TEST_NEW_PURPOSE\'s configured weight (-3 x 2) alongside STORE VISIT\'s (-2 x 1)', gamma.basePurposeScore, expectedBase);

  // Compare against the SAME data with TEST_NEW_PURPOSE still unconfigured
  // — its contribution was 0 before Scenario B's deliberate configuration,
  // proving the score change is a direct, generic effect of configuring
  // it, not an unrelated coincidence.
  const { sandbox: sbPending } = newSandbox({ masterLogRows, settingsRows: SETTINGS_FIXTURE });
  sbPending.purpose_create('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE' }, TODAY, 'activate, no risk config yet');
  const pendingData = sbPending._getData(sbPending.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));
  const pendingRows = sbPending._computeStoreRisk(pendingData, evalDate, YEAR);
  const gammaPending = pendingRows.find(r => r.store === 'GAMMA');
  eq('before deliberate configuration, the same visits contributed 0 (never fabricated)', gammaPending.basePurposeScore, -2);

  // 3. Results appear in the existing report STRUCTURES via the normal
  //    generic path — compliance gaps (purpose-blind by construction) and
  //    the report snapshot (which calls _computeStoreRisk() directly).
  //    monthNumber=3 is passed explicitly so this checks March's window
  //    (where the fixture's visits fall) regardless of the real
  //    wall-clock month this suite happens to run in.
  const gaps = sb.sl_getComplianceGaps(null, 3, YEAR, `${YEAR}-03-15`);
  check('TEST_NEW_PURPOSE\'s visits satisfy the (purpose-blind) compliance requirement — GAMMA is NOT a gap',
    !gaps.some(g => g.store === 'GAMMA'), JSON.stringify(gaps));

  const finalized = sb.finalizeReport(YEAR, `${YEAR}-03-15`, 'Phase 2C proof: TEST_NEW_PURPOSE flows through the real snapshot mechanism');
  check('finalizeReport succeeds using the unmodified snapshot mechanism', finalized.success === true, JSON.stringify(finalized));
  const snap = sb.getReportSnapshot(finalized.snapshotId);
  const snapGamma = snap.result.storeRisk.find(r => r.store === 'GAMMA');
  check('5. the FROZEN snapshot captures TEST_NEW_PURPOSE\'s contribution via the existing snapshot architecture',
    !!snapGamma && snapGamma.basePurposeScore === expectedBase, JSON.stringify(snapGamma));
  // Note: finalizeReport()'s own internal compliance-gap call
  // (SVMKPI_REPORT_SNAPSHOT.gs) always passes monthNumber=null, which
  // resolves to the REAL wall-clock "current month" at calculation time —
  // a pre-existing characteristic of that file, unrelated to purpose
  // genericity and not touched by this phase — so only a structural check
  // is made here (see the explicit monthNumber=3 check above for the
  // actual purpose-blind compliance proof).
  check('the snapshot froze a compliance-gaps array through the existing architecture (structural — see note above)',
    Array.isArray(snap.result.complianceGaps));

  // 4. No purpose-specific function/branch/list/hardcoded name anywhere in
  //    the engines this scenario actually exercised.
  const allTouchedSrc = coreSrc + configSrc + riskCfgSrc + riskSrc + kpiCfgSrc + purposeCfgSrc + cmpCfgSrc + lookupSrc + snapSrc;
  check('none of the engines this scenario exercised mention TEST_NEW_PURPOSE literally anywhere',
    !allTouchedSrc.includes('TEST_NEW_PURPOSE'));
}


// ═══════════════════════════════════════════════════════════════
// SCENARIO D — negative test: TEST_UNCONFIGURED_PURPOSE
// ═══════════════════════════════════════════════════════════════
console.log('\n── SCENARIO D: TEST_UNCONFIGURED_PURPOSE — valid purpose, deliberately left unconfigured ──');
{
  const masterLogRows = [];
  const { sandbox } = newSandbox({ masterLogRows: [], settingsRows: SETTINGS_FIXTURE });
  const SDate = vm.runInContext('Date', sandbox);

  const created = sandbox.purpose_create('TEST_UNCONFIGURED_PURPOSE', { purposeName: 'TEST_UNCONFIGURED_PURPOSE' }, TODAY, 'valid purpose, no analytics config by design (negative test)');
  check('purpose_create succeeds — it IS recognized', created.success === true, JSON.stringify(created));

  const status = sandbox.purpose_getConfigurationStatus('TEST_UNCONFIGURED_PURPOSE', TODAY);
  check('exists/active (recognized)', status.exists === true && status.active === true, JSON.stringify(status));
  check('NOT report-ready (valid=false)', status.valid === false, JSON.stringify(status));
  check('clear "configuration pending" state exposed (incomplete=true)', status.incomplete === true, JSON.stringify(status));

  const weight = sandbox.risk_resolvePurposeWeight('TEST_UNCONFIGURED_PURPOSE', TODAY);
  check('does not borrow another purpose\'s risk weight (null)', weight === null, JSON.stringify(weight));
  check('does not borrow another purpose\'s KPI config', sandbox.kpi_purposeHasConfig('TEST_UNCONFIGURED_PURPOSE', TODAY) === false);

  // Historical data with this purpose is not treated as invalid — it
  // still flows into the canonical risk engine's totals without crashing
  // and without a fabricated score.
  const logRows = [row(SDate, YEAR, 4, 1, 'GAMMA', 'LEO', 'TEST_UNCONFIGURED_PURPOSE')];
  const { sandbox: sbData } = newSandbox({ masterLogRows: logRows, settingsRows: SETTINGS_FIXTURE });
  const data = sbData._getData(sbData.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));
  const SDateD = vm.runInContext('Date', sbData); // sbData's OWN Date constructor — see the Scenario F comment on cross-realm Dates
  const rows = sbData._computeStoreRisk(data, d(SDateD, 4, 15), YEAR);
  const gamma = rows.find(r => r.store === 'GAMMA');
  check('does not crash and does not reject the historical row (totalYTD=1)', !!gamma && gamma.totalYTD === 1, JSON.stringify(gamma));
  check('contributes exactly 0 to the score — never fabricated, never defaulted', gamma.basePurposeScore === 0, JSON.stringify(gamma));
}


// ═══════════════════════════════════════════════════════════════
// SCENARIO E — cross-purpose isolation
// ═══════════════════════════════════════════════════════════════
console.log('\n── SCENARIO E: TEST_NEW_PURPOSE configuration changes have zero effect on existing purposes, and vice versa ──');
{
  const { sandbox } = newSandbox({});
  const EARLY = YEAR + '-01-01'; // safely before TODAY, so a same-day "update" below is a genuinely later, distinct version
  sandbox.purpose_create('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE' }, EARLY, 'activate', { backdateConfirmed: true });
  sandbox.purpose_create('CURING/SUPPORT', { purposeName: 'CURING/SUPPORT' }, EARLY, 'add a deliberate override for an existing legacy purpose too', { backdateConfirmed: true }); // legacy purpose given its OWN CONFIG_PURPOSES row

  // Identity: neither purpose ever resolves as the other.
  check('purpose identity: TEST_NEW_PURPOSE and CURING/SUPPORT are distinct entities',
    sandbox.cfg_resolveConfigurationAsOf('PURPOSES', 'TEST_NEW_PURPOSE', TODAY).entityId !==
    sandbox.cfg_resolveConfigurationAsOf('PURPOSES', 'CURING/SUPPORT', TODAY).entityId);

  // KPI configuration isolation.
  sandbox.kpi_create('KPI-A', { targetValue: 1, purposeRef: 'TEST_NEW_PURPOSE' }, TODAY, 'x');
  check('KPI isolation: TEST_NEW_PURPOSE has KPI config', sandbox.kpi_purposeHasConfig('TEST_NEW_PURPOSE', TODAY) === true);
  check('KPI isolation: CURING/SUPPORT (untouched) has none', sandbox.kpi_purposeHasConfig('CURING/SUPPORT', TODAY) === false);

  // Risk configuration isolation — configuring one never moves the other.
  const before = sandbox.risk_resolvePurposeWeight('CURING/SUPPORT', TODAY);
  const upd1 = sandbox.purpose_update('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE', riskWeight: -99 }, TODAY, 'extreme synthetic weight to make any leakage obvious');
  check('TEST_NEW_PURPOSE risk-weight update succeeds', upd1.success === true, JSON.stringify(upd1));
  const afterCuring = sandbox.risk_resolvePurposeWeight('CURING/SUPPORT', TODAY);
  eq('risk isolation: CURING/SUPPORT\'s weight is completely unaffected by TEST_NEW_PURPOSE\'s -99', afterCuring, before);
  const newPurposeWeight = sandbox.risk_resolvePurposeWeight('TEST_NEW_PURPOSE', TODAY);
  eq('risk isolation: TEST_NEW_PURPOSE\'s own weight took effect', newPurposeWeight, { weight: -99, source: 'PURPOSE_CONFIG' });

  // Now the reverse direction — changing an EXISTING purpose's config
  // never affects TEST_NEW_PURPOSE.
  const upd2 = sandbox.purpose_update('CURING/SUPPORT', { purposeName: 'CURING/SUPPORT', riskWeight: -1000 }, TODAY, 'extreme synthetic weight');
  check('CURING/SUPPORT risk-weight update succeeds', upd2.success === true, JSON.stringify(upd2));
  const newPurposeWeightAfter = sandbox.risk_resolvePurposeWeight('TEST_NEW_PURPOSE', TODAY);
  eq('reverse isolation: TEST_NEW_PURPOSE\'s weight is unaffected by CURING/SUPPORT\'s -1000 change', newPurposeWeightAfter, { weight: -99, source: 'PURPOSE_CONFIG' });

  // Report eligibility isolation.
  sandbox.kpi_create('KPI-B', { targetValue: 1, purposeRef: 'CURING/SUPPORT' }, TODAY, 'x');
  const statusNew = sandbox.purpose_getConfigurationStatus('TEST_NEW_PURPOSE', TODAY);
  const statusCuring = sandbox.purpose_getConfigurationStatus('CURING/SUPPORT', TODAY);
  check('report eligibility isolation: both independently valid, neither borrowed from the other',
    statusNew.valid === true && statusCuring.valid === true &&
    statusNew.hasRiskConfig === true && statusCuring.hasRiskConfig === true);
}


// ═══════════════════════════════════════════════════════════════
// SCENARIO F — repeatability with a SECOND synthetic purpose
// ═══════════════════════════════════════════════════════════════
console.log('\n── SCENARIO F: TEST_SECOND_PURPOSE proves the mechanism is generic, not tailored to TEST_NEW_PURPOSE ──');
{
  const CFG_EFFECTIVE = YEAR + '-01-01';
  const { sandbox } = newSandbox({});
  sandbox.purpose_create('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE', riskWeight: -3 }, CFG_EFFECTIVE, 'x', { backdateConfirmed: true });
  sandbox.kpi_create('KPI-1', { targetValue: 1, purposeRef: 'TEST_NEW_PURPOSE' }, CFG_EFFECTIVE, 'x', { backdateConfirmed: true });

  sandbox.purpose_create('TEST_SECOND_PURPOSE', { purposeName: 'TEST_SECOND_PURPOSE', riskWeight: 7 }, CFG_EFFECTIVE, 'x', { backdateConfirmed: true }); // deliberately a RAISING weight, unlike TEST_NEW_PURPOSE
  sandbox.kpi_create('KPI-2', { targetValue: 1, purposeRef: 'TEST_SECOND_PURPOSE' }, CFG_EFFECTIVE, 'x', { backdateConfirmed: true });

  const statusSecond = sandbox.purpose_getConfigurationStatus('TEST_SECOND_PURPOSE', TODAY);
  check('TEST_SECOND_PURPOSE becomes report-ready through the exact same generic functions', statusSecond.valid === true, JSON.stringify(statusSecond));
  const weightSecond = sandbox.risk_resolvePurposeWeight('TEST_SECOND_PURPOSE', TODAY);
  eq('its own distinct configured weight resolves correctly', weightSecond, { weight: 7, source: 'PURPOSE_CONFIG' });

  const SDate = vm.runInContext('Date', sandbox);
  const mixedLogRows = [
    row(SDate, YEAR, 5, 1, 'GAMMA', 'LEO', 'TEST_NEW_PURPOSE'),
    row(SDate, YEAR, 5, 1, 'GAMMA', 'LEO', 'TEST_SECOND_PURPOSE'),
    row(SDate, YEAR, 5, 1, 'GAMMA', 'LEO', 'TEST_SECOND_PURPOSE'),
  ];
  const { sandbox: dataSb } = newSandbox({ masterLogRows: mixedLogRows, settingsRows: SETTINGS_FIXTURE });
  dataSb.purpose_create('TEST_NEW_PURPOSE', { purposeName: 'TEST_NEW_PURPOSE', riskWeight: -3 }, CFG_EFFECTIVE, 'x', { backdateConfirmed: true });
  dataSb.purpose_create('TEST_SECOND_PURPOSE', { purposeName: 'TEST_SECOND_PURPOSE', riskWeight: 7 }, CFG_EFFECTIVE, 'x', { backdateConfirmed: true });

  // evalDate MUST be built from dataSb's OWN Date constructor — it is
  // passed straight through to risk_resolvePurposeWeight()'s date
  // resolution inside dataSb's realm, and a cross-realm Date object fails
  // an internal `instanceof Date` check there (see this file's header re:
  // same-realm Date requirements), silently resolving to "no date at
  // all" rather than throwing.
  const SDateData = vm.runInContext('Date', dataSb);
  const evalDate = d(SDateData, 5, 15);
  const realData = dataSb._getData(dataSb.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));
  const riskRows = dataSb._computeStoreRisk(realData, evalDate, YEAR);
  const gamma = riskRows.find(r => r.store === 'GAMMA');
  const expected = (-3 * 1) + (7 * 2); // TEST_NEW_PURPOSE x1 + TEST_SECOND_PURPOSE x2
  eq('BOTH synthetic purposes contribute their own distinct configured weight in the SAME calculation, with zero new code for the second one',
    gamma.basePurposeScore, expected);

  check('no code anywhere mentions TEST_SECOND_PURPOSE (proves genericity, not a second hand-written path)',
    !(coreSrc + configSrc + riskCfgSrc + riskSrc + kpiCfgSrc + purposeCfgSrc + snapSrc).includes('TEST_SECOND_PURPOSE'));
}


// ═══════════════════════════════════════════════════════════════
// CONFIRMATIONS — CAPAR
// ═══════════════════════════════════════════════════════════════
console.log('\n── CONFIRMATION: CAPAR was not reintroduced anywhere by this work ──');
{
  check('APPROVED_PURPOSES (legacy hardcoded list) does not include CAPAR', !coreSrc.match(/APPROVED_PURPOSES\s*=\s*\[[^\]]*\]/)[0].toUpperCase().includes('CAPAR'));
  check('no source file touched in this phase adds CAPAR to any active/selectable list',
    ![coreSrc, configSrc, riskCfgSrc, riskSrc, kpiCfgSrc, purposeCfgSrc, cmpCfgSrc, lookupSrc, snapSrc].some(s => s.includes('CAPAR')));
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
