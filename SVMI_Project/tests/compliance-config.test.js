// Phase 1D: Versioned Compliance Configuration + Period-to-Date
// Resolution (SVMKPI_COMPLIANCE_CONFIG.gs + sl_getComplianceGaps()).
//
// Covers the Phase 1D spec's "22. TESTING — COMPLIANCE" and relevant
// parts of "26. TESTING — STORE ID" / "27. TESTING — CONFIGURATION
// SECURITY" / "28. SCALE / PERFORMANCE".
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs + SVMKPI_CONFIG.gs +
// SVMKPI_CALENDAR.gs + SVMKPI_COMPLIANCE_CONFIG.gs +
// SVMKPI_STORE_CONFIG.gs + SVMKPI_RISK.gs + SVMKPI_STORE_LOOKUP.gs) in a
// Node vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc       = APPS('SVMKPI_CORE.gs');
const configSrc     = APPS('SVMKPI_CONFIG.gs');
const calSrc        = APPS('SVMKPI_CALENDAR.gs');
const cmpCfgSrc     = APPS('SVMKPI_COMPLIANCE_CONFIG.gs');
const storeCfgSrc   = APPS('SVMKPI_STORE_CONFIG.gs');
const riskSrc       = APPS('SVMKPI_RISK.gs');
const lookupSrc     = APPS('SVMKPI_STORE_LOOKUP.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Generic writable Sheet mock (established pattern — config-service/
//    store-identity/duplicate-prevention test files all use this) ──────
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
  return { getSheetByName: (name) => sheets[name] || null, insertSheet: (name) => { const s = makeWritableSheet(); sheets[name] = s; return s; }, _sheets: sheets };
}

function newSandbox(masterLogRows, settingsRows) {
  const ssMock = makeSpreadsheetMock();
  const state = { isAdmin: true };
  if (masterLogRows) {
    const master = ssMock.insertSheet('MASTER_LOG');
    master.getRange(1, 1, 1, 8).setValues([['Timestamp', 'Date', 'Store', 'Brand', 'Region', 'Visited By', 'Purpose', 'Remarks']]);
    masterLogRows.forEach(r => master.appendRow(r));
  }
  if (settingsRows) {
    const settings = ssMock.insertSheet('SETTINGS');
    // Real Sheet convention (and sl_getComplianceGaps()'s own assumption):
    // row 1 = header, data starts at row 2 — this mock has no implicit
    // offset, so an explicit header row must be written first, or
    // getLastRow() < 2 makes the real code treat SETTINGS as empty.
    settings.getRange(1, 1, 1, 5).setValues([['Store', 'Brand', 'Region', 'Unused', 'Category']]);
    settingsRows.forEach(r => settings.appendRow(r));
  }
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return fmt.indexOf('HH') !== -1 ? `${y}-${m}-${d} 00:00:00` : `${y}-${m}-${d}`;
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
  vm.runInContext(calSrc, sandbox);
  vm.runInContext(cmpCfgSrc, sandbox);
  vm.runInContext(storeCfgSrc, sandbox);
  vm.runInContext(riskSrc, sandbox);
  vm.runInContext(lookupSrc, sandbox);
  return { sandbox, ssMock, state };
}

function row(y, m, d, store, visitor, purpose) {
  const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return [ds + ' 08:00:00', ds, store, 'FIGARO', 'NCR', visitor, purpose || 'STORE VISIT', ''];
}

// Computed dynamically (never a fixed literal) so this suite never again
// silently starts treating its own "today" fixture as backdated the
// moment the real calendar date advances past whatever day this file
// was authored on — discovered when 2026-09-18 -> 2026-09-19 broke every
// TODAY-effective (non-backdate-testing) call in this file. The
// evaluationDateStr literals passed to sl_getComplianceGaps() elsewhere
// in this file are unaffected — those are period-to-date read queries,
// not configuration-creation calls, and are never subject to backdate
// confirmation.
const TODAY = new Date().toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════
// 1. PERIOD-TO-DATE COMPLIANCE — compliant / insufficient / excludes
//    activity after the evaluation date
// ═══════════════════════════════════════════════════════════════

