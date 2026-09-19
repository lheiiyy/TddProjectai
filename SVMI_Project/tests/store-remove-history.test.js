// Unit tests for the "Remove Store" feature:
//   - portal_removeStore(storeName) (INPUT_PORTAL.gs) must clear ONLY that
//     store's own SETTINGS columns (A store, B brand, C region, D formula,
//     E category) — cols F (Visitor Roster) and H (Purpose List) are
//     independent parallel lists that happen to share the same row index,
//     and a bug here would silently delete an unrelated roster/purpose
//     entry that happens to sit on the same row as the removed store.
//   - _computeStoreRisk() (SVMKPI_RISK.gs) must keep showing a removed
//     store's full MASTER_LOG history, degrading only its category to
//     "—" (no MASTER_LOG fallback exists for category) rather than losing
//     the store from Store Health entirely.
//
// Both run the REAL Apps Script code in a Node vm sandbox — same approach
// as kpi-roster-history.test.js/roster-auto-refresh.test.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const inputSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'INPUT_PORTAL.gs'), 'utf8');
const riskSrc  = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_RISK.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Generic writable Sheet/Range mock (cells: {row,col} -> value), same
//    pattern as roster-auto-refresh.test.js but simpler — no formulas
//    needed here, portal_removeStore only ever clears/reads plain values ──
function makeSheet() {
  const cells = {};
  const key = (r, c) => r + ',' + c;

  function makeRange(row, col, numRows, numCols) {
    const range = {};
    let proxy;
    range.setValue = (v) => { cells[key(row, col)] = v; return proxy; };
    range.clearContent = () => {
      for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) delete cells[key(row + r, col + c)];
      return proxy;
    };
    range.getValue = () => (cells[key(row, col)] == null ? '' : cells[key(row, col)]);
    range.getValues = () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const rowArr = [];
        for (let c = 0; c < numCols; c++) rowArr.push(cells[key(row + r, col + c)] == null ? '' : cells[key(row + r, col + c)]);
        out.push(rowArr);
      }
      return out;
    };
    proxy = new Proxy(range, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string') return undefined;
        return () => proxy;
      },
    });
    return proxy;
  }

  const sheet = {
    _cells: cells,
    getLastRow() {
      let max = 1; // header row always present
      Object.keys(cells).forEach(k => {
        const [r] = k.split(',').map(Number);
        if (cells[k] != null && cells[k] !== '' && r > max) max = r;
      });
      return max;
    },
    getRange(row, col, numRows, numCols) { return makeRange(row, col, numRows || 1, numCols || 1); },
  };
  let sproxy;
  sproxy = new Proxy(sheet, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      return () => sproxy;
    },
  });
  return sproxy;
}

function newInputSandbox(isAdmin) {
  const settingsSheet = makeSheet();
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => (name === 'SETTINGS' ? settingsSheet : null),
      }),
      flush: () => {},
    },
    sl_isAdmin: () => isAdmin,
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(inputSrc, sandbox);
  return { sandbox, settingsSheet };
}

// ── portal_removeStore(): row isolation + admin gate ──────────────────
console.log('\n── portal_removeStore() clears only the store\'s own columns ──');

{
  const { sandbox, settingsSheet } = newInputSandbox(true);
  // Row 2: STORE A's own data (A-E) plus a visitor (F) and a purpose (H)
  // that happen to share the same row index — these must survive.
  settingsSheet.getRange(2, 1).setValue('STORE A');   // A store
  settingsSheet.getRange(2, 2).setValue('FIGARO');    // B brand
  settingsSheet.getRange(2, 3).setValue('NCR');       // C region
  settingsSheet.getRange(2, 4).setValue('OK');        // D validation (plain value stand-in for a formula)
  settingsSheet.getRange(2, 5).setValue('NCR');       // E category
  settingsSheet.getRange(2, 6).setValue('LEO');       // F visitor roster
  settingsSheet.getRange(2, 8).setValue('STORE VISIT'); // H purpose list

  const result = sandbox.portal_removeStore('store a');
  check('remove succeeds', result && result.success === true, JSON.stringify(result));

  eq('A (store) cleared', settingsSheet.getRange(2, 1).getValue(), '');
  eq('B (brand) cleared', settingsSheet.getRange(2, 2).getValue(), '');
  eq('C (region) cleared', settingsSheet.getRange(2, 3).getValue(), '');
  eq('D (validation) cleared', settingsSheet.getRange(2, 4).getValue(), '');
  eq('E (category) cleared', settingsSheet.getRange(2, 5).getValue(), '');
  eq('F (visitor roster) — untouched, same row as removed store', settingsSheet.getRange(2, 6).getValue(), 'LEO');
  eq('H (purpose list) — untouched, same row as removed store', settingsSheet.getRange(2, 8).getValue(), 'STORE VISIT');

  const second = sandbox.portal_removeStore('store a');
  check('removing again fails cleanly (already gone)', second.success === false, JSON.stringify(second));
}

