// v25 — fixes from Leo's 2026-10-05 live check (PLAN.md 🐞 F1 + F2).
//
// Server half: the REAL .gs code in a Node vm sandbox (the in-memory
// spreadsheet from store-name-matching.test.js) —
//   • svmiPlain_: dates become text so google.script.run can deliver results
//   • admin list/detail/audit results carry no Date objects
//   • store_create refuses a second OPEN store with the same name + brand
//   • Store Name Matching never overwrites non-Store-ID text in MASTER_LOG
//     column I (Leo's leaderboard in I2:I13)
//   • admin saves queue the Store Health rebuild instead of running it inline
// Browser half: the REAL SVMI_PORTAL.html with a stubbed google.script.run —
//   • 📅 is a real date input sitting on the icon (taps open the calendar)
//   • Enter on Date Visited stops at Visited By (no double jump to Purpose)
//   • Unvisited tier pills combine (Monthly + Quarterly, …)
//   • Admin edit form is pre-filled; fmtDate handles text dates;
//     a tool with an empty reply doesn't stay "Running…"

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); fail++; }
}

// Reuse the sandbox + seed from store-name-matching.test.js without running its checks.
const T = path.join(__dirname, 'store-name-matching.test.js');
const testSrc = fs.readFileSync(T, 'utf8');
const lib = {};
new Function('require', '__dirname', 'lib',
  testSrc.split("console.log('\\n── Find:")[0] + '\nlib.newSandbox = newSandbox; lib.seed = seed; lib.cell = cell; lib.sheetRows = sheetRows; lib.anyDate = anyDate;'
)(require, __dirname, lib);
const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');

const TODAY = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
function env2() {
  const env = lib.newSandbox();
  ['SVMKPI_ADMIN_API.gs', 'SVMKPI_ADMIN.gs'].forEach(f => vm.runInContext(src(f), env.sandbox, { filename: f }));
  return env;
}

// ─────────────────────────────────────────────────────────────
console.log('\n── svmiPlain_: dates as text ──');
{
  const env = env2(); const s = env.sandbox; const D = env.SDate;
  check('midnight → yyyy-MM-dd', s.svmiPlain_(new D(2026, 9, 5)) === '2026-10-05', s.svmiPlain_(new D(2026, 9, 5)));
  check('with time → yyyy-MM-dd HH:mm:ss', s.svmiPlain_(new D(2026, 9, 5, 13, 4, 9)) === '2026-10-05 13:04:09');
  check('invalid Date → empty text', s.svmiPlain_(new D('nope')) === '');
  const nested = s.svmiPlain_({ a: [new D(2026, 0, 2), { b: new D(2026, 0, 3, 8, 0, 0) }], n: 3, t: 'x', z: null, f: () => 1 });
  check('nested arrays/objects converted, other values kept', JSON.stringify(nested) === JSON.stringify({ a: ['2026-01-02', { b: '2026-01-03 08:00:00' }], n: 3, t: 'x', z: null }), nested);
  check('result has no Date anywhere', !lib.anyDate(nested));
}

console.log('\n── Admin → Configuration / Audit results carry no Date objects ──');
{
  const env = env2(); const s = env.sandbox; const ids = lib.seed(env);
  const list = s.admin_listAllStores(null);
  check('admin_listAllStores: no Date (page used to get null → endless spinner)', !lib.anyDate(list));
  check('admin_listAllStores: every store listed', list.length === 5, list.length);
  check('admin_listAllStores: effectiveFrom is yyyy-MM-dd text', /^\d{4}-\d{2}-\d{2}$/.test(list[0].effectiveFrom), list[0].effectiveFrom);
  const det = s.admin_getConfigEntityDetail('STORES', ids.SP, null);
  check('admin_getConfigEntityDetail: no Date', !lib.anyDate(det));
  check('admin_getConfigEntityDetail: current + history kept', det.current && det.current.fields.storeName === 'SAN PEDRO' && det.history.length >= 1, det.current);
  const raw = s.admin_getConfigEntityDetail_raw_('STORES', ids.SP, null);
  check('raw version (server-side callers) still has real Dates', lib.anyDate(raw));
  const audit = s.cfg_getAuditLog('STORES', null);
  check('cfg_getAuditLog: rows returned', audit.length > 0, audit.length);
  check('cfg_getAuditLog: no Date (Audit tab used to always say "no entries")', !lib.anyDate(audit));
}

