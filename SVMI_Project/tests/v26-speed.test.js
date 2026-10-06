// v26 — Store Insights speed (Leo 2026-10-06: "search store and loading the
// details takes very long").
//
// Server half (REAL .gs code in a Node vm sandbox): one Store Insights lookup
// scores every store's health to show one (_computeStoreRisk). Each store used
// to re-read CONFIG_PURPOSES / CONFIG_RISK for its 4 purpose weights and the
// tier thresholds — ~9 sheet reads per store. Now each answer is read once
// per scoring pass, with identical results.
// Browser half (REAL SVMI_PORTAL.html, stubbed google.script.run): typing in
// the Store Insights search before the store list has arrived says so, and
// the list appears by itself when it lands.

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
  testSrc.split("console.log('\\n── Find:")[0] + '\nlib.newSandbox = newSandbox; lib.seed = seed;'
)(lib, require, __dirname);
const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');
const EXTRA = ['SVMKPI_REPORTING_YEAR.gs', 'SVMKPI_CALENDAR.gs', 'SVMKPI_COMPLIANCE_CONFIG.gs', 'SVMKPI_RISK_CONFIG.gs',
  'SVMKPI_PURPOSE_CONFIG.gs', 'SVMKPI_RISK.gs', 'SVMKPI_STORE_LOOKUP.gs', 'SVMKPI_VISIT_DATA.gs'];
const TODAY = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

function env(extraStores) {
  const e = lib.newSandbox();
  const props = {};
  e.sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) };
  EXTRA.forEach(f => vm.runInContext(src(f), e.sandbox, { filename: f }));
  const ids = lib.seed(e);
  for (let i = 0; i < extraStores; i++) {
    const r = e.sandbox.store_create({ storeName: 'EXTRA STORE ' + i, brand: 'FIGARO', region: 'FRANCHISE', category: 'NCR' }, '2026-01-01', 'setup', { backdateConfirmed: true });
    if (!r.success) throw new Error(JSON.stringify(r));
  }
  // SETTINGS mirror (Store Health seeds every store from it).
  const s = e.sandbox;
  const today = s.cfg_resolveAllAsOf('STORES', null);
  const rows = Object.keys(today).map(id => { const f = today[id].fields; return [f.storeName, f.brand, f.region, '', f.category]; });
  e.settings.getRange(2, 1, rows.length, 5).setValues(rows);
  s.portal_rebuildVisitTables();
  s.portal_useVisitTablesForReports();
  return { e, s, ids };
}

// Count every config resolution (each one is a full CONFIG_* sheet read).
function countConfigReads(s, fn) {
  const orig = vm.runInContext('cfg_resolveConfigurationAsOf', s);
  const byArea = {};
  vm.runInContext('cfg_resolveConfigurationAsOf', s);
  s.cfg_resolveConfigurationAsOf = function (area) { byArea[area] = (byArea[area] || 0) + 1; return orig.apply(this, arguments); };
  try { const result = fn(); return { result, byArea, total: Object.keys(byArea).reduce((a, k) => a + byArea[k], 0) }; }
  finally { s.cfg_resolveConfigurationAsOf = orig; }
}

console.log('\n── Store Insights: config read once per lookup, not per store ──');
{
  const small = env(0), big = env(60);
  const runSmall = countConfigReads(small.s, () => small.s.sl_getStoreData('SAN PEDRO', "ANGEL'S PIZZA", small.ids.SP));
  const runBig = countConfigReads(big.s, () => big.s.sl_getStoreData('SAN PEDRO', "ANGEL'S PIZZA", big.ids.SP));
  check('lookup works', runBig.result && runBig.result.meta && runBig.result.meta.name === 'SAN PEDRO', runBig.result && runBig.result.meta);
  check('CONFIG_RISK / CONFIG_PURPOSES reads stay small (≤ 10)', (runBig.byArea.RISK || 0) + (runBig.byArea.PURPOSES || 0) <= 10, runBig.byArea);
  check('…and do not grow with the number of stores (5 vs 65 stores)', runBig.total === runSmall.total, { small: runSmall.byArea, big: runBig.byArea });
  check('memo is gone after the lookup (next lookup sees config changes)', vm.runInContext('_SL_RISK_MEMO_', big.s) === null);
}

