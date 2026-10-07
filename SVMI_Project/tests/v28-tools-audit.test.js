// v28 — Admin → System Tools, Audit, Report Snapshots, Identity (PLAN.md 🐞 F3 + F4).
//
// Server half: the REAL .gs code in a Node vm sandbox (the in-memory
// spreadsheet from store-name-matching.test.js).
// Browser half: the REAL SVMI_PORTAL.html with a stubbed google.script.run.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); fail++; }
}

const lib = {};
const testSrc = fs.readFileSync(path.join(__dirname, 'store-name-matching.test.js'), 'utf8');
new Function('lib', 'require', '__dirname',
  testSrc.split("console.log('\\n── Find:")[0] + '\nlib.newSandbox = newSandbox; lib.seed = seed; lib.cell = cell; lib.sheetRows = sheetRows;'
)(lib, require, __dirname);
const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');
const EXTRA = ['SVMKPI_REPORTING_YEAR.gs', 'SVMKPI_CALENDAR.gs', 'SVMKPI_COMPLIANCE_CONFIG.gs', 'SVMKPI_RISK_CONFIG.gs',
  'SVMKPI_PURPOSE_CONFIG.gs', 'SVMKPI_RISK.gs', 'SVMKPI_RISK_LAYOUT.gs', 'SVMKPI_STORE_LOOKUP.gs', 'SVMKPI_VISIT_DATA.gs',
  'SVMKPI_REPORTS.gs', 'SVMKPI_MASTER_REBUILD.gs', 'SVMKPI_REPORT_SNAPSHOT.gs'];

function env() {
  const e = lib.newSandbox();
  const props = {};
  const cache = {};
  e.sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) };
  e.sandbox.CacheService = { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) };
  EXTRA.forEach(f => vm.runInContext(src(f), e.sandbox, { filename: f }));
  e.props = props; e.cache = cache;
  e.ids = lib.seed(e);
  return e;
}
const auditRows = e => lib.sheetRows(e, 'CONFIG_AUDIT', 12);

// ─────────────────────────────────────────────────────────────
console.log('\n── F3.2 Data Sheet Headers keeps SETTINGS G (admin emails) and I (guest password) visible ──');
{
  const e = env(); const s = e.sandbox;
  const widths = {};
  e.settings.setColumnWidth = (c, w) => { widths[c] = w; };
  e.settings.getRange(2, 7).setValue('owner@example.com');
  e.settings.getRange(2, 9).setValue('secret');
  const r = s.rebuildSettingsHeaders();
  check('runs', r == null || r.success !== false, r);
  check('G1 = ADMIN EMAILS, I1 = GUEST PASSWORD (were blanked)', e.settings.getRange(1, 7).getValue() === 'ADMIN EMAILS' && e.settings.getRange(1, 9).getValue() === 'GUEST PASSWORD',
    [e.settings.getRange(1, 7).getValue(), e.settings.getRange(1, 9).getValue()]);
  check('G and I are normal width (were shrunk to 20 px)', widths[7] >= 100 && widths[9] >= 100, widths);
  check('the admin email and password themselves are untouched', e.settings.getRange(2, 7).getValue() === 'owner@example.com' && e.settings.getRange(2, 9).getValue() === 'secret');
}