console.log('\n── store_create: no second OPEN store with the same name + brand ──');
{
  const env = env2(); const s = env.sandbox; const ids = lib.seed(env);
  const dup = s.store_create({ storeName: 'san pedro ', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', category: 'FAR PROVINCIAL' }, TODAY, 'retry', {});
  check('same name + brand as an open store → refused', !dup.success && dup.duplicateStoreId === ids.SP, dup);
  check('message says it may already be saved', /may have been saved already/.test(dup.message || ''), dup.message);
  const other = s.store_create({ storeName: 'SAN PEDRO', brand: 'FIGARO', region: 'FRANCHISE', category: 'FAR PROVINCIAL' }, TODAY, 'other brand', {});
  check('same name, other brand → allowed', other.success, other);
  const off = s.store_deactivate(ids.URD, 'closed', TODAY, {});
  check('(setup) URDANETA closed', off && off.success, off);
  const reopen = s.store_create({ storeName: 'URDANETA', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', category: 'FAR PROVINCIAL' }, TODAY, 'new branch', {});
  check('same name + brand as a CLOSED store → allowed', reopen.success, reopen);
  const forced = s.store_create({ storeName: 'SAN PEDRO', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', category: 'FAR PROVINCIAL' }, TODAY, 'migration', { allowSameNameAndBrand: true });
  check('allowSameNameAndBrand (migration) skips the check', forced.success, forced);
}

console.log('\n── Store Name Matching never overwrites the leaderboard in column I ──');
{
  const env = env2(); const s = env.sandbox; const ids = lib.seed(env);
  // Rows 2–13 of the live MASTER_LOG hold Leo's visitor leaderboard in I:J.
  env.master.getRange(2, 9).setValue('CHARLIE');
  env.master.getRange(3, 9).setValue('ANN');
  const r = s.portal_applyStoreCleanupDecision({ type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' });
  check('merge applied', r && r.success, r);
  check('row 2: name changed to the final name', lib.cell(env, 2, 3) === 'STA. MARIA (F)', lib.cell(env, 2, 3));
  check('row 2: column I still "CHARLIE" (leaderboard untouched)', lib.cell(env, 2, 9) === 'CHARLIE', lib.cell(env, 2, 9));
  check('row 3: column I still "ANN"', lib.cell(env, 3, 9) === 'ANN', lib.cell(env, 3, 9));
  check('row 4 (blank column I): Store ID written', lib.cell(env, 4, 9) === ids.K, lib.cell(env, 4, 9));
  check('row 6 (old Store ID): replaced with the kept store', lib.cell(env, 6, 9) === ids.K, lib.cell(env, 6, 9));
  const fixes = lib.sheetRows(env, 'MASTER_LOG_FIXES', 10);
  const row2 = fixes.filter(f => Number(f[4]) === 2)[0];
  check('MASTER_LOG_FIXES records column I unchanged for row 2', row2 && row2[8] === 'CHARLIE' && row2[9] === 'CHARLIE', row2);
  const rb = s.portal_rebuildVisitTables();
  check('(setup) visit tables rebuilt', rb && rb.success, rb);
  const visits = lib.sheetRows(env, 'STORE_VISITS', 8);
  const v2 = visits.filter(v => Number(v[7]) === 2)[0] || visits.filter(v => String(v.join('|')).indexOf('2026-05-11') !== -1)[0];
  const allK = visits.filter(v => v[2] === ids.K).length;
  check('rows 2–3 still belong to the kept store in the visit tables (by name + brand)', allK >= 4, { allK, sample: v2 });
}

console.log('\n── Admin saves queue the Store Health rebuild (no rebuild inside Save) ──');
{
  const env = env2(); const s = env.sandbox; lib.seed(env);
  const props = {};
  const triggers = [];
  let risk = 0, riskToken = null;
  s.PropertiesService = { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; },
  }) };
  s.ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => { const i = triggers.indexOf(t); if (i !== -1) triggers.splice(i, 1); },
    newTrigger: fn => ({ timeBased: () => ({ after: ms => ({ create: () => { const t = { getHandlerFunction: () => fn, ms }; triggers.push(t); return t; } }) }) }),
  };
  s.RISK_SHEET_NAME = 'STORE HEALTH';
  env.ss.insertSheet('STORE HEALTH');
  s.refreshRiskEngine = (y, tok) => { risk++; riskToken = tok; return { success: true }; };

  const saved = s.store_create({ storeName: 'NEW STORE', brand: 'FIGARO', region: 'FRANCHISE', category: 'NCR' }, TODAY, 'add', {});
  check('store saved', saved.success, saved);
  check('Store Health NOT rebuilt inside the save', risk === 0, risk);
  check('rebuild queued', props.SVMI_QUEUED_REBUILDS === 'STORE_HEALTH', props);
  check('one trigger, about a minute later', triggers.length === 1 && triggers[0].ms === 60000 && triggers[0].getHandlerFunction() === 'triggerQueuedRebuilds', triggers.length);
  s.store_create({ storeName: 'NEW STORE 2', brand: 'FIGARO', region: 'FRANCHISE', category: 'NCR' }, TODAY, 'add', {});
  check('a second save adds no second trigger', triggers.length === 1, triggers.length);

  const ran = s.triggerQueuedRebuilds();
  check('trigger runs Store Health once', risk === 1, risk);
  check('…with the server-only token (no admin session in a trigger)', riskToken && riskToken === vm.runInContext('_SYSTEM_TRIGGER_TOKEN_', s), riskToken);
  check('queue cleared and trigger removed', !props.SVMI_QUEUED_REBUILDS && triggers.length === 0, { props, n: triggers.length });
  check('result is plain', ran && ran.success && JSON.stringify(ran.ran) === '["STORE_HEALTH"]', ran);
  s.triggerQueuedRebuilds();
  check('running it again with nothing queued does nothing', risk === 1, risk);

  // No trigger service available → falls back to the old inline rebuild.
  delete s.ScriptApp;
  vm.runInContext('ScriptApp = undefined', s);
  s.store_create({ storeName: 'NEW STORE 3', brand: 'FIGARO', region: 'FRANCHISE', category: 'NCR' }, TODAY, 'add', {});
  check('without triggers the save still refreshes Store Health (inline fallback)', risk === 2, risk);
}

// ─────────────────────────────────────────────────────────────
// Browser half
// ─────────────────────────────────────────────────────────────
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
})();

const PORTAL_FILE = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'svmi-v25-')), 'SVMI_PORTAL.html');
fs.writeFileSync(PORTAL_FILE, src('SVMI_PORTAL.html').replace("<?!= JSON.stringify(enteredPassword || '') ?>", "''"));

