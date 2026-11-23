// v30 — past years in reports (PLAN.md 🐞 F7).
// Server half: REAL .gs code in a Node vm sandbox. Browser half: REAL
// SVMI_PORTAL.html with a stubbed google.script.run.

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
  testSrc.split("console.log('\\n── Find:")[0] + '\nlib.newSandbox = newSandbox; lib.seed = seed; lib.anyDate = anyDate;'
)(lib, require, __dirname);
const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');
const EXTRA = ['SVMKPI_REPORTING_YEAR.gs', 'SVMKPI_CALENDAR.gs', 'SVMKPI_COMPLIANCE_CONFIG.gs', 'SVMKPI_RISK_CONFIG.gs',
  'SVMKPI_PURPOSE_CONFIG.gs', 'SVMKPI_RISK.gs', 'SVMKPI_RISK_LAYOUT.gs', 'SVMKPI_STORE_LOOKUP.gs', 'SVMKPI_VISIT_DATA.gs', 'SVMKPI_REPORTS.gs'];
const NOW = new Date();
const CUR = NOW.getFullYear();

function env() {
  const e = lib.newSandbox();
  const props = {};
  e.sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) };
  EXTRA.forEach(f => vm.runInContext(src(f), e.sandbox, { filename: f }));
  e.ids = lib.seed(e);
  const D = e.SDate, ids = e.ids;
  const row = (y, m, d, store, id, purpose) => [new D(y, m - 1, d, 9), new D(y, m - 1, d), store, "ANGEL'S PIZZA", 'PROVINCIAL', 'LEO', purpose || 'STORE VISIT', '', id];
  e.master.getRange(e.master.getLastRow() + 1, 1, 4, 9).setValues([
    row(CUR - 1, 3, 10, 'SAN PEDRO', ids.SP),
    row(CUR - 1, 3, 20, 'SAN PEDRO', ids.SP),
    row(CUR - 1, 11, 5, 'URDANETA', ids.URD),
    row(CUR + 1, 1, 15, 'URDANETA', ids.URD),        // a future-dated row makes "latest year with data" = next year
  ]);
  e.sandbox.portal_rebuildVisitTables();
  e.sandbox.portal_useVisitTablesForReports();
  return e;
}

console.log('\n── Year list ──');
{
  const e = env(); const s = e.sandbox;
  const years = s.sl_getReportYears();
  check('years with visits from the tables, plus this year, oldest first', JSON.stringify(years) === JSON.stringify([CUR - 1, CUR, CUR + 1]), years);
}

console.log('\n── "Current Month" = this month of THIS year ──');
{
  const e = env(); const s = e.sandbox;
  check('(setup) latest year with data is next year', s.getDefaultReportingYear() === CUR + 1, s.getDefaultReportingYear());
  const gaps = s.sl_getComplianceGaps([], 0, null);
  const cur = s.sl_getComplianceGaps([], NOW.getMonth() + 1, CUR);
  check('Unvisited: no month + no year = this month of this year (was: of the latest year with data)', JSON.stringify(gaps) === JSON.stringify(cur), { a: gaps.length, b: cur.length });
  const vis = s.sl_getVisitedThisMonth([], 0, null);
  const visCur = s.sl_getVisitedThisMonth([], NOW.getMonth() + 1, CUR);
  check('Visited: same', JSON.stringify(vis) === JSON.stringify(visCur));
  const logV = s._sl_visitedThisMonthFromLog_([], 0, null), logC = s._sl_visitedThisMonthFromLog_([], NOW.getMonth() + 1, CUR);
  check('MASTER_LOG version: same', JSON.stringify(logV) === JSON.stringify(logC));
}