console.log('\n── Period-to-date: compliant activity within the period, up to the evaluation date ──');
{
  const { sandbox } = newSandbox(
    [row(2026, 9, 5, 'STORE_A', 'LEO')],
    [['STORE_A', 'FIGARO', 'NCR', '', 'NCR']]
  );
  const gaps = sandbox.sl_getComplianceGaps([], 9, 2026, '2026-09-18');
  check('STORE_A (visited Sep 5, evaluated Sep 18) is compliant — absent from gaps', !gaps.some(g => g.store === 'STORE_A'), JSON.stringify(gaps));
}

console.log('\n── Period-to-date: insufficient activity is a real gap ──');
{
  const { sandbox } = newSandbox([], [['STORE_B', 'FIGARO', 'NCR', '', 'NCR']]);
  const gaps = sandbox.sl_getComplianceGaps([], 9, 2026, '2026-09-18');
  check('STORE_B (never visited) is a gap', gaps.some(g => g.store === 'STORE_B'));
}

console.log('\n── Period-to-date: activity AFTER the evaluation date is excluded — the core Phase 1D fix ──');
{
  const { sandbox } = newSandbox(
    [row(2026, 9, 19, 'STORE_C', 'LEO')], // Sep 19 — one day AFTER the Sep 18 evaluation date
    [['STORE_C', 'FIGARO', 'NCR', '', 'NCR']]
  );
  const gaps = sandbox.sl_getComplianceGaps([], 9, 2026, '2026-09-18');
  check('STORE_C is STILL a gap as of Sep 18 — the Sep 19 visit does not count yet', gaps.some(g => g.store === 'STORE_C'), JSON.stringify(gaps));

  const gapsNextDay = sandbox.sl_getComplianceGaps([], 9, 2026, '2026-09-19');
  check('...but as of Sep 19 itself, the same visit now counts', !gapsNextDay.some(g => g.store === 'STORE_C'), JSON.stringify(gapsNextDay));
}

console.log('\n── Period-to-date: exact boundary dates (Sep 5/17/18 included, Sep 19 excluded) ──');
{
  [5, 17, 18].forEach(day => {
    const { sandbox } = newSandbox([row(2026, 9, day, 'STORE_X', 'LEO')], [['STORE_X', 'FIGARO', 'NCR', '', 'NCR']]);
    const gaps = sandbox.sl_getComplianceGaps([], 9, 2026, '2026-09-18');
    check('a visit on Sep ' + day + ' (<= evaluation date) counts', !gaps.some(g => g.store === 'STORE_X'), JSON.stringify(gaps));
  });
  const { sandbox } = newSandbox([row(2026, 9, 19, 'STORE_Y', 'LEO')], [['STORE_Y', 'FIGARO', 'NCR', '', 'NCR']]);
  const gaps = sandbox.sl_getComplianceGaps([], 9, 2026, '2026-09-18');
  check('a visit on Sep 19 (> evaluation date) does not count', gaps.some(g => g.store === 'STORE_Y'), JSON.stringify(gaps));
}


// ═══════════════════════════════════════════════════════════════
// 2. HISTORICAL / FUTURE RULE VERSIONS
// ═══════════════════════════════════════════════════════════════

