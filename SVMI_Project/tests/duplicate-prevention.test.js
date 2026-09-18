// Phase 1B: partial-accept duplicate visitor handling, keyed by Store ID
// (with a name-based fallback for pre-migration data), enforced inside
// processSubmissionAsync()'s LockService section (INPUT_PORTAL.gs).
//
// Business rule (revised from Phase 0.5's whole-submission rejection):
// duplicate identity is Store ID + Visitor + calendar date. A submission
// with SOME already-recorded visitors is not rejected outright — the
// already-recorded ones are skipped (with a warning), and any genuinely
// new visitor on the same submission is still recorded. All four of the
// spec's worked examples are covered below by name.
//
// "Two simultaneous submissions" is tested the same way established in
// Phase 0.5: two sequential calls sharing one mutable mock MASTER_LOG —
// see that file's original header comment for why this is the correct
// way to test lock-serialized atomicity in a single-threaded harness.
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs + SVMKPI_CONFIG.gs +
// SVMKPI_STORE_CONFIG.gs + INPUT_PORTAL.gs) in a Node vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const coreSrc        = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CORE.gs'), 'utf8');
const configSrc       = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CONFIG.gs'), 'utf8');
const storeConfigSrc  = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_STORE_CONFIG.gs'), 'utf8');
const inputSrc        = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'INPUT_PORTAL.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

function makePayload(overrides) {
  return Object.assign({
    store: 'ALPHA', brand: 'FIGARO', region: 'NCR',
    dateVisited: '2026-09-18', visitedBy: 'JOHN', purpose: 'STORE VISIT', remarks: '',
  }, overrides || {});
}

// ── Generic writable Sheet mock shared by MASTER_LOG and every CONFIG_*
//    sheet SVMKPI_STORE_CONFIG.gs/SVMKPI_CONFIG.gs create on demand ────
function makeWritableSheet() {
  const cells = {};
  let maxRow = 0;
  const key = (r, c) => r + ',' + c;
  function setCell(r, c, v) { cells[key(r, c)] = v; if (r > maxRow) maxRow = r; }
  function getCell(r, c) { const v = cells[key(r, c)]; return v == null ? '' : v; }

  function makeRange(row, col, numRows, numCols) {
    const range = {};
    let proxy;
    range.setValue = (v) => { setCell(row, col, v); return proxy; };
    range.setValues = (rows) => { rows.forEach((rowArr, ri) => rowArr.forEach((v, ci) => setCell(row + ri, col + ci, v))); return proxy; };
    range.getValue = () => getCell(row, col);
    range.getValues = () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const rowArr = [];
        for (let c = 0; c < numCols; c++) rowArr.push(getCell(row + r, col + c));
        out.push(rowArr);
      }
      return out;
    };
    proxy = new Proxy(range, {
      get(target, prop) { if (prop in target) return target[prop]; if (typeof prop !== 'string') return undefined; return () => proxy; },
    });
    return proxy;
  }

  const sheet = {
    getLastRow: () => maxRow,
    getRange: (row, col, numRows, numCols) => makeRange(row, col, numRows || 1, numCols || 1),
    appendRow: (rowArr) => { const r = maxRow + 1; rowArr.forEach((v, i) => setCell(r, i + 1, v)); },
    _rowCount: () => Math.max(0, maxRow - 1),
  };
  let sproxy;
  sproxy = new Proxy(sheet, {
    get(target, prop) { if (prop in target) return target[prop]; if (typeof prop !== 'string') return undefined; return () => sproxy; },
  });
  return sproxy;
}

function makeSpreadsheetMock() {
  const sheets = {};
  return {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => { const s = makeWritableSheet(); sheets[name] = s; return s; },
    _sheets: sheets,
  };
}

function newSandbox() {
  const ssMock = makeSpreadsheetMock();
  const master = ssMock.insertSheet('MASTER_LOG'); // pre-created so tests can seed rows directly
  // The mock has no implicit header-row offset like the real sheet does —
  // write an explicit row 1 so getLastRow()/appendRow() behave the same
  // way processSubmissionAsync() already assumes (data starts at row 2).
  master.getRange(1, 1, 1, 9).setValues([['Timestamp', 'Date', 'Store', 'Brand', 'Region', 'Visited By', 'Purpose', 'Remarks', 'Store ID']]);
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return fmt.indexOf('HH') !== -1 ? `${y}-${m}-${d} 00:00:00` : `${y}-${m}-${d}`;
      },
      getUuid: (() => { let n = 0; return () => 'test-uuid-' + (++n); })(),
    },
    sl_isAdmin: () => true,
    sl_getCurrentUser: () => 'admin@test.com',
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(configSrc, sandbox);
  vm.runInContext(storeConfigSrc, sandbox);
  vm.runInContext(inputSrc, sandbox);
  return { sandbox, master };
}

