// Unit tests for _parseDateCell() (SVMKPI_CORE.gs) — the single shared
// date parser that replaced three independent implementations
// (processSubmissionAsync()'s write-side manual split, _getData()'s
// former inline `new Date(row[...])` fallback which never routed through
// the script timezone, and checkDuplicateVisit()'s own rebuild).
//
// Runs the REAL Apps Script code in a Node vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const coreSrc  = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CORE.gs'), 'utf8');
const inputSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'INPUT_PORTAL.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

function newSandbox() {
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
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
  return sandbox;
}

const sandbox = newSandbox();
const SDate = vm.runInContext('Date', sandbox);

console.log('\n── _parseDateCell(): string inputs ──');
{
  const r = sandbox._parseDateCell('2026-03-10');
  check('plain YYYY-MM-DD string parses correctly', r && r.getFullYear() === 2026 && r.getMonth() === 2 && r.getDate() === 10, r);
}
{
  const r = sandbox._parseDateCell('2026-03-10T15:45:00.000Z');
  check('a full ISO timestamp string still parses (first 10 chars used)',
    r && r.getFullYear() === 2026 && r.getMonth() === 2 && r.getDate() === 10, r);
}
{
  check('empty string -> null', sandbox._parseDateCell('') === null);
  check('null -> null', sandbox._parseDateCell(null) === null);
  check('undefined -> null', sandbox._parseDateCell(undefined) === null);
  check('garbage string -> null', sandbox._parseDateCell('not-a-date') === null);
  check('too few date parts -> null', sandbox._parseDateCell('2026-03') === null);
}

console.log('\n── _parseDateCell(): Date-object inputs ──');
{
  const r = sandbox._parseDateCell(new SDate(2026, 2, 10));
  check('a real Date object round-trips to the same day', r && r.getFullYear() === 2026 && r.getMonth() === 2 && r.getDate() === 10, r);
}
{
  // A Sheets cell that somehow carries a time-of-day component must still
  // normalize to local midnight — this is the exact bug class this fix
  // closes: two visits on the same calendar day but different times used
  // to compare as different `.getTime()` values elsewhere in the project.
  const withTime = sandbox._parseDateCell(new SDate(2026, 2, 10, 15, 30, 0));
  check('a Date with a time-of-day component strips to local midnight',
    withTime.getHours() === 0 && withTime.getMinutes() === 0 && withTime.getSeconds() === 0, withTime);
}
{
  const invalidDate = new SDate('not-a-real-date');
  check('an Invalid Date object -> null', sandbox._parseDateCell(invalidDate) === null);
}

console.log('\n── checkDuplicateVisit(): integration with the shared parser ──');
{
  const sandbox2 = newSandbox();
  // Each vm.createContext() has its own separate Date constructor — a
  // Date built via the outer SDate is not `instanceof` sandbox2's Date,
  // so mock data destined for sandbox2 must use sandbox2's own Date.
  const SDate2 = vm.runInContext('Date', sandbox2);
  const master = {
    getLastRow: () => 2,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => [
        // Timestamp, Date, Store, Brand, Region, VisitedBy, Purpose, Remarks
        ['2026-03-07 09:00:00', new SDate2(2026, 2, 7), 'ALPHA', 'FIGARO', 'NCR', 'LEO', 'STORE VISIT', ''],
      ],
    }),
  };
  sandbox2.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: (n) => (n === 'MASTER_LOG' ? master : null) });
  vm.runInContext(inputSrc, sandbox2);

  const result = sandbox2.checkDuplicateVisit({ store: 'Alpha', dateVisited: '2026-03-10' });
  check('a visit 3 days earlier at the same store is flagged as a duplicate warning',
    result.duplicate === true && result.rows.length === 1 && result.rows[0].daysSince === 3,
    JSON.stringify(result));

  const noMatch = sandbox2.checkDuplicateVisit({ store: 'BETA', dateVisited: '2026-03-10' });
  check('a different store is never flagged', noMatch.duplicate === false, JSON.stringify(noMatch));

  const badDate = sandbox2.checkDuplicateVisit({ store: 'ALPHA', dateVisited: 'garbage' });
  check('a malformed submitted date fails safe (no throw, no duplicate)', badDate.duplicate === false, JSON.stringify(badDate));
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
