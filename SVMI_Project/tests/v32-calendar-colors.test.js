// v32 — business calendar P#W# (F9) and colour pills (F10). PLAN.md 🐞 F9/F10.
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
const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');

console.log('\n── Business calendar rule ──');
{
  const c = { console };
  vm.createContext(c);
  vm.runInContext(src('SVMKPI_CALENDAR.gs') + ';this.bw=cal_businessWeek_;this.rg=cal_businessRange_;this.cnt=cal_businessWeekCount_;this.D=Date;', c);
  const D = c.D;
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const at = (y, m, d) => c.bw(new D(y, m - 1, d));
  const w = (y, m, d) => { const b = at(y, m, d); return b.label + ' ' + ymd(b.start) + '..' + ymd(b.end); };

  check('2027: W1 = Jan 1 (Fri) → first Sunday Jan 3', w(2027, 1, 1) === 'P1W1 2027-01-01..2027-01-03', w(2027, 1, 1));
  check('2027: Jan 4–10 = P1W2 (Mon–Sun)', w(2027, 1, 4) === 'P1W2 2027-01-04..2027-01-10' && w(2027, 1, 10) === w(2027, 1, 4), w(2027, 1, 4));
  check('2026: W1 = Jan 1–4, W2 = Jan 5–11', w(2026, 1, 4) === 'P1W1 2026-01-01..2026-01-04' && w(2026, 1, 5) === 'P1W2 2026-01-05..2026-01-11');
  check('W repeats each period: year-week 5 (Jan 26, 2026) = P2W1', at(2026, 1, 26).label === 'P2W1' && at(2026, 1, 26).yearWeek === 5, [at(2026, 1, 26).label, at(2026, 1, 26).yearWeek]);
  check('Nov 23, 2026 = P12W4', at(2026, 11, 23).label === 'P12W4' && at(2026, 11, 23).yearWeek === 48, at(2026, 11, 23));
  check('year-end week stops on Dec 31 and joins P13 as W5', w(2026, 12, 31) === 'P13W5 2026-12-28..2026-12-31', w(2026, 12, 31));
  check('Jan 1 on a Sunday → W1 is one day (2023)', w(2023, 1, 1) === 'P1W1 2023-01-01..2023-01-01' && w(2023, 1, 2) === 'P1W2 2023-01-02..2023-01-08');
  check('Jan 1 on a Monday → W1 is a full week (2029)', w(2029, 1, 1) === 'P1W1 2029-01-01..2029-01-07');

  let gaps = 0, badLabel = 0, weeks53 = 0;
  for (let y = 2020; y <= 2035; y++) {
    if (c.cnt(y) === 53) weeks53++;
    let prevEnd = null, prevWeek = 0;
    for (let d = new D(y, 0, 1); d.getFullYear() === y; d = new D(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const b = c.bw(d);
      if (b.yearWeek !== prevWeek) {
        if (prevEnd && (new D(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() + 1)).getTime() !== b.start.getTime()) gaps++;
        if (b.yearWeek !== prevWeek + 1) gaps++;
        prevEnd = b.end; prevWeek = b.yearWeek;
      }
      if (b.start > d || b.end < d) gaps++;
      const okW = b.period < 13 ? b.weekInPeriod >= 1 && b.weekInPeriod <= 4 : b.weekInPeriod >= 1 && b.weekInPeriod <= 5;
      if (!okW || b.label !== 'P' + b.period + 'W' + b.weekInPeriod) badLabel++;
    }
    if (ymd(prevEnd) !== y + '-12-31') gaps++;
  }
  check('2020–2035: every day in exactly one week, weeks back to back, none past Dec 31', gaps === 0, gaps);
  check('2020–2035: W1–W4 in P1–P12, W1–W5 in P13', badLabel === 0, badLabel);
  check('every year has a short W53 (365 days > 52 weeks)', weeks53 === 16, weeks53);
  const p13 = c.rg(2026, 13, 0), p1w2 = c.rg(2027, 1, 2), p3 = c.rg(2026, 3, 0);
  check('P13 2026 = Nov 30 → Dec 31 (5 weeks)', ymd(p13.start) === '2026-11-30' && ymd(p13.end) === '2026-12-31', [ymd(p13.start), ymd(p13.end)]);
  check('P3 2026 = Feb 23 → Mar 22', ymd(p3.start) === '2026-02-23' && ymd(p3.end) === '2026-03-22', [ymd(p3.start), ymd(p3.end)]);
  check('P1W2 2027 range', ymd(p1w2.start) === '2027-01-04' && ymd(p1w2.end) === '2027-01-10' && p1w2.label === 'P1W2');
  check('invalid period / week → null', c.rg(2026, 14, 0) === null && c.rg(2026, 2, 5) === null && c.rg(2026, 13, 6) === null);
}

// ── Sandbox with MASTER_LOG + visit tables (shared seed) ─────────
const lib = {};
new Function('lib', 'require', '__dirname',
  fs.readFileSync(path.join(__dirname, 'store-name-matching.test.js'), 'utf8').split("console.log('\\n── Find:")[0]
  + '\nlib.newSandbox = newSandbox; lib.seed = seed;'
)(lib, require, __dirname);
const EXTRA = ['SVMKPI_REPORTING_YEAR.gs', 'SVMKPI_CALENDAR.gs', 'SVMKPI_COMPLIANCE_CONFIG.gs', 'SVMKPI_RISK_CONFIG.gs',
  'SVMKPI_PURPOSE_CONFIG.gs', 'SVMKPI_RISK.gs', 'SVMKPI_RISK_LAYOUT.gs', 'SVMKPI_STORE_LOOKUP.gs', 'SVMKPI_VISIT_DATA.gs'];
function env() {
  const e = lib.newSandbox();
  const props = {};
  e.sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) };
  EXTRA.forEach(f => vm.runInContext(src(f), e.sandbox, { filename: f }));
  e.ids = lib.seed(e);
  const D = e.SDate;
  e.master.getRange(e.master.getLastRow() + 1, 1, 1, 9).setValues([
    [new D(2026, 11, 30, 9), new D(2026, 11, 30), 'URDANETA', "ANGEL'S PIZZA", 'PROVINCIAL', 'LEO', 'STORE VISIT', '', e.ids.URD],
  ]);
  e.sandbox.portal_rebuildVisitTables();
  e.sandbox.portal_useVisitTablesForReports();
  return e;
}

