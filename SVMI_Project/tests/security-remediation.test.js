// Phase 1H-B.1: Required Pilot Security Remediation.
//
// Focused regression coverage for the 3 Required findings fixed this
// phase (reviews/003-phase-1h-security-identity-audit.md §H, carried
// forward in reviews/004-phase-1h-enterprise-identity-architecture.md
// §11), and for reviews/005-phase-1h-required-security-remediation.md's
// own claims. This file loads the REAL .gs source for every function it
// tests — no reimplementation, no stubs standing in for the fix itself.
//
// Does NOT re-run the full existing regression suite (admin-api.test.js,
// report-snapshot.test.js, etc.) — those already cover the underlying
// business logic and are re-run unchanged as part of this phase's
// regression (see reviews/005 for the full-suite result).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const accessSrc  = APPS('SVMKPI_ACCESS.gs');
const layoutSrc  = APPS('SVMKPI_LAYOUT.gs');
const kpiSrc     = APPS('SVMKPI_KPI_REBUILD.gs');
const masterSrc  = APPS('SVMKPI_MASTER_REBUILD.gs');
const smiSrc     = APPS('SVMKPI_STORE_MASTER.gs');
const riskSrc    = APPS('SVMKPI_RISK.gs');
const adminSrc   = APPS('SVMKPI_ADMIN.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

// ── Shared mock helpers (same pattern as admin-api.test.js) ────────────
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
    range.setFontWeight = () => proxy;
    proxy = new Proxy(range, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => proxy; } });
    return proxy;
  }
  const sheet = {
    getLastRow: () => maxRow,
    getRange: (row, col, numRows, numCols) => makeRange(row, col, numRows || 1, numCols || 1),
    appendRow: (rowArr) => { const r = maxRow + 1; rowArr.forEach((v, i) => setCell(r, i + 1, v)); },
    clear: () => { Object.keys(cells).forEach(k => delete cells[k]); maxRow = 0; },
    clearFormats: () => {},
    setFrozenRows: () => {}, setFrozenColumns: () => {}, setColumnWidth: () => {},
  };
  let sproxy;
  sproxy = new Proxy(sheet, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => sproxy; } });
  return sproxy;
}
function makeSpreadsheetMock() {
  const sheets = {};
  return { getSheetByName: (name) => sheets[name] || null, insertSheet: (name) => { const s = makeWritableSheet(); sheets[name] = s; return s; }, _sheets: sheets };
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── REQUIRED FINDING 1 — _getAdminEmails()/_getGuestPassword() are no longer directly RPC-callable ──');
{
  const ssMock = makeSpreadsheetMock();
  const settings = ssMock.insertSheet('SETTINGS');
  settings.getRange(1, 7).setValue('ADMIN_EMAILS');
  settings.getRange(2, 7).setValue('admin@test.com');
  settings.getRange(1, 9).setValue('GUEST_PASSWORD');
  settings.getRange(2, 9).setValue('correct-horse-battery-staple');

  const state = { email: 'admin@test.com' };
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, getUi: () => ({ alert: () => {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => state.email }), getEffectiveUser: () => ({ getEmail: () => state.email }) },
    HtmlService: {
      createTemplateFromFile: (name) => ({
        enteredPassword: undefined,
        failed: undefined,
        actionUrl: undefined,
        evaluate: function () { const tag = 'SERVED:' + name; return { setTitle: () => ({ addMetaTag: () => tag }) }; },
      }),
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example.com/exec' }) },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(accessSrc, sandbox);

  // google.script.run can only invoke a function it finds by name at the
  // top level of the script's global scope — the old `_getAdminEmails`/
  // `_getGuestPassword` function declarations are gone entirely.
  check('_getAdminEmails is no longer a global of any kind', typeof sandbox._getAdminEmails === 'undefined');
  check('_getGuestPassword is no longer a global of any kind', typeof sandbox._getGuestPassword === 'undefined');

  // The raw reader now lives as a plain (non-function) object property —
  // structurally impossible to reach via google.script.run.NAME(), which
  // requires NAME to resolve to a callable top-level function.
  check('_SL_SECRET_ itself is not a function (cannot be invoked as google.script.run._SL_SECRET_())', typeof sandbox._SL_SECRET_ !== 'function');
  check('_SL_SECRET_.adminEmails is not reachable through the google.script.run.NAME() calling convention (no top-level function of that name exists)',
    !Object.keys(sandbox).some(k => k === 'adminEmails' || k === 'guestPassword'));

  // Legitimate internal behavior is fully preserved: sl_isAdmin() still
  // resolves correctly, and the password gate still works, exactly as
  // before the fix.
  check('sl_isAdmin() still returns true for a real admin email (internal call path unaffected)', sandbox.sl_isAdmin() === true);
  state.email = 'nobody@test.com';
  check('sl_isAdmin() still returns false for a non-admin email', sandbox.sl_isAdmin() === false);

  const wrongPw = sandbox._handleWebAppRequest_({ parameter: { pw: 'guess' } });
  check('_handleWebAppRequest_() still rejects the wrong guest password (serves SVMI_LOCK, not the portal)', wrongPw === 'SERVED:SVMI_LOCK', wrongPw);
  const rightPw = sandbox._handleWebAppRequest_({ parameter: { pw: 'correct-horse-battery-staple' } });
  check('_handleWebAppRequest_() still accepts the correct guest password (serves the real SVMI_PORTAL)', rightPw === 'SERVED:SVMI_PORTAL', rightPw);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── REQUIRED FINDING 2 — the 4 non-trigger rebuild engines require sl_isAdmin() directly, not just their wrapper ──');
{
  function newEngineSandbox(isAdmin) {
    const ssMock = makeSpreadsheetMock();
    const settings = ssMock.insertSheet('SETTINGS');
    settings.getRange(2, 6).setValue('LEO'); // visitor roster (col F) for buildKPI2026
    const sandbox = {
      SpreadsheetApp: {
        getActiveSpreadsheet: () => ssMock,
        flush: () => {},
        BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM' },
      },
      Session: { getScriptTimeZone: () => 'UTC' },
      Utilities: { formatDate: () => '2026-01-01', getUuid: (() => { let n = 0; return () => 'uuid-' + (++n); })() },
      SHEET: { SETTINGS: 'SETTINGS', MASTER_LOG: 'MASTER_LOG' },
      getDefaultReportingYear: () => 2026,
      _getSheet: () => null,
      _getData: () => ({ dates: [], rawVisitors: [], totalRows: 0, stores: [] }),
      _es_discoverReportablePurposes: () => [],
      APPROVED_PURPOSES: ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'],
      MASTER_LOG_MAX_ROW: 200000,
      sl_isAdmin: () => isAdmin,
      Logger: { log: () => {} },
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(layoutSrc, sandbox);
    vm.runInContext(kpiSrc, sandbox);
    vm.runInContext(masterSrc, sandbox);
    return sandbox;
  }
  // This file is about the AUTHORIZATION gate, not each engine's full
  // reporting logic (already covered exhaustively by purpose-report-
  // surfaces.test.js, kpi-purpose-config.test.js, etc.). "Succeeds for an
  // authorized admin" here means: the gate did not block it — any error
  // past that point belongs to business-logic fixtures those other suites
  // already own, not to this fix.
  function notBlockedByAuth(fn) {
    try { fn(); return { blocked: false, error: null }; }
    catch (e) { return { blocked: /admin access required/i.test(e.message), error: e.message }; }
  }

  // buildExecutiveSummaryLayout() — void/throwing engine
  {
    const sandbox = newEngineSandbox(false);
    let threw = null;
    try { sandbox.buildExecutiveSummaryLayout(2026); } catch (e) { threw = e; }
    check('buildExecutiveSummaryLayout() called directly (unwrapped) by a non-admin throws, not silently runs', threw && /admin/i.test(threw.message), threw && threw.message);
  }
  {
    const sandbox = newEngineSandbox(false);
    let threw = null;
    try { sandbox.buildExecutiveSummaryLayout({ isAdmin: true, role: 'ADMIN' }); } catch (e) { threw = e; }
    check('a spoofed {isAdmin:true} argument to buildExecutiveSummaryLayout() cannot bypass authorization', threw && /admin/i.test(threw.message), threw && threw.message);
  }
  {
    const sandbox = newEngineSandbox(true);
    const r = notBlockedByAuth(() => sandbox.buildExecutiveSummaryLayout(2026));
    check('buildExecutiveSummaryLayout() is not blocked by the auth gate for an authorized admin (existing behavior preserved)', r.blocked === false, r.error);
  }

  // buildKPI2026()
  {
    const sandbox = newEngineSandbox(false);
    let threw = null;
    try { sandbox.buildKPI2026(2026); } catch (e) { threw = e; }
    check('buildKPI2026() called directly by a non-admin throws', threw && /admin/i.test(threw.message), threw && threw.message);
  }
  {
    const sandbox = newEngineSandbox(true);
    let result;
    const r = notBlockedByAuth(() => { result = sandbox.buildKPI2026(2026); });
    check('buildKPI2026() is not blocked by the auth gate for an authorized admin, and still returns success:true', r.blocked === false && result && result.success === true, r.error || JSON.stringify(result));
  }

  // rebuildDataSheetHeaders()
  {
    const sandbox = newEngineSandbox(false);
    let threw = null;
    try { sandbox.rebuildDataSheetHeaders(); } catch (e) { threw = e; }
    check('rebuildDataSheetHeaders() called directly by a non-admin throws', threw && /admin/i.test(threw.message), threw && threw.message);
  }
  {
    const sandbox = newEngineSandbox(true);
    let result;
    const r = notBlockedByAuth(() => { result = sandbox.rebuildDataSheetHeaders(); });
    check('rebuildDataSheetHeaders() is not blocked by the auth gate for an authorized admin', r.blocked === false, r.error);
  }

  // rebuildStoreMasterInsight() — loaded separately (own required globals)
  function newSmiSandbox(isAdmin) {
    const ssMock = makeSpreadsheetMock();
    const settings = ssMock.insertSheet('SETTINGS');
    settings.getRange(2, 1).setValue('ALPHA');
    settings.getRange(2, 2).setValue('FIGARO');
    settings.getRange(2, 3).setValue('NCR');
    settings.getRange(2, 5).setValue('NCR');
    const sandbox = {
      SpreadsheetApp: { getActiveSpreadsheet: () => ssMock },
      Logger: { log: () => {} },
      sl_isAdmin: () => isAdmin,
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(smiSrc, sandbox);
    return sandbox;
  }
  {
    const sandbox = newSmiSandbox(false);
    let threw = null;
    try { sandbox.rebuildStoreMasterInsight(); } catch (e) { threw = e; }
    check('rebuildStoreMasterInsight() called directly by a non-admin throws', threw && /admin/i.test(threw.message), threw && threw.message);
  }
  {
    const sandbox = newSmiSandbox(true);
    const r = notBlockedByAuth(() => sandbox.rebuildStoreMasterInsight());
    check('rebuildStoreMasterInsight() is not blocked by the auth gate for an authorized admin', r.blocked === false, r.error);
  }

  // A sandbox that never loads SVMKPI_ACCESS.gs at all (sl_isAdmin truly
  // undefined, not just false) must not throw a ReferenceError — this is
  // the documented typeof-guard compatibility behavior, matching the
  // existing _cfg_syncLegacyMirror() soft-dispatch convention.
  {
    const ssMock = makeSpreadsheetMock();
    const sandbox = {
      SpreadsheetApp: {
        getActiveSpreadsheet: () => ssMock,
        flush: () => {},
        BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM' },
      },
      Session: { getScriptTimeZone: () => 'UTC' },
      Utilities: { formatDate: () => '2026-01-01', getUuid: () => 'uuid-x' },
      getDefaultReportingYear: () => 2026,
      _es_discoverReportablePurposes: () => [],
      APPROVED_PURPOSES: ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'],
      APPROVED_BRANDS: ['FIGARO'],
      Logger: { log: () => {} },
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(layoutSrc, sandbox);
    // This sandbox deliberately provides no other business-logic fixtures
    // beyond what's needed to prove the ONE thing in scope here: the
    // typeof-guard itself doesn't throw when sl_isAdmin was never
    // defined. Any *other* missing fixture (this engine's reporting
    // logic has many, all owned by purpose-report-surfaces.test.js) is
    // expected and irrelevant to that claim.
    const r = notBlockedByAuth(() => sandbox.buildExecutiveSummaryLayout(2026));
    check('a sandbox that never loaded SVMKPI_ACCESS.gs at all is unaffected (typeof-guard, not a ReferenceError about sl_isAdmin)',
      r.error === null || !/sl_isAdmin/.test(r.error || ''), r.error);
  }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── REQUIRED FINDING 2 (refreshRiskEngine) — admin-gated for direct/RPC calls, still works for the unattended daily trigger ──');
{
  function newRiskSandbox() {
    const ssMock = makeSpreadsheetMock();
    const sandbox = {
      SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} },
      SHEET: { MASTER_LOG: 'MASTER_LOG' },
      _getSheet: () => null,
      _getData: () => ({ totalRows: 3, stores: [] }),
      buildRiskEngineSheet: () => makeWritableSheet(),
      populateRiskEngine: () => {},
      _log: () => {},
      Utilities: { getUuid: (() => { let n = 0; return () => 'risk-uuid-' + (++n); })() },
      Logger: { log: () => {} },
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(riskSrc, sandbox);
    // riskSrc defines its own real buildRiskEngineSheet()/populateRiskEngine(),
    // which in production delegate to SVMKPI_RISK_LAYOUT.gs and
    // _computeStoreRisk()'s full scoring engine (not loaded in this
    // focused test) — force the stubs back in so this file stays scoped
    // to the authorization gate, not Store Health's scoring/presentation
    // logic (already covered by risk-scoring.test.js / canonical-risk-
    // engine.test.js / risk-config.test.js).
    sandbox.buildRiskEngineSheet = () => makeWritableSheet();
    sandbox.populateRiskEngine = () => {};
    return sandbox;
  }

  {
    const sandbox = newRiskSandbox();
    sandbox.sl_isAdmin = () => false;
    const result = sandbox.refreshRiskEngine(2026);
    check('refreshRiskEngine() called directly by a non-admin, no token, is rejected', result.success === false && /admin/i.test(result.message), JSON.stringify(result));
  }
  {
    const sandbox = newRiskSandbox();
    sandbox.sl_isAdmin = () => true;
    const result = sandbox.refreshRiskEngine(2026);
    check('refreshRiskEngine() still succeeds for an authorized admin', result.success === true, JSON.stringify(result));
  }
  {
    const sandbox = newRiskSandbox();
    sandbox.sl_isAdmin = () => false;
    const spoofed = sandbox.refreshRiskEngine(2026, { isAdmin: true });
    check('a spoofed object passed as the token argument cannot bypass authorization', spoofed.success === false, JSON.stringify(spoofed));
    const guessed = sandbox.refreshRiskEngine(2026, 'a-guessed-or-hardcoded-string');
    check('a guessed string token cannot bypass authorization either', guessed.success === false, JSON.stringify(guessed));
  }
  {
    // Simulates the real SVMKPI_ADMIN.gs trigger: a token value that is
    // never sent to any client, matched exactly.
    const sandbox = newRiskSandbox();
    sandbox.sl_isAdmin = () => false;
    sandbox._SYSTEM_TRIGGER_TOKEN_ = 'server-generated-per-execution-token';
    const asSystemTrigger = sandbox.refreshRiskEngine(undefined, sandbox._SYSTEM_TRIGGER_TOKEN_);
    check('the unattended daily trigger (exact server-held token) still succeeds with no admin session', asSystemTrigger.success === true, JSON.stringify(asSystemTrigger));
  }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── REQUIRED FINDING 3 — the 5 Sheets-menu handlers now require sl_isAdmin(), same as the Web App path ──');
{
  function newMenuSandbox(isAdmin) {
    const alerts = [];
    const engineCalls = { es: 0, risk: 0, kpi: 0, headers: 0, validate: 0 };
    const sandbox = {
      SpreadsheetApp: {
        getUi: () => ({
          alert: (title, msg) => { alerts.push({ title, msg }); },
          ButtonSet: { OK: 'OK' },
        }),
      },
      ScriptApp: { newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => {} }) }) }) }), getProjectTriggers: () => [] },
      HtmlService: { createTemplateFromFile: () => ({ evaluate: () => ({ setWidth: () => ({ setHeight: () => 'DIALOG' }) }) }) },
      Utilities: { getUuid: () => 'menu-test-token' },
      Logger: { log: () => {} },
      sl_isAdmin: () => isAdmin,
      buildExecutiveSummaryLayout: () => { engineCalls.es++; },
      refreshRiskEngine: () => { engineCalls.risk++; return { success: true, rows: 0 }; },
      buildKPI2026: () => { engineCalls.kpi++; },
      rebuildDataSheetHeaders: () => { engineCalls.headers++; return { success: true, results: [] }; },
      validateMasterLog: () => { engineCalls.validate++; return { valid: true, summary: 'OK', errors: [] }; },
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(adminSrc, sandbox);
    return { sandbox, alerts, engineCalls };
  }

  const menuFns = [
    ['menuRebuildDashboard', 'es'],
    ['menuRefreshStoreHealth', 'risk'],
    ['menuRebuildKPI2026', 'kpi'],
    ['menuRebuildDataHeaders', 'headers'],
    ['menuValidateMasterLog', 'validate'],
  ];

  menuFns.forEach(([fnName, engineKey]) => {
    const { sandbox, alerts, engineCalls } = newMenuSandbox(false);
    sandbox[fnName]();
    check(fnName + '() rejects a non-admin Sheet user with an "Access Denied" alert, never reaching the engine',
      engineCalls[engineKey] === 0 && alerts.some(a => a.title === 'Access Denied'),
      JSON.stringify({ engineCalls, alerts }));
  });

  menuFns.forEach(([fnName, engineKey]) => {
    const { sandbox, alerts, engineCalls } = newMenuSandbox(true);
    sandbox[fnName]();
    check(fnName + '() still runs normally for an admin Sheet user (existing behavior preserved)',
      engineCalls[engineKey] === 1 && !alerts.some(a => a.title === 'Access Denied'),
      JSON.stringify({ engineCalls, alerts }));
  });

  // The daily trigger path (a completely separate function from the menu
  // handlers) must remain unaffected by finding 3's menu-level gating.
  {
    const { sandbox } = newMenuSandbox(false);
    let threw = null;
    try { sandbox.triggerRefreshDashboard(); } catch (e) { threw = e; }
    check('triggerRefreshDashboard() is unaffected by the menu-level admin check (different entry point)', threw === null, threw && threw.message);
  }
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
