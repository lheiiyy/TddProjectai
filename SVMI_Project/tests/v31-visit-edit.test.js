// v31 — edit / void / restore a logged visit, admin only (PLAN.md 🐞 F8).
// Leo 2026-10-07: L1 void (restorable), L2 a reason on every change.
//
// Server half: REAL .gs code in a Node vm sandbox — after every change the
// visit tables must still match MASTER_LOG exactly (Check Visit Tables).
// Browser half: REAL SVMI_PORTAL.html with a stubbed google.script.run.

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
  testSrc.split("console.log('\\n── Find:")[0] + '\nlib.newSandbox = newSandbox; lib.seed = seed; lib.cell = cell; lib.sheetRows = sheetRows; lib.anyDate = anyDate;'
)(lib, require, __dirname);
const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');
const EXTRA = ['SVMKPI_REPORTING_YEAR.gs', 'SVMKPI_CALENDAR.gs', 'SVMKPI_COMPLIANCE_CONFIG.gs', 'SVMKPI_RISK.gs',
  'SVMKPI_STORE_LOOKUP.gs', 'SVMKPI_VISIT_DATA.gs', 'SVMKPI_VISIT_EDIT.gs'];

function env() {
  const e = lib.newSandbox();
  const props = {};
  e.sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) };
  EXTRA.forEach(f => vm.runInContext(src(f), e.sandbox, { filename: f }));
  // The in-memory sheet has no deleteRow — add one that shifts the rows below up, like Sheets.
  const cells = e.master._cells;
  e.master.deleteRow = (r) => {
    const moved = {};
    Object.keys(cells).forEach(k => {
      const [row, col] = k.split(',').map(Number);
      if (row === r) return;
      moved[(row > r ? row - 1 : row) + ',' + col] = cells[k];
    });
    Object.keys(cells).forEach(k => delete cells[k]);
    Object.assign(cells, moved);
  };
  const ids = lib.seed(e);
  const D = e.SDate;
  const row = (d, store, brand, id, who, purpose, remarks, ts) => [ts, new D(2026, 8, d), store, brand, 'PROVINCIAL', who, purpose, remarks || '', id];
  // Rows 13–16 (seed fills 2–12).
  e.master.getRange(13, 1, 4, 9).setValues([
    row(1, 'SAN PEDRO', "ANGEL'S PIZZA", ids.SP, 'LEO', 'STORE VISIT', '', new D(2026, 8, 1, 9, 0, 1)),
    row(2, 'SAN PEDRO', "ANGEL'S PIZZA", ids.SP, 'ANN', 'STORE VISIT', 'wrong store', new D(2026, 8, 2, 9, 0, 2)),
    row(3, 'URDANETA', "ANGEL'S PIZZA", ids.URD, 'LEO', 'TLTC', '', new D(2026, 8, 3, 9, 0, 3)),
    row(4, 'SAN PEDRO', "ANGEL'S PIZZA", ids.SP, 'CHARLIE', 'STORE VISIT', '', new D(2026, 8, 4, 9, 0, 4)),
  ]);
  e.master.getRange(2, 9).setValue('CHARLIE');              // Leo's leaderboard in I2:J13
  e.master.getRange(2, 10).setValue(12);
  const s = e.sandbox;
  s.portal_rebuildVisitTables();
  s.portal_useVisitTablesForReports();
  e.ids = ids;
  return e;
}
const inSync = s => { const c = s.portal_checkVisitTables(); return c && c.success && /in sync/i.test(c.message); };
const corrections = e => lib.sheetRows(e, 'VISIT_CORRECTIONS', 9);
const tsOf = e => r => e.sandbox.ve_tsKey_(e.master.getRange(r, 1).getValue());

console.log('\n── Week list gives each visit its MASTER_LOG row + timestamp ──');
{
  const e = env(); const s = e.sandbox;
  const w = s.portal_getWeekHistory('2026-09-02');
  const r = w.rows.filter(x => x.remarks === 'wrong store')[0];
  check('row number and timestamp key on every row', r && r.row === 14 && r.tsKey === '2026-09-02 09:00:02', r);
}

console.log('\n── Who may change a visit ──');
{
  const e = env(); const s = e.sandbox; const ts = tsOf(e);
  e.state.isAdmin = false;
  check('non-admin: read refused', s.portal_getVisitForEdit(14, ts(14)).success === false);
  check('non-admin: edit refused', s.portal_editVisit(14, ts(14), {}, 'x').success === false);
  check('non-admin: void refused', s.portal_voidVisit(14, ts(14), 'x').success === false);
  e.state.isAdmin = true;
  check('no reason → refused (edit)', /reason is required/.test(s.portal_editVisit(14, ts(14), {}, '  ').message));
  check('no reason → refused (void)', /reason is required/.test(s.portal_voidVisit(14, ts(14), '').message));
  const moved = s.portal_editVisit(14, '2026-09-02 09:00:99', { dateVisited: '2026-09-02', storeId: e.ids.URD, visitors: ['ANN'], purpose: 'STORE VISIT' }, 'x');
  check('a row that is no longer that visit (timestamp differs) is not touched', moved.success === false && moved.moved === true, moved);
}