console.log('\n── MASTER_LOG column K ──');
{
  const e = env(); const s = e.sandbox;
  const last = e.master.getLastRow();
  check('rebuild writes the header in K1', e.master.getRange(1, 11).getValue() === 'BUSINESS WEEK', e.master.getRange(1, 11).getValue());
  const k = r => e.master.getRange(r, 11).getValue();
  check('K for May 11, 2026 = P5W4 (W20)', k(2) === s.cal_businessWeekLabel_(new e.SDate(2026, 4, 11)) && k(2) === 'P5W4', k(2));
  check('K for Dec 30, 2026 = P13W5', k(last) === 'P13W5', k(last));
  check('text dates work too', s.svt_bwLabel_('2027-01-04') === 'P1W2' && s.svt_bwLabel_('') === '', s.svt_bwLabel_('2027-01-04'));
  check('leaderboard columns I–J untouched by K', e.master.getRange(1, 10).getValue() === '' || e.master.getRange(1, 10).getValue() == null);
}

console.log('\n── Visited filtered by period / week ──');
{
  const e = env(); const s = e.sandbox; const ids = e.ids;
  const visits = (bp, mo) => {
    const r = s.sl_getVisitedThisMonth([], mo || 3, 2026, bp);
    return { sp: (r.resolved.filter(x => x.storeId === ids.SP)[0] || {}).visits || 0, urd: (r.resolved.filter(x => x.storeId === ids.URD)[0] || {}).visits || 0, r };
  };
  const p3 = visits('P3');
  check('P3 (Feb 23 – Mar 22) has the Mar 1 San Pedro visit only', p3.sp === 1 && p3.urd === 0 && p3.r.businessPeriod === 'P3', p3);
  check('P3 range is returned for the label', p3.r.rangeStart && p3.r.rangeEnd && p3.r.rangeStart !== p3.r.rangeEnd, [p3.r.rangeStart, p3.r.rangeEnd]);
  check('P2W4 (Feb 16–22) has the Feb 21 San Pedro visit', visits('P2W4').sp === 1, visits('P2W4'));
  check('P3W2 has none', visits('P3W2').sp === 0 && visits('P3W2').r.resolved.length === 0, visits('P3W2').r.resolved);
  check('P13W5 (Dec 28–31) has the Dec 30 Urdaneta visit', visits('P13W5').urd === 1, visits('P13W5'));
  check('no period → the month as before (March)', visits('', 3).sp === 1 && !visits('', 3).r.businessPeriod);
  check('garbage period is ignored (month used)', visits('P99', 3).sp === 1 && !visits('P99', 3).r.businessPeriod);
}

