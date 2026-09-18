// Unit tests for the Store Health risk-scoring engine (SVMKPI_RISK.gs).
// Unlike portal-ui.test.js/responsive-check.js (which drive the browser
// preview's demo mock backend), this runs the REAL Apps Script scoring
// code in a Node vm sandbox with SpreadsheetApp/SHEET/DATA_YEAR stubbed —
// there is no browser-side equivalent of this logic to test through the
// UI, since the demo's mock Store Health report uses its own simplified
// heuristic, not this file.
//
// vm.createContext() gives the sandbox its own realm with its own Date
// constructor — a Date built in this outer script is not `instanceof`
// the sandbox's Date, so every Date used in these tests is built via
// `new SDate(...)`, pulled out of the sandbox itself.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_RISK.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Sandbox: SpreadsheetApp/SHEET/DATA_YEAR stubbed, SETTINGS sheet mocked ──
function makeSettingsSheet(rows) {
  // rows: [store, brand, region, _unused, category][]
  return {
    getLastRow: () => rows.length + 1, // header row + data
    getRange: (row, col, numRows) => ({
      getValues: () => rows.slice(row - 2, row - 2 + numRows),
    }),
  };
}

function newSandbox(settingsRows) {
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => (name === 'SETTINGS' ? makeSettingsSheet(settingsRows || []) : null),
      }),
    },
    SHEET: { SETTINGS: 'SETTINGS', MASTER_LOG: 'MASTER_LOG' },
    DATA_YEAR: 2026,
    // Phase 1C: _computeStoreRisk() now takes an explicit `year` param,
    // falling back to getDefaultReportingYear() (SVMKPI_REPORTING_YEAR.gs)
    // when omitted — this sandbox doesn't load that file (it only tests
    // SVMKPI_RISK.gs in isolation), so stub the same fixed answer
    // DATA_YEAR used to give directly, matching this file's fixtures.
    getDefaultReportingYear: () => 2026,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

const sandbox = newSandbox();
const SDate = vm.runInContext('Date', sandbox);

console.log('\n── _sl_getCadenceDays ──');
eq('NCR -> 31', sandbox._sl_getCadenceDays('NCR'), 31);
eq('NEAR PROVINCIAL -> 31', sandbox._sl_getCadenceDays('NEAR PROVINCIAL'), 31);
eq('FAR PROVINCIAL -> 92', sandbox._sl_getCadenceDays('FAR PROVINCIAL'), 92);
eq('FLIGHT PROVINCIAL -> 183', sandbox._sl_getCadenceDays('FLIGHT PROVINCIAL'), 183);
eq('unrecognized category -> 0', sandbox._sl_getCadenceDays('BOGUS'), 0);

console.log('\n── _sl_computeComplianceScore ──');
const today = new SDate(2026, 8, 14); // Sep 14, 2026
eq('within cadence (Monthly, 10 days ago) -> -3 WITHIN TIME FRAME',
  pick(sandbox._sl_computeComplianceScore(new SDate(2026, 8, 4), 'NCR', today), 'score', 'status'),
  { score: -3, status: 'WITHIN TIME FRAME' });
eq('overdue (Monthly, 40 days ago) -> +3 OVERDUE',
  pick(sandbox._sl_computeComplianceScore(new SDate(2026, 7, 5), 'NCR', today), 'score', 'status'),
  { score: 3, status: 'OVERDUE' });
eq('never visited -> +3 NO HISTORY (fixed: v1 scored this as neutral 0, ranking it as LESS urgent than merely-overdue)',
  pick(sandbox._sl_computeComplianceScore(null, 'NCR', today), 'score', 'status'),
  { score: 3, status: 'NO HISTORY' });
eq('Semi-Annual, 100 days ago -> still compliant (183-day cadence)',
  pick(sandbox._sl_computeComplianceScore(new SDate(2026, 5, 6), 'FLIGHT PROVINCIAL', today), 'score', 'status'),
  { score: -3, status: 'WITHIN TIME FRAME' });

console.log('\n── _sl_riskTier (cutoffs unchanged from v1) ──');
eq('score 0 -> LOW', sandbox._sl_riskTier(0), 'LOW');
eq('score 4 -> LOW', sandbox._sl_riskTier(4), 'LOW');
eq('score 5 -> MEDIUM', sandbox._sl_riskTier(5), 'MEDIUM');
eq('score 9 -> MEDIUM', sandbox._sl_riskTier(9), 'MEDIUM');
eq('score 10 -> HIGH', sandbox._sl_riskTier(10), 'HIGH');

