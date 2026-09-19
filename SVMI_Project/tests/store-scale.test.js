// Phase 1B spec item "18. SCALE TESTING": verify the Store-ID-aware
// duplicate-visitor lookup (_findRecordedVisitors(), inside
// processSubmissionAsync()'s LockService section) still scans the WHOLE
// MASTER_LOG at 4,999 / 5,000 / 5,001 / 10,000 data rows — i.e. that
// Phase 1B did not reintroduce a hardcoded scan-range ceiling like the
// old literal 5000 caps Phase 0 removed (see MASTER_LOG_MAX_ROW in
// SVMKPI_CORE.gs, now 200000 and unrelated to this lookup, which reads
// via master.getLastRow() dynamically).
//
// Mocks/fixtures only — no live data, per the Phase 1B "NO LIVE DATA"
// constraint. Runs the REAL Apps Script code (SVMKPI_CORE.gs +
// SVMKPI_CONFIG.gs + SVMKPI_STORE_CONFIG.gs + INPUT_PORTAL.gs) in a Node
// vm sandbox.

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

// A lighter-weight writable-sheet mock than the generic Proxy one used in
// the other test files — plain 2D array storage, sized for tens of
// thousands of cells without per-cell object-key overhead.
function makeFastSheet() {
  const rows = []; // rows[0] is row 1 (1-indexed rows -> 0-indexed array)
  function ensureRow(r) { while (rows.length < r) rows.push([]); return rows[r - 1]; }

  function makeRange(row, col, numRows, numCols) {
    return {
      setValues: (vals) => {
        for (let r = 0; r < numRows; r++) {
          const target = ensureRow(row + r);
          for (let c = 0; c < numCols; c++) target[col - 1 + c] = vals[r][c];
        }
        return this;
      },
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = rows[row + r - 1] || [];
          const rowArr = [];
          for (let c = 0; c < numCols; c++) rowArr.push(src[col - 1 + c] == null ? '' : src[col - 1 + c]);
          out.push(rowArr);
        }
        return out;
      },
      setFontWeight: () => this,
    };
  }

  return {
    getLastRow: () => rows.length,
    getRange: (row, col, numRows, numCols) => makeRange(row, col, numRows || 1, numCols || 1),
    appendRow: (rowArr) => { rows.push(rowArr.slice()); },
  };
}

function newSandbox() {
  const master = makeFastSheet();
  const sheets = { MASTER_LOG: master };
  const ssMock = {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => { sheets[name] = makeFastSheet(); return sheets[name]; },
  };
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

function makePayload(overrides) {
  return Object.assign({
    store: 'ALPHA', brand: 'FIGARO', region: 'NCR',
    dateVisited: '2026-09-18', visitedBy: 'JOHN', purpose: 'STORE VISIT', remarks: '',
  }, overrides || {});
}

[4999, 5000, 5001, 10000].forEach((N) => {
  console.log(`\n── Scale: ${N} existing MASTER_LOG data rows, duplicate target as the very LAST row ──`);
  const { sandbox, master } = newSandbox();

  // Header row.
  master.getRange(1, 1, 1, 9).setValues([['Timestamp', 'Date', 'Store', 'Brand', 'Region', 'Visited By', 'Purpose', 'Remarks', 'Store ID']]);

  // N-1 filler rows, bulk-written in one setValues() call — distinct
  // store/visitor/date combinations so none of them can be mistaken for
  // the duplicate target below.
  const filler = [];
  for (let i = 0; i < N - 1; i++) {
    const day = String((i % 27) + 1).padStart(2, '0');
    const month = String(((i / 27) % 12 | 0) + 1).padStart(2, '0');
    filler.push([
      '2026-01-01 08:00:00', `2026-${month}-${day}`, 'FILLER', 'FIGARO', 'NCR',
      'FILLER_VISITOR_' + i, 'STORE VISIT', '', '',
    ]);
  }
  if (filler.length) master.getRange(2, 1, filler.length, 9).setValues(filler);

  // The specific already-recorded visit, placed as the LAST data row (row
  // N+1) — the position most likely to be silently missed if any scan-range
  // ceiling were ever reintroduced.
  master.appendRow(['2026-09-18 08:00:00', '2026-09-18', 'ALPHA', 'FIGARO', 'NCR', 'JOHN', 'STORE VISIT', '', '']);

  check(`MASTER_LOG has exactly ${N} data rows before the test submission`, master.getLastRow() === N + 1, master.getLastRow());

  const dupResult = sandbox.processSubmissionAsync(makePayload({ visitedBy: 'JOHN' }));
  check('the exact duplicate (JOHN/ALPHA/2026-09-18), sitting at the very last row, is still found — no scan ceiling', dupResult.success === true && dupResult.allDuplicates === true, JSON.stringify(dupResult));
  check('no new row was written for the duplicate submission', master.getLastRow() === N + 1, master.getLastRow());

  const newResult = sandbox.processSubmissionAsync(makePayload({ visitedBy: 'NEWGUY' }));
  check('a genuinely new visitor on the same store/date is still recorded (not falsely flagged)', newResult.success === true && !newResult.allDuplicates, JSON.stringify(newResult));
  check('the new row was actually appended', master.getLastRow() === N + 2, master.getLastRow());
});

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