console.log('\n── Historical rule version: 2026 = 1 visit/period, 2027 = 2 visits/period (spec\'s worked example) ──');
{
  const masterLogRows = [
    row(2026, 3, 10, 'STORE_H', 'LEO'),           // 1 visit in March 2026
    row(2027, 3, 10, 'STORE_H', 'LEO'),           // 1 visit in March 2027 (of 2 required)
  ];
  const { sandbox } = newSandbox(masterLogRows, [['STORE_H', 'FIGARO', 'NCR', '', 'NCR']]);

  const v1 = sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, '2026-01-01', 'initial rule', { backdateConfirmed: true, });
  check('v1 (2026, requiredCount=1) created', v1.success, JSON.stringify(v1));
  const v2 = sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 2 }, '2027-01-01', 'stricter rule for 2027', { backdateConfirmed: true });
  check('v2 (2027, requiredCount=2) created', v2.success, JSON.stringify(v2));

  const gaps2026 = sandbox.sl_getComplianceGaps([], 3, 2026, '2026-03-31');
  check('2026: 1 visit satisfies the 2026 rule (requiredCount=1) — compliant', !gaps2026.some(g => g.store === 'STORE_H'), JSON.stringify(gaps2026));

  const gaps2027 = sandbox.sl_getComplianceGaps([], 3, 2027, '2027-03-31');
  const gap2027 = gaps2027.find(g => g.store === 'STORE_H');
  check('2027: only 1 visit but the 2027 rule requires 2 — NOT compliant', !!gap2027, JSON.stringify(gaps2027));
  check('2027 gap correctly reports requiredCount=2, actualCount=1', gap2027 && gap2027.requiredCount === 2 && gap2027.actualCount === 1, JSON.stringify(gap2027));
}

console.log('\n── Future rule version does not affect an earlier evaluation date ──');
{
  const { sandbox } = newSandbox([row(2026, 3, 10, 'STORE_F', 'LEO')], [['STORE_F', 'FIGARO', 'NCR', '', 'NCR']]);
  sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, '2026-01-01', 'baseline', { backdateConfirmed: true });
  sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 5 }, '2030-01-01', 'far-future stricter rule', { backdateConfirmed: true });

  const gaps2026 = sandbox.sl_getComplianceGaps([], 3, 2026, '2026-03-31');
  check('2026 evaluation still uses the 2026 rule (requiredCount=1), unaffected by the 2030 version', !gaps2026.some(g => g.store === 'STORE_F'), JSON.stringify(gaps2026));
}

console.log('\n── Effective-date boundary: the exact Effective From date already uses the NEW version ──');
{
  const { sandbox } = newSandbox([], []);
  const resolvedAt = sandbox.resolveComplianceConfigurationAsOf; // exists but store-based; use category resolver directly for a pure boundary check
  sandbox.cmp_create('FAR PROVINCIAL', { cadenceType: 'QUARTERLY', cadenceDays: 92, requiredCount: 1 }, '2026-01-01', 'v1', { backdateConfirmed: true });
  sandbox.cmp_create('FAR PROVINCIAL', { cadenceType: 'QUARTERLY', cadenceDays: 92, requiredCount: 3 }, '2027-06-01', 'v2', { backdateConfirmed: true });
  const before = sandbox._cmp_resolveByCategory('FAR PROVINCIAL', '2027-05-31');
  const on = sandbox._cmp_resolveByCategory('FAR PROVINCIAL', '2027-06-01');
  check('the day before Effective From still resolves v1 (requiredCount=1)', before.requiredCount === 1, JSON.stringify(before));
  check('exactly on Effective From resolves v2 (requiredCount=3)', on.requiredCount === 3, JSON.stringify(on));
}


// ═══════════════════════════════════════════════════════════════
// 3. INACTIVE / OVERLAPPING / MISSING CONFIGURATION
// ═══════════════════════════════════════════════════════════════

console.log('\n── Inactive configuration (deactivated version) is not eligible for resolution ──');
{
  const { sandbox } = newSandbox([], []);
  const created = sandbox.cmp_create('QUARTERLY_TEST', { cadenceType: 'QUARTERLY', cadenceDays: 92, requiredCount: 1 }, '2026-01-01', 'v1', { backdateConfirmed: true });
  const deactivated = sandbox.cmp_deactivate(created.versionId, 'retired');
  check('deactivation succeeds', deactivated.success, JSON.stringify(deactivated));
  const resolved = sandbox._cmp_resolveByCategory('QUARTERLY_TEST', '2026-06-01');
  check('an inactive-only category falls through to the hardcoded default (or null) rather than resolving the inactive version', resolved === null || resolved.source !== 'CONFIG_COMPLIANCE', JSON.stringify(resolved));
}

