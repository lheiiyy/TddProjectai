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
const yearSrc   = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_REPORTING_YEAR.gs'), 'utf8');
const calSrc    = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CALENDAR.gs'), 'utf8');
const cmpCfgSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_COMPLIANCE_CONFIG.gs'), 'utf8');
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
  vm.runInContext(yearSrc, sandbox); // declares getDefaultReportingYear() (Phase 1C)
  vm.runInContext(calSrc, sandbox);  // declares resolveCalendarPeriod() (Phase 1D)
  vm.runInContext(cmpCfgSrc, sandbox); // declares _cmp_resolveByCategory()'s hardcoded-default fallback (Phase 1D)
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

  const visited = sandbox.sl_getVisitedThisMonth([]).resolved.map(r => r.name).sort();
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

// ── sl_getVisitedThisMonth(): unmapped-row bucket (bug fix) ───────────
// A live-deployment report: Executive Summary's Monthly-by-Brand total
// (raw COUNTIFS over MASTER_LOG, no roster check) didn't match Store
// Insights' "Visited This Month" total (roster-joined, silently dropped
// any row whose Store text didn't resolve to a current SETTINGS entry).
// Proves such rows are now surfaced in `unmapped` instead of vanishing,
// and that resolved+unmapped visits reconciles with a raw brand+month count.
console.log('\n── sl_getVisitedThisMonth(): unmapped rows are surfaced, not dropped ──');
{
  const { sandbox, SDate } = newSandbox((D) => {
    const now = new D();
    const thisMonth10th = new D(now.getFullYear(), now.getMonth(), 10);
    const thisMonth12th = new D(now.getFullYear(), now.getMonth(), 12);
    return {
      masterLogRows: [
        ['t1', thisMonth10th, 'STORE_KNOWN', 'FIGARO', 'NCR', 'LEO', 'STORE VISIT', ''],
        // Renamed/removed from Settings, or a data-entry mismatch — this
        // store text has NO current roster entry at all.
        ['t2', thisMonth12th, 'STORE_GHOST', 'FIGARO', 'NCR', 'YANA', 'STORE VISIT', ''],
        ['t3', thisMonth12th, 'STORE_GHOST', 'FIGARO', 'NCR', 'YANA', 'STORE VISIT', ''],
      ],
      settingsRows: [
        ['STORE_KNOWN', 'FIGARO', 'NCR', '', 'NCR'],
      ],
    };
  });

  const result = sandbox.sl_getVisitedThisMonth([]);
  check('resolved bucket contains the roster-matched store', result.resolved.some(r => r.name === 'STORE_KNOWN'), JSON.stringify(result.resolved.map(r => r.name)));
  check('unmapped bucket contains the non-roster store instead of dropping it (the fix)',
    result.unmapped.some(u => u.name === 'STORE_GHOST'), JSON.stringify(result.unmapped));
  const ghost = result.unmapped.find(u => u.name === 'STORE_GHOST');
  check('unmapped entry counts both of its visit rows', ghost && ghost.visits === 2, ghost);
  check('unmapped entry keeps its most recent visit date', ghost && ghost.lastVisitDate && ghost.lastVisitDate !== '—', ghost);

  const rawTotal = 1 /*STORE_KNOWN*/ + 2 /*STORE_GHOST*/;
  const resolvedTotal = result.resolved.reduce((n, r) => n + r.visits, 0);
  const unmappedTotal = result.unmapped.reduce((n, u) => n + u.visits, 0);
  check('resolved + unmapped visits reconciles with the raw row count (matches Executive Summary\'s COUNTIFS)',
    resolvedTotal + unmappedTotal === rawTotal, { resolvedTotal, unmappedTotal, rawTotal });
}

// ── sl_getVisitedThisMonth(): a store excluded by brandFilter is NOT
//    mistaken for "unmapped" — it's simply out of scope for this call.
console.log('\n── sl_getVisitedThisMonth(): brandFilter exclusion is not the same as unmapped ──');
{
  const { sandbox, SDate } = newSandbox((D) => {
    const now = new D();
    const thisMonth5th = new D(now.getFullYear(), now.getMonth(), 5);
    return {
      masterLogRows: [
        ['t1', thisMonth5th, 'STORE_OTHERBRAND', 'ANGELS PIZZA', 'NCR', 'LEO', 'STORE VISIT', ''],
      ],
      settingsRows: [
        ['STORE_OTHERBRAND', 'ANGELS PIZZA', 'NCR', '', 'NCR'],
      ],
    };
  });

  const result = sandbox.sl_getVisitedThisMonth(['FIGARO']); // filter excludes the only store
  check('store excluded by brandFilter is absent from resolved', result.resolved.length === 0, JSON.stringify(result.resolved));
  check('store excluded by brandFilter is NOT counted as unmapped either', result.unmapped.length === 0, JSON.stringify(result.unmapped));
}

// ── sl_getVisitedThisMonth(): optional monthNumber/reportingYear ──────
// Mirrors sl_getComplianceGaps()'s existing fallback pattern — omitting
// both params preserves the exact pre-fix "always current month" behavior;
// passing them reproduces any past month on demand.
console.log('\n── sl_getVisitedThisMonth(): optional month/year params reproduce a past month ──');
{
  const { sandbox, SDate } = newSandbox((D) => ({
    masterLogRows: [
      ['t1', new D(2026, 6, 15), 'STORE_JUL', 'FIGARO', 'NCR', 'LEO', 'STORE VISIT', ''],   // July
      ['t2', new D(2026, 7, 20), 'STORE_AUG', 'FIGARO', 'NCR', 'YANA', 'STORE VISIT', ''],  // August
      ['t3', new D(2026, 8, 5),  'STORE_SEP', 'FIGARO', 'NCR', 'GIO', 'STORE VISIT', ''],   // September
    ],
    settingsRows: [
      ['STORE_JUL', 'FIGARO', 'NCR', '', 'NCR'],
      ['STORE_AUG', 'FIGARO', 'NCR', '', 'NCR'],
      ['STORE_SEP', 'FIGARO', 'NCR', '', 'NCR'],
    ],
  }));

  const august = sandbox.sl_getVisitedThisMonth([], 8, 2026).resolved.map(r => r.name);
  check('explicit monthNumber=8 returns only the August visit', august.length === 1 && august[0] === 'STORE_AUG', JSON.stringify(august));

  const july = sandbox.sl_getVisitedThisMonth([], 7, 2026).resolved.map(r => r.name);
  check('explicit monthNumber=7 returns only the July visit — proves ANY past month is reachable now', july.length === 1 && july[0] === 'STORE_JUL', JSON.stringify(july));
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
