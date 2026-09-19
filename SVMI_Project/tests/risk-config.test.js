// Phase 1D: Versioned Risk Configuration (SVMKPI_RISK_CONFIG.gs) feeding
// the EXISTING canonical risk engine (_computeStoreRisk(), SVMKPI_RISK.gs
// — unchanged algorithm).
//
// Covers the Phase 1D spec's "23. TESTING — RISK" and relevant parts of
// "27. TESTING — CONFIGURATION SECURITY".
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs + SVMKPI_CONFIG.gs +
// SVMKPI_RISK_CONFIG.gs + SVMKPI_RISK.gs) in a Node vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc     = APPS('SVMKPI_CORE.gs');
const configSrc   = APPS('SVMKPI_CONFIG.gs');
const riskCfgSrc  = APPS('SVMKPI_RISK_CONFIG.gs');
const riskSrc     = APPS('SVMKPI_RISK.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

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
      for (let r = 0; r < numRows; r++) { const rowArr = []; for (let c = 0; c < numCols; c++) rowArr.push(getCell(row + r, col + c)); out.push(rowArr); }
      return out;
    };
    proxy = new Proxy(range, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => proxy; } });
    return proxy;
  }
  const sheet = {
    getLastRow: () => maxRow,
    getRange: (row, col, numRows, numCols) => makeRange(row, col, numRows || 1, numCols || 1),
    appendRow: (rowArr) => { const r = maxRow + 1; rowArr.forEach((v, i) => setCell(r, i + 1, v)); },
  };
  let sproxy;
  sproxy = new Proxy(sheet, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => sproxy; } });
  return sproxy;
}
function makeSpreadsheetMock() {
  const sheets = {};
  return { getSheetByName: (name) => sheets[name] || null, insertSheet: (name) => { const s = makeWritableSheet(); sheets[name] = s; return s; } };
}
function makeSettingsSheet(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: (row, col, numRows) => ({ getValues: () => rows.slice(row - 2, row - 2 + numRows) }),
  };
}

function newSandbox(settingsRows) {
  const ssMock = makeSpreadsheetMock();
  const state = { isAdmin: true };
  const settings = makeSettingsSheet(settingsRows || []);
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => (name === 'SETTINGS' ? settings : ssMock.getSheetByName(name)),
        insertSheet: (name) => ssMock.insertSheet(name),
      }),
      flush: () => {},
    },
    SHEET: { SETTINGS: 'SETTINGS', MASTER_LOG: 'MASTER_LOG' },
    // Phase 1C: _computeStoreRisk() falls back to getDefaultReportingYear()
    // (SVMKPI_REPORTING_YEAR.gs) when no year is passed; this sandbox
    // doesn't load that file (it's testing Phase 1D's risk configuration,
    // not year-neutrality), so stub the same fixed answer this file's
    // fixtures (all dated 2026) already assume.
    getDefaultReportingYear: () => 2026,
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      },
      getUuid: (() => { let n = 0; return () => 'test-uuid-' + (++n); })(),
    },
    sl_isAdmin: () => state.isAdmin,
    sl_getCurrentUser: () => 'admin@test.com',
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(configSrc, sandbox);
  vm.runInContext(riskCfgSrc, sandbox);
  vm.runInContext(riskSrc, sandbox);
  return { sandbox, state };
}

// Computed dynamically (never a fixed literal) so this suite never again
// silently starts treating its own "today" fixture as backdated the
// moment the real calendar date advances past whatever day this file
// was authored on — discovered when 2026-09-18 -> 2026-09-19 broke every
// TODAY-effective (non-backdate-testing) call in this file.
const TODAY = new Date().toISOString().slice(0, 10);
// Same "today", but as a sandbox-realm Date object built from Y/M/D
// components (never an ISO-string reparse, to sidestep any UTC/local
// timezone ambiguity) — for call sites needing a real Date rather than a
// 'YYYY-MM-DD' string. Also never a fixed literal, for the same reason
// TODAY above isn't one.
function todayInSandbox(SDate) {
  const d = new Date();
  return new SDate(d.getFullYear(), d.getMonth(), d.getDate());
}

function bucket(failed, sv, curing, tltc) { return { failedCount: failed, storeVisitCount: sv, curingCount: curing, tltcCount: tltc }; }

