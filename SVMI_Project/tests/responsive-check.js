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

// Real device sizes, CSS pixels (what the breakpoint actually sees)
const DEVICES = [
  { label: 'Phone portrait  (iPhone 14, 390×844)',      w: 390,  h: 844,  touch: true  },
  { label: 'Phone landscape (iPhone 14, 844×390)',       w: 844,  h: 390,  touch: true  },
  { label: 'Tablet portrait  (iPad, 768×1024)',           w: 768,  h: 1024, touch: true  },
  { label: 'Tablet landscape (iPad, 1024×768)',           w: 1024, h: 768,  touch: true  },
  { label: 'Small laptop     (1280×800)',                 w: 1280, h: 800,  touch: false },
  { label: 'Desktop          (1440×900)',                 w: 1440, h: 900,  touch: false },
];

(async () => {
  const browser = await chromium.launch();

  for (const dev of DEVICES) {
    console.log('\n── ' + dev.label + ' ──');
    const ctx = await browser.newContext({
      viewport: { width: dev.w, height: dev.h },
      isMobile: dev.touch, hasTouch: dev.touch,
      deviceScaleFactor: dev.touch ? 2 : 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL);
    await page.waitForTimeout(1100);

    // ── universal: no horizontal page scroll at any size ──
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check('no horizontal page overflow', overflow.scrollW <= overflow.innerW + 1,
      `scrollWidth=${overflow.scrollW} innerWidth=${overflow.innerW}`);

    // ── which layout mode did this width actually land in? ──
    const isCompact = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.tab-content.active')).display === 'block');
    console.log(`    layout: ${isCompact ? 'compact/stacked (<=820px CSS breakpoint)' : 'desktop two-pane (>820px)'}`);

    // ── tap targets: only meaningful on touch devices ──
    if (dev.touch) {
      const btnH = await page.evaluate(() =>
        document.getElementById('btnSubmit').getBoundingClientRect().height);
      check('primary button >=42px tall (touch target)', btnH >= 42, btnH + 'px');

      const caretBox = await page.evaluate(() => {
        const el = document.querySelector('.combo-caret');
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      // 24px is the practical floor for a small icon-only touch target; flag anything smaller
      check('dropdown caret is a plausible touch target (>=24px)',
        caretBox.w >= 24 && caretBox.h >= 24, JSON.stringify(caretBox));

      const inputFont = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.getElementById('storeSearch')).fontSize));
      check('store input >=16px font (stops iOS zoom-on-focus)', inputFont >= 16, inputFont + 'px');
    }

    // ── form usable: fields visible, nothing clipped off-screen ──
    const formVisible = await page.evaluate(() => {
      const el = document.getElementById('storeSearch');
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth + 1;
    });
    check('Store field fully on-screen, not clipped', formVisible);

    // ── open the store dropdown and confirm it doesn't run off-screen ──
    await page.click('#storeSearch');
    await page.waitForTimeout(250);
    const dropOk = await page.evaluate(() => {
      const el = document.getElementById('storeDrop');
      const r = el.getBoundingClientRect();
      return r.right <= window.innerWidth + 2 && r.left >= -2;
    });
    check('store dropdown stays within viewport', dropOk);
    await page.keyboard.press('Escape');

    // ── System Tools: cards readable, not so cramped text overlaps ──
    await page.click('#tab-Tools');
    await page.waitForTimeout(300);
    const toolsLayout = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.tool-card')];
      if (cards.length < 2) return null;
      const a = cards[0].getBoundingClientRect(), b = cards[1].getBoundingClientRect();
      return { sameRow: Math.abs(a.top - b.top) < 5, aWidth: a.width };
    });
    check('tool cards have real width (>=140px, not crushed)',
      toolsLayout && toolsLayout.aWidth >= 140, JSON.stringify(toolsLayout));

    // ── Unvisited tab: wide table must scroll in its own box, not the page ──
    await page.click('#tab-Visits');
    await page.waitForTimeout(1500);
    const tableCheck = await page.evaluate(() => {
      const w = document.querySelector('.tbl-scroll');
      if (!w) return 'no .tbl-scroll wrapper found';
      return {
        wrapperOverflowX: getComputedStyle(w).overflowX,
        pageStillFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      };
    });
    check('wide table contained in its own scrollbox, page does not scroll',
      tableCheck !== 'no .tbl-scroll wrapper found' && tableCheck.pageStillFits,
      JSON.stringify(tableCheck));

    // ── header filter popover: must not be clipped off the right/bottom edge ──
    const fhBtn = await page.$('.fh-btn');
    if (fhBtn) {
      await fhBtn.click();
      await page.waitForTimeout(250);
      const popOk = await page.evaluate(() => {
        const pop = document.getElementById('colFilterPop');
        if (pop.hidden) return null;
        const r = pop.getBoundingClientRect();
        return r.right <= window.innerWidth + 2 && r.bottom <= window.innerHeight + 2 && r.left >= -2;
      });
      check('header filter popover fully within viewport', popOk === true, JSON.stringify(popOk));
    }

    check('no console/page errors at this size', errors.length === 0, errors.slice(0, 3).join(' | '));

    await page.screenshot({ path: `${OUT}/rc-${dev.w}x${dev.h}.png` });
    await ctx.close();
  }

  await browser.close();
  console.log('\n════════════════════════════════');
  console.log('  PASS ' + pass + '   FAIL ' + fail);
  console.log('════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