console.log('\n── Overlapping configuration windows are rejected ──');
{
  const { sandbox } = newSandbox([], []);
  sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, '2026-01-01', 'v1', { backdateConfirmed: true });
  const overlap = sandbox.cfg_createConfiguration('COMPLIANCE', 'NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 2 }, '2026-01-01', null, 'duplicate date', { backdateConfirmed: true });
  check('a second version with the SAME Effective From is rejected', overlap.success === false, JSON.stringify(overlap));
}

console.log('\n── Missing configuration (unknown category, no CONFIG_COMPLIANCE, no hardcoded default) is handled safely ──');
{
  const { sandbox } = newSandbox([row(2026, 3, 1, 'STORE_Z', 'LEO')], [['STORE_Z', 'FIGARO', 'NCR', '', 'NOWHERE CATEGORY']]);
  let threw = false;
  let gaps;
  try { gaps = sandbox.sl_getComplianceGaps([], 3, 2026, '2026-03-31'); } catch (e) { threw = true; }
  check('an unrecognized category never throws', !threw);
  check('an unrecognized category is simply skipped (not reported as a false gap)', !gaps.some(g => g.store === 'STORE_Z'), JSON.stringify(gaps));
}


// ═══════════════════════════════════════════════════════════════
// 4. STORE ID AS THE CONFIGURATION-RESOLUTION IDENTITY
// ═══════════════════════════════════════════════════════════════

console.log('\n── resolveComplianceConfigurationAsOf(storeId, date): resolves via the STORE\'S category as of that date ──');
{
  const { sandbox } = newSandbox([], []);
  const store = sandbox.store_create({ storeName: 'Category Changer', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, TODAY, 'setup');
  sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, TODAY, 'ncr rule', {});
  sandbox.cmp_create('FAR PROVINCIAL', { cadenceType: 'QUARTERLY', cadenceDays: 92, requiredCount: 1 }, TODAY, 'far rule', {});

  const beforeChange = sandbox.resolveComplianceConfigurationAsOf(store.storeId, TODAY);
  check('before the category change, resolves the NCR (Monthly) rule', beforeChange && beforeChange.periodDefinition === 'MONTH', JSON.stringify(beforeChange));

  sandbox.store_update(store.storeId, { storeName: 'Category Changer', brand: 'FIGARO', region: 'NCR', category: 'FAR PROVINCIAL' }, '2026-10-01', 'category changed');
  const afterChange = sandbox.resolveComplianceConfigurationAsOf(store.storeId, '2026-10-01');
  check('after the category change, resolves the FAR PROVINCIAL (Quarterly) rule instead — via Store ID, never Store Name', afterChange && afterChange.periodDefinition === 'QUARTER', JSON.stringify(afterChange));
}