// Seeds a raw MASTER_LOG row directly (bypassing processSubmissionAsync),
// to set up "existing visit" preconditions precisely.
function seedRow(master, opts) {
  master.appendRow([
    opts.timestamp || '2026-09-18 08:00:00',
    opts.date, opts.store, opts.brand || 'FIGARO', opts.region || 'NCR',
    opts.visitedBy, opts.purpose || 'STORE VISIT', opts.remarks || '',
    opts.storeId || '',
  ]);
}

console.log('\n── Single-visitor exact duplicate: fully skipped, nothing new to record ──');
{
  const { sandbox, master } = newSandbox();
  const first = sandbox.processSubmissionAsync(makePayload());
  check('first submission succeeds', first.success === true, JSON.stringify(first));

  const second = sandbox.processSubmissionAsync(makePayload());
  check('second identical submission is NOT an error (success:true)', second.success === true, JSON.stringify(second));
  check('flagged as all-duplicates, nothing new', second.allDuplicates === true, JSON.stringify(second));
  check('names the skipped visitor', /JOHN/.test(second.message), second.message);
  check('no second row was written', master._rowCount() === 1, master._rowCount());
}

console.log('\n── Example 1 from spec: existing John, submit John+Mary -> Mary recorded, John skipped ──');
{
  const { sandbox, master } = newSandbox();
  sandbox.processSubmissionAsync(makePayload({ visitedBy: 'John' }));

  const r = sandbox.processSubmissionAsync(makePayload({ visitedBy: ['John', 'Mary'] }));
  check('submission succeeds (partially)', r.success === true, JSON.stringify(r));
  check('flagged as a warning, not allDuplicates', r.warning === true && !r.allDuplicates, JSON.stringify(r));
  check('John is in skippedVisitors', r.skippedVisitors.includes('JOHN'), JSON.stringify(r.skippedVisitors));
  check('Mary is in recordedVisitors', r.recordedVisitors.includes('MARY'), JSON.stringify(r.recordedVisitors));
  check('Mary is NOT also in skippedVisitors', !r.skippedVisitors.includes('MARY'));

  check('exactly 2 rows exist total (original John + new Mary-only row)', master._rowCount() === 2, master._rowCount());
  const secondRow = master.getRange(3, 1, 1, 9).getValues()[0];
  check('the new row\'s Visited By is ONLY Mary, not "JOHN | MARY"', secondRow[5] === 'MARY', secondRow[5]);
}

console.log('\n── Example 2 from spec: existing John+Mary, submit Mary+Peter -> Peter recorded, Mary skipped ──');
{
  const { sandbox, master } = newSandbox();
  sandbox.processSubmissionAsync(makePayload({ visitedBy: ['John', 'Mary'] }));

  const r = sandbox.processSubmissionAsync(makePayload({ visitedBy: ['Mary', 'Peter'] }));
  check('submission succeeds (partially)', r.success === true, JSON.stringify(r));
  check('Mary is skipped', r.skippedVisitors.includes('MARY'), JSON.stringify(r));
  check('John is NOT mentioned (was never on this submission)', !r.skippedVisitors.includes('JOHN') && !r.recordedVisitors.includes('JOHN'));
  check('Peter is recorded', r.recordedVisitors.includes('PETER'), JSON.stringify(r));

  const secondRow = master.getRange(3, 1, 1, 9).getValues()[0];
  check('the new row\'s Visited By is ONLY Peter', secondRow[5] === 'PETER', secondRow[5]);
}