console.log('\n── F3.3 Validate MASTER_LOG: one purpose lookup per purpose, Store ID check ──');
{
  const e = env(); const s = e.sandbox; const ids = e.ids;
  s.purpose_create('AUDIT VISIT', { purposeName: 'AUDIT VISIT', riskWeight: 1 }, '2026-01-01', 'x', { backdateConfirmed: true });
  const D = e.SDate;
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push([new D(2026, 8, 1, 9), new D(2026, 8, 1), 'SAN PEDRO', "ANGEL'S PIZZA", 'PROVINCIAL', 'LEO', 'AUDIT VISIT', '', ids.SP]);
  rows.push([new D(2026, 8, 2, 9), new D(2026, 8, 2), 'SAN PEDRO', "ANGEL'S PIZZA", 'PROVINCIAL', 'LEO', 'STORE VISIT', '', 'STR-NOPE']);
  e.master.getRange(e.master.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
  const orig = vm.runInContext('purpose_getConfigurationStatus', s);
  let calls = 0;
  s.purpose_getConfigurationStatus = function () { calls++; return orig.apply(this, arguments); };
  const v = s.validateMasterLog();
  check('a configured purpose on 40 rows is looked up once (was once per row)', calls === 1, calls);
  const bad = v.errors.filter(x => x.rule === 'UNKNOWN_STORE_ID');
  check('a Store ID no store has ever had is reported', bad.length === 1 && bad[0].col === 'I' && bad[0].value === 'STR-NOPE', bad);
  check('real Store IDs and the leaderboard names in column I are not errors', v.errors.filter(x => x.col === 'I').length === 1, v.errors.filter(x => x.col === 'I'));
}

console.log('\n── F3.5 Store Health rebuild: one at a time, rows ready before the sheet is cleared ──');
{
  const e = env(); const s = e.sandbox;
  s.SHEET = { MASTER_LOG: 'MASTER_LOG' };
  s._getSheet = n => e.ss.getSheetByName(n);
  s._log = () => {};
  e.settings.getRange(2, 1, 1, 5).setValues([['SAN PEDRO', "ANGEL'S PIZZA", 'PROVINCIAL', '', 'FAR PROVINCIAL']]);
  e.cache.SVMI_STORE_HEALTH_REBUILDING = '1';
  const busy = s.refreshRiskEngine(2026);
  check('a second rebuild while one runs is refused, not run on top', busy.success === false && /already being rebuilt/.test(busy.message), busy);
  delete e.cache.SVMI_STORE_HEALTH_REBUILDING;
  const order = [];
  const origRows = vm.runInContext('_sl_storeHealthRows_', s), origBuild = vm.runInContext('buildRiskEngineSheet_', s);
  s._sl_storeHealthRows_ = function () { order.push('rows'); return origRows.apply(this, arguments); };
  s.buildRiskEngineSheet_ = function () { order.push('clear'); return origBuild.apply(this, arguments); };
  s.populateRiskEngine = (sheet, data, year, rows) => { order.push('write ' + (rows ? rows.length : 'none')); };   // sheet layout is not under test
  const ok = s.refreshRiskEngine(2026);
  check('rebuild runs', ok.success === true, ok);
  check('rows computed before the sheet is cleared, then written', order.length === 3 && order[0] === 'rows' && order[1] === 'clear' && /^write [1-9]/.test(order[2]), order);
  check('marker removed afterwards', !e.cache.SVMI_STORE_HEALTH_REBUILDING);
  check('buildRiskEngineSheet is private now (no page-callable name)', vm.runInContext('typeof buildRiskEngineSheet', s) === 'undefined');
}

console.log('\n── F3.8 / F4.5 admin checks on functions the page could call ──');
{
  const e = env(); const s = e.sandbox;
  e.state.isAdmin = false;
  const r = s.store_recordUnmapped('X', '2026-01-01', '2026-01-01', 1);
  check('store_recordUnmapped refuses a non-admin', r && r.success === false, r);
  let threw = null;
  try { s.cfg_getAuditLog(null, null); } catch (err) { threw = err.message; }
  check('the audit log refuses a non-admin', /Admin access required/.test(threw || ''), threw);
  threw = null;
  try { s.listReportSnapshots(2026); } catch (err) { threw = err.message; }
  check('report snapshots refuse a non-admin', /Admin access required/.test(threw || ''), threw);
  const idSrc = src('SVMKPI_IDENTITY_ADMIN.gs');
  check('handleExternalIdentityDisabled is private (could disable accounts from any browser)', /function handleExternalIdentityDisabled_\(/.test(idSrc) && !/function handleExternalIdentityDisabled\(/.test(idSrc));
}

console.log('\n── F4.9 Audit tab shows system actions ──');
{
  const e = env(); const s = e.sandbox; const ids = e.ids;
  const before = auditRows(e).length;
  s.portal_rebuildVisitTables();
  s.portal_useVisitTablesForReports();
  s.portal_useMasterLogForReports();
  s.portal_applyStoreCleanupDecision({ type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA' });
  const sys = auditRows(e).slice(before).filter(r => r[3] === 'SYSTEM');
  const has = (ent, act) => sys.some(r => r[4] === ent && r[5] === act);
  check('Rebuild Visit Tables audited', has('VISIT_TABLES', 'REBUILD'), sys.map(r => r[4] + '/' + r[5]));
  check('Report Source switches audited (both ways)', sys.filter(r => r[4] === 'REPORT_SOURCE').map(r => r[7]).join(',') === 'TABLES,MASTER_LOG', sys.map(r => r[4] + ':' + r[7]));
  check('Store Name Matching merge audited', has('STORE_NAME_MATCHING', 'MERGE'), sys.map(r => r[4] + '/' + r[5]));
  check('…by the signed-in admin', sys.every(r => r[2] === 'admin@test.com'), sys.map(r => r[2]));
  const log = s.cfg_getAuditLog('SYSTEM', null);
  check('visible through the Audit tab reader, dates as text', log.length >= 4 && typeof log[0].timestamp === 'string', log.length);
  const src2 = s.portal_getReportSource();
  check('Report Source card can show the current source', src2.success && src2.source === 'MASTER_LOG', src2);
}

console.log('\n── F4.6 / F4.7 / F4.10 Report Snapshots ──');
{
  const e = env(); const s = e.sandbox;
  s.portal_rebuildVisitTables();
  s.portal_useVisitTablesForReports();
  const calls = [];
  s.buildExecutiveSummaryLayout = y => calls.push('layout ' + y);
  s.getExecutiveSummaryReport = y => { calls.push('summary ' + y); return { year: y }; };
  s._kpiSheetName = y => 'KPI ' + y;
  s.buildKPI2026 = y => { calls.push('kpi build ' + y); e.ss.insertSheet('KPI ' + y); };
  s.getKPI2026Report = y => ({ year: y });
  s.sl_getComplianceGaps = () => [];
  s.Session.getScriptTimeZone = () => 'Asia/Manila';
  const D = e.SDate;
  const draft = s._snap_captureCalculatedResult(2025, new D(2025, 11, 31), true);
  check('a 2025 snapshot asks the Executive Summary for 2025 (froze the latest year before)', calls.indexOf('summary 2025') !== -1, calls);
  check('View Draft does not rewrite the EXECUTIVE SUMMARY sheet', calls.indexOf('layout 2025') === -1, calls);
  check('store rows come from the visit tables by Store ID, like the Reports tab', draft.storeRisk.length > 0 && draft.storeRisk.every(r => /^STR-/.test(r.storeId)), draft.storeRisk.slice(0, 2));
  calls.length = 0;
  s._snap_captureCalculatedResult(2026, new D(2026, 8, 30), false);
  check('a real finalize still rebuilds the sheet copy', calls.indexOf('layout 2026') !== -1, calls);
}

console.log('\n── F4.8 Identity admin works for someone on the admin list ──');
{
  const e = env(); const s = e.sandbox;
  ['SVMKPI_IDENTITY_CORE.gs'].forEach(f => vm.runInContext(src(f), s, { filename: f }));
  s._identity_currentUserRecord_ = () => null;          // no SVMI identity linked (Leo's case)
  const yes = s._identity_authorizeCurrentUser_('REGISTRATION_APPROVE');
  check('admin-list member with no linked identity is authorized', yes.authorized === true, yes);
  check('…and is recorded as ADMIN:<email> on the audit', s._identity_actorRecord_().userId === 'ADMIN:admin@test.com', s._identity_actorRecord_());
  e.state.isAdmin = false;
  const no = s._identity_authorizeCurrentUser_('REGISTRATION_APPROVE');
  check('anyone else still needs a linked ACTIVE identity with the permission', no.authorized === false && /No SVMI identity/.test(no.reason), no);
}

// ─────────────────────────────────────────────────────────────
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found.'); process.exit(2);
})();
const PORTAL_FILE = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'svmi-v28-')), 'SVMI_PORTAL.html');
fs.writeFileSync(PORTAL_FILE, src('SVMI_PORTAL.html').replace("<?!= JSON.stringify(enteredPassword || '') ?>", "''"));
const STUB = `
window.__calls = [];
window.__hold = [];
window.__stub = { sl_isAdmin: true, portal_getReportSource: { success: true, source: 'TABLES' }, getSidebarData: { stores: [], visitors: [], purposes: [] } };
window.google = { script: { get run() {
  let ok = null, bad = null;
  const h = { withSuccessHandler(f) { ok = f; return p; }, withFailureHandler(f) { bad = f; return p; }, withUserObject() { return p; } };
  const p = new Proxy(h, { get(t, prop) {
    if (prop in t) return t[prop];
    if (typeof prop !== 'string') return undefined;
    return (...args) => {
      window.__calls.push(prop);
      const deliver = () => { const v = window.__stub[prop]; try { if (ok) ok(v === undefined ? null : v); } catch (e) {} };
      if (prop === 'finalizeReport') window.__hold.push(deliver); else setTimeout(deliver, 5);
    };
  } });
  return p;
} } };`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(STUB);
  await page.goto('file://' + PORTAL_FILE);
  await page.waitForTimeout(500);

  console.log('\n── Report Source card shows the current source ──');
  const rs = await page.evaluate(() => document.getElementById('stat-RS').textContent);
  check('"Now: reports read the visit tables"', /Now: reports read the visit tables/.test(rs), rs);

  console.log('\n── Admin actions: no double submit, empty reply is an error ──');
  const r = await page.evaluate(async () => {
    const before = window.__calls.filter(c => c === 'finalizeReport').length;
    const errs = [];
    callServer('finalizeReport', [2026, '2026-09-30', 'x'], function () {}, function (m) { errs.push(m); });
    callServer('finalizeReport', [2026, '2026-09-30', 'x'], function () {}, function (m) { errs.push(m); });
    const sent = window.__calls.filter(c => c === 'finalizeReport').length - before;
    window.__hold.shift()();                                   // the server answers nothing (null)
    await new Promise(res => setTimeout(res, 20));
    callServer('finalizeReport', [2026, '2026-09-30', 'x'], function () {}, function (m) { errs.push(m); });
    const sentAfter = window.__calls.filter(c => c === 'finalizeReport').length - before;
    return { sent, sentAfter, errs };
  });
  check('a second Finalize while the first is running is not sent', r.sent === 1, r);
  check('an empty reply ends as an error message', r.errs.length === 1 && /No reply from the server/.test(r.errs[0]), r.errs);
  check('after the reply, Finalize can be sent again', r.sentAfter === 2, r);

  console.log('\n── Tool cards: every button follows the admin gate ──');
  const gate = await page.evaluate(() => {
    applyAdminGating(false);
    const hiddenAll = Array.from(document.querySelectorAll('.tool-card[data-admin-only] .tool-run')).every(b => b.hidden);
    applyAdminGating(true);
    const shownAll = Array.from(document.querySelectorAll('.tool-card[data-admin-only] .tool-run')).every(b => !b.hidden);
    return { hiddenAll, shownAll };
  });
  check('non-admin: all tool buttons hidden (Report Source\'s second button used to stay)', gate.hiddenAll, gate);
  check('admin: all shown', gate.shownAll, gate);

  await browser.close();
  console.log('\n══════════════════════════════════   PASS ' + pass + '   FAIL ' + fail + ' ══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