console.log('\n── Edit ──');
{
  const e = env(); const s = e.sandbox; const ids = e.ids; const ts = tsOf(e);
  const before = s.portal_getVisitForEdit(14, ts(14));
  check('edit form values', before.success && before.storeId === ids.SP && JSON.stringify(before.visitors) === '["ANN"]' && before.dateVisited === '2026-09-02' && before.canVoid === true, before);
  check('no Date objects to the page', !lib.anyDate(before));
  const oldIds = lib.sheetRows(e, 'STORE_VISITS', 8).filter(v => Number(v[7]) === 14).map(v => v[0]);
  const r = s.portal_editVisit(14, ts(14), { dateVisited: '2026-09-03', storeId: ids.URD, visitors: ['ANN', 'leo'], purpose: 'TLTC', remarks: 'fixed' }, 'wrong store picked');
  check('saved', r.success && /^VC-/.test(r.correctionId), r);
  const row = e.master.getRange(14, 1, 1, 9).getValues()[0];
  check('MASTER_LOG row rewritten: date, store, brand, region, visitors, purpose, remarks, Store ID',
    row[1] === '2026-09-03' && row[2] === 'URDANETA' && row[3] === "ANGEL'S PIZZA" && row[5] === 'ANN | LEO' && row[6] === 'TLTC' && row[7] === 'fixed' && row[8] === ids.URD, row);
  check('submission timestamp unchanged', s.ve_tsKey_(row[0]) === '2026-09-02 09:00:02', row[0]);
  const vrows = lib.sheetRows(e, 'STORE_VISITS', 8).filter(v => Number(v[7]) === 14);
  check('visit tables: that visit now belongs to URDANETA', vrows.length === 1 && vrows[0][2] === ids.URD && vrows[0][3] === 'TLTC', vrows);
  check('…the old Visit ID is gone', !lib.sheetRows(e, 'STORE_VISITS', 8).some(v => oldIds.indexOf(v[0]) !== -1));
  check('…its visitors are ANN + LEO', lib.sheetRows(e, 'STORE_VISIT_VISITORS', 2).filter(l => l[0] === vrows[0][0]).map(l => l[1]).sort().join(',') === 'ANN,LEO');
  check('visit tables still match MASTER_LOG exactly', inSync(s), s.portal_checkVisitTables().message);
  const c = corrections(e).slice(-1)[0];
  check('VISIT_CORRECTIONS: EDIT, row, reason, before + after', c[3] === 'EDIT' && Number(c[4]) === 14 && c[5] === 'wrong store picked'
    && JSON.parse(c[6])[2] === 'SAN PEDRO' && JSON.parse(c[7])[2] === 'URDANETA', c);
  check('audit row (SYSTEM / VISIT / EDIT)', lib.sheetRows(e, 'CONFIG_AUDIT', 12).some(a => a[3] === 'SYSTEM' && a[4] === 'VISIT' && a[5] === 'EDIT'));
  const same = s.portal_editVisit(14, ts(14), { dateVisited: '2026-09-03', storeId: ids.URD, visitors: ['ANN', 'LEO'], purpose: 'TLTC', remarks: 'fixed' }, 'again');
  check('saving with nothing changed writes nothing', same.success && same.unchanged === true && corrections(e).length === 1, same);
  const bad = s.portal_editVisit(14, ts(14), { dateVisited: '2026-09-03', storeId: 'STR-NOPE', visitors: ['ANN'], purpose: 'TLTC' }, 'x');
  check('an unknown store is refused', bad.success === false && /Pick a store/.test(bad.message), bad);
}

console.log('\n── Leaderboard rows (2–13) ──');
{
  const e = env(); const s = e.sandbox; const ids = e.ids; const ts = tsOf(e);
  const g = s.portal_getVisitForEdit(2, ts(2));
  check('row 2 can be edited but not voided', g.success && g.canVoid === false, g);
  s.portal_editVisit(2, ts(2), { dateVisited: '2026-05-11', storeId: ids.K, visitors: ['LEO', 'ANN'], purpose: 'STORE VISIT', remarks: '' }, 'add ANN');
  check('editing it leaves the leaderboard name in column I', e.master.getRange(2, 9).getValue() === 'CHARLIE' && e.master.getRange(2, 6).getValue() === 'LEO | ANN');
  const v = s.portal_voidVisit(2, ts(2), 'x');
  check('voiding it is refused (would shift the leaderboard)', v.success === false && /leaderboard/.test(v.message), v);
  check('tables still in sync', inSync(s));
}