console.log('\n── Store Name changes do not break configuration identity; two similarly-named stores stay distinct ──');
{
  const { sandbox } = newSandbox([], []);
  const alpha = sandbox.store_create({ storeName: 'Store Alpha', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, TODAY, 'setup');
  const alphaTwo = sandbox.store_create({ storeName: 'Store Alpha Two', brand: 'FIGARO', region: 'NCR', category: 'FAR PROVINCIAL' }, TODAY, 'setup');
  sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, TODAY, 'ncr', {});
  sandbox.cmp_create('FAR PROVINCIAL', { cadenceType: 'QUARTERLY', cadenceDays: 92, requiredCount: 1 }, TODAY, 'far', {});

  sandbox.store_update(alpha.storeId, { storeName: 'Store Alpha RENAMED', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, '2026-10-01', 'rename');

  const alphaResolved = sandbox.resolveComplianceConfigurationAsOf(alpha.storeId, '2026-10-01');
  const alphaTwoResolved = sandbox.resolveComplianceConfigurationAsOf(alphaTwo.storeId, '2026-10-01');
  check('the renamed store still resolves its OWN (NCR/Monthly) rule correctly', alphaResolved && alphaResolved.periodDefinition === 'MONTH', JSON.stringify(alphaResolved));
  check('the similarly-named second store remains distinct (FAR PROVINCIAL/Quarterly), never confused by name similarity', alphaTwoResolved && alphaTwoResolved.periodDefinition === 'QUARTER', JSON.stringify(alphaTwoResolved));
}

console.log('\n── A store\'s historical Store ID remains stable across configuration/category changes ──');
{
  const { sandbox } = newSandbox([], []);
  const store = sandbox.store_create({ storeName: 'Stable ID Co', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, TODAY, 'setup');
  const idBefore = store.storeId;
  sandbox.store_update(store.storeId, { storeName: 'Stable ID Co', brand: 'FIGARO', region: 'NCR', category: 'FAR PROVINCIAL' }, '2026-10-01', 'category change');
  const resolvedLater = sandbox.resolveStoreAsOf(idBefore, '2026-10-01');
  check('the Store ID is unchanged and still resolves after a category change', resolvedLater && resolvedLater.storeId === idBefore, JSON.stringify(resolvedLater));
}


// ═══════════════════════════════════════════════════════════════
// 5. SECURITY
// ═══════════════════════════════════════════════════════════════

console.log('\n── Security: a non-admin cannot create/update/deactivate/rollback compliance configuration ──');
{
  const { sandbox, state } = newSandbox([], []);
  state.isAdmin = false;
  const create = sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, TODAY, 'x', {});
  check('cmp_create rejected for a non-admin', create.success === false, JSON.stringify(create));
  state.isAdmin = true;
  const real = sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, TODAY, 'x', {});
  state.isAdmin = false;
  const deactivate = sandbox.cmp_deactivate(real.versionId, 'x');
  check('cmp_deactivate rejected for a non-admin', deactivate.success === false, JSON.stringify(deactivate));
  const rollback = sandbox.cmp_rollback('NCR', real.versionId, 'x', TODAY, {});
  check('cmp_rollback rejected for a non-admin', rollback.success === false, JSON.stringify(rollback));
}

console.log('\n── Security: a spoofed isAdmin/role field on the payload cannot bypass the server-side check ──');
{
  const { sandbox, state } = newSandbox([], []);
  state.isAdmin = false;
  const attempt = sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1, isAdmin: true, role: 'ADMIN' }, TODAY, 'x', {});
  check('the spoofed fields are ignored; the request is still rejected', attempt.success === false, JSON.stringify(attempt));
}

console.log('\n── Security: an invalid configuration mutation never creates an audit-success record ──');
{
  const { sandbox } = newSandbox([], []);
  const before = sandbox.cfg_getAuditLog('COMPLIANCE', 'NCR').length;
  const invalid = sandbox.cmp_create('NCR', { cadenceType: 'BOGUS_TYPE', cadenceDays: 31 }, TODAY, 'x', {});
  check('the invalid cadenceType is rejected', invalid.success === false, JSON.stringify(invalid));
  const after = sandbox.cfg_getAuditLog('COMPLIANCE', 'NCR').length;
  check('no audit entry was written for the rejected mutation', after === before, { before, after });
}


// ═══════════════════════════════════════════════════════════════
// 6. AUDIT + ROLLBACK
// ═══════════════════════════════════════════════════════════════

console.log('\n── Audit: a backdated compliance mutation is rejected without confirmation, then accepted with confirmation + reason ──');
{
  const { sandbox } = newSandbox([], []);
  const noConfirm = sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, '2020-01-01', 'backdated');
  check('backdated without confirmation is rejected', noConfirm.success === false && noConfirm.requiresBackdateConfirmation === true, JSON.stringify(noConfirm));
  const noReason = sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, '2020-01-01', '', { backdateConfirmed: true });
  check('backdated with confirmation but no reason is rejected', noReason.success === false, JSON.stringify(noReason));
  const withBoth = sandbox.cmp_create('NCR', { cadenceType: 'MONTHLY', cadenceDays: 31, requiredCount: 1 }, '2020-01-01', 'confirmed backdate', { backdateConfirmed: true });
  check('backdated with confirmation AND reason succeeds', withBoth.success === true, JSON.stringify(withBoth));

  const audit = sandbox.cfg_getAuditLog('COMPLIANCE', 'NCR');
  const last = audit[audit.length - 1];
  check('the audit entry records the reason', last && /confirmed backdate/.test(last.reason), JSON.stringify(last));
}