console.log('\n── A past year ──');
{
  const e = env(); const s = e.sandbox; const ids = e.ids;
  const mar = s.sl_getVisitedThisMonth([], 3, CUR - 1);
  const sp = mar.resolved.filter(r => r.storeId === ids.SP)[0];
  check('Visited, March last year: SAN PEDRO 2 visits', sp && sp.visits === 2, mar.resolved);
  const h = s.getStoreHealthReport(CUR - 1);
  check('Store Health for last year', h.live && h.year === CUR - 1, { live: h.live, year: h.year });
  const urd = h.rows.filter(r => r.storeId === ids.URD)[0];
  check('…counts only that year\'s visits', h.rows.filter(r => r.storeId === ids.SP)[0].totalYtd === 2 && urd.totalYtd === 1, h.rows.map(r => r.store + ':' + r.totalYtd));
  check('…last visit as of Dec 31 (a later visit doesn\'t count yet)', urd.lastVisitDate === (CUR - 1) + '-11-05', urd.lastVisitDate);
  check('…days since counted from Dec 31', urd.daysSince === 56, urd.daysSince);
  const hNow = s.getStoreHealthReport(CUR);
  check('this year: unchanged behaviour (as of now)', hNow.year === CUR && hNow.rows.length === h.rows.length);
}

console.log('\n── KPI for another year ──');
{
  const e = env(); const s = e.sandbox;
  s._kpiSheetName = y => 'KPI ' + y;
  const built = [];
  s.buildKPI2026 = y => { built.push(y); e.ss.insertSheet('KPI ' + y); };
  e.state.isAdmin = false;
  let msg = null;
  try { s.getKPI2026Report(CUR - 1); } catch (err) { msg = err.message; }
  check('non-admin: a clear message, nothing built', /has not been built yet/.test(msg || '') && built.length === 0, msg);
  e.state.isAdmin = true;
  try { s.getKPI2026Report(CUR - 1); } catch (err) { /* the empty test sheet can't be read — the build is what's under test */ }
  check('admin: opening that year builds its KPI sheet', JSON.stringify(built) === JSON.stringify([CUR - 1]), built);
}

