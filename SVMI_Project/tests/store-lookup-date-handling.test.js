// Phase 0.5: regression tests for replacing 7 independent
// `dateRaw instanceof Date` checks in SVMKPI_STORE_LOOKUP.gs with the
// canonical _parseDateCell() (SVMKPI_CORE.gs). Before this fix, a MASTER_LOG
// date cell that held a plain string instead of an auto-coerced Sheets Date
// object was silently dropped by sl_getStoreData()/sl_getVisitedThisMonth()/
// sl_getUnvisitedThisMonth()/sl_getComplianceGaps() — even though
// processSubmissionAsync()/_getData()/checkDuplicateVisit() would have
// parsed the exact same string correctly. Proves all four functions now
// treat a native Date object and an equivalent date string identically, and
// that invalid/blank dates are skipped safely (no throw, no phantom row).
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs + SVMKPI_RISK.gs +
// SVMKPI_STORE_LOOKUP.gs) in a Node vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const coreSrc   = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CORE.gs'), 'utf8');
const riskSrc   = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_RISK.gs'), 'utf8');
const lookupSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_STORE_LOOKUP.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

// MASTER_LOG rows: [timestamp, date, store, brand, region, visitor, purpose, remarks]
function makeMasterLogSheet(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => rows.slice(row - 2, row - 2 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
    }),
  };
}
// SETTINGS rows: [store, brand, region, _unused, category]
function makeSettingsSheet(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => rows.slice(row - 2, row - 2 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
    }),
  };
}

// buildRows(SDate) -> { masterLogRows, settingsRows } — each sandbox gets
// its own Date constructor (vm realms don't share one), so mock data must
// always be built from THIS sandbox's own Date, passed into the callback.
function newSandbox(buildRows) {
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
    SHEET: { SETTINGS: 'SETTINGS', MASTER_LOG: 'MASTER_LOG' },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      },
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(riskSrc, sandbox);
  vm.runInContext(lookupSrc, sandbox);

  const SDate = vm.runInContext('Date', sandbox);
  const built = buildRows ? buildRows(SDate) : {};
  const masterLog = makeMasterLogSheet(built.masterLogRows || []);
  const settings  = makeSettingsSheet(built.settingsRows || []);
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => {
      if (name === 'SETTINGS') return settings;
      if (name === 'MASTER_LOG') return masterLog;
      return null;
    },
  });
  return { sandbox, SDate };
}

// ── sl_getStoreData(): row sort / last-visit / recent-visits ──────────
console.log('\n── sl_getStoreData(): native Date and string dates sort/format identically ──');
{
  const { sandbox, SDate } = newSandbox((D) => ({
    masterLogRows: [
      // Older visit, stored as a native Date object
      ['t1', new D(2026, 0, 5), 'ALPHA', 'FIGARO', 'NCR', 'LEO', 'STORE VISIT', 'older, native Date'],
      // Newer visit, stored as a plain string — this is the exact case the
      // old `instanceof Date` check silently dropped
      ['t2', '2026-03-10', 'ALPHA', 'FIGARO', 'NCR', 'YANA', 'STORE VISIT', 'newer, string date'],
      // Invalid date string — must be skipped, never crash, never sort first
      ['t3', 'not-a-date', 'ALPHA', 'FIGARO', 'NCR', 'GIO', 'TLTC', 'invalid date'],
      // Blank date — same
      ['t4', '', 'ALPHA', 'FIGARO', 'NCR', 'RICE', 'TLTC', 'blank date'],
    ],
    settingsRows: [['ALPHA', 'FIGARO', 'NCR', '', 'NCR']],
  }));

  const data = sandbox.sl_getStoreData('ALPHA');
  check('total visits includes all 4 rows (even unparseable ones count toward volume)', data.summary.totalVisits === 4, data.summary.totalVisits);
  check('most recent visit is the STRING-dated one (Mar 10), not the native-Date one (Jan 5)',
    data.summary.lastVisitDate === 'Mar 10, 2026', data.summary.lastVisitDate);
  check('last visitor is YANA (from the string-dated, actually-newer row)', data.summary.lastVisitor === 'YANA', data.summary.lastVisitor);

  const recentDates = data.recentVisits.map(v => v.date);
  check('recent-visits list formats the string-dated row correctly, not as "—"',
    recentDates.includes('Mar 10, 2026'), JSON.stringify(recentDates));
  check('recent-visits list shows "—" for the invalid/blank rows, not a crash or wrong date',
    recentDates.filter(d => d === '—').length === 2, JSON.stringify(recentDates));
}

