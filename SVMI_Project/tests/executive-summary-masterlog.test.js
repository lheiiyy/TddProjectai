// Tests for getExecutiveSummaryReport(year) (SVMKPI_REPORTS.gs) — now
// computed directly from MASTER_LOG instead of reading fixed cells off the
// EXECUTIVE SUMMARY sheet. Runs the REAL Apps Script code in a vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); fail++; }
}

function fakeSheet(rows) {
  return {
    getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + nr).map(row => {
        const out = [];
        for (let i = 0; i < nc; i++) out.push(row[c - 1 + i] === undefined ? '' : row[c - 1 + i]);
        return out;
      }),
    }),
  };
}

function newSandbox(logRows, rosterNames, opts) {
  opts = opts || {};
  const header = ['Timestamp', 'Date Visited', 'Store', 'Brand', 'Region', 'Visited By', 'Purpose'];
  const settingsRows = [['', '', '', '', '', 'VISITORS']].concat(rosterNames.map(n => ['', '', '', '', '', n]));
  const sheets = { MASTER_LOG: fakeSheet([header].concat(logRows)), SETTINGS: fakeSheet(settingsRows) };
  let summaryReads = 0;
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => {
      if (name === 'EXECUTIVE SUMMARY') { summaryReads++; return null; }
      return opts.noMasterLog && name === 'MASTER_LOG' ? null : (sheets[name] || null);
    } }) },
    Session: { getScriptTimeZone: () => 'Asia/Manila' },
    Utilities: { formatDate: d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') },
    Logger: { log: () => {} },
    console: { log: () => {} },
    getDefaultReportingYear: () => 2026,
  };
  vm.createContext(sandbox);
  vm.runInContext(src('SVMKPI_CORE.gs'), sandbox);
  vm.runInContext(src('SVMKPI_REPORTS.gs'), sandbox);
  sandbox._summaryReads = () => summaryReads;
  return sandbox;
}

const r = (date, store, brand, region, visitors, purpose) => [new Date(), date, store, brand, region, visitors, purpose];
const LOG = [
  r('2026-01-05', 'AP MAKATI',  "ANGEL'S PIZZA", 'NCR',        'LEO',        'STORE VISIT'),
  r('2026-01-20', 'AP MAKATI',  "Angel’s Pizza", ' ncr ',      'LEO | ANN',  'TLTC'),          // curly apostrophe + messy case
  r('2026-02-03', 'FIG CEBU',   'FIGARO',        'PROVINCIAL', 'ANN',        'FAILED QA/MS'),
  r('2026-02-14', 'FIG CEBU',   'FIGARO',        'PROVINCIAL', 'ANN|ANN',    'STORE VISIT'),   // duplicate name in one row
  r('2026-02-15', 'APEX BGC',   'APEX',          'FRANCHISE',  'CHARLIE',    'CURING/SUPPORT'),
  r('2025-12-30', 'AP MAKATI',  "ANGEL'S PIZZA", 'NCR',        'LEO',        'STORE VISIT'),   // previous year
  r('2026-03-01', 'KK ORTIGAS', 'KOOBIDEH',      'NCR',        'GHOST',      'STORE VISIT'),   // visitor not on roster
];
const ROSTER = ['LEO', 'ANN', 'CHARLIE', 'NOBODY'];

console.log('\n── Reads MASTER_LOG, never the EXECUTIVE SUMMARY sheet ──');
{
  const sb = newSandbox(LOG, ROSTER);
  const es = sb.getExecutiveSummaryReport(2026);
  check('works with no EXECUTIVE SUMMARY tab at all', !!es);
  check('EXECUTIVE SUMMARY sheet is never looked up', sb._summaryReads() === 0, sb._summaryReads());
  check('reports the year used', es.year === 2026, es.year);
  check('defaults to getDefaultReportingYear()', sb.getExecutiveSummaryReport().year === 2026);
}

console.log('\n── KPI cards (all-time, like the COUNTIF cells) ──');
{
  const es = newSandbox(LOG, ROSTER).getExecutiveSummaryReport(2026);
  const kv = Object.fromEntries(es.kpi.map(k => [k.label, k.value]));
  check('Total Visits = every row with a store', kv['Total Visits'] === '7', kv);
  check('Store Visits', kv['Store Visits'] === '4', kv);
  check('TLTC', kv['TLTC'] === '1', kv);
  check('Failed QA/MS', kv['Failed QA/MS'] === '1', kv);
  check('Curing/Support', kv['Curing/Support'] === '1', kv);
  check('NCR counts messy " ncr " too', kv['NCR'] === '4', kv);
  check('Provincial', kv['Provincial'] === '2', kv);
}

