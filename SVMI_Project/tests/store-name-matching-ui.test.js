// Phase C.1 — Store Name Matching card, end to end in a real browser.
//
// Loads the REAL SVMI_PORTAL.html (not the demo) and answers every
// google.script.run call with the REAL .gs code running in a Node vm sandbox
// (the same in-memory spreadsheet as store-name-matching.test.js). So this
// clicks through Find → choices → Preview → Apply → confirm and then checks
// the spreadsheet itself.

const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
})();
const fs = require('fs');
const path = require('path');

// Reuse the sandbox + seed from the server-side test without running its checks.
const T = path.join(__dirname, 'store-name-matching.test.js');
const testSrc = fs.readFileSync(T, 'utf8');
const lib = {};
new Function('require', '__dirname', 'lib',
  testSrc.split("console.log('\\n── Find:")[0] + '\nlib.newSandbox = newSandbox; lib.seed = seed; lib.cell = cell; lib.sheetRows = sheetRows;'
)(require, __dirname, lib);

const OUT = process.env.SVMI_TEST_OUT || require('os').tmpdir();
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); fail++; }
}

// The portal with its one server-side template tag filled in, served from a
// temp file (init scripts and exposed functions need a real navigation).
const PORTAL_FILE = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'svmi-portal-')), 'SVMI_PORTAL.html');
fs.writeFileSync(PORTAL_FILE, fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMI_PORTAL.html'), 'utf8')
  .replace("<?!= JSON.stringify(enteredPassword || '') ?>", "''"));

// google.script.run → window.__gs(fn, args) → Node sandbox. Unknown functions fail.
const SHIM = `
window.google = { script: { get run() {
  let ok = null, bad = null;
  const h = { withSuccessHandler(f) { ok = f; return p; }, withFailureHandler(f) { bad = f; return p; }, withUserObject() { return p; } };
  const p = new Proxy(h, { get(t, prop) {
    if (prop in t) return t[prop];
    if (typeof prop !== 'string') return undefined;
    return (...args) => { window.__gs(prop, args).then(r => {
      if (r && r.__error) { if (bad) bad(new Error(r.__error)); }
      else if (ok) ok(r.value);
    }); };
  } });
  return p;
} } };`;

async function openTools(page) {
  await page.waitForFunction(() => !document.getElementById('smtFindBtn').hidden, null, { timeout: 5000 });
  await page.evaluate(() => { switchTab('Admin'); switchAdminSub('tools'); });
}