console.log('\n── Example 3 from spec: different Store ID, same visitor/date -> not a duplicate ──');
{
  const { sandbox, master } = newSandbox();
  sandbox.store_create({ storeName: 'ALPHA', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, '2020-01-01', 'setup', { backdateConfirmed: true });
  sandbox.store_create({ storeName: 'BETA', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, '2020-01-01', 'setup', { backdateConfirmed: true });

  const first = sandbox.processSubmissionAsync(makePayload({ store: 'ALPHA', visitedBy: 'John' }));
  check('first submission (ALPHA) succeeds', first.success === true, JSON.stringify(first));

  const second = sandbox.processSubmissionAsync(makePayload({ store: 'BETA', visitedBy: 'John' }));
  check('John at a DIFFERENT store on the same date is not a duplicate', second.success === true && !second.warning && !second.allDuplicates, JSON.stringify(second));
  check('both rows exist', master._rowCount() === 2, master._rowCount());

  const row1StoreId = master.getRange(2, 1, 1, 9).getValues()[0][8];
  const row2StoreId = master.getRange(3, 1, 1, 9).getValues()[0][8];
  check('the two rows carry two DIFFERENT, non-blank Store IDs', row1StoreId && row2StoreId && row1StoreId !== row2StoreId, row1StoreId + ' vs ' + row2StoreId);
}

console.log('\n── Example 4 from spec: same Store ID/visitor, different date -> not a duplicate ──');
{
  const { sandbox, master } = newSandbox();
  sandbox.processSubmissionAsync(makePayload({ dateVisited: '2026-09-18', visitedBy: 'John' }));
  const r = sandbox.processSubmissionAsync(makePayload({ dateVisited: '2026-09-19', visitedBy: 'John' }));
  check('John revisiting the next day is not a duplicate', r.success === true && !r.warning && !r.allDuplicates, JSON.stringify(r));
  check('both rows exist', master._rowCount() === 2, master._rowCount());
}

console.log('\n── All-new submission: no warning field at all (unchanged common case) ──');
{
  const { sandbox } = newSandbox();
  const r = sandbox.processSubmissionAsync(makePayload({ visitedBy: ['Gio', 'Rice'] }));
  check('a submission with no overlap succeeds cleanly', r.success === true, JSON.stringify(r));
  check('no warning/allDuplicates flags on a clean submission', !r.warning && !r.allDuplicates, JSON.stringify(r));
}

console.log('\n── Backward compatibility: falls back to name-based matching when Store ID is not yet resolvable ──');
{
  // No store_create() call at all — simulates a not-yet-migrated
  // environment, exactly Phase 0.5's behavior.
  const { sandbox, master } = newSandbox();
  sandbox.processSubmissionAsync(makePayload({ visitedBy: 'John' }));
  const r = sandbox.processSubmissionAsync(makePayload({ visitedBy: ['John', 'Mary'] }));
  check('duplicate detection still works by name when no Store ID exists yet', r.warning === true && r.skippedVisitors.includes('JOHN'), JSON.stringify(r));
  const secondRow = master.getRange(3, 1, 1, 9).getValues()[0];
  check('rows written before migration have a blank Store ID column, not an error', secondRow[8] === '', JSON.stringify(secondRow));
}

console.log('\n── Concurrency: two simultaneous identical submissions never both fully succeed ──');
{
  const { sandbox, master } = newSandbox();
  const payload = makePayload();
  const resultA = sandbox.processSubmissionAsync(payload);
  const resultB = sandbox.processSubmissionAsync(payload);
  check('exactly one of the two records John (the other sees allDuplicates)',
    [resultA, resultB].filter(r => r.success && !r.allDuplicates).length === 1,
    JSON.stringify({ resultA, resultB }));
  check('exactly one row exists afterward (no double-write)', master._rowCount() === 1, master._rowCount());
}

console.log('\n── Concurrency: overlapping multi-visitor submissions never create a duplicate visitor record ──');
{
  const { sandbox, master } = newSandbox();
  const resultA = sandbox.processSubmissionAsync(makePayload({ visitedBy: ['John', 'Mary'] }));
  const resultB = sandbox.processSubmissionAsync(makePayload({ visitedBy: ['Mary', 'Peter'] }));
  check('submission A records John+Mary', resultA.success === true && !resultA.warning);
  check('submission B skips Mary, records Peter', resultB.success === true && resultB.skippedVisitors.includes('MARY') && resultB.recordedVisitors.includes('PETER'));

  check('exactly 2 rows total', master._rowCount() === 2, master._rowCount());
  const allVisitors = [1, 2].map(r => master.getRange(r + 1, 1, 1, 9).getValues()[0][5]).join(' | ').split('|').map(v => v.trim());
  const maryCount = allVisitors.filter(v => v === 'MARY').length;
  check('Mary appears in the log exactly once across both rows, never duplicated', maryCount === 1, allVisitors.join(','));
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