// ─────────────────────────────────────────────────────────────
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found.'); process.exit(2);
})();
const PORTAL_FILE = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'svmi-v30-')), 'SVMI_PORTAL.html');
fs.writeFileSync(PORTAL_FILE, src('SVMI_PORTAL.html').replace("<?!= JSON.stringify(enteredPassword || '') ?>", "''"));
const STUB = `
window.__calls = [];
window.__stub = {
  sl_isAdmin: false, getSidebarData: { stores: [], visitors: [], purposes: [] },
  sl_getReportYears: [${CUR - 2}, ${CUR - 1}, ${CUR}],
  sl_getVisitedThisMonth: { resolved: [], unmapped: [] },
  sl_getComplianceGaps: [],
  getExecutiveSummaryReport: { kpi: [], year: ${CUR} },
  getStoreHealthReport: { kpis: [], headers: [], rows: [], live: true, year: ${CUR} },
};
window.google = { script: { get run() {
  let ok = null, bad = null;
  const h = { withSuccessHandler(f) { ok = f; return p; }, withFailureHandler(f) { bad = f; return p; }, withUserObject() { return p; } };
  const p = new Proxy(h, { get(t, prop) {
    if (prop in t) return t[prop];
    if (typeof prop !== 'string') return undefined;
    return (...args) => { window.__calls.push({ fn: prop, args: JSON.parse(JSON.stringify(args)) }); setTimeout(() => {
      const v = window.__stub[prop];
      try { if (ok) ok(v === undefined ? null : v); } catch (e) {}
    }, 5); };
  } });
  return p;
} } };`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(STUB);
  await page.goto('file://' + PORTAL_FILE);
  await page.waitForTimeout(400);
  const last = fn => page.evaluate(f => { const c = window.__calls.filter(x => x.fn === f); return c.length ? c[c.length - 1].args : null; }, fn);

  console.log('\n── Year dropdowns ──');
  const sels = await page.evaluate(() => ['esYearSel', 'visYearSel', 'yearSel'].map(id => {
    const s = document.getElementById(id);
    return { opts: Array.from(s.options).map(o => o.value).join(','), val: s.value };
  }));
  check('Reports, Visited and Unvisited all list the years, newest first, this year selected',
    sels.every(x => x.opts === [CUR, CUR - 1, CUR - 2].join(',') && x.val === String(CUR)), sels);
  check('years come from the visit tables (one call), not MASTER_LOG', await page.evaluate(() => window.__calls.filter(c => c.fn === 'sl_getReportYears').length === 1 && !window.__calls.some(c => c.fn === 'getAvailableReportingYears')));
  check('KPI tab no longer says 2026', (await page.textContent('#repTab-kpi')).trim() === 'KPI');

  console.log('\n── Reports send the year ──');
  check('Executive Summary gets this year', JSON.stringify(await last('getExecutiveSummaryReport')) === JSON.stringify([CUR]), await last('getExecutiveSummaryReport'));
  await page.evaluate(() => switchReport('health'));
  await page.waitForTimeout(50);
  check('Store Health gets the year too', JSON.stringify(await last('getStoreHealthReport')) === JSON.stringify([CUR]), await last('getStoreHealthReport'));
  await page.selectOption('#esYearSel', String(CUR - 1));
  await page.waitForTimeout(50);
  check('picking last year reloads Store Health for last year', JSON.stringify(await last('getStoreHealthReport')) === JSON.stringify([CUR - 1]), await last('getStoreHealthReport'));
  await page.evaluate(() => switchReport('kpi'));
  await page.waitForTimeout(50);
  check('KPI gets the picked year', JSON.stringify(await last('getKPI2026Report')) === JSON.stringify([CUR - 1]), await last('getKPI2026Report'));

  console.log('\n── Visited This Month / Unvisited ──');
  await page.evaluate(() => switchTab('Insights'));
  await page.evaluate(() => loadVisited());
  await page.waitForTimeout(50);
  const curMonth = NOW => NOW.getMonth() + 1;
  check('"Current Month" sends this month AND this year', JSON.stringify((await last('sl_getVisitedThisMonth')).slice(1)) === JSON.stringify([new Date().getMonth() + 1, CUR]), await last('sl_getVisitedThisMonth'));
  await page.selectOption('#visYearSel', String(CUR - 1));
  await page.waitForTimeout(50);
  check('past year with "Current Month" → its December', JSON.stringify((await last('sl_getVisitedThisMonth')).slice(1)) === JSON.stringify([12, CUR - 1])
    && (await page.inputValue('#visMonthSel')) === '12', await last('sl_getVisitedThisMonth'));
  check('label shows month + picked year', (await page.textContent('#visMonthLbl')) === 'December ' + (CUR - 1), await page.textContent('#visMonthLbl'));
  await page.selectOption('#visMonthSel', '3');
  await page.waitForTimeout(50);
  check('March of the picked year', JSON.stringify((await last('sl_getVisitedThisMonth')).slice(1)) === JSON.stringify([3, CUR - 1]), await last('sl_getVisitedThisMonth'));

  await page.evaluate(() => switchTab('Visits'));
  await page.waitForTimeout(50);
  check('Unvisited: this month of this year', JSON.stringify((await last('sl_getComplianceGaps')).slice(1)) === JSON.stringify([new Date().getMonth() + 1, CUR]), await last('sl_getComplianceGaps'));
  await page.selectOption('#yearSel', String(CUR - 2));
  await page.waitForTimeout(50);
  check('Unvisited: a past year → its December', JSON.stringify((await last('sl_getComplianceGaps')).slice(1)) === JSON.stringify([12, CUR - 2])
    && (await page.textContent('#monthLbl')) === 'December ' + (CUR - 2), [await last('sl_getComplianceGaps'), await page.textContent('#monthLbl')]);

  await browser.close();
  console.log('\n══════════════════════════════════   PASS ' + pass + '   FAIL ' + fail + ' ══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