console.log('\n── Weekly History header ──');
{
  const e = env(); const s = e.sandbox;
  const r = s.portal_getWeekHistory('2026-12-30');
  check('label carries P#W#', r.success && r.businessWeek === 'P13W5' && r.label === 'P13W5 · Dec 28 – 31, 2026', r.label);
  check('short week has only its own days', r.days.length === 4 && r.weekEnd === '2026-12-31', r.days.map(d => d.date));
  const jan = s.portal_getWeekHistory('2027-01-02');
  check('first week of 2027 is Jan 1–3 and ◀ goes to Dec 28', jan.weekStart === '2027-01-01' && jan.weekEnd === '2027-01-03' && jan.prevStart === '2026-12-28', [jan.weekStart, jan.weekEnd, jan.prevStart]);
  const mid = s.portal_getWeekHistory('2026-03-04');
  check('◀ from a normal week = the Monday before', mid.prevStart === '2026-02-23' && mid.businessWeek === 'P3W2', [mid.prevStart, mid.businessWeek]);
}

console.log('\n── KPI sheet: P1–P13 block ──');
{
  const c = { console, MASTER_LOG_MAX_ROW: 5000 };
  vm.createContext(c);
  vm.runInContext(src('SVMKPI_CALENDAR.gs') + '\n' + src('SVMKPI_KPI_REBUILD.gs').replace(/^const KPI_C = /m, 'var KPI_C = '), c);
  const writes = {};
  const range = (r, col, nr, nc) => {
    const o = {};
    ['merge', 'setBackground', 'setFontColor', 'setFontFamily', 'setFontSize', 'setFontWeight', 'setHorizontalAlignment', 'setVerticalAlignment']
      .forEach(m => { o[m] = () => o; });
    o.setValue = v => { writes[r + ',' + col] = v; return o; };
    o.setValues = v => { v.forEach((row, i) => row.forEach((x, j) => { writes[(r + i) + ',' + (col + j)] = x; })); return o; };
    o.setFormulas = o.setValues;
    return o;
  };
  const sheet = { getRange: range, setColumnWidth: () => {} };
  c._kpiWritePeriodBlock_(sheet, 2026, [{ name: 'LEO', settingsRow: 3 }, { name: 'OLD', settingsRow: null }], 6, 8);
  check('P1…P13 headers in row 4 from col 93', writes['4,93'] === 'P1' && writes['4,105'] === 'P13', [writes['4,93'], writes['4,105']]);
  check('date ranges in row 5', writes['5,93'] === '01/01–01/25' && writes['5,105'] === '11/30–12/31', [writes['5,93'], writes['5,105']]);
  const f = String(writes['6,95']);
  check('P3 formula counts LEO between Feb 23 and Mar 22', f.indexOf('SETTINGS!F3') !== -1 && f.indexOf('DATE(2026,2,23)') !== -1 && f.indexOf('DATE(2026,3,22)') !== -1, f);
  check('removed visitor uses a literal name', String(writes['7,93']).indexOf('"OLD"') !== -1);
  check('team total sums each period', writes['8,93'] === '=SUM(CO6:CO7)', writes['8,93']);
}