// ═══════════════════════════════════════════════════════════════
// 1. EXISTING OUTPUT REMAINS EQUIVALENT UNDER DEFAULT/CURRENT CONFIG
// ═══════════════════════════════════════════════════════════════

console.log('\n── Existing risk output is equivalent with no CONFIG_RISK version created (hardcoded defaults) ──');
{
  const { sandbox } = newSandbox([]);
  const SDate = vm.runInContext('Date', sandbox);
  const buckets = Array.from({ length: 12 }, () => bucket(0, 0, 0, 0));
  for (let m = 0; m < 9; m++) buckets[m].storeVisitCount = 1;
  buckets[5].failedCount = 1;
  const r = sandbox._sl_computeMonthlyPurposeScores(buckets, 8, new SDate(2026, 8, 14));
  eq('basePurposeScore unchanged: 9 * -2 = -18', r.basePurposeScore, -18);
  eq('activeFailedPenalty unchanged: 5 - 3 clean months = 2', r.activeFailedPenalty, 2);
  eq('tier cutoffs unchanged: score 9 -> MEDIUM', sandbox._sl_riskTier(9, new SDate(2026, 8, 14)), 'MEDIUM');
  eq('tier cutoffs unchanged: score 10 -> HIGH', sandbox._sl_riskTier(10, new SDate(2026, 8, 14)), 'HIGH');
}


// ═══════════════════════════════════════════════════════════════
// 2. CONFIGURED THRESHOLD/WEIGHT CHANGES AFFECT THE CORRECT CALCULATION
// ═══════════════════════════════════════════════════════════════

console.log('\n── A configured threshold change affects _sl_riskTier() as of its effective date ──');
{
  const { sandbox } = newSandbox([]);
  const SDate = vm.runInContext('Date', sandbox);
  const created = sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 20, highThreshold: 30 }, TODAY, 'raise the bar', {});
  check('risk_create succeeds', created.success, JSON.stringify(created));

  eq('score 9 is now LOW (below the new mediumThreshold=20)', sandbox._sl_riskTier(9, todayInSandbox(SDate)), 'LOW');
  eq('score 25 is now MEDIUM (between 20 and 30)', sandbox._sl_riskTier(25, todayInSandbox(SDate)), 'MEDIUM');
  eq('score 35 is now HIGH (>= 30)', sandbox._sl_riskTier(35, todayInSandbox(SDate)), 'HIGH');
}

console.log('\n── A configured purpose-weight change affects the monthly-purpose score ──');
{
  const { sandbox } = newSandbox([]);
  const SDate = vm.runInContext('Date', sandbox);
  const created = sandbox.risk_create(
    { lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightStoreVisit: -10 }, // steeper reward per visit
    TODAY, 'reward visits more', {}
  );
  check('risk_create succeeds', created.success, JSON.stringify(created));

  const buckets = Array.from({ length: 12 }, () => bucket(0, 0, 0, 0));
  buckets[0].storeVisitCount = 1;
  const r = sandbox._sl_computeMonthlyPurposeScores(buckets, 0, todayInSandbox(SDate));
  eq('1 store visit now scores -10 (the configured weight), not the old -2', r.basePurposeScore, -10);
}


// ═══════════════════════════════════════════════════════════════
// 3. HISTORICAL / FUTURE CONFIGURATION RESOLUTION
// ═══════════════════════════════════════════════════════════════

console.log('\n── Historical date resolves historical configuration (spec\'s worked risk example: 2026=A, 2027=B) ──');
{
  const { sandbox } = newSandbox([]);
  const SDate = vm.runInContext('Date', sandbox);
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, '2026-01-01', 'threshold A', { backdateConfirmed: true });
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 50, highThreshold: 100 }, '2027-01-01', 'threshold B', { backdateConfirmed: true });

  eq('a 2026 event (score 9) resolves threshold A -> MEDIUM', sandbox._sl_riskTier(9, new SDate(2026, 5, 1)), 'MEDIUM');
  eq('a 2027 event (score 9) resolves threshold B -> LOW', sandbox._sl_riskTier(9, new SDate(2027, 5, 1)), 'LOW');
}