// ── sl_getVisitedThisMonth() / sl_getUnvisitedThisMonth() ─────────────
console.log('\n── sl_getVisitedThisMonth() / sl_getUnvisitedThisMonth(): string dates count too ──');
{
  const { sandbox, SDate } = newSandbox((D) => {
    const now = new D();
    const thisMonth1st = new D(now.getFullYear(), now.getMonth(), 1);
    const lastMonth1st = new D(now.getFullYear(), now.getMonth() - 1, 1);
    const y = thisMonth1st.getFullYear(), m = String(thisMonth1st.getMonth() + 1).padStart(2, '0');
    return {
      masterLogRows: [
        ['t1', thisMonth1st, 'STORE_NATIVE', 'FIGARO', 'NCR', 'LEO', 'STORE VISIT', ''],
        ['t2', `${y}-${m}-01`, 'STORE_STRING', 'FIGARO', 'NCR', 'YANA', 'STORE VISIT', ''],
        ['t3', 'garbage', 'STORE_INVALID', 'FIGARO', 'NCR', 'GIO', 'STORE VISIT', ''],
        ['t4', '', 'STORE_BLANK', 'FIGARO', 'NCR', 'RICE', 'STORE VISIT', ''],
        ['t5', lastMonth1st, 'STORE_LASTMONTH', 'FIGARO', 'NCR', 'CARL', 'STORE VISIT', ''],
      ],
      settingsRows: [
        ['STORE_NATIVE', 'FIGARO', 'NCR', '', 'NCR'],
        ['STORE_STRING', 'FIGARO', 'NCR', '', 'NCR'],
        ['STORE_INVALID', 'FIGARO', 'NCR', '', 'NCR'],
        ['STORE_BLANK', 'FIGARO', 'NCR', '', 'NCR'],
        ['STORE_LASTMONTH', 'FIGARO', 'NCR', '', 'NCR'],
      ],
    };
  });

  const visited = sandbox.sl_getVisitedThisMonth([]).map(r => r.name).sort();
  check('native-Date store counts as visited this month', visited.includes('STORE_NATIVE'), JSON.stringify(visited));
  check('string-dated store counts as visited this month (the fix)', visited.includes('STORE_STRING'), JSON.stringify(visited));
  check('invalid-date store is not counted as visited', !visited.includes('STORE_INVALID'), JSON.stringify(visited));
  check('blank-date store is not counted as visited', !visited.includes('STORE_BLANK'), JSON.stringify(visited));
  check('last-month store is not counted as visited this month', !visited.includes('STORE_LASTMONTH'), JSON.stringify(visited));

  const unvisited = sandbox.sl_getUnvisitedThisMonth([]).map(r => r.name).sort();
  check('native-Date and string-dated stores are NOT in the unvisited list',
    !unvisited.includes('STORE_NATIVE') && !unvisited.includes('STORE_STRING'), JSON.stringify(unvisited));
  check('invalid/blank/last-month stores ARE in the unvisited list',
    unvisited.includes('STORE_INVALID') && unvisited.includes('STORE_BLANK') && unvisited.includes('STORE_LASTMONTH'),
    JSON.stringify(unvisited));
}

// ── sl_getComplianceGaps(): deterministic via explicit monthNumber ────
console.log('\n── sl_getComplianceGaps(): string dates count toward YTD/compliance too ──');
{
  const { sandbox, SDate } = newSandbox((D) => ({
    masterLogRows: [
      // March visit (month 3), native Date — should satisfy NCR's Monthly window for March
      ['t1', new D(2026, 2, 15), 'STORE_A', 'FIGARO', 'NCR', 'LEO', 'STORE VISIT', ''],
      // March visit, string date — must ALSO satisfy the window (the fix)
      ['t2', '2026-03-20', 'STORE_B', 'FIGARO', 'NCR', 'YANA', 'STORE VISIT', ''],
      // Invalid date — must not crash, must not count toward YTD or compliance
      ['t3', 'not-a-real-date', 'STORE_C', 'FIGARO', 'NCR', 'GIO', 'STORE VISIT', ''],
      // Blank date — same
      ['t4', '', 'STORE_D', 'FIGARO', 'NCR', 'RICE', 'STORE VISIT', ''],
    ],
    settingsRows: [
      ['STORE_A', 'FIGARO', 'NCR', '', 'NCR'],
      ['STORE_B', 'FIGARO', 'NCR', '', 'NCR'],
      ['STORE_C', 'FIGARO', 'NCR', '', 'NCR'],
      ['STORE_D', 'FIGARO', 'NCR', '', 'NCR'],
    ],
  }));

  // sl_getComplianceGaps() only returns NON-compliant stores — a compliant
  // store is simply absent from the result, not present with a flag.
  const gaps = sandbox.sl_getComplianceGaps([], 3); // reference month = March
  const byStore = Object.fromEntries(gaps.map(g => [g.store, g]));

  check('STORE_A (native Date, March) is compliant -> absent from the gap list', !byStore.STORE_A, JSON.stringify(gaps.map(g => g.store)));
  check('STORE_B (string date, March) is ALSO compliant -> absent — the fix', !byStore.STORE_B, JSON.stringify(gaps.map(g => g.store)));
  check('STORE_C (invalid date) is NOT compliant -> present in the gap list', !!byStore.STORE_C, JSON.stringify(gaps.map(g => g.store)));
  check('STORE_D (blank date) is NOT compliant -> present in the gap list', !!byStore.STORE_D, JSON.stringify(gaps.map(g => g.store)));
  check('STORE_C\'s YTD count is 0 (invalid date never counted)', byStore.STORE_C.ytdVisits === 0, byStore.STORE_C.ytdVisits);
  check('STORE_D\'s YTD count is 0 (blank date never counted)', byStore.STORE_D.ytdVisits === 0, byStore.STORE_D.ytdVisits);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