console.log('\n── portal_removeStore() is admin-gated ──');
{
  const { sandbox, settingsSheet } = newInputSandbox(false);
  settingsSheet.getRange(2, 1).setValue('STORE B');
  const result = sandbox.portal_removeStore('store b');
  check('non-admin is rejected', result.success === false && /admin/i.test(result.message), JSON.stringify(result));
  eq('store row untouched for a rejected non-admin call', settingsSheet.getRange(2, 1).getValue(), 'STORE B');
}

// ── _computeStoreRisk(): removed store keeps its full visit history ───
console.log('\n── _computeStoreRisk() keeps a removed store\'s history, category degrades to "—" ──');

function makeSettingsMetaSheet(rows) {
  // rows: [store, brand, region, _unused, category][]
  return {
    getLastRow: () => rows.length + 1,
    getRange: (row, col, numRows) => ({
      getValues: () => rows.slice(row - 2, row - 2 + numRows),
    }),
  };
}

function newRiskSandbox(settingsRows) {
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => (name === 'SETTINGS' ? makeSettingsMetaSheet(settingsRows || []) : null),
      }),
    },
    SHEET: { SETTINGS: 'SETTINGS', MASTER_LOG: 'MASTER_LOG' },
    DATA_YEAR: 2026,
    // Phase 1C: _computeStoreRisk() falls back to getDefaultReportingYear()
    // (SVMKPI_REPORTING_YEAR.gs) when no year is passed; this sandbox only
    // loads SVMKPI_RISK.gs, so stub the same fixed answer this file's
    // fixtures (all dated 2026) already assume.
    getDefaultReportingYear: () => 2026,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(riskSrc, sandbox);
  return sandbox;
}

{
  // STORE A is no longer in SETTINGS (removed) but has one MASTER_LOG visit.
  const sandbox = newRiskSandbox([]); // empty SETTINGS — store fully removed
  const SDate = vm.runInContext('Date', sandbox);
  const today = new SDate(2026, 8, 14);

  const data = {
    stores: ['STORE A'],
    dates: [new SDate(2026, 0, 15)],
    purposes: ['STORE VISIT'],
    brands: ['FIGARO'],
    regions: ['NCR'],
  };

  const rows = sandbox._computeStoreRisk(data, today);
  const storeA = rows.find(r => r.store === 'STORE A');

  check('removed store still appears in Store Health', !!storeA, JSON.stringify(rows.map(r => r.store)));
  eq('category degrades to "—" (no MASTER_LOG fallback for category)', storeA && storeA.category, '—');
  eq('brand falls back to the MASTER_LOG literal', storeA && storeA.brand, 'FIGARO');
  eq('region falls back to the MASTER_LOG literal', storeA && storeA.region, 'NCR');
  check('hasHistory is true — the visit itself is never lost', storeA && storeA.hasHistory === true);
  eq('totalYTD counts the surviving visit', storeA && storeA.totalYTD, 1);
  eq('storeYTD counts the STORE VISIT purpose', storeA && storeA.storeYTD, 1);
}

{
  // Control: same visit, but STORE A is still active in SETTINGS — category
  // should come from SETTINGS, not degrade.
  const sandbox = newRiskSandbox([['STORE A', 'FIGARO', 'NCR', '', 'NCR']]);
  const SDate = vm.runInContext('Date', sandbox);
  const today = new SDate(2026, 8, 14);

  const data = {
    stores: ['STORE A'],
    dates: [new SDate(2026, 0, 15)],
    purposes: ['STORE VISIT'],
    brands: ['FIGARO'],
    regions: ['NCR'],
  };

  const rows = sandbox._computeStoreRisk(data, today);
  const storeA = rows.find(r => r.store === 'STORE A');
  eq('control: still-active store keeps its real category', storeA && storeA.category, 'NCR');
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