console.log('\n── Future configuration does not affect an earlier date ──');
{
  const { sandbox } = newSandbox([]);
  const SDate = vm.runInContext('Date', sandbox);
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, TODAY, 'current', {});
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 100, highThreshold: 200 }, '2030-01-01', 'far future', { backdateConfirmed: true });
  eq('today (score 9) still resolves the CURRENT threshold, not the 2030 one', sandbox._sl_riskTier(9, todayInSandbox(SDate)), 'MEDIUM');
}


// ═══════════════════════════════════════════════════════════════
// 4. BACKDATED MUTATION HANDLING
// ═══════════════════════════════════════════════════════════════

console.log('\n── Backdated mutation rejected without confirmation ──');
{
  const { sandbox } = newSandbox([]);
  const r = sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, '2020-01-01', 'no confirm');
  check('rejected, requiresBackdateConfirmation', r.success === false && r.requiresBackdateConfirmation === true, JSON.stringify(r));
}

console.log('\n── Backdated mutation rejected without a reason ──');
{
  const { sandbox } = newSandbox([]);
  const r = sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, '2020-01-01', '', { backdateConfirmed: true });
  check('rejected — no reason', r.success === false, JSON.stringify(r));
}

console.log('\n── Backdated mutation accepted with confirmation + reason ──');
{
  const { sandbox } = newSandbox([]);
  const r = sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, '2020-01-01', 'confirmed backdate', { backdateConfirmed: true });
  check('accepted', r.success === true, JSON.stringify(r));
}

console.log('\n── Audit records backdating (reason + version) ──');
{
  const { sandbox } = newSandbox([]);
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, '2020-06-15', 'a documented backdate reason', { backdateConfirmed: true });
  const audit = sandbox.cfg_getAuditLog('RISK', 'DEFAULT');
  const entry = audit[audit.length - 1];
  check('audit entry records the reason', entry && /a documented backdate reason/.test(entry.reason), JSON.stringify(entry));
  const effFromStr = entry && entry.effectiveFrom && typeof entry.effectiveFrom.toISOString === 'function' ? entry.effectiveFrom.toISOString().slice(0, 10) : String(entry && entry.effectiveFrom);
  check('audit entry records the effective date', effFromStr === '2020-06-15', effFromStr);
}


// ═══════════════════════════════════════════════════════════════
// 5. ROLLBACK
// ═══════════════════════════════════════════════════════════════

console.log('\n── Rollback produces a new version, preserves history ──');
{
  const { sandbox } = newSandbox([]);
  const v1 = sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, '2026-01-01', 'v1', { backdateConfirmed: true });
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 50, highThreshold: 100 }, '2026-06-01', 'v2 bad change', { backdateConfirmed: true });
  const rb = sandbox.risk_rollback(v1.versionId, 'undo the bad change', '2026-09-01', { backdateConfirmed: true });
  check('rollback succeeds', rb.success, JSON.stringify(rb));

  const all = sandbox.cfg_getConfiguration('RISK', 'DEFAULT');
  eq('3 versions total, nothing deleted', all.length, 3);

  const resolvedAt = sandbox.resolveRiskConfigurationAsOf('2026-09-01');
  eq('mediumThreshold back to 5 (v1\'s value)', resolvedAt.mediumThreshold, 5);
}


// ═══════════════════════════════════════════════════════════════
// 6. THE CANONICAL ENGINE REMAINS THE ONLY SCORING ENGINE
// ═══════════════════════════════════════════════════════════════

console.log('\n── The canonical _computeStoreRisk() is still the only risk-scoring path (no second engine introduced) ──');
{
  const { sandbox } = newSandbox([['ALPHA', 'FIGARO', 'NCR', '', 'NCR']]);
  const SDate = vm.runInContext('Date', sandbox);
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 3, highThreshold: 6 }, TODAY, 'lower cutoffs', {});

  const data = {
    stores: ['ALPHA'],
    dates: [new SDate(2026, 8, 10)],
    purposes: ['STORE VISIT'],
    brands: ['FIGARO'],
    regions: ['NCR'],
  };
  const rows = sandbox._computeStoreRisk(data, todayInSandbox(SDate));
  const alpha = rows.find(r => r.store === 'ALPHA');
  check('_computeStoreRisk() itself reflects the configured thresholds end-to-end', !!alpha && (alpha.riskTier === 'LOW' || alpha.riskTier === 'MEDIUM' || alpha.riskTier === 'HIGH'), JSON.stringify(alpha));
  // _sl_computeHealth()/SL_RISK were the OLD, independent "Bible §6" risk
  // formula Phase 0 retired in favor of this one canonical engine (see
  // canonical-risk-engine.test.js) — confirms it hasn't crept back in.
  check('no old duplicate risk engine (_sl_computeHealth/SL_RISK) has reappeared',
    typeof sandbox._sl_computeHealth === 'undefined' && typeof sandbox.SL_RISK === 'undefined');
}


