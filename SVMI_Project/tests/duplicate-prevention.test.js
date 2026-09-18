// Phase 0.5: exact-duplicate blocking, enforced server-side inside
// processSubmissionAsync()'s LockService section (INPUT_PORTAL.gs).
//
// Business rule: a duplicate is the same Store + same Visitor + same
// calendar date. Store is matched by normalized NAME as an interim
// identity key (Store ID doesn't exist until a later migration — this
// will be re-keyed then). checkDuplicateVisit() remains a separate,
// unlocked, advisory-only pre-submit warning with its own broader
// "any visit in the last 7 days" definition — it is NOT the authority
// here; the final accept/reject decision happens only inside the lock,
// re-reading MASTER_LOG fresh, so it can never depend on a stale
// browser-side check.
//
// "Two simultaneous submissions" is tested the standard way for a
// single-threaded JS test harness: two sequential calls against the SAME
// mutable mock MASTER_LOG, where the mock's appendRow() and getRange()
// share the same backing array. LockService's real job (in Apps Script,
// across genuinely concurrent executions) is to serialize access to that
// shared critical section — sequential calls sharing state is exactly
// what that serialization guarantees the code will observe, which is the
// invariant under test: whichever submission's lock is granted second
// must see the first one's write already committed.
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs + INPUT_PORTAL.gs) in a
// Node vm sandbox.

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

// A live, stateful MASTER_LOG mock — appendRow() and getRange() share the
// same backing array, so a later call sees an earlier call's committed
// write, exactly like the real sheet would.
function makeMasterLogSheet() {
  const rows = [];
  return {
    _rows: rows,
    getLastRow: () => rows.length + 1,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => rows.slice(row - 2, row - 2 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
    }),
    appendRow: (row) => { rows.push(row); },
  };
}

function newSandbox() {
  const master = makeMasterLogSheet();
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (name) => (name === 'MASTER_LOG' ? master : null) }),
      flush: () => {},
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return fmt.indexOf('HH') !== -1 ? `${y}-${m}-${d} 00:00:00` : `${y}-${m}-${d}`;
      },
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);  // declares _parseDateCell()
  vm.runInContext(inputSrc, sandbox); // declares processSubmissionAsync(), _findExactDuplicateVisitor()
  return { sandbox, master };
}

console.log('\n── Exact duplicate: same Store + same Visitor + same date -> blocked ──');
{
  const { sandbox, master } = newSandbox();
  const first = sandbox.processSubmissionAsync(makePayload());
  check('first submission succeeds', first.success === true, JSON.stringify(first));

  const second = sandbox.processSubmissionAsync(makePayload());
  check('exact-duplicate second submission is rejected', second.success === false, JSON.stringify(second));
  check('rejection is flagged as a duplicate', second.duplicate === true, JSON.stringify(second));
  check('rejection message names the visitor/store/date', /LEO/.test(second.message) && /ALPHA/.test(second.message), second.message);
  check('exactly one row was ever written to MASTER_LOG', master._rows.length === 1, master._rows.length);
}

console.log('\n── Same store, DIFFERENT visitor, same date -> allowed ──');
{
  const { sandbox, master } = newSandbox();
  sandbox.processSubmissionAsync(makePayload({ visitedBy: 'LEO' }));
  const r = sandbox.processSubmissionAsync(makePayload({ visitedBy: 'YANA' }));
  check('a different visitor to the same store on the same date is NOT a duplicate', r.success === true, JSON.stringify(r));
  check('both rows were written', master._rows.length === 2, master._rows.length);
}

console.log('\n── Same store, same visitor, DIFFERENT date -> allowed ──');
{
  const { sandbox, master } = newSandbox();
  sandbox.processSubmissionAsync(makePayload({ dateVisited: '2026-03-10' }));
  const r = sandbox.processSubmissionAsync(makePayload({ dateVisited: '2026-03-11' }));
  check('the same visitor revisiting the same store on a different date is NOT a duplicate', r.success === true, JSON.stringify(r));
  check('both rows were written', master._rows.length === 2, master._rows.length);
}

console.log('\n── DIFFERENT store, same visitor, same date -> allowed ──');
{
  const { sandbox, master } = newSandbox();
  sandbox.processSubmissionAsync(makePayload({ store: 'ALPHA' }));
  const r = sandbox.processSubmissionAsync(makePayload({ store: 'BETA' }));
  check('the same visitor at a different store on the same date is NOT a duplicate', r.success === true, JSON.stringify(r));
  check('both rows were written', master._rows.length === 2, master._rows.length);
}

console.log('\n── Multi-visitor submissions: duplicate is per-individual, not per-combination ──');
{
  const { sandbox, master } = newSandbox();
  const first = sandbox.processSubmissionAsync(makePayload({ visitedBy: ['LEO', 'YANA'] }));
  check('multi-visitor submission succeeds', first.success === true, JSON.stringify(first));

  // GIO wasn't on the first submission, but LEO was — this must still be
  // caught, because the business risk (LEO's visit logged twice) exists
  // regardless of who else is added to the second submission.
  const second = sandbox.processSubmissionAsync(makePayload({ visitedBy: ['LEO', 'GIO'] }));
  check('a submission sharing even ONE visitor with an existing same-store/date row is blocked',
    second.success === false && second.duplicate === true, JSON.stringify(second));

  const third = sandbox.processSubmissionAsync(makePayload({ visitedBy: ['GIO', 'RICE'] }));
  check('a submission sharing NO visitor with the existing row is allowed',
    third.success === true, JSON.stringify(third));
}

console.log('\n── Simultaneous submissions: the second can never create the same exact visit ──');
{
  const { sandbox, master } = newSandbox();
  const payload = makePayload();

  // Two "simultaneous" submissions, modeled as sequential calls sharing
  // the same mutable MASTER_LOG mock — see file header for why this is
  // the correct way to test lock-serialized atomicity in a single-threaded
  // harness. If the duplicate check ran OUTSIDE the lock (the pre-fix
  // behavior), both of these would very plausibly both succeed in a real
  // concurrent scenario; with the check moved inside the lock and re-
  // reading fresh state, the second call is guaranteed to see the first's
  // commit before it decides.
  const resultA = sandbox.processSubmissionAsync(payload);
  const resultB = sandbox.processSubmissionAsync(payload);

  const succeeded = [resultA, resultB].filter(r => r.success);
  check('exactly one of the two simultaneous submissions succeeds', succeeded.length === 1,
    JSON.stringify({ resultA, resultB }));
  check('exactly one row exists in MASTER_LOG afterward (no double-write)', master._rows.length === 1, master._rows.length);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