console.log('\n── Same scores as before ──');
{
  const { s } = env(20);
  const log = s.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG');
  const data = s._getData(log);
  const today = new (vm.runInContext('Date', s))();
  const withMemo = s._computeStoreRisk(data, today, 2026);
  const without = s._computeStoreRiskPass_(data, today, 2026);   // the old path: no memo at all
  check('every store\'s score, tier and reason identical', JSON.stringify(withMemo) === JSON.stringify(without), { n: withMemo.length });
  check('scored every store (seed + extras)', withMemo.length >= 25, withMemo.length);

  // A threshold change between two passes is picked up by the second one.
  const before = s._computeStoreRisk(data, today, 2026).filter(r => r.riskScore > 0)[0];
  s.risk_create({ lowThreshold: 0, mediumThreshold: 0.01, highThreshold: 0.02 }, TODAY, 'test', { backdateConfirmed: true });
  const after = s._computeStoreRisk(data, today, 2026).filter(r => r.store === before.store && r.brand === before.brand)[0];
  check('a config change is seen by the next pass', before && after && after.riskTier === 'HIGH', { before: before && before.riskTier, after: after && after.riskTier });
}

// ─────────────────────────────────────────────────────────────
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found.'); process.exit(2);
})();
const PORTAL_FILE = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'svmi-v26-')), 'SVMI_PORTAL.html');
fs.writeFileSync(PORTAL_FILE, src('SVMI_PORTAL.html').replace("<?!= JSON.stringify(enteredPassword || '') ?>", "''"));
const STUB = `
window.__hold = {};          // fn -> array of pending deliveries
window.__stub = { sl_isAdmin: false, getSidebarData: { stores: [], visitors: [], purposes: [] } };
window.google = { script: { get run() {
  let ok = null, bad = null;
  const h = { withSuccessHandler(f) { ok = f; return p; }, withFailureHandler(f) { bad = f; return p; }, withUserObject() { return p; } };
  const p = new Proxy(h, { get(t, prop) {
    if (prop in t) return t[prop];
    if (typeof prop !== 'string') return undefined;
    return (...args) => {
      const deliver = () => { const v = window.__stub[prop]; try { if (ok) ok(v === undefined ? null : v); } catch (e) {} };
      if (prop === 'sl_getStoreList') (window.__hold[prop] = window.__hold[prop] || []).push(deliver);
      else setTimeout(deliver, 5);
    };
  } });
  return p;
} } };`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(STUB);
  await page.goto('file://' + PORTAL_FILE);
  await page.waitForTimeout(300);
  await page.evaluate(() => switchTab('Insights'));

  console.log('\n── Store Insights search before the list has arrived ──');
  await page.click('#siSearch');
  await page.keyboard.type('SAN');
  await page.waitForTimeout(100);
  const loading = await page.evaluate(() => ({ text: document.getElementById('siDrop').textContent, open: document.getElementById('siDrop').classList.contains('open'), opts: document.querySelectorAll('#siDrop .ss-opt').length }));
  check('dropdown says the list is loading (not an empty "nothing found")', loading.open && /Loading the store list/.test(loading.text), loading);
  check('the loading note is not a pickable option', loading.opts === 0, loading);
  const requests = await page.evaluate(() => (window.__hold.sl_getStoreList || []).length);
  check('typing while it loads does not request the list again', requests === 1, requests);

  await page.evaluate(() => {
    window.__stub.sl_getStoreList = [{ storeId: 'STR-1', name: 'SAN PEDRO', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', closed: false },
                                     { storeId: 'STR-2', name: 'URDANETA', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', closed: false }];
    window.__hold.sl_getStoreList.shift()();
  });
  await page.waitForTimeout(50);
  const ready = await page.evaluate(() => Array.from(document.querySelectorAll('#siDrop .ss-opt')).map(o => o.dataset.v));
  check('when the list lands, the matching stores appear by themselves', JSON.stringify(ready) === '["SAN PEDRO"]', ready);

  await browser.close();
  console.log('\n══════════════════════════════════   PASS ' + pass + '   FAIL ' + fail + ' ══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