console.log('\n── Void and restore ──');
{
  const e = env(); const s = e.sandbox; const ts = tsOf(e);
  const before = e.master.getLastRow();
  const sepBefore = s.sl_getVisitedThisMonth([], 9, 2026).resolved.reduce((n, r) => n + r.visits, 0);
  const tsKey = ts(14);
  const r = s.portal_voidVisit(14, tsKey, 'logged twice');
  check('voided', r.success, r);
  check('the row left MASTER_LOG (rows below moved up)', e.master.getLastRow() === before - 1 && e.master.getRange(14, 3).getValue() === 'URDANETA');
  check('visit tables still match MASTER_LOG exactly (Source Rows shifted)', inSync(s), s.portal_checkVisitTables().message);
  const sepAfter = s.sl_getVisitedThisMonth([], 9, 2026).resolved.reduce((n, x) => n + x.visits, 0);
  check('September visits drop by one in the reports', sepAfter === sepBefore - 1, [sepBefore, sepAfter]);
  const list = s.portal_listVoidedVisits();
  check('listed as voided, with who / why / what', list.success && list.rows.length === 1 && list.rows[0].reason === 'logged twice'
    && list.rows[0].store === 'SAN PEDRO' && list.rows[0].visited === '2026-09-02' && list.rows[0].by === 'admin@test.com', list.rows[0]);
  check('no Date objects to the page', !lib.anyDate(list));
  const again = s.portal_voidVisit(14, tsKey, 'x');
  check('the old row number + timestamp no longer match → nothing else is touched', again.success === false && again.moved === true, again);

  const rs = s.portal_restoreVisit(list.rows[0].correctionId, 'not a duplicate after all');
  check('restored', rs.success && rs.row === e.master.getLastRow(), rs);
  const back = e.master.getRange(rs.row, 1, 1, 9).getValues()[0];
  check('same values back, same submission timestamp', back[2] === 'SAN PEDRO' && back[5] === 'ANN' && back[7] === 'wrong store' && s.ve_tsKey_(back[0]) === tsKey, back);
  check('visit tables still match', inSync(s), s.portal_checkVisitTables().message);
  check('counts in the reports again', s.sl_getVisitedThisMonth([], 9, 2026).resolved.reduce((n, x) => n + x.visits, 0) === sepBefore);
  check('no longer listed as voided', s.portal_listVoidedVisits().rows.length === 0);
  const twice = s.portal_restoreVisit(list.rows[0].correctionId, 'x');
  check('restoring twice is refused', twice.success === false && /Already restored/.test(twice.message), twice);
  check('VISIT_CORRECTIONS: VOID then RESTORE (refers to the void)', JSON.stringify(corrections(e).map(c => c[3])) === '["VOID","RESTORE"]' && corrections(e)[1][8] === list.rows[0].correctionId);
}

