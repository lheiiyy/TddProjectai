// v29 — Input Portal weekly history (PLAN.md 🐞 F5): every visit SUBMITTED in
// one Monday–Sunday week (Leo 2026-10-07: by submission date), newest first,
// count per day, date visited on each row, ◀ ▶ between weeks (none after the
// current one), filter by visitor.
//
// Server half: REAL .gs code in a Node vm sandbox (store-name-matching seed
// plus visits in a known week). Browser half: REAL SVMI_PORTAL.html with a
// stubbed google.script.run.

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
const EXTRA = ['SVMKPI_REPORTING_YEAR.gs', 'SVMKPI_CALENDAR.gs', 'SVMKPI_COMPLIANCE_CONFIG.gs', 'SVMKPI_RISK.gs', 'SVMKPI_STORE_LOOKUP.gs', 'SVMKPI_VISIT_DATA.gs'];

console.log('\n── portal_getWeekHistory ──');
{
  const e = lib.newSandbox();
  const props = {};
  e.sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) };
  EXTRA.forEach(f => vm.runInContext(src(f), e.sandbox, { filename: f }));
  const ids = lib.seed(e);
  const s = e.sandbox, D = e.SDate;
  // Week of Mon 2026-09-28 … Sun 2026-10-04, plus visits just outside it.
  const row = (y, m, d, store, brand, who, purpose, id, remarks, logged) =>
    [logged || new D(y, m - 1, d, 9, 0, 0), new D(y, m - 1, d), store, brand, 'PROVINCIAL', who, purpose, remarks || '', id || ''];
  const rows = [
    row(2026, 9, 27, 'SAN PEDRO', "ANGEL'S PIZZA", 'LEO', 'STORE VISIT', ids.SP),                  // Sun before → out
    row(2026, 9, 28, 'SAN PEDRO', "ANGEL'S PIZZA", 'LEO|ANN', 'STORE VISIT', ids.SP, 'all good'),  // Mon
    row(2026, 9, 30, 'URDANETA', "ANGEL'S PIZZA", 'ANN', 'TLTC', ids.URD),                         // Wed
    row(2026, 10, 2, 'STA. MARIA', "ANGEL'S PIZZA", 'CHARLIE', 'STORE VISIT', ids.APSM, '', new D(2026, 9, 2, 8, 0, 0)),  // Fri
    row(2026, 10, 2, 'SAN PEDRO', "ANGEL'S PIZZA", 'LEO', 'CURING/SUPPORT', ids.SP, '', new D(2026, 9, 2, 15, 30, 0)),    // Fri, logged later
    row(2026, 10, 4, 'URDANETA', "ANGEL'S PIZZA", 'LEO', 'STORE VISIT', ids.URD),                  // Sun
    row(2026, 10, 5, 'URDANETA', "ANGEL'S PIZZA", 'LEO', 'STORE VISIT', ids.URD),                  // next Mon → out
    row(2026, 9, 25, 'URDANETA', "ANGEL'S PIZZA", 'ANN', 'STORE VISIT', ids.URD, 'late log', new D(2026, 8, 29, 10, 0, 0)), // visited the week before, SUBMITTED Tue → in
    row(2026, 10, 3, 'SAN PEDRO', "ANGEL'S PIZZA", 'ANN', 'STORE VISIT', ids.SP, '', new D(2026, 9, 6, 9, 0, 0)),          // visited Sat, submitted next Tue → out
  ];
  e.master.getRange(e.master.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
  s.portal_rebuildVisitTables();

  const r = s.portal_getWeekHistory('2026-10-01');        // any day in the week
  check('loads', r.success, r.message);
  check('no Date objects (google.script.run)', !lib.anyDate(r));
  check('week is Monday–Sunday', r.weekStart === '2026-09-28' && r.weekEnd === '2026-10-04', [r.weekStart, r.weekEnd]);
  check('label', r.label === 'Sep 28 – Oct 4, 2026', r.label);
  check('only visits SUBMITTED inside the week (6)', r.total === 6 && r.rows.length === 6, r.rows.map(x => x.date + '/' + x.visited));
  check('newest submission first', JSON.stringify(r.rows.map(x => x.date + ' ' + x.purpose)) ===
    JSON.stringify(['2026-10-04 STORE VISIT', '2026-10-02 CURING/SUPPORT', '2026-10-02 STORE VISIT', '2026-09-30 TLTC', '2026-09-29 STORE VISIT', '2026-09-28 STORE VISIT']), r.rows.map(x => x.date + ' ' + x.purpose));
  check('count per submission day Mon..Sun', JSON.stringify(r.days.map(d => d.count)) === '[1,1,1,0,2,0,1]', r.days);
  const late = r.rows.filter(x => x.remarks === 'late log')[0];
  check('a visit submitted days later is listed on its submission day, with its date visited', late && late.date === '2026-09-29' && late.visited === '2026-09-25', late);
  check('a visit dated inside the week but submitted after it is not listed', !r.rows.some(x => x.visited === '2026-10-03'), r.rows.map(x => x.visited));
  check('day labels', r.days[0].label === 'Mon 09/28' && r.days[6].label === 'Sun 10/04', r.days.map(d => d.label));
  const mon = r.rows.filter(x => x.date === '2026-09-28')[0];
  check('row: store + brand from CONFIG_STORES, all visitors, remarks, logged time', mon.store === 'SAN PEDRO' && mon.brand === "ANGEL'S PIZZA"
    && JSON.stringify(mon.visitors) === '["LEO","ANN"]' && mon.remarks === 'all good' && mon.recordedAt === '2026-09-28 09:00', mon);
  check('same name, other brand stays its own store (STA. MARIA → Angel\'s Pizza)', r.rows.some(x => x.store === 'STA. MARIA' && x.brand === "ANGEL'S PIZZA"));
  check('visitor list for the filter', JSON.stringify(r.visitors) === '["ANN","CHARLIE","LEO"]', r.visitors);
  check('◀ previous week', r.prevStart === '2026-09-21', r.prevStart);
  check('▶ next week available for a past week', r.nextStart === '2026-10-05', r.nextStart);
  check('a past week is not "this week"', r.isCurrentWeek === false);

  const cur = s.portal_getWeekHistory('');
  check('no date → the current week, no ▶ beyond it', cur.success && cur.isCurrentWeek === true && cur.nextStart === '', { start: cur.weekStart, next: cur.nextStart });
  const sunday = s.portal_getWeekHistory('2026-10-04');
  check('a Sunday belongs to the week that started the Monday before', sunday.weekStart === '2026-09-28', sunday.weekStart);
}