// google.script.run stub: answers from window.__stub[fn] (value or function), else null.
const STUB = `
window.__calls = [];
window.__stub = {
  getSidebarData: { stores: [{ name: 'SAN PEDRO', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', category: 'FAR PROVINCIAL', storeId: 'STR-1' }],
                    visitors: ['LEO', 'ANN'], purposes: ['STORE VISIT'] },
  sl_isAdmin: true,
};
window.google = { script: { get run() {
  let ok = null, bad = null;
  const h = { withSuccessHandler(f) { ok = f; return p; }, withFailureHandler(f) { bad = f; return p; }, withUserObject() { return p; } };
  const p = new Proxy(h, { get(t, prop) {
    if (prop in t) return t[prop];
    if (typeof prop !== 'string') return undefined;
    return (...args) => { window.__calls.push(prop); setTimeout(() => {
      const v = window.__stub[prop];
      try { if (ok) ok(typeof v === 'function' ? v(...args) : (v === undefined ? null : v)); } catch (e) { /* page handler errors are not under test */ }
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
  await page.evaluate(() => { if (typeof switchTab === 'function') switchTab('Input'); });
  await page.waitForTimeout(200);

  console.log('\n── 📅 date picker: a real date input on the icon ──');
  const geo = await page.evaluate(() => {
    const nat = document.getElementById('dateVisited');
    const txt = document.getElementById('dateVisitedText');
    const btn = nat.parentElement;
    const a = nat.getBoundingClientRect(), b = btn.getBoundingClientRect(), t = txt.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    return {
      type: nat.type, pe: getComputedStyle(nat).pointerEvents, inBtn: btn.classList.contains('date-btn'),
      covers: Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1 && a.height > 10,
      hit: document.elementFromPoint(cx, cy) === nat,
      textFree: document.elementFromPoint(t.left + 20, t.top + t.height / 2) === txt,
      showPickerUsed: typeof window.openDatePicker === 'function',
    };
  });
  check('the date input lives inside the 📅 button', geo.inBtn && geo.type === 'date', geo);
  check('it covers the whole icon and takes taps (pointer-events on)', geo.covers && geo.pe !== 'none', geo);
  check('a tap in the middle of 📅 lands on the date input itself', geo.hit, geo);
  check('the typing field is not covered', geo.textFree, geo);
  check('no showPicker() opener left (refused inside the Apps Script iframe)', !geo.showPickerUsed, geo);
  await page.evaluate(() => { const n = document.getElementById('dateVisited'); n.value = '2026-10-03'; n.dispatchEvent(new Event('change')); });
  check('picking a date fills the typing field', (await page.inputValue('#dateVisitedText')) === '10/03/2026', await page.inputValue('#dateVisitedText'));

  console.log('\n── Enter on Date Visited stops at Visited By ──');
  await page.click('#dateVisitedText', { clickCount: 3 });
  await page.keyboard.type('10052026');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  check('focus is on Visited By (not Purpose)', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'visSearch',
    await page.evaluate(() => document.activeElement && document.activeElement.id));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  check('Enter on an empty Visited By with no visitor chosen stays there', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'visSearch',
    await page.evaluate(() => document.activeElement && document.activeElement.id));
  // Android-style Enter: keydown arrives as 229, only keyup says Enter → the keyup fallback still works.
  const android = await page.evaluate(async () => {
    const vs = document.getElementById('visSearch');
    vs.focus(); vs.value = 'LEO'; vs.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 1100));          // well past the last real Enter
    vs.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 229, bubbles: true }));
    vs.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    return { chips: (typeof selVisitors !== 'undefined') ? selVisitors.slice() : null };
  });
  check('Android Enter (keyup only) still picks the visitor', android.chips && android.chips.indexOf('LEO') !== -1, android);

  console.log('\n── Unvisited: tier pills combine ──');
  const pills = await page.evaluate(async () => {
    document.getElementById('visitsPanel').innerHTML = '';
    renderCompliance([
      { store: 'A', brand: 'FIGARO', region: 'NCR', ytdVisits: 1, windowLabel: 'Monthly', lastVisitDate: '—', daysSince: null },
      { store: 'B', brand: 'FIGARO', region: 'NCR', ytdVisits: 1, windowLabel: 'Quarterly', lastVisitDate: '—', daysSince: null },
      { store: 'C', brand: 'FIGARO', region: 'NCR', ytdVisits: 1, windowLabel: 'Semi-Annual', lastVisitDate: '—', daysSince: null },
      { store: 'D', brand: 'FIGARO', region: 'NCR', ytdVisits: 1, windowLabel: 'Monthly', lastVisitDate: '—', daysSince: null },
    ]);
    const rows = () => Array.from(document.querySelectorAll('#compBody tr.cr')).map(tr => tr.getAttribute('data-w'));
    const act = () => Array.from(document.querySelectorAll('.cf-btn.active')).map(b => b.dataset.f).sort().join('+');
    const btn = f => document.querySelector('.cf-btn[data-f="' + f + '"]');
    const out = {};
    btn('Monthly').click(); out.m = { rows: rows(), act: act() };
    btn('Quarterly').click(); out.mq = { rows: rows(), act: act() };
    btn('Quarterly').click(); btn('Semi-Annual').click(); out.ms = { rows: rows(), act: act() };
    btn('Monthly').click(); out.s = { rows: rows(), act: act() };
    btn('ALL').click(); out.all = { rows: rows(), act: act() };
    return out;
  });
  check('Monthly alone → 2 monthly stores', pills.m.rows.length === 2 && pills.m.act === 'Monthly', pills.m);
  check('Monthly + Quarterly → 3 stores, both pills on', pills.mq.rows.length === 3 && pills.mq.act === 'Monthly+Quarterly', pills.mq);
  check('Monthly + Semi-Annual → 3 stores', pills.ms.rows.length === 3 && pills.ms.act === 'Monthly+Semi-Annual', pills.ms);
  check('turning Monthly off leaves Semi-Annual only', pills.s.rows.length === 1 && pills.s.act === 'Semi-Annual', pills.s);
  check('All Stores clears the filter', pills.all.rows.length === 4 && pills.all.act === 'ALL', pills.all);

  console.log('\n── Admin: edit form pre-filled, text dates, ✏️ on rows ──');
  const admin = await page.evaluate(() => {
    adminSchema = { fields: [{ key: 'storeName', header: 'Store Name' }, { key: 'brand', header: 'Brand' }, { key: 'status', header: 'Status' }], required: ['storeName'] };
    adminArea = 'STORES';
    adminStoreFormOptions = { brands: ['FIGARO'], regions: [], categories: [] };
    const col = document.getElementById('adminDetailCol');
    col.innerHTML = renderAdminCreateForm('STORES', 'STR-1', false);
    adminPrefillForm({ storeName: 'URDANETA', brand: 'KOOBIDEH', status: 'INACTIVE' });
    const row = adminEntityRowHtml('STR-1', 'URDANETA', 'STR-1 · INACTIVE', 'no');
    return {
      name: document.getElementById('af_storeName').value,
      brand: document.getElementById('af_brand').value,
      status: document.getElementById('af_status').value,
      fmt1: fmtDate('2026-10-05 13:04:09'), fmt2: fmtDate('2026-10-05'),
      edit: /admin-edit-btn/.test(row) && /adminEditEntity\('STR-1'\)/.test(row),
    };
  });
  check('edit form starts with the current name', admin.name === 'URDANETA', admin);
  check('a brand missing from the list is added, not blanked', admin.brand === 'KOOBIDEH', admin);
  check('an inactive store stays INACTIVE in the edit form', admin.status === 'INACTIVE', admin);
  check('fmtDate shows text dates as yyyy-MM-dd', admin.fmt1 === '2026-10-05' && admin.fmt2 === '2026-10-05', admin);
  check('each record row has a ✏️ edit button', admin.edit, admin);

  console.log('\n── System Tools: empty reply / double click ──');
  const tool = await page.evaluate(async () => {
    window.__stub.portal_rebuildVisitTables = null;              // the page gets nothing back
    const key = Object.keys(toolMap).filter(k => toolMap[k] === 'portal_rebuildVisitTables')[0] || Object.keys(toolMap)[0];
    window.__stub[toolMap[key]] = null;
    const stat = document.createElement('div'); stat.id = 'stat-v25'; document.body.appendChild(stat);
    const before = window.__calls.length;
    execTool(key, 'stat-v25');
    execTool(key, 'stat-v25');                                   // second click while running
    const calls = window.__calls.length - before;
    await new Promise(r => setTimeout(r, 60));
    return { calls, text: stat.textContent, cls: stat.className };
  });
  check('a second click while running does not start it again', tool.calls === 1, tool);
  check('an empty reply ends as an error, not "Running…" forever', /No reply from the server/.test(tool.text) && /error/.test(tool.cls), tool);

  await browser.close();
  console.log('\n══════════════════════════════════   PASS ' + pass + '   FAIL ' + fail + ' ══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