// ─────────────────────────────────────────────────────────────
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found.'); process.exit(2);
})();
const PORTAL_FILE = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'svmi-v31-')), 'SVMI_PORTAL.html');
fs.writeFileSync(PORTAL_FILE, src('SVMI_PORTAL.html').replace("<?!= JSON.stringify(enteredPassword || '') ?>", "''"));
const WEEK = {
  success: true, weekStart: '2026-09-28', weekEnd: '2026-10-04', label: 'Sep 28 – Oct 4, 2026', isCurrentWeek: true,
  prevStart: '2026-09-21', nextStart: '', total: 1, visitors: ['ANN'],
  days: [0, 1, 2, 3, 4, 5, 6].map(i => ({ date: '2026-10-0' + (i + 1), label: 'D' + i, count: 0 })),
  rows: [{ date: '2026-10-01', day: 'Thu', visited: '2026-09-30', store: 'SAN PEDRO', brand: "ANGEL'S PIZZA", storeId: 'STR-1', visitors: ['ANN'], purpose: 'STORE VISIT', remarks: '', recordedAt: '2026-10-01 09:00', row: 14, tsKey: '2026-10-01 09:00:02' }],
};
const STUB = (admin) => `
window.__calls = [];
window.__stub = {
  sl_isAdmin: ${admin},
  getSidebarData: { stores: [{ store: 'SAN PEDRO', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', storeId: 'STR-1' }, { store: 'URDANETA', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', storeId: 'STR-2' }], visitors: ['ANN', 'LEO'], purposes: ['STORE VISIT', 'TLTC'] },
  portal_getWeekHistory: ${JSON.stringify(WEEK)},
  portal_getVisitForEdit: { success: true, row: 14, tsKey: '2026-10-01 09:00:02', dateVisited: '2026-09-30', storeId: 'STR-1', store: 'SAN PEDRO', brand: "ANGEL'S PIZZA", visitors: ['ANN'], purpose: 'STORE VISIT', remarks: '', canVoid: true },
  portal_editVisit: { success: true, message: 'Visit updated.' },
  portal_voidVisit: { success: true, message: 'Visit voided.' },
  portal_listVoidedVisits: { success: true, rows: [{ correctionId: 'VC-1', at: '2026-10-07 10:00', by: 'leo@x', reason: 'twice', visited: '2026-09-30', store: 'SAN PEDRO', brand: "ANGEL'S PIZZA", visitors: ['ANN'], purpose: 'STORE VISIT', remarks: '' }] },
  portal_restoreVisit: { success: true, message: 'Visit restored.' },
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

  console.log('\n── Non-admin: no edit buttons ──');
  {
    const page = await browser.newPage();
    await page.addInitScript(STUB(false));
    await page.goto('file://' + PORTAL_FILE);
    await page.waitForTimeout(300);
    await page.evaluate(() => switchTab('Input'));
    await page.waitForTimeout(150);
    check('no ✏️ / 🗑 and no "voided visits" for a non-admin', (await page.$$('.wh-acts')).length === 0 && await page.evaluate(() => document.getElementById('whVoidedBtn').hidden));
    await page.close();
  }

  console.log('\n── Admin: edit, void, restore ──');
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(STUB(true));
  await page.goto('file://' + PORTAL_FILE);
  await page.waitForTimeout(300);
  await page.evaluate(() => switchTab('Input'));
  await page.waitForTimeout(150);
  const last = fn => page.evaluate(f => { const c = window.__calls.filter(x => x.fn === f); return c.length ? c[c.length - 1].args : null; }, fn);
  check('✏️ and 🗑 on the row', (await page.$$('.wh-acts button')).length === 2);
  check('"voided visits" link shown', !(await page.evaluate(() => document.getElementById('whVoidedBtn').hidden)));

  await page.click('.wh-acts button[title="Edit"]');
  await page.waitForTimeout(80);
  check('edit form asks for that row + timestamp', JSON.stringify(await last('portal_getVisitForEdit')) === '[14,"2026-10-01 09:00:02"]', await last('portal_getVisitForEdit'));
  const form = await page.evaluate(() => ({
    open: document.getElementById('veOv').classList.contains('show'),
    date: document.getElementById('veDate').value, store: document.getElementById('veStore').value,
    vis: Array.from(document.querySelectorAll('#veVisitors input:checked')).map(c => c.value).join(','),
    purpose: document.getElementById('vePurpose').value,
  }));
  check('form open, filled with the current values', form.open && form.date === '2026-09-30' && form.store === 'STR-1' && form.vis === 'ANN' && form.purpose === 'STORE VISIT', form);
  await page.selectOption('#veStore', 'STR-2');
  await page.check('#veVisitors input[value="LEO"]');
  await page.click('#veSave');
  await page.waitForTimeout(50);
  check('no reason → not sent', (await last('portal_editVisit')) === null && /reason/.test(await page.textContent('#veErr')));
  await page.fill('#veReason', 'wrong store picked');
  await page.click('#veSave');
  await page.waitForTimeout(80);
  const sent = await last('portal_editVisit');
  check('save sends row, timestamp, the changes and the reason', sent && sent[0] === 14 && sent[1] === '2026-10-01 09:00:02'
    && sent[2].storeId === 'STR-2' && sent[2].visitors.join(',') === 'ANN,LEO' && sent[3] === 'wrong store picked', sent);
  check('form closes and the week reloads', !(await page.evaluate(() => document.getElementById('veOv').classList.contains('show'))) && (await page.evaluate(() => window.__calls.filter(c => c.fn === 'portal_getWeekHistory').length)) === 2);

  page.once('dialog', d => d.accept('logged twice'));
  await page.click('.wh-acts button[title^="Void"]');
  await page.waitForTimeout(80);
  check('🗑 asks for a reason and voids that row', JSON.stringify(await last('portal_voidVisit')) === '[14,"2026-10-01 09:00:02","logged twice"]', await last('portal_voidVisit'));

  await page.click('#whVoidedBtn');
  await page.waitForTimeout(80);
  check('voided list shows the visit and why', /twice/.test(await page.textContent('#whList')) && (await page.$$('.wh-void')).length === 1);
  page.once('dialog', d => d.accept('not a duplicate'));
  await page.click('.wh-void .wh-acts button');
  await page.waitForTimeout(80);
  check('↩ restores with a reason', JSON.stringify(await last('portal_restoreVisit')) === '["VC-1","not a duplicate"]', await last('portal_restoreVisit'));

  await browser.close();
  console.log('\n══════════════════════════════════   PASS ' + pass + '   FAIL ' + fail + ' ══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