console.log('\n── _sl_computeMonthlyPurposeScores (visit scoring + Failed QA/MS decay) ──');
function bucket(failed, sv, curing, tltc) {
  return { failedCount: failed, storeVisitCount: sv, curingCount: curing, tltcCount: tltc };
}
// 9 store visits Jan-Sep, one Failed QA/MS in June (idx 5); "today" = September (monthLimit=8)
// -> 3 clean months follow June (Jul/Aug/Sep), decaying the +5 penalty by 1 each: 5-1-1-1=2
const buckets = Array.from({ length: 12 }, () => bucket(0, 0, 0, 0));
for (let m = 0; m < 9; m++) buckets[m].storeVisitCount = 1;
buckets[5].failedCount = 1;
const r1 = sandbox._sl_computeMonthlyPurposeScores(buckets, 8);
eq('9 store visits score -18 (9 * -2), permanent — no decay on good visits', r1.basePurposeScore, -18);
eq('June failure (+5), 3 clean months since (Jul/Aug/Sep) each -1 -> 2 remaining', r1.activeFailedPenalty, 2);
eq('total purpose score = -16 (-18 + 2)', r1.totalPurposeScore, -16);

// A failure in the LAST included month has had no clean month yet — should not have decayed
const bucketsLateFail = Array.from({ length: 12 }, () => bucket(0, 0, 0, 0));
bucketsLateFail[8].failedCount = 1; // September (the current month itself)
const r2 = sandbox._sl_computeMonthlyPurposeScores(bucketsLateFail, 8);
eq('a failure in the current month keeps its full +5 (no clean month has passed yet)', r2.activeFailedPenalty, 5);

// A failure needs exactly 5 clean months to fully decay (1 point each)
const bucketsFullyDecayed = Array.from({ length: 12 }, () => bucket(0, 0, 0, 0));
bucketsFullyDecayed[0].failedCount = 1; // January
const r3 = sandbox._sl_computeMonthlyPurposeScores(bucketsFullyDecayed, 5); // through June — 5 clean months (Feb-Jun)
eq('a failure fully decays after exactly 5 clean months (5 - 5*1 = 0)', r3.activeFailedPenalty, 0);
const r4 = sandbox._sl_computeMonthlyPurposeScores(bucketsFullyDecayed, 4); // through May — only 4 clean months
eq('...but not one month sooner (4 clean months: 5 - 4*1 = 1)', r4.activeFailedPenalty, 1);

console.log('\n── _sl_attentionReason (priority order) ──');
eq('2+ live failures -> "Repeated QA/MS Interventions"',
  sandbox._sl_attentionReason(10, 'WITHIN TIME FRAME', 'Monthly', true), 'Repeated QA/MS Interventions');
eq('1 live failure -> "QA/MS Intervention"',
  sandbox._sl_attentionReason(5, 'WITHIN TIME FRAME', 'Monthly', true), 'QA/MS Intervention');
eq('overdue, no live failure -> "{Category} Visit Overdue"',
  sandbox._sl_attentionReason(0, 'OVERDUE', 'Quarterly', true), 'Quarterly Visit Overdue');
eq('never visited -> "No Visit History"',
  sandbox._sl_attentionReason(0, 'NO HISTORY', 'Monthly', false), 'No Visit History');
eq('nothing wrong -> "No Risk Factors"',
  sandbox._sl_attentionReason(0, 'WITHIN TIME FRAME', 'Monthly', true), 'No Risk Factors');

console.log('\n── _computeStoreRisk: never-visited stores get a row (the original bug) ──');
{
  const sb = newSandbox([
    ['VISITED STORE',       'FIGARO', 'NCR', '', 'NCR'],
    ['NEVER VISITED STORE', 'FIGARO', 'NCR', '', 'NCR'],
  ]);
  const data = {
    stores:  ['VISITED STORE'],
    dates:   [new (vm.runInContext('Date', sb))(2026, 8, 10)],
    purposes: ['STORE VISIT'],
    brands:  ['FIGARO'],
    regions: ['NCR'],
  };
  const rows = sb._computeStoreRisk(data, new (vm.runInContext('Date', sb))(2026, 8, 14));
  const names = rows.map(r => r.store).sort();
  eq('both the visited AND the never-visited store appear', names, ['NEVER VISITED STORE', 'VISITED STORE']);

  const neverRow = rows.find(r => r.store === 'NEVER VISITED STORE');
  check('never-visited store: daysSince is null', neverRow.daysSince === null, neverRow.daysSince);
  check('never-visited store: complianceStatus is NO HISTORY', neverRow.complianceStatus === 'NO HISTORY', neverRow.complianceStatus);
  check('never-visited store: attentionReason is "No Visit History"', neverRow.attentionReason === 'No Visit History', neverRow.attentionReason);
  // Score 3 (compliance-only, zero purpose activity) is genuinely LOW per
  // the documented tier cutoffs and the "coverage alone can't reach
  // HIGH/MEDIUM" guarantee — the fix isn't that it must rank high, it's
  // that it scores the SAME +3 an equivalently-overdue store gets (v1
  // scored it 0, silently safer than overdue) and isn't dropped from the
  // list entirely (the row-count check above).
  check('never-visited store gets the full +3 compliance penalty (same as OVERDUE, not the old neutral 0)',
    neverRow.complianceScore === 3, neverRow.complianceScore);
}

function pick(obj, ...keys) {
  const out = {};
  keys.forEach(k => { out[k] = obj[k]; });
  return out;
}

console.log('\n' + '═'.repeat(34));
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('═'.repeat(34));
process.exit(fail ? 1 : 0);
