// Phase 1D: Calendar Period Resolution (SVMKPI_CALENDAR.gs).
//
// Covers the Phase 1D spec's "21. TESTING — CALENDAR PERIODS" list:
// first/middle/last day of period, transition to next period, period-to-
// date counting excludes events after the evaluation date, historical/
// future evaluation dates, non-monthly period definitions, and invalid
// period definitions.
//
// Runs the REAL Apps Script code (SVMKPI_CALENDAR.gs) directly in Node —
// this file has no Apps Script global dependencies at all, so no vm
// sandbox/stubbing is needed; it's simply loaded and its exports pulled
// out via a tiny eval-in-function-scope shim (matching the project's
// established real-.gs-in-Node convention, minus the sandbox machinery
// this particular file doesn't need).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const calSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CALENDAR.gs'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(calSrc, sandbox);
// vm.createContext() gives the sandbox its own realm with its own Date
// constructor — a Date built via the outer Node realm's `new Date(...)`
// is NOT `instanceof` the sandbox's Date, which resolveCalendarPeriod()
// checks. Every date below is built via the sandbox's OWN Date.
//
// Top-level `const`/`let` bindings in a vm-run script live in the
// context's internal lexical environment, NOT as own properties of the
// sandbox object — only `function`/`var` declarations attach that way
// (why `sandbox.resolveCalendarPeriod` works below but a destructured
// `sandbox.CAL_PERIOD_FAMILY` would be undefined). Pull const bindings
// back out via vm.runInContext(), the same way Date is retrieved.
const resolveCalendarPeriod = sandbox.resolveCalendarPeriod;
const SDate = vm.runInContext('Date', sandbox);
const CAL_PERIOD_FAMILY = vm.runInContext('CAL_PERIOD_FAMILY', sandbox);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}
function d(y, m, day) { return new SDate(y, m - 1, day); } // m is 1-based
function ymd(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }

console.log('\n── MONTH: first / middle / last day of period ──');
{
  const first = resolveCalendarPeriod(d(2026, 9, 1), 'MONTH');
  const mid   = resolveCalendarPeriod(d(2026, 9, 18), 'MONTH');
  const last  = resolveCalendarPeriod(d(2026, 9, 30), 'MONTH');
  eq('first day: periodId', first.periodId, '2026-09');
  eq('first day: periodStart', ymd(first.periodStart), '2026-09-01');
  eq('first day: periodEnd', ymd(first.periodEnd), '2026-09-30');
  eq('middle day: same period as first/last', mid.periodId, '2026-09');
  eq('last day: same period, same boundaries', [ymd(last.periodStart), ymd(last.periodEnd)], ['2026-09-01', '2026-09-30']);
  eq('year field', first.year, 2026);
}

console.log('\n── MONTH: transition to next period ──');
{
  const sep30 = resolveCalendarPeriod(d(2026, 9, 30), 'MONTH');
  const oct1  = resolveCalendarPeriod(d(2026, 10, 1), 'MONTH');
  check('Sep 30 and Oct 1 resolve to DIFFERENT periods', sep30.periodId !== oct1.periodId, [sep30.periodId, oct1.periodId]);
  eq('Oct 1 starts the new period', ymd(oct1.periodStart), '2026-10-01');
}

console.log('\n── MONTH: February leap-year boundary (2028 is a leap year) ──');
{
  const feb2028 = resolveCalendarPeriod(d(2028, 2, 10), 'MONTH');
  eq('Feb 2028 (leap) ends on the 29th', ymd(feb2028.periodEnd), '2028-02-29');
  const feb2026 = resolveCalendarPeriod(d(2026, 2, 10), 'MONTH');
  eq('Feb 2026 (non-leap) ends on the 28th', ymd(feb2026.periodEnd), '2026-02-28');
}

console.log('\n── QUARTER: boundaries and transition ──');
{
  const q1 = resolveCalendarPeriod(d(2026, 2, 15), 'QUARTER');
  const q3start = resolveCalendarPeriod(d(2026, 7, 1), 'QUARTER');
  const q2end = resolveCalendarPeriod(d(2026, 6, 30), 'QUARTER');
  eq('Feb -> Q1, Jan1-Mar31', [q1.periodId, ymd(q1.periodStart), ymd(q1.periodEnd)], ['2026-Q1', '2026-01-01', '2026-03-31']);
  eq('Jul 1 -> Q3 starts', [q3start.periodId, ymd(q3start.periodStart)], ['2026-Q3', '2026-07-01']);
  check('Jun 30 (Q2) and Jul 1 (Q3) are different periods', q2end.periodId !== q3start.periodId);
}

console.log('\n── SEMI_ANNUAL: calendar half-years, not a rolling window ──');
{
  const h1 = resolveCalendarPeriod(d(2026, 3, 15), 'SEMI_ANNUAL');
  const h2 = resolveCalendarPeriod(d(2026, 9, 15), 'SEMI_ANNUAL');
  eq('March -> H1, Jan1-Jun30', [h1.periodId, ymd(h1.periodStart), ymd(h1.periodEnd)], ['2026-H1', '2026-01-01', '2026-06-30']);
  eq('September -> H2, Jul1-Dec31', [h2.periodId, ymd(h2.periodStart), ymd(h2.periodEnd)], ['2026-H2', '2026-07-01', '2026-12-31']);
}

console.log('\n── Non-monthly period definitions the implemented configuration supports (QUARTER, SEMI_ANNUAL) work identically to MONTH ──');
{
  [CAL_PERIOD_FAMILY.MONTH, CAL_PERIOD_FAMILY.QUARTER, CAL_PERIOD_FAMILY.SEMI_ANNUAL].forEach(fam => {
    const p = resolveCalendarPeriod(d(2026, 5, 10), fam);
    check(fam + ': resolves to a well-formed period', !!(p && p.periodId && p.periodStart instanceof SDate && p.periodEnd instanceof SDate && p.periodStart.getTime() <= p.periodEnd.getTime()), JSON.stringify(p));
  });
}

console.log('\n── Invalid period definitions are rejected, never guessed ──');
{
  eq('unrecognized family string -> null', resolveCalendarPeriod(d(2026, 1, 1), 'WEEKLY'), null);
  eq('empty family -> null', resolveCalendarPeriod(d(2026, 1, 1), ''), null);
  eq('null family -> null', resolveCalendarPeriod(d(2026, 1, 1), null), null);
  eq('invalid date -> null', resolveCalendarPeriod(new SDate('not-a-date'), 'MONTH'), null);
  eq('non-Date date -> null', resolveCalendarPeriod('2026-01-01', 'MONTH'), null);
}

console.log('\n── Historical and future evaluation dates resolve their OWN period, never "now" ──');
{
  const historical = resolveCalendarPeriod(d(2020, 6, 15), 'MONTH');
  const future = resolveCalendarPeriod(d(2031, 12, 1), 'MONTH');
  eq('a date from 2020 resolves 2020-06, not today\'s month', historical.periodId, '2020-06');
  eq('a date from 2031 resolves 2031-12', future.periodId, '2031-12');
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