console.log('\n── Monthly by brand (reporting year only) ──');
{
  const es = newSandbox(LOG, ROSTER).getExecutiveSummaryReport(2026);
  const ap = es.monthBrandLabels.indexOf("ANGEL'S PIZZA");
  const fig = es.monthBrandLabels.indexOf('FIGARO');
  check('12 months', es.monthly.length === 12);
  check('Jan Angel\'s = 2 (curly apostrophe normalized)', es.monthly[0].byBrand[ap] === '2', es.monthly[0]);
  check('Feb Figaro = 2', es.monthly[1].byBrand[fig] === '2', es.monthly[1]);
  check('Feb total = 3', es.monthly[1].total === '3', es.monthly[1]);
  check('Dec 2025 row excluded from 2026', es.monthly[11].total === '0', es.monthly[11]);
  check('grand total = 6 rows in 2026', es.monthlyTotal.total === '6', es.monthlyTotal);
  const es25 = newSandbox(LOG, ROSTER).getExecutiveSummaryReport(2025);
  check('year 2025 shows only the Dec 2025 row', es25.monthlyTotal.total === '1' && es25.monthly[11].total === '1', es25.monthlyTotal);
}

console.log('\n── Region & purpose with percentages ──');
{
  const es = newSandbox(LOG, ROSTER).getExecutiveSummaryReport(2026);
  check('NCR 4 of 7 = 57.1%', es.region[0].visits === '4' && es.region[0].pct === '57.1%', es.region[0]);
  check('region total 100.0%', es.regionTotal.visits === '7' && es.regionTotal.pct === '100.0%', es.regionTotal);
  check('purpose STORE VISIT 4 = 57.1%', es.purpose[0].count === '4' && es.purpose[0].pct === '57.1%', es.purpose[0]);
  check('purpose total 7', es.purposeTotal.count === '7', es.purposeTotal);
}

console.log('\n── Top stores & leaderboard ──');
{
  const es = newSandbox(LOG, ROSTER).getExecutiveSummaryReport(2026);
  check('top store is AP MAKATI with 3', es.topStores[0].name === 'AP MAKATI' && es.topStores[0].visits === '3', es.topStores[0]);
  check('ranks are 1..n', es.topStores.map(s => s.rank).join(',') === '1,2,3,4', es.topStores);
  const lb = Object.fromEntries(es.leaderboard.map(v => [v.name, v.visits]));
  check('LEO = 3 (incl. pipe-delimited row)', lb.LEO === '3', lb);
  check('ANN = 3 (duplicate name in one row counted once)', lb.ANN === '3', lb);
  check('roster member with no visits still listed with 0', lb.NOBODY === '0', lb);
  check('visitor not on roster is excluded', !('GHOST' in lb), lb);
  check('sorted by visits desc', es.leaderboard[0].visits >= es.leaderboard[es.leaderboard.length - 1].visits);
}

console.log('\n── Brand performance ──');
{
  const es = newSandbox(LOG, ROSTER).getExecutiveSummaryReport(2026);
  const fig = es.brandPerformance.find(b => b.brand === 'FIGARO');
  check('Figaro total 2, peak FEBRUARY 2', fig.total === '2' && fig.peakMonth === 'FEBRUARY' && fig.peakCount === '2', fig);
  check('brand pct uses 2 decimals', /^\d+\.\d\d%$/.test(fig.pct), fig.pct);
  check('brand total = 7', es.brandTotal.total === '7', es.brandTotal);
}

console.log('\n── Edge cases ──');
{
  const es = newSandbox([], ROSTER).getExecutiveSummaryReport(2026);
  check('empty MASTER_LOG returns zeros, not an error', es.kpi[0].value === '0' && es.region[0].pct === '0.0%', es.kpi[0]);
  let msg = '';
  try { newSandbox(LOG, ROSTER, { noMasterLog: true }).getExecutiveSummaryReport(2026); } catch (e) { msg = e.message; }
  check('missing MASTER_LOG gives a clear error', /MASTER_LOG/.test(msg), msg);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
process.exit(fail ? 1 : 0);
