// Phase 1B: Store ID identity, historical-attribute resolution, operational
// visibility, migration/UNMAPPED handling, and security tests, per the
// spec's "17. TESTING" list. Complements duplicate-prevention.test.js
// (which already covers the partial-accept duplicate-visitor behavior
// that also changed in this phase).
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs + SVMKPI_CONFIG.gs +
// SVMKPI_STORE_CONFIG.gs) in a Node vm sandbox.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const coreSrc        = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CORE.gs'), 'utf8');
const configSrc       = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CONFIG.gs'), 'utf8');
const storeConfigSrc  = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_STORE_CONFIG.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

// ── Generic writable Sheet mock (same pattern as config-service.test.js /
//    duplicate-prevention.test.js) shared by every CONFIG_*/CONFIG_AUDIT/
//    CONFIG_UNMAPPED_STORES sheet the config engine creates on demand ──
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

// isAdmin is mutable per-test so security tests can flip it mid-scenario.
function newSandbox() {
  const ssMock = makeSpreadsheetMock();
  const state = { isAdmin: true };
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
  vm.runInContext(storeConfigSrc, sandbox);
  return { sandbox, ssMock, state };
}

const TODAY = '2026-09-18';

// ═══════════════════════════════════════════════════════════════
// 1. STORE IDENTITY
// ═══════════════════════════════════════════════════════════════

