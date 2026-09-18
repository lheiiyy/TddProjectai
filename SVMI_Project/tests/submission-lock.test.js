// Unit tests for the LockService fix in processSubmissionAsync()
// (INPUT_PORTAL.gs): the MASTER_LOG write is now wrapped in a script
// lock so two near-simultaneous visit submissions can never interleave.
// Covers: normal submission still succeeds and releases the lock;
// contention (tryLock fails) returns a clean failure WITHOUT writing
// anything; and the lock is still released even if the write itself
// throws mid-way.
//
// Runs the REAL Apps Script code (INPUT_PORTAL.gs) in a Node vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const inputSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'INPUT_PORTAL.gs'), 'utf8');
const coreSrc  = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CORE.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

function makePayload(overrides) {
  return Object.assign({
    store: 'ALPHA',
    brand: 'FIGARO',
    region: 'NCR',
    dateVisited: '2026-03-10',
    visitedBy: 'LEO',
    purpose: 'STORE VISIT',
    remarks: '',
  }, overrides || {});
}

function newSandbox({ tryLockReturns = true, appendRowThrows = false } = {}) {
  const appendedRows = [];
  const lockCalls = { tryLock: 0, releaseLock: 0 };
  const master = {
    // Empty log (header row only) — the in-lock duplicate check
    // (_findExactDuplicateVisitor) short-circuits on getLastRow() < 2, so
    // these lock-mechanics tests never hit an actual duplicate.
    getLastRow: () => 1,
    getRange: () => ({ getValues: () => [] }),
    appendRow: (row) => {
      if (appendRowThrows) throw new Error('simulated write failure');
      appendedRows.push(row);
    },
  };
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (name) => (name === 'MASTER_LOG' ? master : null) }),
      flush: () => {},
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: (ms) => { lockCalls.tryLock++; return tryLockReturns; },
        releaseLock: () => { lockCalls.releaseLock++; },
      }),
    },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return fmt.indexOf('HH') !== -1 ? `${y}-${m}-${d} 00:00:00` : `${y}-${m}-${d}`;
      },
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);  // declares _parseDateCell(), used by processSubmissionAsync()
  vm.runInContext(inputSrc, sandbox);
  return { sandbox, appendedRows, lockCalls };
}

console.log('\n── Normal submission: acquires and releases the lock, writes once ──');
{
  const { sandbox, appendedRows, lockCalls } = newSandbox();
  const result = sandbox.processSubmissionAsync(makePayload());
  check('submission succeeds', result && result.success === true, JSON.stringify(result));
  check('exactly one row written', appendedRows.length === 1, appendedRows.length);
  check('lock was acquired', lockCalls.tryLock === 1);
  check('lock was released', lockCalls.releaseLock === 1);
}

console.log('\n── Contention: tryLock() fails -> clean failure, nothing written ──');
{
  const { sandbox, appendedRows, lockCalls } = newSandbox({ tryLockReturns: false });
  const result = sandbox.processSubmissionAsync(makePayload());
  check('submission reports busy, not a crash', result && result.success === false, JSON.stringify(result));
  check('failure message mentions being busy', /busy/i.test(result.message), result.message);
  check('nothing was written to MASTER_LOG', appendedRows.length === 0);
  check('lock was never released (never acquired)', lockCalls.releaseLock === 0);
}

console.log('\n── A write failure mid-lock still releases the lock ──');
{
  const { sandbox, appendedRows, lockCalls } = newSandbox({ appendRowThrows: true });
  const result = sandbox.processSubmissionAsync(makePayload());
  check('submission reports the failure, not a silent success', result && result.success === false, JSON.stringify(result));
  check('lock was still released despite the write throwing', lockCalls.releaseLock === 1);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