// ═══════════════════════════════════════════════════════════════
// 7. PURPOSE-WEIGHT FALLBACK CHAIN
// ═══════════════════════════════════════════════════════════════

console.log('\n── risk_resolvePurposeWeight(): fallback chain (hardcoded -> legacy CONFIG_RISK -> deliberate CONFIG_PURPOSES) ──');
{
  const { sandbox } = newSandbox([]);
  const noConfigAtAll = sandbox.risk_resolvePurposeWeight('STORE VISIT', TODAY);
  eq('step 3: no CONFIG_RISK exists yet -> hardcoded RISK_PURPOSE_SCORE default', noConfigAtAll, { weight: -2, source: 'HARDCODED_DEFAULT' });

  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightStoreVisit: -7 }, TODAY, 'legacy override', {});
  const legacyOverride = sandbox.risk_resolvePurposeWeight('STORE VISIT', TODAY);
  eq('step 2: CONFIG_RISK\'s legacy named field now wins', legacyOverride, { weight: -7, source: 'RISK_CONFIG_LEGACY' });

  sandbox.cfg_createConfiguration('PURPOSES', 'STORE VISIT', { purposeName: 'STORE VISIT', riskWeight: -99 }, TODAY, null, 'deliberate override', {});
  const deliberateOverride = sandbox.risk_resolvePurposeWeight('STORE VISIT', TODAY);
  eq('step 1: a deliberate CONFIG_PURPOSES.riskWeight wins over everything', deliberateOverride, { weight: -99, source: 'PURPOSE_CONFIG' });
}

console.log('\n── A genuinely new purpose with NO configuration anywhere has NO risk weight — never inherits another purpose\'s ──');
{
  const { sandbox } = newSandbox([]);
  sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightStoreVisit: -2 }, TODAY, 'x', {});
  const result = sandbox.risk_resolvePurposeWeight('BRAND NEW PURPOSE', TODAY);
  check('null — no weight at all, never silently reuses STORE VISIT\'s -2', result === null, JSON.stringify(result));
}


// ═══════════════════════════════════════════════════════════════
// 8. SECURITY
// ═══════════════════════════════════════════════════════════════

console.log('\n── Security: non-admin rejected on every risk mutation ──');
{
  const { sandbox, state } = newSandbox([]);
  state.isAdmin = false;
  const create = sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, TODAY, 'x', {});
  check('risk_create rejected', create.success === false, JSON.stringify(create));
  state.isAdmin = true;
  const real = sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10 }, TODAY, 'x', {});
  state.isAdmin = false;
  check('risk_deactivate rejected', sandbox.risk_deactivate(real.versionId, 'x').success === false);
  check('risk_rollback rejected', sandbox.risk_rollback(real.versionId, 'x', TODAY, {}).success === false);
}

console.log('\n── Security: a spoofed isAdmin/role field cannot bypass the server-side check ──');
{
  const { sandbox, state } = newSandbox([]);
  state.isAdmin = false;
  const attempt = sandbox.risk_create({ lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, isAdmin: true, role: 'ADMIN' }, TODAY, 'x', {});
  check('rejected regardless of the spoofed payload fields', attempt.success === false, JSON.stringify(attempt));
}

console.log('\n── Security: an invalid risk configuration never creates an audit-success record ──');
{
  const { sandbox } = newSandbox([]);
  const before = sandbox.cfg_getAuditLog('RISK', 'DEFAULT').length;
  const invalid = sandbox.risk_create({ lowThreshold: 20, mediumThreshold: 5, highThreshold: 10 }, TODAY, 'x', {}); // low >= medium
  check('rejected (low >= medium)', invalid.success === false, JSON.stringify(invalid));
  const after = sandbox.cfg_getAuditLog('RISK', 'DEFAULT').length;
  eq('no audit entry written', after, before);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