(async () => {
  const browser = await chromium.launch();

  // env.delays[fnName] = ms makes that server call answer late (to test
  // what the page does while a call is still running).
  async function newPage(env, viewport) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.exposeFunction('__gs', async (fn, args) => {
      const f = env.sandbox[fn];
      if (typeof f !== 'function') return { __error: 'not in this test backend: ' + fn };
      try {
        const v = f.apply(null, args);
        if (env.delays && env.delays[fn]) await new Promise(r => setTimeout(r, env.delays[fn]));
        return { value: v === undefined ? null : JSON.parse(JSON.stringify(v)) };
      } catch (e) { return { __error: e.message }; }
    });
    await page.addInitScript(SHIM);
    await page.goto('file://' + PORTAL_FILE);
    return { page, errors, ctx };
  }

  // ── Desktop: the whole Sta. Maria flow ──────────────────────────────
  console.log('\n── Find → choose → Preview → Apply (desktop) ──');
  {
    const env = lib.newSandbox();
    const ids = lib.seed(env);
    let applyCalls = 0;
    const realApply = env.sandbox.portal_applyStoreCleanupDecision;
    env.sandbox.portal_applyStoreCleanupDecision = function (d) { applyCalls++; return realApply(d); };

    const { page, errors } = await newPage(env, { width: 1280, height: 900 });
    await openTools(page);
    check('card is on the Tools tab', await page.isVisible('#smtFindBtn'));

    await page.click('#smtFindBtn');
    await page.waitForSelector('#smtPreviewBtn', { timeout: 5000 });
    const stat = await page.textContent('#stat-SMT');
    check('status line counts what it found', /3 name\(s\) with no store \(4 visits\) · 2 store\(s\) to review/.test(stat), stat);
    check('STA. MARIA (F) defaults to "Same store as"', await page.inputValue('#smtUAct-1') === 'map', await page.inputValue('#smtUAct-1'));
    check('…pre-selected to the older Figaro store', await page.inputValue('#smtUStore-1') === ids.K, await page.inputValue('#smtUStore-1'));
    check('★ marks the strong suggestion', (await page.textContent('#smtUStore-1')).includes('★ SANTA MARIA · FIGARO'));
    check('SHANGRILA defaults to "New store — closed"', await page.inputValue('#smtUAct-0') === 'closed');
    check('…with NCR / NCR and closed-from = day after last visit', await page.inputValue('#smtURegion-0') === 'NCR' && await page.inputValue('#smtUCat-0') === 'NCR' && await page.inputValue('#smtUClosed-0') === '2026-05-29',
      [await page.inputValue('#smtURegion-0'), await page.inputValue('#smtUCat-0'), await page.inputValue('#smtUClosed-0')]);
    check('closed-from hidden when "still open" is picked', await (async () => { await page.selectOption('#smtUAct-0', 'open'); const hidden = !(await page.isVisible('#smtUClosed-0')); await page.selectOption('#smtUAct-0', 'closed'); return hidden; })());
    const groupText = await page.textContent('.smt-group');
    check('duplicate group lists both Figaro stores', /SANTA MARIA/.test(groupText) && /STA MARIA/.test(groupText) && /Possible duplicate/.test(groupText), groupText.slice(0, 200));
    check('group name pre-filled STA. MARIA (F)', await page.inputValue('#smtGName-0') === 'STA. MARIA (F)');
    check('groups default to Skip (nothing merges unless chosen)', await page.inputValue('#smtGAct-0') === 'skip' && await page.inputValue('#smtGAct-1') === 'skip');
    check('Keep radio pre-selected on SANTA MARIA', await page.$eval('input[name="smtGKeep-0"]:checked', el => el.value) === ids.K);

    // Choose: merge Sta. Maria; one name for SAN PEDRO; URDANETA FIGARO category check
    await page.selectOption('#smtGAct-0', 'merge');
    await page.selectOption('#smtGAct-1', 'merge');
    check('URDANETA FIGARO category pre-filled from AP URDANETA', await page.inputValue('#smtUCat-2') === 'FAR PROVINCIAL', await page.inputValue('#smtUCat-2'));
    await page.screenshot({ path: path.join(OUT, 'smt-desktop-choices.png'), fullPage: false });

    await page.click('#smtPreviewBtn');
    await page.waitForSelector('#smtApplyBtn', { timeout: 5000 });
    const plans = await page.$$eval('.smt-plan', els => els.map(e => e.textContent));
    check('preview shows 5 planned changes, all OK', plans.length === 5 && plans.every(t => t.startsWith('✅')), plans);
    check('merge listed first', /^✅ Merge \/ one name: SANTA MARIA \(FIGARO\)/.test(plans[0]), plans[0]);
    check('Apply button counts changes and rows', /Apply 5 changes \(9 MASTER_LOG rows\)/.test(await page.textContent('#smtApplyBtn')), await page.textContent('#smtApplyBtn'));
    check('preview wrote nothing', applyCalls === 0 && lib.cell(env, 2, 3) === 'SANTA MARIA');

    // Editing after a preview hides Apply until previewed again
    await page.fill('#smtGName-0', 'STA. MARIA (F) ');
    check('editing after preview drops the Apply button', !(await page.$('#smtApplyBtn')));
    await page.click('#smtPreviewBtn');
    await page.waitForSelector('#smtApplyBtn', { timeout: 5000 });
    await page.screenshot({ path: path.join(OUT, 'smt-desktop-preview.png'), fullPage: false });

    await page.click('#smtApplyBtn');
    await page.waitForSelector('#confirmOv.show', { timeout: 3000 });
    check('confirm dialog asks first', /Apply 5 store changes\?/.test(await page.textContent('#confirmTitle')));
    check('nothing applied before confirming', applyCalls === 0);
    await page.click('#confirmGo');
    await page.waitForFunction(() => /Find again/.test(document.getElementById('smtPanel').textContent), null, { timeout: 15000 });
    const done = await page.textContent('#stat-SMT');
    check('status: all 5 applied, 9 rows, tables in sync', /5 of 5 change\(s\) applied · 9 MASTER_LOG row\(s\) updated · Visit tables: In sync/.test(done), done);
    check('server received exactly 5 apply calls', applyCalls === 5, applyCalls);
    await page.screenshot({ path: path.join(OUT, 'smt-desktop-result.png'), fullPage: false });

    const s = env.sandbox;
    check('spreadsheet: Figaro store renamed STA. MARIA (F)', s.store_getById(ids.K).fields.storeName === 'STA. MARIA (F)');
    check('spreadsheet: duplicate retired', !s.store_getById(ids.M));
    check('spreadsheet: all 5 Sta. Maria rows on the kept Store ID', [2, 3, 4, 5, 6].every(r => lib.cell(env, r, 9) === ids.K && lib.cell(env, r, 3) === 'STA. MARIA (F)'));
    check('spreadsheet: SHANGRILA rows have a Store ID', /^STR-/.test(lib.cell(env, 8, 9)) && lib.cell(env, 8, 9) === lib.cell(env, 9, 9));
    check('spreadsheet: SM SAN PEDRO row now SAN PEDRO', lib.cell(env, 10, 3) === 'SAN PEDRO' && lib.cell(env, 10, 9) === ids.SP);
    const logText = await page.textContent('#actLog');
    check('activity log has a line per change', (logText.match(/Store Name Matching:/g) || []).length >= 6, logText.slice(0, 300));

    await page.click('text=🔍 Find again');
    await page.waitForFunction(() => /nothing to fix/.test(document.getElementById('stat-SMT').textContent), null, { timeout: 5000 });
    check('Find again: nothing left', true);
    check('no page errors', errors.length === 0, errors);
  }

  // ── A failure stops the batch ───────────────────────────────────────
  console.log('\n── A failed change stops the rest ──');
  {
    const env = lib.newSandbox(); lib.seed(env);
    let applyCalls = 0;
    const realApply = env.sandbox.portal_applyStoreCleanupDecision;
    env.sandbox.portal_applyStoreCleanupDecision = function (d) {
      applyCalls++;
      return applyCalls === 1 ? { success: false, message: 'simulated: a visit is being saved' } : realApply(d);
    };
    const { page, errors } = await newPage(env, { width: 1280, height: 900 });
    await openTools(page);
    await page.click('#smtFindBtn');
    await page.waitForSelector('#smtPreviewBtn', { timeout: 5000 });
    await page.selectOption('#smtGAct-0', 'merge');
    await page.click('#smtPreviewBtn');
    await page.waitForSelector('#smtApplyBtn', { timeout: 5000 });
    await page.click('#smtApplyBtn');
    await page.waitForSelector('#confirmOv.show', { timeout: 3000 });
    await page.click('#confirmGo');
    await page.waitForFunction(() => /Find again/.test(document.getElementById('smtPanel').textContent), null, { timeout: 15000 });
    const stat = await page.textContent('#stat-SMT');
    check('only the first change was sent', applyCalls === 1, applyCalls);
    check('status: 0 of 4 applied, 1 failed, 3 not run', /0 of 4 change\(s\) applied/.test(stat) && /1 failed/.test(stat) && /3 not run/.test(stat), stat);
    check('the not-run changes are listed', (await page.$$eval('.smt-plan', els => els.filter(e => e.textContent.indexOf('Not run') !== -1).length)) === 3);
    check('MASTER_LOG untouched', lib.cell(env, 5, 9) === '' && lib.cell(env, 8, 9) === '');
    check('no page errors', errors.length === 0, errors);
  }

  // ── Split by brand from the page; an edit during Preview is caught ──
  console.log('\n── Split by brand · edit while Preview runs ──');
  {
    const env = lib.newSandbox(); lib.seed(env);
    const SD = env.SDate;
    env.master.appendRow([new SD(2026, 2, 6, 9), new SD(2026, 2, 6), 'GLORIETTA', "ANGEL'S PIZZA", 'NCR', 'LEO', 'STORE VISIT', '', '']);
    env.master.appendRow([new SD(2026, 2, 11, 9), new SD(2026, 2, 11), 'GLORIETTA', 'FIGARO', 'NCR', 'ANN', 'STORE VISIT', '', '']);
    const { page, errors } = await newPage(env, { width: 1280, height: 900 });
    await openTools(page);
    await page.click('#smtFindBtn');
    await page.waitForSelector('#smtPreviewBtn', { timeout: 5000 });
    const row = await page.$$eval('#smtPanel .smt-tbl tbody tr', trs => trs.map(t => t.querySelector('b').textContent).indexOf('GLORIETTA'));
    check('GLORIETTA listed', row >= 0, row);
    check('two-brand name offers only Split / Skip, Split selected', JSON.stringify(await page.$$eval('#smtUAct-' + row + ' option', o => o.map(x => x.value))) === '["split","skip"]' && await page.inputValue('#smtUAct-' + row) === 'split');
    check('Angel\'s Pizza keeps the name by default', await page.inputValue('#smtUKeepBrand-' + row) === "ANGEL'S PIZZA");
    check('hint shows both brands', /ANGEL'S PIZZA ×1 · FIGARO ×1/.test(await page.textContent('#smtPanel .smt-tbl tbody tr:nth-child(' + (row + 1) + ')')));
    // set everything else to Skip so only the split runs
    const n = await page.$$eval('[id^="smtUAct-"]', els => els.length);
    for (let i = 0; i < n; i++) if (i !== row) await page.selectOption('#smtUAct-' + i, 'skip');

    env.delays = { portal_previewStoreCleanup: 700 };
    await page.click('#smtPreviewBtn');
    await page.selectOption('#smtUKeepBrand-' + row, 'FIGARO');   // changed while the preview is running
    await page.waitForFunction(() => /Changed while checking/.test(document.getElementById('smtResult').textContent), null, { timeout: 5000 });
    check('an edit made during Preview is caught — no Apply button', !(await page.$('#smtApplyBtn')));
    env.delays = {};
    await page.selectOption('#smtUKeepBrand-' + row, "ANGEL'S PIZZA");
    await page.click('#smtPreviewBtn');
    await page.waitForSelector('#smtApplyBtn', { timeout: 5000 });
    check('split previewed', /Split by brand: GLORIETTA/.test(await page.textContent('#smtResult')) && /→ name "GLORIETTA \(F\)"/.test(await page.textContent('#smtResult')));
    await page.click('#smtApplyBtn');
    await page.waitForSelector('#confirmOv.show', { timeout: 3000 });
    await page.click('#confirmGo');
    await page.waitForFunction(() => /Find again/.test(document.getElementById('smtPanel').textContent), null, { timeout: 15000 });
    check('Figaro visit renamed GLORIETTA (F) in MASTER_LOG', lib.cell(env, 14, 3) === 'GLORIETTA (F)' && lib.cell(env, 13, 3) === 'GLORIETTA', [lib.cell(env, 13, 3), lib.cell(env, 14, 3)]);
    await page.click('text=🔍 Find again');
    await page.waitForSelector('#smtPreviewBtn', { timeout: 5000 });
    const names = await page.$$eval('#smtPanel .smt-tbl tbody tr b', bs => bs.map(b => b.textContent));
    check('Find again lists GLORIETTA and GLORIETTA (F) separately', names.indexOf('GLORIETTA') !== -1 && names.indexOf('GLORIETTA (F)') !== -1, names);
    check('no page errors', errors.length === 0, errors);
  }

  // ── Phone width: usable, no sideways page scroll ────────────────────
  console.log('\n── Phone (390px) ──');
  {
    const env = lib.newSandbox(); lib.seed(env);
    const { page, errors } = await newPage(env, { width: 390, height: 844 });
    await openTools(page);
    await page.click('#smtFindBtn');
    await page.waitForSelector('#smtPreviewBtn', { timeout: 5000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('page does not scroll sideways (tables scroll inside their box)', overflow <= 1, overflow);
    await page.screenshot({ path: path.join(OUT, 'smt-phone.png'), fullPage: false });
    check('no page errors', errors.length === 0, errors);
  }

  // ── Not an admin: no button, server refuses anyway ──────────────────
  console.log('\n── Not an admin ──');
  {
    const env = lib.newSandbox(); lib.seed(env);
    env.state.isAdmin = false;
    const { page } = await newPage(env, { width: 1280, height: 900 });
    await page.waitForTimeout(400);
    await page.evaluate(() => { switchTab('Admin'); switchAdminSub('tools'); });
    check('Find button hidden', !(await page.isVisible('#smtFindBtn')));
    check('lock message shown', await page.isVisible('#lock-SMT'));
    const r = await page.evaluate(() => new Promise(res => google.script.run.withSuccessHandler(res).portal_getStoreCleanup()));
    check('a direct call is refused by the server', r && !r.success && /Admin/.test(r.message), r);
  }

  await browser.close();
  console.log('\n══════════════════════════════════');
  console.log('  PASS ' + pass + '   FAIL ' + fail);
  console.log('  screenshots: ' + OUT + '/smt-*.png');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
