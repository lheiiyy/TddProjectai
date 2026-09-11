// Playwright ships with this environment; fall back to a local install elsewhere.
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) {}
  }
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
})();
const path = require('path');

// Resolved relative to this file so the suite runs from any checkout.
const URL = 'file://' + path.resolve(__dirname, '..', 'SVMI_Command_Center_Demo.html');
const OUT = process.env.SVMI_TEST_OUT || require('os').tmpdir();   // screenshots land here

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); fail++; }
}

(async () => {
  const browser = await chromium.launch();

  // ─────────────────────────────────────────────────────────
  // DESKTOP
  // ─────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL);
  await page.waitForTimeout(1200);   // mock backend has a simulated 260-680ms delay

  console.log('\n── Tab labels ──');
  check('Tab renamed to "Unvisited This Month"',
    (await page.textContent('#tab-Visits')).includes('Unvisited This Month'),
    await page.textContent('#tab-Visits'));

  console.log('\n── Input: store dropdown shows brand ──');
  await page.click('#storeSearch');
  await page.fill('#storeSearch', 'MAKATI');
  await page.waitForTimeout(150);
  const optHtml = await page.innerHTML('#storeDrop');
  check('store option renders a brand badge', optHtml.includes('opt-brand'));
  check('brand text present in dropdown', /ANGEL/i.test(optHtml), optHtml.slice(0, 200));

  // search by BRAND, not just store name
  await page.fill('#storeSearch', 'KOOBIDEH');
  await page.waitForTimeout(150);
  const brandSearch = await page.$$eval('#storeDrop .ss-opt', els => els.map(e => e.dataset.v));
  check('searching by brand returns that brand\'s stores', brandSearch.length > 0,
    JSON.stringify(brandSearch).slice(0, 160));

  console.log('\n── Input: keyboard flow ──');
  await page.fill('#storeSearch', 'BGC');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');
  const activeCount = await page.$$eval('#storeDrop .ss-opt.active', e => e.length);
  check('ArrowDown highlights an option', activeCount === 1, 'active=' + activeCount);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const storeVal = await page.inputValue('#storeVal');
  check('Enter commits the highlighted store', storeVal.includes('BGC'), storeVal);
  const focusedAfterEnter = await page.evaluate(() => document.activeElement.id);
  check('Enter advances focus to Date', focusedAfterEnter === 'dateVisited', 'focus=' + focusedAfterEnter);
  check('store info panel is shown', await page.isVisible('#storeInfo'));

  // Enter on date advances to visitors
  await page.keyboard.press('Enter');
  const focusVis = await page.evaluate(() => document.activeElement.id);
  check('Enter on Date advances to Visited By', focusVis === 'visSearch', 'focus=' + focusVis);

  // pick two visitors by keyboard, stay in field
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const focusStill = await page.evaluate(() => document.activeElement.id);
  check('visitor pick keeps focus in the visitor box (multi-select)', focusStill === 'visSearch', 'focus=' + focusStill);
  let chips = await page.$$eval('#chipArea .chip', e => e.length);
  check('one visitor chip added', chips === 1, 'chips=' + chips);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  chips = await page.$$eval('#chipArea .chip', e => e.length);
  check('second visitor chip added', chips === 2, 'chips=' + chips);

  // Backspace on empty box removes last chip
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  chips = await page.$$eval('#chipArea .chip', e => e.length);
  check('Backspace in empty box removes last chip', chips === 1, 'chips=' + chips);

  console.log('\n── Input: Visited By is one control ──');
  check('chips and the input share one box',
    (await page.$$eval('#chipArea .chip', e => e.length)) > 0
    && (await page.$eval('#chipArea #visSearch', e => !!e)),
    'chips or input not inside #chipArea');
  check('no separate hint line under the field',
    (await page.$$eval('.fg .hint', e => e.filter(x => /Backspace in an empty box/.test(x.textContent)).length)) === 0);
  // typing must survive a chip re-render (chips live in their own holder)
  await page.click('#visSearch');
  await page.type('#visSearch', 'JO');
  const focusDuring = await page.evaluate(() => document.activeElement.id);
  check('focus stays in the input while chips are present', focusDuring === 'visSearch', 'focus=' + focusDuring);
  await page.fill('#visSearch', '');
  await page.keyboard.press('Escape');        // the open list would cover the next target
  await page.waitForTimeout(150);
  // clicking blank space in the box focuses the input
  await page.click('#remarks');
  await page.waitForTimeout(150);
  await page.click('#chipArea', { position: { x: 200, y: 12 } });
  const focusAfterBoxClick = await page.evaluate(() => document.activeElement.id);
  check('clicking the box focuses the input', focusAfterBoxClick === 'visSearch', 'focus=' + focusAfterBoxClick);
  // the chip × still removes just that one
  const beforeX = await page.$$eval('#chipArea .chip', e => e.length);
  await page.click('#chipArea .chip-x');
  await page.waitForTimeout(150);
  check('chip × removes only that visitor',
    (await page.$$eval('#chipArea .chip', e => e.length)) === beforeX - 1);
  // put one back so the later "survives a per-field clear" checks have state to test
  await page.click('#visSearch');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);

  console.log('\n── Input: purpose is now selectable/typeable ──');
  await page.click('#purpSearch');
  const isReadonly = await page.getAttribute('#purpSearch', 'readonly');
  check('purpose field is no longer readonly', isReadonly === null, 'readonly=' + isReadonly);
  await page.fill('#purpSearch', 'TLTC');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check('purpose committed', (await page.inputValue('#purpVal')) === 'TLTC', await page.inputValue('#purpVal'));

  console.log('\n── Input: per-field clear (does NOT wipe the rest) ──');
  check('store clear button is visible', await page.isVisible('#storeX'));
  await page.click('#storeX');
  await page.waitForTimeout(120);
  check('store cleared', (await page.inputValue('#storeVal')) === '');
  check('purpose SURVIVED clearing store', (await page.inputValue('#purpVal')) === 'TLTC',
    await page.inputValue('#purpVal'));
  chips = await page.$$eval('#chipArea .chip', e => e.length);
  check('visitors SURVIVED clearing store', chips === 1, 'chips=' + chips);

  await page.keyboard.press('Escape');   // clearing store refocuses it and opens its list
  await page.waitForTimeout(150);
  await page.click('#purpClear');
  await page.waitForTimeout(120);
  check('purpose cleared on its own', (await page.inputValue('#purpVal')) === '');
  chips = await page.$$eval('#chipArea .chip', e => e.length);
  check('visitors still survive', chips === 1, 'chips=' + chips);

  console.log('\n── Type-then-Enter commits (regression: used to leave fields empty) ──');
  await page.click('button.btn-clear');   // Clear All Fields — start from a known state
  await page.waitForTimeout(200);

  // PURPOSE: "S" matches STORE VISIT, FAILED QA/MS and CURING/SUPPORT.
  // Ambiguous match used to advance with the field left empty.
  await page.click('#purpSearch');
  await page.fill('#purpSearch', 'S');
  await page.waitForTimeout(200);
  const sMatches = await page.$$eval('#purpDrop .ss-opt', e => e.length);
  check('"S" really is an ambiguous purpose match', sMatches > 1, 'opts=' + sMatches);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const purpAfter = await page.inputValue('#purpVal');
  check('ambiguous type+Enter COMMITS a purpose (was empty)', purpAfter !== '', 'purpVal="' + purpAfter + '"');
  check('purpose box shows what was committed', (await page.inputValue('#purpSearch')) === purpAfter);
  check('and focus advanced to Remarks',
    (await page.evaluate(() => document.activeElement.id)) === 'remarks');

  // exact text still wins over "first hit"
  await page.fill('#purpSearch', 'TLTC');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('exact text commits that exact purpose', (await page.inputValue('#purpVal')) === 'TLTC',
    await page.inputValue('#purpVal'));

  // garbage must NOT commit something unrelated (purpose falls back to the full list)
  await page.click('#purpSearch');
  await page.fill('#purpSearch', 'ZZZZ');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('unmatched text commits nothing', (await page.inputValue('#purpVal')) === 'TLTC',
    'purpVal="' + (await page.inputValue('#purpVal')) + '"');

  // STORE: ambiguous prefix
  await page.click('#storeX').catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.fill('#storeSearch', 'CA');
  await page.waitForTimeout(200);
  const caMatches = await page.$$eval('#storeDrop .ss-opt', e => e.length);
  check('"CA" is an ambiguous store match', caMatches > 1, 'opts=' + caMatches);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  check('ambiguous store type+Enter commits a store', (await page.inputValue('#storeVal')) !== '',
    'storeVal="' + (await page.inputValue('#storeVal')) + '"');
  check('store box matches the committed store',
    (await page.inputValue('#storeSearch')) === (await page.inputValue('#storeVal')));

  // STORE by brand: the matched text lives in the brand, not the store name
  await page.click('#storeX');
  await page.waitForTimeout(150);
  await page.fill('#storeSearch', 'KOOBIDEH');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const brandPicked = await page.inputValue('#storeVal');
  check('typing a BRAND commits one of that brand\'s stores', brandPicked !== '', 'storeVal="' + brandPicked + '"');
  check('and its brand really is the one typed',
    (await page.textContent('#iBrand')) === 'KOOBIDEH', await page.textContent('#iBrand'));

  // VISITED BY: ambiguous partial should add a visitor, not skip past
  const chipsBefore = await page.$$eval('#chipArea .chip', e => e.length);
  await page.click('#visSearch');
  await page.fill('#visSearch', 'A');
  await page.waitForTimeout(200);
  const aMatches = await page.$$eval('#visDrop .ss-opt', e => e.length);
  check('"A" is an ambiguous visitor match', aMatches > 1, 'opts=' + aMatches);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('ambiguous visitor type+Enter adds a chip',
    (await page.$$eval('#chipArea .chip', e => e.length)) === chipsBefore + 1);

  console.log('\n── Blur reconciles the box against the committed value ──');
  // typed-but-uncommitted ambiguous text must not linger as a phantom
  await page.click('#storeX');
  await page.waitForTimeout(150);
  await page.fill('#storeSearch', 'CA');
  await page.waitForTimeout(200);
  await page.click('#remarks');
  await page.waitForTimeout(500);
  check('ambiguous text does not linger in the box after blur',
    (await page.inputValue('#storeSearch')) === (await page.inputValue('#storeVal')),
    'box="' + (await page.inputValue('#storeSearch')) + '" val="' + (await page.inputValue('#storeVal')) + '"');

  // unambiguous typed text commits on blur rather than being thrown away
  await page.fill('#storeSearch', 'BAGUIO CITY');
  await page.waitForTimeout(200);
  await page.click('#remarks');
  await page.waitForTimeout(500);
  check('unambiguous text commits on blur instead of vanishing',
    (await page.inputValue('#storeVal')) === 'BAGUIO CITY', await page.inputValue('#storeVal'));

  // emptying the box by hand drops the committed value too
  await page.fill('#storeSearch', '');
  await page.click('#remarks');
  await page.waitForTimeout(500);
  check('clearing the box clears the committed value',
    (await page.inputValue('#storeVal')) === '', await page.inputValue('#storeVal'));

  console.log('\n── Tab commits what was typed ──');
  await page.fill('#purpSearch', '');
  await page.click('#purpSearch');
  await page.fill('#purpSearch', 'CUR');
  await page.waitForTimeout(200);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  check('Tab commits the typed match', (await page.inputValue('#purpVal')) === 'CURING/SUPPORT',
    await page.inputValue('#purpVal'));

  await page.click('button.btn-clear');   // leave a clean slate for later sections
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');

  console.log('\n── Store Insights: single combobox store picker ──');
  await page.click('#tab-Insights');
  await page.waitForTimeout(300);
  check('the old <select> is gone', (await page.$('#siSel')) === null);
  check('exactly one visible text input in the sidebar',
    (await page.$$eval('.si-side input:not([type=hidden])', e => e.length)) === 1);

  // focus alone browses the whole roster
  await page.click('#siSearch');
  await page.waitForTimeout(200);
  const allOpts = await page.$$eval('#siDrop .ss-opt', e => e.length);
  check('focus opens the full list (browsable like a dropdown)', allOpts > 5, 'opts=' + allOpts);
  check('rows show a brand badge', (await page.innerHTML('#siDrop')).includes('opt-brand'));

  // typing narrows it — including by brand
  await page.fill('#siSearch', 'CEBU');
  await page.waitForTimeout(200);
  const typed = await page.$$eval('#siDrop .ss-opt', e => e.map(x => x.dataset.v));
  check('typing filters the same control', typed.length > 0 && typed.every(v => /CEBU/i.test(v)),
    JSON.stringify(typed));

  await page.fill('#siSearch', 'FIGARO');
  await page.waitForTimeout(200);
  const byBrand = await page.$$eval('#siDrop .ss-opt', e => e.length);
  check('typing a brand name also filters', byBrand > 0, 'opts=' + byBrand);

  // keyboard: arrow + enter picks AND loads the profile
  await page.fill('#siSearch', 'BAGUIO');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  check('Enter commits the store', (await page.inputValue('#siStore')).includes('BAGUIO'),
    await page.inputValue('#siStore'));
  const siLoaded = await page.textContent('#siMain');
  check('picking loads the profile with no extra click', /BAGUIO/.test(siLoaded), siLoaded.slice(0, 90));

  // clear resets it
  check('clear button visible once a store is set', await page.isVisible('#siX'));
  await page.click('#siX');
  await page.waitForTimeout(150);
  check('clear empties the picker', (await page.inputValue('#siStore')) === ''
    && (await page.inputValue('#siSearch')) === '');
  check('View Profile disabled again after clear',
    await page.isDisabled('#siBtn'));

  // cross-tab jump still works (it used to drive the <select>)
  await page.click('#tab-Visits');
  await page.waitForTimeout(1400);
  const link = await page.$('#visitsPanel .store-link');
  if (link) {
    const linkName = (await link.textContent()).trim();
    await link.click();
    await page.waitForTimeout(1300);
    check('jumpToStore from another tab still loads a profile',
      (await page.inputValue('#siStore')) === linkName, await page.inputValue('#siStore'));
  } else {
    check('jumpToStore from another tab still loads a profile', false, 'no store-link found to click');
  }

  console.log('\n── Store Insights: VISITED list ──');
  await page.click('#tab-Insights');
  await page.click('button.btn-navy');
  await page.waitForTimeout(1000);
  const siText = await page.textContent('#siMain');
  check('shows "Stores Visited This Month"', /Stores Visited This Month/.test(siText), siText.slice(0, 120));
  const hint = await page.textContent('#coverageHint');
  check('hint reads "visited this month"', /visited this month/.test(hint), hint);
  const visitedRows = await page.$$eval('#siMain tbody tr', e => e.length);
  check('visited table has rows', visitedRows > 0, 'rows=' + visitedRows);
  // header text now carries the sort arrow + filter glyph, so match on contains
  const hdrs = await page.$$eval('#siMain thead th', e => e.map(x => x.textContent.replace(/[▲▼]/g, '').trim()));
  check('has Visits + Visited By columns', hdrs.includes('Visits') && hdrs.includes('Visited By'),
    JSON.stringify(hdrs));

  console.log('\n── Store Insights: header filters on the visited table ──');
  await page.click('#tab-Insights');
  await page.click('button.btn-navy');
  await page.waitForTimeout(1200);
  const visTotal = await page.$$eval('#ftTbl-vis tbody tr', e => e.length);
  check('visited table rendered through the shared engine', visTotal > 1, 'rows=' + visTotal);
  const visFhBtns = await page.$$eval('#ftTbl-vis .fh-btn', e => e.length);
  check('visited headers have filter buttons', visFhBtns === 7, 'buttons=' + visFhBtns);

  // set filter on Brand
  await page.click('#ftTbl-vis .fh-btn[onclick*="\'brand\'"]');
  await page.waitForTimeout(250);
  const visBoxes = await page.$$eval('.colfBox', e => e.map(x => x.value));
  check('brand values listed for the visited table', visBoxes.length >= 2, JSON.stringify(visBoxes));
  for (let i = 1; i < visBoxes.length; i++) await page.uncheck(`.colfBox >> nth=${i}`);
  await page.waitForTimeout(350);
  const visBrands = await page.$$eval('#ftTbl-vis tbody tr td:nth-child(3)', e => [...new Set(e.map(x => x.textContent.trim()))]);
  check('visited table filters by brand', visBrands.length === 1 && visBrands[0] === visBoxes[0],
    JSON.stringify(visBrands));
  check('summary line notes the filtering', /filtered to/.test(await page.textContent('#visSummary')),
    await page.textContent('#visSummary'));
  check('sidebar hint notes the filtering', /filtered/.test(await page.textContent('#coverageHint')),
    await page.textContent('#coverageHint'));
  await page.click('.colf-clear');
  await page.waitForTimeout(300);
  check('clearing restores every visited row',
    (await page.$$eval('#ftTbl-vis tbody tr', e => e.length)) === visTotal);

  // numeric filter on Visits
  await page.click('#ftTbl-vis .fh-btn[onclick*="\'visits\'"]');
  await page.waitForTimeout(250);
  await page.fill('#colfMin', '2');
  await page.waitForTimeout(350);
  const visCounts = await page.$$eval('#ftTbl-vis tbody tr td:nth-child(5)', e => e.map(x => Number(x.textContent.trim())));
  check('visits min filter applies', visCounts.every(v => v >= 2), JSON.stringify(visCounts));
  await page.click('.colf-clear');
  await page.waitForTimeout(300);

  // Last Visit sorts chronologically, not alphabetically
  await page.click('#ftTbl-vis .fh-lbl >> nth=5');
  await page.waitForTimeout(300);
  const order1 = await page.$$eval('#ftTbl-vis tbody tr td:nth-child(6)', e => e.map(x => Date.parse(x.textContent.trim())));
  check('Last Visit sorts by real date (ascending)',
    order1.every((v, i) => i === 0 || order1[i - 1] <= v),
    JSON.stringify(order1.map(t => new Date(t).toISOString().slice(0, 10))));
  await page.click('#ftTbl-vis .fh-lbl >> nth=5');
  await page.waitForTimeout(300);
  const order2 = await page.$$eval('#ftTbl-vis tbody tr td:nth-child(6)', e => e.map(x => Date.parse(x.textContent.trim())));
  check('and reverses', order2.every((v, i) => i === 0 || order2[i - 1] >= v));

  // the two tables keep independent filter state
  await page.click('#ftTbl-vis .fh-btn[onclick*="\'region\'"]');
  await page.waitForTimeout(250);
  const rBoxes = await page.$$eval('.colfBox', e => e.length);
  for (let i = 1; i < rBoxes; i++) await page.uncheck(`.colfBox >> nth=${i}`);
  await page.waitForTimeout(350);
  const visFilteredCount = await page.$$eval('#ftTbl-vis tbody tr', e => e.length);
  await page.click('#tab-Visits');
  await page.waitForTimeout(1400);
  const compUnaffected = await page.$$eval('#ftTbl-comp tbody tr', e => e.length);
  check('filtering one table does not leak into the other',
    compUnaffected > visFilteredCount || compUnaffected > 0, 'comp=' + compUnaffected + ' vis=' + visFilteredCount);
  check('Unvisited tab has no active filter markers',
    (await page.$$eval('#ftTbl-comp .fh-btn.on', e => e.length)) === 0);

  console.log('\n── System Tools: order + confirmation ──');
  await page.click('#tab-Tools');
  await page.waitForTimeout(200);
  const toolTitles = await page.$$eval('.tool-card .tool-title', e => e.map(x => x.textContent));
  check('1st card = Store Master Insight', toolTitles[0] === 'Store Master Insight', toolTitles[0]);
  check('2nd card = Store Health', toolTitles[1] === 'Store Health', toolTitles[1]);
  console.log('    order: ' + JSON.stringify(toolTitles));

  // destructive tool asks first
  await page.click('button[onclick*="rebuildStoreMaster"]');
  await page.waitForTimeout(200);
  check('destructive tool opens a confirmation', await page.isVisible('#confirmOv'));
  const cTitle = await page.textContent('#confirmTitle');
  check('confirm names the tool', /Store Master Insight/.test(cTitle), cTitle);
  const statBefore = await page.textContent('#stat-SMI');
  check('tool did NOT run before confirming', statBefore === 'Ready', statBefore);

  await page.click('#confirmOv .dup-cancel');
  await page.waitForTimeout(150);
  check('cancel closes without running', !(await page.isVisible('#confirmOv'))
    && (await page.textContent('#stat-SMI')) === 'Ready');

  await page.click('button[onclick*="rebuildStoreMaster"]');
  await page.waitForTimeout(200);
  await page.click('#confirmGo');
  await page.waitForTimeout(1200);
  const statAfter = await page.textContent('#stat-SMI');
  check('proceeding actually runs the tool', /rebuilt/i.test(statAfter), statAfter);

  console.log('\n── System Tools: soft "update" vs hard "warn" tone ──');
  for (const [tool, stat] of [['rebuildStoreMaster','stat-SMI'], ['rebuildStoreHealth','stat-SH']]) {
    await page.click(`button[onclick*="${tool}"]`);
    await page.waitForTimeout(200);
    const t = await page.textContent('#confirmTitle');
    const b = await page.textContent('#confirmBody');
    const g = await page.textContent('#confirmGo');
    const icon = await page.textContent('#confirmIcon');
    const goClass = await page.getAttribute('#confirmGo', 'class');
    check(tool + ': says "Update", not "Rebuild"', t.startsWith('Update ') && g.startsWith('Update '), t + ' / ' + g);
    check(tool + ': soft body, no version-history scare', /Confirm to update/.test(b) && !/cannot be undone/.test(b), b.slice(0,80));
    check(tool + ': neutral icon + button', icon === '🔄' && /update/.test(goClass), icon + ' / ' + goClass);
    await page.click('#confirmOv .dup-cancel');
    await page.waitForTimeout(120);
  }

  for (const [tool, stat] of [['rebuildExecutiveSummary','stat-ES'], ['rebuildDataHeaders','stat-DH']]) {
    await page.click(`button[onclick*="${tool}"]`);
    await page.waitForTimeout(200);
    const t = await page.textContent('#confirmTitle');
    const b = await page.textContent('#confirmBody');
    const icon = await page.textContent('#confirmIcon');
    const goClass = await page.getAttribute('#confirmGo', 'class');
    check(tool + ': keeps hard "Rebuild" warning', t.startsWith('Rebuild ') && /cannot be undone/.test(b), t);
    check(tool + ': warning icon + red button', icon === '⚠️' && !/update/.test(goClass), icon + ' / ' + goClass);
    await page.click('#confirmOv .dup-cancel');
    await page.waitForTimeout(120);
  }

  // soft confirm still actually runs the tool when accepted
  await page.click('button[onclick*="rebuildStoreHealth"]');
  await page.waitForTimeout(200);
  await page.click('#confirmGo');
  await page.waitForTimeout(1200);
  check('soft confirm still runs the tool', /refreshed|rebuilt/i.test(await page.textContent('#stat-SH')),
    await page.textContent('#stat-SH'));

  // read-only tool runs with no prompt
  await page.click('button[onclick*="validateMasterLog"]');
  await page.waitForTimeout(300);
  check('read-only Validate skips the prompt', !(await page.isVisible('#confirmOv')));
  await page.waitForTimeout(1000);
  const valStat = await page.textContent('#stat-VAL');
  check('validation produced a result', /Validation/i.test(valStat), valStat);

  await page.screenshot({ path: OUT + '/desktop-tools.png' });

  console.log('\n── Input: Visited By reads as a dropdown ──');
  await page.click('#tab-Input');
  await page.waitForTimeout(200);
  const carets = await page.$$eval('.combo-caret', e => e.length);
  check('every combobox has a caret (store, visitors, purpose, SI store)', carets === 4, 'carets=' + carets);
  // caret opens the visitor list without typing anything
  const visCaret = await page.$('#visDrop ~ * , .ss-wrap:has(#visSearch) .combo-caret');
  await page.click('.ss-wrap:has(#visSearch) .combo-caret');
  await page.waitForTimeout(250);
  const visOpen = await page.$$eval('#visDrop .ss-opt', e => e.length);
  check('caret opens the full visitor list', visOpen > 3, 'opts=' + visOpen);
  check('visitor dropdown is showing', await page.isVisible('#visDrop'));
  // and you can still type to narrow it
  await page.fill('#visSearch', 'LE');
  await page.waitForTimeout(200);
  const visTyped = await page.$$eval('#visDrop .ss-opt', e => e.map(x => x.dataset.v));
  check('typing still narrows the visitor list', visTyped.length > 0 && visTyped.every(v => v.includes('LE')),
    JSON.stringify(visTyped));
  await page.click('.ss-wrap:has(#visSearch) .combo-caret'); // toggle closed
  await page.waitForTimeout(200);

  console.log('\n── Unvisited This Month: header filters + sorting ──');
  await page.click('#tab-Visits');
  await page.waitForTimeout(1500);
  const totalRows = await page.$$eval('#ftTbl-comp tbody tr', e => e.length);
  check('table rendered', totalRows > 1, 'rows=' + totalRows);
  const fhBtns = await page.$$eval('#ftTbl-comp .fh-btn', e => e.length);
  check('filter buttons on the filterable headers', fhBtns === 7, 'buttons=' + fhBtns);

  // --- text filter on Store Name
  await page.click('#ftTbl-comp .fh-btn[onclick*="\'store\'"]');
  await page.waitForTimeout(250);
  check('clicking a header filter opens the popover', await page.isVisible('#colFilterPop'));
  await page.fill('#colfText', 'CITY');
  await page.waitForTimeout(300);
  const storeFiltered = await page.$$eval('#ftTbl-comp tbody tr td:nth-child(2)', e => e.map(x => x.textContent.trim()));
  check('text filter narrows to matching stores',
    storeFiltered.length > 0 && storeFiltered.length < totalRows && storeFiltered.every(s => /CITY/i.test(s)),
    JSON.stringify(storeFiltered).slice(0, 130));
  check('header filter button shows as active', (await page.getAttribute('#ftTbl-comp .fh-btn[onclick*="\'store\'"]', 'class')).includes('on'));
  check('count badge says filtered', /filtered/.test(await page.textContent('#cfCount')), await page.textContent('#cfCount'));
  check('row numbers renumber from 1',
    (await page.textContent('#ftTbl-comp tbody tr:first-child .crn')).trim() === '1');
  await page.click('.colf-clear');
  await page.waitForTimeout(300);
  check('Clear restores every row', (await page.$$eval('#ftTbl-comp tbody tr', e => e.length)) === totalRows);

  // --- set filter on Brand
  await page.click('#ftTbl-comp .fh-btn[onclick*="\'brand\'"]');
  await page.waitForTimeout(250);
  const boxes = await page.$$eval('.colfBox', e => e.map(x => x.value));
  check('brand filter lists the distinct brands', boxes.length >= 2, JSON.stringify(boxes));
  // untick everything except the first brand
  for (let i = 1; i < boxes.length; i++) await page.uncheck(`.colfBox >> nth=${i}`);
  await page.waitForTimeout(350);
  const brandCol = await page.$$eval('#ftTbl-comp tbody tr td:nth-child(3)', e => [...new Set(e.map(x => x.textContent.trim()))]);
  check('set filter keeps only the ticked brand', brandCol.length === 1 && brandCol[0] === boxes[0],
    JSON.stringify(brandCol) + ' expected ' + boxes[0]);
  await page.click('.colf-clear');
  await page.waitForTimeout(300);

  // --- numeric filter on Days Since
  await page.click('#ftTbl-comp .fh-btn[onclick*="daysSince"]');
  await page.waitForTimeout(250);
  await page.fill('#colfMin', '100');
  await page.waitForTimeout(350);
  const daysVals = await page.$$eval('#ftTbl-comp tbody tr td:nth-child(8)', e => e.map(x => x.textContent.trim()));
  const allOver = daysVals.every(t => { const m = t.match(/(\d+)d/); return m && Number(m[1]) >= 100; });
  check('numeric min filter applies', daysVals.length > 0 && allOver, JSON.stringify(daysVals).slice(0, 120));
  await page.click('.colf-clear');
  await page.waitForTimeout(300);

  // --- sorting
  await page.click('#ftTbl-comp .fh-lbl >> nth=4');   // YTD Visits header
  await page.waitForTimeout(300);
  const ytdAsc = await page.$$eval('#ftTbl-comp tbody tr td:nth-child(5)', e => e.map(x => Number(x.textContent.trim())));
  check('clicking a header sorts ascending',
    ytdAsc.every((v, i) => i === 0 || ytdAsc[i - 1] <= v), JSON.stringify(ytdAsc).slice(0, 90));
  await page.click('#ftTbl-comp .fh-lbl >> nth=4');
  await page.waitForTimeout(300);
  const ytdDesc = await page.$$eval('#ftTbl-comp tbody tr td:nth-child(5)', e => e.map(x => Number(x.textContent.trim())));
  check('clicking again reverses it',
    ytdDesc.every((v, i) => i === 0 || ytdDesc[i - 1] >= v), JSON.stringify(ytdDesc).slice(0, 90));
  check('sort arrow marks the active column',
    (await page.$$eval('#ftTbl-comp .fh-arrow.on', e => e.length)) === 1);

  // --- pill buttons and the Required column filter stay in agreement
  await page.click('.cf-btn[data-f="Monthly"]');
  await page.waitForTimeout(350);
  const reqCol = await page.$$eval('#ftTbl-comp tbody tr td:nth-child(6)', e => [...new Set(e.map(x => x.textContent.trim()))]);
  check('pill button filters the Required column', reqCol.length <= 1 && (reqCol[0] || 'Monthly') === 'Monthly',
    JSON.stringify(reqCol));
  check('Required header shows an active filter',
    (await page.getAttribute('#ftTbl-comp .fh-btn[onclick*="windowLabel"]', 'class')).includes('on'));
  await page.click('.cf-btn[data-f="ALL"]');
  await page.waitForTimeout(350);
  check('All Stores clears it again',
    (await page.$$eval('#ftTbl-comp tbody tr', e => e.length)) === totalRows);

  // --- popover dismissal
  await page.click('#ftTbl-comp .fh-btn[onclick*="\'region\'"]');
  await page.waitForTimeout(250);
  check('popover open before outside click', await page.isVisible('#colFilterPop'));
  await page.click('#visitsPanel .kpi-row');
  await page.waitForTimeout(250);
  check('clicking outside closes the popover', !(await page.isVisible('#colFilterPop')));

  console.log('\n── Console errors ──');
  check('no page/console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  // ─────────────────────────────────────────────────────────
  // PHONE
  // ─────────────────────────────────────────────────────────
  console.log('\n── Phone (iPhone-ish 390×844) ──');
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const mp = await mctx.newPage();
  const merrors = [];
  mp.on('pageerror', e => merrors.push(e.message));
  await mp.goto(URL);
  await mp.waitForTimeout(1200);

  const noHScroll = await mp.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('no horizontal page overflow', noHScroll,
    await mp.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));

  const inputFont = await mp.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById('storeSearch')).fontSize));
  check('inputs ≥16px (stops iOS zoom-on-focus)', inputFont >= 16, inputFont + 'px');

  const btnH = await mp.evaluate(() =>
    document.getElementById('btnSubmit').getBoundingClientRect().height);
  check('submit button ≥42px tap target', btnH >= 42, btnH + 'px');

  // form and queue should stack, not sit side by side
  const stacked = await mp.evaluate(() => {
    const f = document.querySelector('.portal-form').getBoundingClientRect();
    const q = document.querySelector('.portal-queue').getBoundingClientRect();
    return q.top >= f.bottom - 2;
  });
  check('form + queue stack vertically', stacked);

  await mp.screenshot({ path: OUT + '/phone-input.png', fullPage: false });

  // tools tab on phone = single column
  await mp.click('#tab-Tools');
  await mp.waitForTimeout(300);
  const oneCol = await mp.evaluate(() => {
    const cards = [...document.querySelectorAll('.tool-card')];
    if (cards.length < 2) return false;
    const a = cards[0].getBoundingClientRect(), b = cards[1].getBoundingClientRect();
    return b.top >= a.bottom - 2;
  });
  check('tools stack to one column', oneCol);
  await mp.screenshot({ path: OUT + '/phone-tools.png' });

  // wide table scrolls inside its own box on the unvisited tab
  await mp.click('#tab-Visits');
  await mp.waitForTimeout(1400);
  const tableContained = await mp.evaluate(() => {
    const w = document.querySelector('.tbl-scroll');
    if (!w) return 'no .tbl-scroll wrapper';
    const okOverflow = getComputedStyle(w).overflowX === 'auto';
    const pageOk = document.documentElement.scrollWidth <= window.innerWidth + 1;
    return okOverflow && pageOk ? true : ('overflowX=' + getComputedStyle(w).overflowX +
      ' pageW=' + document.documentElement.scrollWidth + '/' + window.innerWidth);
  });
  check('wide table scrolls in-box, page does not', tableContained === true, tableContained);
  await mp.screenshot({ path: OUT + '/phone-unvisited.png' });

  check('no phone console errors', merrors.length === 0, merrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n════════════════════════════════');
  console.log('  PASS ' + pass + '   FAIL ' + fail);
  console.log('════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
