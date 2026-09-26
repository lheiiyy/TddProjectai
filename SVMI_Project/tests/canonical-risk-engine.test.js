// Regression test for retiring SVMKPI_STORE_LOOKUP.gs's old, independent
// "Bible §6" risk formula (SL_RISK / _sl_computeHealth — removed) in favor
// of the SAME canonical engine Store Health already uses
// (_computeStoreRisk(), SVMKPI_RISK.gs), via the new
// _sl_computeCanonicalHealth() helper. Before this fix, Store Insights'
// single-store health card and the Store Health sheet could score the
// exact same store completely differently (e.g. a never-visited store
// scored HIGH here via a days-since/30 penalty, but only the modest
// "no history" +3 on Store Health).
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs + SVMKPI_RISK.gs +
// SVMKPI_STORE_LOOKUP.gs) in a Node vm sandbox, same approach as the
// project's other .gs-in-a-sandbox tests.
//
// vm.createContext() gives each sandbox its own realm with its own Date
// constructor — a Date built from one sandbox's constructor is not
// `instanceof` another sandbox's Date. So every scenario below builds its
// mock rows using ITS OWN sandbox's Date (passed into the buildRows
// callback), never a Date shared across sandboxes.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const coreSrc   = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CORE.gs'), 'utf8');
const yearSrc   = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_REPORTING_YEAR.gs'), 'utf8');
const riskSrc   = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_RISK.gs'), 'utf8');
const lookupSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_STORE_LOOKUP.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

// ── Minimal read-only Sheet mocks ──────────────────────────────────────
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
    getRange: (row, col, numRows) => ({
      getValues: () => rows.slice(row - 2, row - 2 + numRows),
    }),
  };
}

// buildRows(SDate) -> { masterLogRows, settingsRows } — receives THIS
// sandbox's own Date constructor so mock data is always same-realm.
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
  vm.runInContext(coreSrc, sandbox);   // declares DATA_YEAR, APPROVED_PURPOSES, COL, _getData(), _parseDateCell()
  vm.runInContext(yearSrc, sandbox);   // declares getDefaultReportingYear() (Phase 1C) — _computeStoreRisk()'s fallback
  vm.runInContext(riskSrc, sandbox);   // declares _computeStoreRisk()
  vm.runInContext(lookupSrc, sandbox); // declares sl_getStoreData(), _sl_computeCanonicalHealth()

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

  return { sandbox, masterLog, settings, SDate };
}

// ── Scenario 1: a normal, actively-visited store ───────────────────────
console.log('\n── A visited store: Store Insights and Store Health agree exactly ──');
{
  const { sandbox, SDate } = newSandbox((D) => ({
    masterLogRows: [
      ['2026-01-05 09:00:00', new D(2026, 0, 5), 'ALPHA', 'FIGARO', 'NCR', 'LEO', 'STORE VISIT', ''],
      ['2026-03-10 09:00:00', new D(2026, 2, 10), 'ALPHA', 'FIGARO', 'NCR', 'LEO', 'FAILED QA/MS', ''],
    ],
    settingsRows: [['ALPHA', 'FIGARO', 'NCR', '', 'NCR']],
  }));

  const data = sandbox._getData(sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));
  const today = new SDate(2026, 8, 14);
  const canonicalRow = sandbox._computeStoreRisk(data, today).find(r => r.store === 'ALPHA');
  check('canonical engine produced a row for ALPHA', !!canonicalRow);

  const health = sandbox._sl_computeCanonicalHealth(
    sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'), 'ALPHA'
  );
  check('Store Insights score matches Store Health score exactly',
    health.score === canonicalRow.riskScore,
    'insights=' + health.score + ' health=' + canonicalRow.riskScore);
  check('Store Insights tier matches Store Health tier exactly',
    health.label === canonicalRow.riskTier,
    'insights=' + health.label + ' health=' + canonicalRow.riskTier);

  // Full integration: sl_getStoreData() itself (not just the helper) must
  // wire the same values through to its own health field.
  const full = sandbox.sl_getStoreData('ALPHA');
  check('sl_getStoreData().health matches the canonical engine end-to-end',
    full.health.score === canonicalRow.riskScore && full.health.label === canonicalRow.riskTier,
    JSON.stringify(full.health));
}

// ── Scenario 2: a never-visited store — the case the old formula got wrong ─
console.log('\n── A never-visited store: no longer inflated to HIGH by a separate formula ──');
{
  const { sandbox, SDate } = newSandbox((D) => ({
    settingsRows: [['BETA', 'APEX', 'NCR', '', 'NCR']],
  }));

  const data = sandbox._getData(sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));
  const today = new SDate(2026, 8, 14);
  const canonicalRow = sandbox._computeStoreRisk(data, today).find(r => r.store === 'BETA');
  check('canonical engine seeds a never-visited store from SETTINGS', !!canonicalRow);
  check('canonical engine: never-visited scores the modest +3 (NO HISTORY), not a >30 penalty',
    canonicalRow.riskScore === 3, canonicalRow.riskScore);

  // BETA has zero MASTER_LOG rows, so sl_getStoreData() takes the
  // _sl_emptyResult() path — that path must ALSO reach the canonical
  // engine, not fall back to a neutral/zero score of its own invention.
  const full = sandbox.sl_getStoreData('BETA');
  check('sl_getStoreData() empty-result path still matches the canonical engine',
    full.health.score === canonicalRow.riskScore && full.health.label === canonicalRow.riskTier,
    JSON.stringify(full.health) + ' vs canonical=' + JSON.stringify({ score: canonicalRow.riskScore, label: canonicalRow.riskTier }));
}

// ── Scenario 3: a store visited but no longer in SETTINGS (removed) ────
console.log('\n── A store removed from SETTINGS but still visited: both surfaces still agree ──');
{
  const { sandbox, SDate } = newSandbox((D) => ({
    masterLogRows: [
      ['2026-02-01 09:00:00', new D(2026, 1, 1), 'GAMMA', 'FIGARO', 'NCR', 'YANA', 'STORE VISIT', ''],
    ],
    // GAMMA not in SETTINGS at all
  }));

  const data = sandbox._getData(sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MASTER_LOG'));
  const today = new SDate(2026, 8, 14);
  const canonicalRow = sandbox._computeStoreRisk(data, today).find(r => r.store === 'GAMMA');
  check('canonical engine keeps a SETTINGS-removed store via its MASTER_LOG fallback', !!canonicalRow);
  check('category degrades to "—" for a store with no SETTINGS row', canonicalRow.category, '—');

  const full = sandbox.sl_getStoreData('GAMMA');
  check('sl_getStoreData() matches the canonical engine for a SETTINGS-removed store',
    full.health.score === canonicalRow.riskScore && full.health.label === canonicalRow.riskTier,
    JSON.stringify(full.health));
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