console.log('\n── Identity: two stores created back-to-back get distinct, unguessable IDs ──');
{
  const { sandbox } = newSandbox();
  const a = sandbox.store_create({ storeName: 'Alpha Store', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const b = sandbox.store_create({ storeName: 'Beta Store', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  check('both creates succeed', a.success && b.success, JSON.stringify([a, b]));
  check('IDs are distinct', a.storeId !== b.storeId, JSON.stringify([a.storeId, b.storeId]));
  check('IDs use the STR- prefix (not a row number or the store name)', /^STR-/.test(a.storeId) && /^STR-/.test(b.storeId));
}

console.log('\n── Identity: Store ID is independent of row/array position ──');
{
  const { sandbox } = newSandbox();
  const a = sandbox.store_create({ storeName: 'Row Store', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  // Add several unrelated versions to other stores in between, shifting
  // row positions in the underlying sheet, then resolve the original ID.
  sandbox.store_create({ storeName: 'Filler 1', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  sandbox.store_create({ storeName: 'Filler 2', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const resolved = sandbox.resolveStoreAsOf(a.storeId, TODAY);
  check('the original store still resolves correctly by ID regardless of row shifts', resolved && resolved.fields.storeName === 'Row Store', JSON.stringify(resolved));
}

console.log('\n── Identity: Store ID survives a store-name change ──');
{
  // store_update() takes the full field set for the new version (matching
  // store_create()'s contract, not a partial patch) — callers that only
  // want to change one field merge it onto the current resolved fields
  // first, exactly as _store_setOperationalStatus() does internally.
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Old Name', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const renamed = sandbox.store_update(created.storeId, { storeName: 'New Name', brand: 'FIGARO', region: 'NCR', category: 'A' }, '2026-09-19', 'rename');
  check('rename succeeds as a new version of the SAME Store ID', renamed.success, JSON.stringify(renamed));
  const after = sandbox.resolveStoreAsOf(created.storeId, '2026-09-19');
  check('the Store ID now resolves to the new name', after && after.fields.storeName === 'New Name', JSON.stringify(after));
  check('the Store ID itself is unchanged', after && after.storeId === created.storeId);
}

console.log('\n── Identity: an attempt to change Store ID via store_update() is rejected, not ignored ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Immutable Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const attempt = sandbox.store_update(created.storeId, { storeId: 'STR-some-other-id', storeName: 'Renamed' }, '2026-09-19', 'malicious rename attempt');
  check('the mismatched-ID update is explicitly rejected (not silently ignored)', attempt.success === false, JSON.stringify(attempt));
  const stillOriginal = sandbox.resolveStoreAsOf(created.storeId, '2026-09-19');
  check('the original store is unaffected by the rejected attempt', stillOriginal && stillOriginal.fields.storeName === 'Immutable Co', JSON.stringify(stillOriginal));
}

console.log('\n── Identity: creating with a duplicate (already-used) Store ID is rejected ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'First', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const dupe = sandbox.store_create({ storeName: 'Second', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup', {}, created.storeId);
  check('creating a second store under the same explicit Store ID fails', dupe.success === false, JSON.stringify(dupe));
  check('the failure message names the conflict', /already exists/i.test(dupe.message || ''), dupe.message);
}

// ═══════════════════════════════════════════════════════════════
// 2. HISTORICAL ATTRIBUTES
// ═══════════════════════════════════════════════════════════════

console.log('\n── Historical: initial configuration resolves as of its effective date ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Initial Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const resolved = sandbox.resolveStoreAsOf(created.storeId, TODAY);
  check('resolves with the initial fields', resolved && resolved.fields.category === 'A', JSON.stringify(resolved));
}

console.log('\n── Historical: a future-dated version does not apply before its effective date ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Future Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  sandbox.store_update(created.storeId, { storeName: 'Future Co', brand: 'FIGARO', region: 'NCR', category: 'B' }, '2026-12-01', 'future category change');
  const beforeChange = sandbox.resolveStoreAsOf(created.storeId, '2026-10-01');
  const afterChange = sandbox.resolveStoreAsOf(created.storeId, '2026-12-01');
  check('before the future effective date, old category still applies', beforeChange && beforeChange.fields.category === 'A', JSON.stringify(beforeChange));
  check('on/after the future effective date, new category applies', afterChange && afterChange.fields.category === 'B', JSON.stringify(afterChange));
}

console.log('\n── Historical: resolution exactly before / on / after a change boundary ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Boundary Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, '2026-01-01', 'setup', { backdateConfirmed: true });
  sandbox.store_update(created.storeId, { storeName: 'Boundary Co', brand: 'FIGARO', region: 'NCR', category: 'B' }, '2026-06-01', 'mid-year category change', { backdateConfirmed: true });
  const before = sandbox.resolveStoreAsOf(created.storeId, '2026-05-31');
  const on = sandbox.resolveStoreAsOf(created.storeId, '2026-06-01');
  const after = sandbox.resolveStoreAsOf(created.storeId, '2026-06-02');
  check('the day before the boundary resolves to the OLD category', before && before.fields.category === 'A', JSON.stringify(before));
  check('exactly on the boundary date resolves to the NEW category', on && on.fields.category === 'B', JSON.stringify(on));
  check('the day after the boundary resolves to the NEW category', after && after.fields.category === 'B', JSON.stringify(after));
}

console.log('\n── Historical: store-name, brand, and region changes are each independently resolvable ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Multi Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, '2026-01-01', 'setup', { backdateConfirmed: true });
  sandbox.store_update(created.storeId, { storeName: 'Multi Co Renamed', brand: 'FIGARO', region: 'NCR', category: 'A' }, '2026-03-01', 'rename', { backdateConfirmed: true });
  sandbox.store_update(created.storeId, { storeName: 'Multi Co Renamed', brand: 'APEX', region: 'NCR', category: 'A' }, '2026-05-01', 'rebrand', { backdateConfirmed: true });
  sandbox.store_update(created.storeId, { storeName: 'Multi Co Renamed', brand: 'APEX', region: 'VISMIN', category: 'A' }, '2026-07-01', 'region change', { backdateConfirmed: true });

  const jan = sandbox.resolveStoreAsOf(created.storeId, '2026-02-01');
  const mar = sandbox.resolveStoreAsOf(created.storeId, '2026-04-01');
  const may = sandbox.resolveStoreAsOf(created.storeId, '2026-06-01');
  const jul = sandbox.resolveStoreAsOf(created.storeId, '2026-08-01');

  check('January: original name/brand/region', jan.fields.storeName === 'Multi Co' && jan.fields.brand === 'FIGARO' && jan.fields.region === 'NCR', JSON.stringify(jan));
  check('March: renamed, but brand/region unchanged so far', mar.fields.storeName === 'Multi Co Renamed' && mar.fields.brand === 'FIGARO', JSON.stringify(mar));
  check('May: rebranded, name stays renamed', may.fields.storeName === 'Multi Co Renamed' && may.fields.brand === 'APEX', JSON.stringify(may));
  check('July: region also changed, all three cumulative', jul.fields.storeName === 'Multi Co Renamed' && jul.fields.brand === 'APEX' && jul.fields.region === 'VISMIN', JSON.stringify(jul));
}

console.log('\n── Historical: an inactive store still resolves historically (never globally filtered) ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Closed Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, '2026-01-01', 'setup', { backdateConfirmed: true });
  sandbox.store_deactivate(created.storeId, 'store closed', '2026-06-01', { backdateConfirmed: true });
  const historical = sandbox.resolveStoreAsOf(created.storeId, '2026-03-01');
  const currentById = sandbox.store_getById(created.storeId);
  check('resolving a date BEFORE deactivation still returns full attributes', historical && historical.fields.storeName === 'Closed Co', JSON.stringify(historical));
  check('resolveStoreAsOf/store_getById still returns the inactive store (not filtered)', currentById && currentById.fields.status === 'INACTIVE', JSON.stringify(currentById));
}

// ═══════════════════════════════════════════════════════════════
// 3. OPERATIONAL VISIBILITY
// ═══════════════════════════════════════════════════════════════

console.log('\n── Operational visibility: active store appears in the operational list ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Active Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const list = sandbox.store_getOperationalList(TODAY);
  check('active store is present', list.some(s => s.storeId === created.storeId), JSON.stringify(list));
}

console.log('\n── Operational visibility: inactive store does NOT appear in the operational list ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Inactive Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  // Deactivate effective the NEXT day — the same Effective From date as the
  // creation itself is correctly rejected ("a version with this exact
  // Effective From date already exists"), so this must be a distinct date.
  const deactivated = sandbox.store_deactivate(created.storeId, 'closed', '2026-09-19');
  check('deactivation itself succeeds', deactivated.success === true, JSON.stringify(deactivated));
  const list = sandbox.store_getOperationalList('2026-09-19');
  check('inactive store is absent from the operational list', !list.some(s => s.storeId === created.storeId), JSON.stringify(list));
}

console.log('\n── Operational visibility: inactive store is STILL historically resolvable ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Was Active Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, '2026-01-01', 'setup', { backdateConfirmed: true });
  sandbox.store_deactivate(created.storeId, 'closed', '2026-06-01', { backdateConfirmed: true });
  const isOpToday = sandbox.store_isOperational(created.storeId, '2026-09-18');
  const isOpBeforeClose = sandbox.store_isOperational(created.storeId, '2026-03-01');
  const historicallyResolvable = sandbox.resolveStoreAsOf(created.storeId, '2026-03-01');
  check('not operational today (after deactivation)', isOpToday === false);
  check('was operational before the deactivation date', isOpBeforeClose === true);
  check('still fully resolvable historically regardless of current operational status', !!historicallyResolvable, JSON.stringify(historicallyResolvable));
}

// ═══════════════════════════════════════════════════════════════
// 4. MIGRATION + UNMAPPED
// ═══════════════════════════════════════════════════════════════

console.log('\n── Migration: unambiguous exact-name match maps to a Store ID ──');
{
  const { sandbox } = newSandbox();
  const settingsStores = [{ store: 'Angel Store', brand: 'FIGARO', region: 'NCR', category: 'A' }];
  const masterLogRows = [{ store: 'Angel Store', date: '2026-01-15' }, { store: 'Angel Store', date: '2026-02-01' }];
  const result = sandbox.store_migrateFromSettings(settingsStores, masterLogRows);
  check('migration succeeds', result.success, JSON.stringify(result));
  check('exactly one store created', result.createdStoreIds.length === 1, JSON.stringify(result));
  check('the mapping resolves the exact name to that Store ID', result.mapping['ANGEL STORE'] === result.createdStoreIds[0], JSON.stringify(result));
  check('nothing left unmapped', result.unmappedCount === 0, result.unmappedCount);
  const resolved = sandbox.resolveStoreAsOf(result.createdStoreIds[0], '2026-01-15');
  const effFromStr = resolved && new Date(resolved.effectiveFrom).toISOString().slice(0, 10);
  check('the earliest MASTER_LOG date becomes the initial effective-from date, not an invented one', effFromStr === '2026-01-15', JSON.stringify(resolved));
}

console.log('\n── Migration: a name with no exact SETTINGS match is never guessed — it is UNMAPPED ──');
{
  const { sandbox } = newSandbox();
  const settingsStores = [{ store: 'Correct Store', brand: 'FIGARO', region: 'NCR', category: 'A' }];
  // "Korect Store" is a near-miss typo — must NOT be fuzzy-matched to "Correct Store".
  const masterLogRows = [
    { store: 'Correct Store', date: '2026-01-15' },
    { store: 'Korect Store', date: '2026-02-01' },
    { store: 'Korect Store', date: '2026-02-15' },
  ];
  const result = sandbox.store_migrateFromSettings(settingsStores, masterLogRows);
  check('the near-miss typo is not silently matched', result.mapping['KORECT STORE'] === undefined);
  check('exactly one distinct unmapped name recorded', result.unmappedCount === 1, result.unmappedCount);
  const unmapped = sandbox.store_getUnmappedStores('UNMAPPED');
  check('the unmapped entry preserves the ORIGINAL name text, unaltered', unmapped.some(u => u.originalStoreName === 'KORECT STORE'), JSON.stringify(unmapped));
  check('occurrence count reflects both MASTER_LOG rows for that name, not just one', unmapped.find(u => u.originalStoreName === 'KORECT STORE').occurrenceCount === 2, JSON.stringify(unmapped));
}

console.log('\n── Migration: a store with no SETTINGS entry at all is UNMAPPED, never discarded ──');
{
  const { sandbox } = newSandbox();
  const settingsStores = []; // nothing in current roster
  const masterLogRows = [{ store: 'Long Gone Store', date: '2026-01-01' }];
  const result = sandbox.store_migrateFromSettings(settingsStores, masterLogRows);
  check('no stores created (nothing in SETTINGS to migrate)', result.createdStoreIds.length === 0);
  check('the orphaned historical reference is recorded as unmapped, not dropped', result.unmappedCount === 1, result.unmappedCount);
  const unmapped = sandbox.store_getUnmappedStores();
  check('the original historical store reference text is preserved exactly', unmapped.some(u => u.originalStoreName === 'LONG GONE STORE'), JSON.stringify(unmapped));
}

console.log('\n── Migration: reconciling an unmapped entry records who/what, without rewriting MASTER_LOG ──');
{
  const { sandbox } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Reconciled Target', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  sandbox.store_recordUnmapped('Old Spelling', '2026-01-01', '2026-01-01', 1);
  const before = sandbox.store_getUnmappedStores('UNMAPPED');
  const entry = before.find(u => u.originalStoreName === 'OLD SPELLING');
  const result = sandbox.store_reconcileUnmapped(entry.unmappedId, created.storeId, 'confirmed same store');
  check('reconciliation succeeds', result.success, JSON.stringify(result));
  const after = sandbox.store_getUnmappedStores('RECONCILED');
  check('the entry now shows RECONCILED with the resolved Store ID', after.some(u => u.unmappedId === entry.unmappedId && u.resolvedStoreId === created.storeId), JSON.stringify(after));
}

// ═══════════════════════════════════════════════════════════════
// 5. SECURITY
// ═══════════════════════════════════════════════════════════════

console.log('\n── Security: a non-admin cannot create, update, activate, or deactivate a store ──');
{
  const { sandbox, state } = newSandbox();
  const created = sandbox.store_create({ storeName: 'Admin Only Co', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  state.isAdmin = false;
  const createAttempt = sandbox.store_create({ storeName: 'Should Fail', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const updateAttempt = sandbox.store_update(created.storeId, { category: 'Z' }, TODAY, 'should fail');
  const deactivateAttempt = sandbox.store_deactivate(created.storeId, 'should fail', TODAY);
  check('create is rejected for a non-admin', createAttempt.success === false, JSON.stringify(createAttempt));
  check('update is rejected for a non-admin', updateAttempt.success === false, JSON.stringify(updateAttempt));
  check('deactivate is rejected for a non-admin', deactivateAttempt.success === false, JSON.stringify(deactivateAttempt));
  state.isAdmin = true;
  const stillOriginal = sandbox.resolveStoreAsOf(created.storeId, TODAY);
  check('none of the rejected attempts mutated the store', stillOriginal.fields.category === 'A', JSON.stringify(stillOriginal));
}

console.log('\n── Security: a spoofed client-side "isAdmin" field on the payload cannot bypass the server check ──');
{
  const { sandbox, state } = newSandbox();
  state.isAdmin = false; // the server-side truth: this caller is NOT an admin
  // Even if a hypothetical caller stuffs isAdmin/role fields onto the
  // fields payload itself, admin gating never reads from the payload —
  // only from sl_isAdmin(), which is a server-side session check.
  const attempt = sandbox.store_create(
    { storeName: 'Spoofed Co', brand: 'FIGARO', region: 'NCR', category: 'A', isAdmin: true, role: 'ADMIN' },
    TODAY, 'setup'
  );
  check('the spoofed field is ignored; the server-side gate still rejects the request', attempt.success === false, JSON.stringify(attempt));
}

console.log('\n── Security: an attempt to retarget an existing store to a different Store ID is rejected even by an admin ──');
{
  const { sandbox } = newSandbox();
  const storeA = sandbox.store_create({ storeName: 'Store A', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const storeB = sandbox.store_create({ storeName: 'Store B', brand: 'FIGARO', region: 'NCR', category: 'A' }, TODAY, 'setup');
  const attempt = sandbox.store_update(storeA.storeId, { storeId: storeB.storeId, storeName: 'Hijacked' }, TODAY, 'attempted retarget');
  check('retargeting Store A to Store B\'s ID is rejected, not silently applied', attempt.success === false, JSON.stringify(attempt));
  const aStill = sandbox.resolveStoreAsOf(storeA.storeId, TODAY);
  const bStill = sandbox.resolveStoreAsOf(storeB.storeId, TODAY);
  check('Store A is untouched', aStill.fields.storeName === 'Store A', JSON.stringify(aStill));
  check('Store B is untouched', bStill.fields.storeName === 'Store B', JSON.stringify(bStill));
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