// ── Browser: pills + period picker ───────────────────────────────
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found.'); process.exit(2);
})();
const CUR = new Date().getFullYear();
const PORTAL_FILE = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'svmi-v32-')), 'SVMI_PORTAL.html');
fs.writeFileSync(PORTAL_FILE, src('SVMI_PORTAL.html').replace("<?!= JSON.stringify(enteredPassword || '') ?>", "''"));
const STUB = `
window.__calls = [];
window.__stub = {
  sl_isAdmin: false,
  getSidebarData: { stores: [
    { storeId: 'STR-1', store: 'MAKATI', brand: "ANGEL'S PIZZA", region: 'NCR', category: 'NCR' },
    { storeId: 'STR-2', store: 'ILOILO', brand: 'FIGARO', region: 'PROVINCIAL', category: 'FAR PROVINCIAL' },
    { storeId: 'STR-3', store: 'CEBU', brand: "TIEN MA'S", region: 'PROVINCIAL', category: 'FLIGHT PROVINCIAL' },
    { storeId: 'STR-4', store: 'NEWBIE', brand: 'NEWBRAND', region: 'NCR', category: '' },
  ], visitors: ['LEO'], purposes: ['STORE VISIT'] },
  sl_getReportYears: [${CUR}],
  sl_getVisitedThisMonth: { resolved: [
    { storeId: 'STR-1', name: 'MAKATI', brand: "ANGEL'S PIZZA", region: 'NCR', visits: 1, lastVisitDate: '—', lastPurpose: 'STORE VISIT', visitors: 'LEO', daysSince: 1 },
    { storeId: 'STR-2', name: 'ILOILO', brand: 'FIGARO', region: 'PROVINCIAL', visits: 1, lastVisitDate: '—', lastPurpose: 'STORE VISIT', visitors: 'LEO', daysSince: 2 },
    { storeId: 'STR-4', name: 'NEWBIE', brand: 'NEWBRAND', region: 'NCR', visits: 1, lastVisitDate: '—', lastPurpose: 'STORE VISIT', visitors: 'LEO', daysSince: 3 },
  ], unmapped: [], businessPeriod: 'P3', rangeStart: 'Feb 23, ${CUR}', rangeEnd: 'Mar 22, ${CUR}' },
  sl_getComplianceGaps: [
    { storeId: 'STR-3', store: 'CEBU', brand: "TIEN MA'S", region: 'PROVINCIAL', category: 'FLIGHT PROVINCIAL', windowLabel: 'Semi-Annual', lastVisitDate: '—', daysSince: null, ytdVisits: 0 },
  ],
  getExecutiveSummaryReport: { kpi: [], year: ${CUR} },
  portal_getWeekHistory: { success: true, weekStart: '${CUR}-03-02', weekEnd: '${CUR}-03-08', businessWeek: 'P3W2', label: 'P3W2 · Mar 2 – 8, ${CUR}',
    isCurrentWeek: false, prevStart: '${CUR}-02-23', nextStart: '${CUR}-03-09',
    days: [{ date: '${CUR}-03-02', label: 'Mon 03/02', count: 1 }], total: 1, visitors: ['LEO'],
    rows: [{ date: '${CUR}-03-02', day: 'Mon', visited: '${CUR}-03-02', storeId: 'STR-2', store: 'ILOILO', brand: 'FIGARO', visitors: ['LEO'], purpose: 'STORE VISIT', remarks: '', recordedAt: '${CUR}-03-02 09:00' }] },
};
window.google = { script: { get run() {
  let ok = null;
  const h = { withSuccessHandler(f) { ok = f; return p; }, withFailureHandler() { return p; }, withUserObject() { return p; } };
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
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(STUB);
  await page.goto('file://' + PORTAL_FILE);
  await page.waitForTimeout(400);
  const last = fn => page.evaluate(f => { const c = window.__calls.filter(x => x.fn === f); return c.length ? c[c.length - 1].args : null; }, fn);

  console.log('\n── Pills ──');
  const pills = await page.evaluate(() => ({
    m: storeNameHtml('MAKATI', 'STR-1', "ANGEL'S PIZZA"),
    q: storeNameHtml('ILOILO', null, 'FIGARO'),
    s: storeNameHtml('CEBU', 'STR-3'),
    none: storeNameHtml('NEWBIE', 'STR-4'),
    unknown: storeNameHtml('<X>', 'STR-99'),
    ap: brandPill("ANGEL'S PIZZA"), tm: brandPill("TIEN MA'S"), nb: brandPill('NEWBRAND'),
  }));
  check('NCR store → Monthly (blue) pill', pills.m.indexOf('wb sn wb-Monthly') !== -1 && pills.m.indexOf('MAKATI') !== -1, pills.m);
  check('Far Provincial found by name + brand → Quarterly', pills.q.indexOf('wb-Quarterly') !== -1, pills.q);
  check('Flight Provincial → Semi-Annual', pills.s.indexOf('wb-Semi-Annual') !== -1, pills.s);
  check('no category / unknown store → plain, escaped text', pills.none === 'NEWBIE' && pills.unknown === '&lt;X&gt;', [pills.none, pills.unknown]);
  check('brand pills: Angel\'s red class, Tien Ma\'s teal, unknown brand grey', pills.ap.indexOf('bp-ANGELSPIZZA') !== -1 && pills.tm.indexOf('bp-TIENMAS') !== -1 && pills.nb === '<span class="bp bp-NEWBRAND">NEWBRAND</span>', [pills.ap, pills.tm, pills.nb]);
  const css = await page.evaluate(() => {
    const el = document.createElement('span'); el.className = 'bp bp-ANGELSPIZZA'; document.body.appendChild(el);
    const g = document.createElement('span'); g.className = 'bp bp-NEWBRAND'; document.body.appendChild(g);
    return [getComputedStyle(el).backgroundColor, getComputedStyle(g).backgroundColor];
  });
  check('brand colour differs from the grey default', css[0] !== css[1], css);

  console.log('\n── Store dropdown (Input) ──');
  await page.focus('#storeSearch').catch(() => {});
  await page.evaluate(() => { if (typeof filterStores === 'function') filterStores(); });
  await page.waitForTimeout(100);
  const drop = await page.evaluate(() => (document.getElementById('storeDrop') || {}).innerHTML || '');
  check('store dropdown shows cadence + brand pills', drop.indexOf('wb-Monthly') !== -1 && drop.indexOf('bp-FIGARO') !== -1, drop.slice(0, 300));

  console.log('\n── Visited: period picker + pills ──');
  await page.evaluate(() => switchTab('Insights'));
  await page.evaluate(() => loadVisited());
  await page.waitForTimeout(100);
  check('month view by default (no period sent)', (await last('sl_getVisitedThisMonth'))[3] === '', await last('sl_getVisitedThisMonth'));
  const periods = await page.evaluate(() => Array.from(document.getElementById('visPeriodSel').options).map(o => o.value).join(','));
  check('period list = By month + P1…P13', periods === ',P1,P2,P3,P4,P5,P6,P7,P8,P9,P10,P11,P12,P13', periods);
  await page.selectOption('#visPeriodSel', 'P3');
  await page.waitForTimeout(100);
  check('picking P3 sends "P3" and the year', JSON.stringify((await last('sl_getVisitedThisMonth')).slice(2)) === JSON.stringify([CUR, 'P3']), await last('sl_getVisitedThisMonth'));
  check('month picker is disabled while a period is picked', await page.isDisabled('#visMonthSel'));
  check('label shows the period range', (await page.textContent('#visMonthLbl')) === 'P3 · Feb 23, ' + CUR + ' – Mar 22, ' + CUR, await page.textContent('#visMonthLbl'));
  const weeks = await page.evaluate(() => Array.from(document.getElementById('visWeekSel').options).map(o => o.value).join(','));
  check('week list for P3 = All + P3W1…P3W4', weeks === ',P3W1,P3W2,P3W3,P3W4', weeks);
  await page.selectOption('#visWeekSel', 'P3W2');
  await page.waitForTimeout(100);
  check('picking a week sends "P3W2"', (await last('sl_getVisitedThisMonth'))[3] === 'P3W2', await last('sl_getVisitedThisMonth'));
  await page.selectOption('#visPeriodSel', 'P13');
  await page.waitForTimeout(100);
  check('P13 offers W5 (the short year-end week)', (await page.evaluate(() => Array.from(document.getElementById('visWeekSel').options).map(o => o.value).join(','))) === ',P13W1,P13W2,P13W3,P13W4,P13W5');
  const vis = await page.evaluate(() => document.getElementById('visBody').innerHTML);
  check('Visited table: store names and brands as pills', vis.indexOf('wb sn wb-Monthly') !== -1 && vis.indexOf('wb sn wb-Quarterly') !== -1 && vis.indexOf('bp-FIGARO') !== -1, vis.slice(0, 200));
  check('heading says the period', (await page.textContent('#siMain')).indexOf('Stores Visited in P13') !== -1);
  await page.selectOption('#visPeriodSel', '');
  await page.waitForTimeout(100);
  check('"By month" goes back to the month view', (await last('sl_getVisitedThisMonth'))[3] === '' && !(await page.isDisabled('#visMonthSel')) && !(await page.isVisible('#visWeekSel')));

  console.log('\n── Unvisited + Weekly History ──');
  await page.evaluate(() => switchTab('Visits'));
  await page.waitForTimeout(150);
  const comp = await page.evaluate(() => (document.getElementById('visitsPanel') || {}).innerHTML || '');
  check('Unvisited store name uses its window colour', comp.indexOf('wb sn wb-Semi-Annual') !== -1 && comp.indexOf('bp-TIENMAS') !== -1);
  await page.evaluate(() => { if (typeof whLoad === 'function') whLoad(); else if (typeof loadWeekHistory === 'function') loadWeekHistory(); });
  await page.waitForTimeout(150);
  const wh = await page.evaluate(() => ({ label: (document.getElementById('whLabel') || {}).textContent, list: (document.getElementById('whList') || {}).innerHTML }));
  check('Weekly History header shows P3W2', String(wh.label).indexOf('P3W2 · Mar 2 – 8') !== -1, wh.label);
  check('Weekly History rows: Quarterly store pill + Figaro pill', String(wh.list).indexOf('wb-Quarterly') !== -1 && String(wh.list).indexOf('bp-FIGARO') !== -1);
  check('no page errors', errors.length === 0, errors);

  await browser.close();
  console.log('\n══════════════════════════════════   PASS ' + pass + '   FAIL ' + fail + ' ══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