console.log('\n── Rollback: creates a new version, preserves history, names the restored version ──');
{
  const { sandbox } = newSandbox([], []);
  const v1 = sandbox.cmp_create('QUARTERLY_TEST2', { cadenceType: 'QUARTERLY', cadenceDays: 92, requiredCount: 1 }, '2026-01-01', 'v1', { backdateConfirmed: true });
  sandbox.cmp_create('QUARTERLY_TEST2', { cadenceType: 'QUARTERLY', cadenceDays: 92, requiredCount: 5 }, '2026-06-01', 'v2 (bad change)', { backdateConfirmed: true });
  const rollback = sandbox.cmp_rollback('QUARTERLY_TEST2', v1.versionId, 'reverting the bad change', '2026-09-01', { backdateConfirmed: true });
  check('rollback succeeds', rollback.success, JSON.stringify(rollback));

  const allVersions = sandbox.cfg_getConfiguration('COMPLIANCE', 'QUARTERLY_TEST2');
  check('all 3 versions (v1, v2, rollback-v3) still exist — nothing deleted', allVersions.length === 3, allVersions.length);

  const resolvedAfterRollback = sandbox._cmp_resolveByCategory('QUARTERLY_TEST2', '2026-09-01');
  check('after rollback, requiredCount is back to 1 (v1\'s value)', resolvedAfterRollback.requiredCount === 1, JSON.stringify(resolvedAfterRollback));
}


// ═══════════════════════════════════════════════════════════════
// 7. SCALE
// ═══════════════════════════════════════════════════════════════

console.log('\n── Scale: 5,000+ MASTER_LOG rows across multiple years/stores, period-to-date compliance still correct ──');
{
  const rows = [];
  const stores = ['SCALE_A', 'SCALE_B', 'SCALE_C', 'SCALE_D', 'SCALE_E'];
  for (let i = 0; i < 5200; i++) {
    const yr = 2024 + (i % 5); // spans 5 years
    const store = stores[i % stores.length];
    const day = (i % 27) + 1;
    let month = ((i / 27) % 12 | 0) + 1;
    if (month === 9) month = 8; // keep September clear so only the one deliberate SCALE_A row lands there
    rows.push(row(yr, month, day, store, 'FILLER_' + i, 'STORE VISIT'));
  }
  // A specific, deliberately-placed compliant visit for SCALE_A in Sep 2026.
  rows.push(row(2026, 9, 5, 'SCALE_A', 'LEO'));
  const settingsRows = stores.map(s => [s, 'FIGARO', 'NCR', '', 'NCR']);

  const { sandbox } = newSandbox(rows, settingsRows);
  const start = Date.now();
  const gaps = sandbox.sl_getComplianceGaps([], 9, 2026, '2026-09-18');
  const elapsedMs = Date.now() - start;

  check('SCALE_A (visited Sep 5, 2026) is compliant despite 5,200+ rows', !gaps.some(g => g.store === 'SCALE_A'), JSON.stringify(gaps.map(g => g.store)));
  check('the other 4 scale stores are correctly flagged as gaps (no Sep 2026 visit of their own)', ['SCALE_B', 'SCALE_C', 'SCALE_D', 'SCALE_E'].every(s => gaps.some(g => g.store === s)), JSON.stringify(gaps.map(g => g.store)));
  check('resolves in a reasonable time (< 5s) — no accidental O(n^2) blowup', elapsedMs < 5000, elapsedMs + 'ms');
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