// ─────────────────────────────────────────────────────────────
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found.'); process.exit(2);
})();
const PORTAL_FILE = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'svmi-v29-')), 'SVMI_PORTAL.html');
fs.writeFileSync(PORTAL_FILE, src('SVMI_PORTAL.html').replace("<?!= JSON.stringify(enteredPassword || '') ?>", "''"));

const WEEK = {
  success: true, weekStart: '2026-09-28', weekEnd: '2026-10-04', label: 'Sep 28 – Oct 4, 2026', isCurrentWeek: true,
  prevStart: '2026-09-21', nextStart: '', total: 3, visitors: ['ANN', 'LEO'],
  days: ['Mon 09/28', 'Tue 09/29', 'Wed 09/30', 'Thu 10/01', 'Fri 10/02', 'Sat 10/03', 'Sun 10/04'].map((l, i) => ({ date: '2026-' + (i < 3 ? '09-' + (28 + i) : '10-0' + (i - 2)), label: l, count: 0 })),
  rows: [
    { date: '2026-10-02', day: 'Fri', visited: '2026-10-02', store: 'SAN PEDRO', brand: "ANGEL'S PIZZA", visitors: ['LEO'], purpose: 'STORE VISIT', remarks: '', recordedAt: '2026-10-02 15:30' },
    { date: '2026-09-30', day: 'Wed', visited: '2026-09-25', store: 'URDANETA', brand: "ANGEL'S PIZZA", visitors: ['ANN'], purpose: 'TLTC', remarks: 'trained 3', recordedAt: '2026-09-30 10:00' },
    { date: '2026-09-28', day: 'Mon', visited: '2026-09-28', store: 'SAN PEDRO', brand: "ANGEL'S PIZZA", visitors: ['LEO', 'ANN'], purpose: 'STORE VISIT', remarks: '', recordedAt: '2026-09-28 09:00' },
  ],
};
const STUB = `
window.__calls = [];
window.__stub = {
  sl_isAdmin: false,
  getSidebarData: { stores: [{ name: 'SAN PEDRO', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', category: 'FAR PROVINCIAL', storeId: 'STR-1' }], visitors: ['LEO', 'ANN'], purposes: ['STORE VISIT'] },
  portal_getWeekHistory: (start) => start === '2026-09-21'
    ? Object.assign({}, ${JSON.stringify(WEEK)}, { weekStart: '2026-09-21', label: 'Sep 21 – 27, 2026', isCurrentWeek: false, prevStart: '2026-09-14', nextStart: '2026-09-28', total: 0, rows: [], visitors: [] })
    : ${JSON.stringify(WEEK)},
  processSubmissionAsync: { success: true, message: 'Saved ✓' },
};
window.google = { script: { get run() {
  let ok = null, bad = null;
  const h = { withSuccessHandler(f) { ok = f; return p; }, withFailureHandler(f) { bad = f; return p; }, withUserObject() { return p; } };
  const p = new Proxy(h, { get(t, prop) {
    if (prop in t) return t[prop];
    if (typeof prop !== 'string') return undefined;
    return (...args) => { window.__calls.push(prop + '(' + args.map(a => typeof a === 'string' ? a : '').join(',') + ')'); setTimeout(() => {
      const v = window.__stub[prop];
      try { if (ok) ok(typeof v === 'function' ? v(...args) : (v === undefined ? null : v)); } catch (e) {}
    }, 5); };
  } });
  return p;
} } };`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(STUB);
  await page.goto('file://' + PORTAL_FILE);
  await page.waitForTimeout(300);
  const calls = () => page.evaluate(() => window.__calls.filter(c => c.indexOf('portal_getWeekHistory') === 0));

  console.log('\n── Input Portal: weekly history panel ──');
  check('not loaded until the Input tab is opened', (await calls()).length === 0, await calls());
  await page.evaluate(() => switchTab('Input'));
  await page.waitForTimeout(150);
  check('opening the Input tab loads the current week once', (await calls()).length === 1, await calls());
  const ui = await page.evaluate(() => ({
    label: document.getElementById('whLabel').textContent,
    next: document.getElementById('whNext').disabled,
    days: Array.from(document.querySelectorAll('.wh-day b')).map(b => b.textContent).join(''),
    rows: document.querySelectorAll('.wh-row').length,
    hdrs: Array.from(document.querySelectorAll('.wh-dayhdr')).map(h => h.textContent),
    total: document.querySelector('.wh-total').textContent,
    rem: document.querySelector('.wh-rem') && document.querySelector('.wh-rem').textContent,
    meta: Array.from(document.querySelectorAll('.wh-row'))[1].querySelectorAll('.wh-meta')[1].textContent,
    hdr: document.querySelector('#weekHistory .queue-hdr span').textContent,
  }));
  check('label says this week', ui.label === 'This week · Sep 28 – Oct 4, 2026', ui.label);
  check('▶ disabled on the current week', ui.next === true);
  check('count per day Mon..Sun', ui.days === '1010100', ui.days);
  check('3 rows grouped under day headings, newest first', ui.rows === 3 && JSON.stringify(ui.hdrs) === '["Fri 10/02","Wed 09/30","Mon 09/28"]', ui);
  check('total and remarks shown', ui.total === '3 visits' && ui.rem === 'trained 3', ui);
  check('each row: date visited + submission time', ui.meta === 'Visited 09/25 · submitted 10:00', ui.meta);
  check('panel says it is by submission', /Submitted this week/.test(ui.hdr), ui.hdr);

  await page.selectOption('#whVisitor', 'ANN');
  const ann = await page.evaluate(() => ({ rows: document.querySelectorAll('.wh-row').length, days: Array.from(document.querySelectorAll('.wh-day b')).map(b => b.textContent).join('') }));
  check('filter by visitor: ANN → 2 visits, day counts follow', ann.rows === 2 && ann.days === '1010000', ann);
  await page.selectOption('#whVisitor', '');

  await page.click('#whPrev');
  await page.waitForTimeout(100);
  const prev = await page.evaluate(() => ({ label: document.getElementById('whLabel').textContent, next: document.getElementById('whNext').disabled, empty: document.getElementById('whList').textContent }));
  check('◀ loads the previous week', prev.label === 'Sep 21 – 27, 2026' && prev.next === false, prev);
  check('an empty week says so', /No visits submitted this week yet/.test(prev.empty), prev.empty);
  await page.click('#whNext');
  await page.waitForTimeout(100);
  check('▶ back to this week', (await page.evaluate(() => document.getElementById('whLabel').textContent)).indexOf('This week') === 0);

  const before = (await calls()).length;
  await page.evaluate(() => { execSubmit({ store: 'SAN PEDRO', dateVisited: '2026-10-07', purpose: 'STORE VISIT', visitedBy: ['LEO'] }); execSubmit({ store: 'SAN PEDRO', dateVisited: '2026-10-07', purpose: 'STORE VISIT', visitedBy: ['ANN'] }); });
  await page.waitForTimeout(1800);
  check('after submissions the week reloads once (not per submission)', (await calls()).length === before + 1, (await calls()).slice(before));

  await browser.close();
  console.log('\n══════════════════════════════════   PASS ' + pass + '   FAIL ' + fail + ' ══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
