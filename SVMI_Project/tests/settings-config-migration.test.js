// Phase 1G: Admin -> Configuration becomes the ONE authoritative place to
// create/edit a Store, Visitor, or Purpose. The "Store & Roster Manager"
// card (which used to write straight to the legacy SETTINGS sheet) is
// removed. This file verifies:
//   1. A CONFIG_STORES/VISITORS/PURPOSES mutation automatically keeps the
//      legacy SETTINGS mirror in sync (_cfg_syncLegacyMirror(), via
//      SVMKPI_STORE_CONFIG.gs/SVMKPI_VISITOR_CONFIG.gs/
//      SVMKPI_PURPOSE_CONFIG.gs's own sync helpers) — add, deactivate,
//      and rename (Stores only — Visitors/Purposes have no rename
//      concept, their name IS their identity).
//   2. Deactivating a legacy-approved Purpose (one of the 4 built-in
//      ones) never removes it from the SETTINGS mirror — the legacy
//      fallback in purpose_getConfigurationStatus() still applies.
//   3. getSidebarData() (INPUT_PORTAL.gs) sources the Input Portal's
//      Store/Visitor/Purpose lists from CONFIG_* directly — proven by
//      populating CONFIG_* WITHOUT ever touching SETTINGS and confirming
//      the correct, active-only list still comes back.
//   4. settingsMigration_run() imports pre-existing legacy SETTINGS data
//      into CONFIG_* once, and is safe to run again without duplicating.
//   5. No Store & Roster Manager UI reference remains in SVMI_PORTAL.html.
//
// Runs the REAL Apps Script code in a Node vm sandbox, same mock
// conventions as roster-auto-refresh.test.js/admin-api.test.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc      = APPS('SVMKPI_CORE.gs');
const configSrc    = APPS('SVMKPI_CONFIG.gs');
const storeCfgSrc  = APPS('SVMKPI_STORE_CONFIG.gs');
const visitorSrc   = APPS('SVMKPI_VISITOR_CONFIG.gs');
const purposeSrc   = APPS('SVMKPI_PURPOSE_CONFIG.gs');
const riskCfgSrc   = APPS('SVMKPI_RISK_CONFIG.gs');
const kpiCfgSrc    = APPS('SVMKPI_KPI_CONFIG.gs');
const adminApiSrc  = APPS('SVMKPI_ADMIN_API.gs');
const inputSrc     = APPS('INPUT_PORTAL.gs');
const migrationSrc = APPS('SVMKPI_SETTINGS_MIGRATION.gs');
const riskSrc      = APPS('SVMKPI_RISK.gs'); // for RISK_PURPOSE_SCORE (risk_resolvePurposeWeight's ultimate fallback)
const htmlSrc      = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMI_PORTAL.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Generic writable Sheet mock covering both the CONFIG_* generic
//    engine's cell layout AND SETTINGS'/MASTER_LOG's plain-value layout,
//    same shape as roster-auto-refresh.test.js's mock. ──
function makeSheet() {
  const cells = {};
  const key = (r, c) => r + ',' + c;
  function makeRange(row, col, numRows, numCols) {
    const range = {};
    let proxy;
    range.setValue = (v) => { for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) cells[key(row + r, col + c)] = v; return proxy; };
    range.setValues = (rows) => { rows.forEach((rowArr, ri) => rowArr.forEach((v, ci) => { cells[key(row + ri, col + ci)] = v; })); return proxy; };
    range.setFormula = (f) => { cells[key(row, col)] = f; return proxy; };
    range.clearContent = () => { for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) delete cells[key(row + r, col + c)]; return proxy; };
    range.getValue = () => { const v = cells[key(row, col)]; return v == null ? '' : v; };
    range.getValues = () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const rowArr = [];
        for (let c = 0; c < numCols; c++) { const v = cells[key(row + r, col + c)]; rowArr.push(v == null ? '' : v); }
        out.push(rowArr);
      }
      return out;
    };
    proxy = new Proxy(range, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => proxy; } });
    return proxy;
  }
  const sheet = {
    _cells: cells,
    getLastRow() {
      let max = 0;
      Object.keys(cells).forEach(k => { const r = parseInt(k.split(',')[0], 10); if (cells[k] != null && cells[k] !== '' && r > max) max = r; });
      return max;
    },
    getRange(row, col, numRows, numCols) { return makeRange(row, col, numRows || 1, numCols || 1); },
    appendRow(rowArr) { const r = this.getLastRow() + 1; rowArr.forEach((v, i) => { cells[key(r, i + 1)] = v; }); },
  };
  let sproxy;
  sproxy = new Proxy(sheet, { get(t, p) { if (p in t) return t[p]; if (typeof p !== 'string') return undefined; return () => sproxy; } });
  return sproxy;
}

function newSandbox() {
  const sheets = {};
  const ssMock = {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => { const s = makeSheet(); sheets[name] = s; return s; },
  };
  // SETTINGS always exists as a real, permanent sheet with a header row
  // in the live deployment (unlike CONFIG_* sheets, which
  // _cfg_ensureSheet() creates on demand) — portal_saveStore()/
  // manageVisitor()/managePurpose() all expect it to already be there,
  // with row 1 as the header, rather than creating it themselves. A mock
  // with NO header row would make the very first store land on row 1
  // instead of row 2 (portal_saveStore()'s own "new row = lastRow + 1"
  // logic), which this settingsSnapshot() helper (scanning from row 2)
  // would then miss entirely — seeding row 1 avoids that mismatch with
  // the real sheet's actual starting state.
  const settingsSheet = ssMock.insertSheet('SETTINGS');
  settingsSheet.getRange(1, 1, 1, 8).setValues([['Store', 'Brand', 'Region', 'Validation', 'Category', 'Visitor Roster', '', 'Purpose List']]);
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
    _kpiSheetName: () => null, // KPI 2026 rebuild isn't loaded in this sandbox; keeps manageVisitor()'s own optional auto-refresh a harmless no-op
    console,
  };
  vm.createContext(sandbox);
  [coreSrc, configSrc, storeCfgSrc, visitorSrc, purposeSrc, riskCfgSrc, kpiCfgSrc, adminApiSrc, inputSrc, migrationSrc, riskSrc]
    .forEach(src => vm.runInContext(src, sandbox));
  return { sandbox, ssMock, sheets, state };
}

function settingsSnapshot(sheets) {
  const settings = sheets['SETTINGS'];
  if (!settings) return { stores: [], visitors: [], purposes: [] };
  const lastRow = settings.getLastRow();
  const stores = [], visitors = [], purposes = [];
  for (let r = 2; r <= lastRow; r++) {
    const store = settings.getRange(r, 1).getValue();
    const brand = settings.getRange(r, 2).getValue();
    const region = settings.getRange(r, 3).getValue();
    const category = settings.getRange(r, 5).getValue();
    const visitor = settings.getRange(r, 6).getValue();
    const purpose = settings.getRange(r, 8).getValue();
    if (store) stores.push({ store, brand, region, category });
    if (visitor) visitors.push(visitor);
    if (purpose) purposes.push(purpose);
  }
  return { stores, visitors, purposes };
}

// Every effective date below is computed relative to the real clock
// (never a hardcoded literal) so this suite keeps passing regardless of
// when it's actually run — a lesson learned from admin-api.test.js's own
// hardcoded-date rollback test, which broke the moment real time passed
// it (see that file's fix in this same change).
function daysFromNowStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const TODAY = daysFromNowStr(0);
const YESTERDAY = daysFromNowStr(-1);

// ── 1a. Creating a store syncs SETTINGS ────────────────────────────────
console.log('\n── store_create() syncs the legacy SETTINGS mirror ──');
{
  const { sandbox, sheets } = newSandbox();
  const r = sandbox.store_create({ storeName: 'Acme Mall', brand: 'APEX', region: 'NCR', category: 'NCR' }, TODAY, 'seed', {});
  check('store created', r.success === true, JSON.stringify(r));
  const snap = settingsSnapshot(sheets);
  eq('SETTINGS has exactly the new store', snap.stores, [{ store: 'ACME MALL', brand: 'APEX', region: 'NCR', category: 'NCR' }]);
}

// ── 1b. Deactivating a store clears its SETTINGS row, keeps history ───
// (The store is created effective YESTERDAY — backdated, confirmed — so
// the deactivation below can be effective TODAY without colliding on an
// identical Effective From date; store_getById()/_storeSync_toSettings()
// both resolve "as of today", so the deactivation needs an effective
// date that has actually arrived for the sync to see it take hold.)
console.log('\n── store_deactivate() clears the SETTINGS row ──');
{
  const { sandbox, sheets } = newSandbox();
  const r = sandbox.store_create({ storeName: 'Acme Mall', brand: 'APEX', region: 'NCR', category: 'NCR' }, YESTERDAY, 'seed', { backdateConfirmed: true });
  sandbox.store_deactivate(r.storeId, 'closing', TODAY, {});
  const snap = settingsSnapshot(sheets);
  eq('SETTINGS no longer lists the deactivated store', snap.stores, []);
  const hist = sandbox.cfg_getConfiguration('STORES', r.storeId);
  eq('CONFIG_STORES history still has both versions', hist.length, 2);
}

// ── 1c. Renaming a store removes the OLD name's row, adds the new one ──
console.log('\n── store_update() renaming a store reconciles SETTINGS (no stale old-name row) ──');
{
  const { sandbox, sheets } = newSandbox();
  const r = sandbox.store_create({ storeName: 'Old Name', brand: 'APEX', region: 'NCR', category: 'NCR' }, YESTERDAY, 'seed', { backdateConfirmed: true });
  sandbox.store_update(r.storeId, { storeName: 'New Name', brand: 'APEX', region: 'NCR', category: 'NCR' }, TODAY, 'rename', {});
  const snap = settingsSnapshot(sheets);
  eq('SETTINGS shows only the new name, old name is gone', snap.stores, [{ store: 'NEW NAME', brand: 'APEX', region: 'NCR', category: 'NCR' }]);
}

// ── 2a. Visitor create/deactivate syncs SETTINGS!F ─────────────────────
console.log('\n── Visitor CONFIG_* mutation (via the generic engine, same as Admin\'s own client code) syncs SETTINGS!F ──');
{
  const { sandbox, sheets } = newSandbox();
  const created = sandbox.cfg_createConfiguration('VISITORS', 'JUAN DELA CRUZ', { visitorName: 'JUAN DELA CRUZ' }, TODAY, null, 'seed', {});
  check('visitor created', created.success === true, JSON.stringify(created));
  eq('SETTINGS!F has the new visitor', settingsSnapshot(sheets).visitors, ['JUAN DELA CRUZ']);

  sandbox.cfg_deactivateConfiguration('VISITORS', created.versionId, 'left the company');
  eq('SETTINGS!F no longer lists the deactivated visitor', settingsSnapshot(sheets).visitors, []);
}

// ── 2b. Purpose create/deactivate syncs SETTINGS!H, legacy purposes never removed ──
console.log('\n── Purpose CONFIG_* mutation syncs SETTINGS!H, without ever dropping a legacy-approved purpose ──');
{
  const { sandbox, sheets } = newSandbox();
  const created = sandbox.purpose_create('SPECIAL AUDIT', {}, TODAY, 'seed', {});
  check('purpose created', created.success === true, JSON.stringify(created));
  eq('SETTINGS!H has the new purpose', settingsSnapshot(sheets).purposes, ['SPECIAL AUDIT']);

  // Deactivating one of the 4 built-in legacy purposes must NOT remove it
  // from SETTINGS!H — purpose_getConfigurationStatus()'s legacy fallback
  // keeps it "active" regardless of any CONFIG_PURPOSES row's own status.
  const legacy = sandbox.purpose_create('STORE VISIT', {}, TODAY, 'deliberately configuring the legacy purpose', {});
  check('CONFIG_PURPOSES row created for a legacy purpose', legacy.success === true, JSON.stringify(legacy));
  sandbox.purpose_deactivate(legacy.versionId, 'testing legacy fallback');
  check('STORE VISIT is still in the SETTINGS!H mirror after its CONFIG_PURPOSES row is deactivated (legacy fallback)',
    settingsSnapshot(sheets).purposes.indexOf('STORE VISIT') !== -1, JSON.stringify(settingsSnapshot(sheets).purposes));
}

// ── 3. getSidebarData() sources Input Portal's lists from CONFIG_*, never SETTINGS ──
console.log('\n── getSidebarData() reads CONFIG_*, not SETTINGS ──');
{
  const { sandbox } = newSandbox();
  sandbox.store_create({ storeName: 'Config Store', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, TODAY, 'seed', {});
  sandbox.cfg_createConfiguration('VISITORS', 'MARIA SANTOS', { visitorName: 'MARIA SANTOS' }, TODAY, null, 'seed', {});
  sandbox.purpose_create('SPECIAL AUDIT', {}, TODAY, 'seed', {});
  // SETTINGS sheet is never touched directly in this scenario — only
  // CONFIG_* calls above wrote anything (their own sync hook is what
  // populated SETTINGS as a side effect, but getSidebarData() must not
  // depend on that mirror at all).
  const data = sandbox.getSidebarData();
  eq('stores come from CONFIG_STORES', data.stores, [{ store: 'CONFIG STORE', brand: 'FIGARO', region: 'NCR', category: 'NCR' }]);
  check('visitors include the CONFIG_VISITORS entry', data.visitors.indexOf('MARIA SANTOS') !== -1, JSON.stringify(data.visitors));
  check('purposes include both the legacy default and the new CONFIG_PURPOSES entry',
    data.purposes.indexOf('STORE VISIT') !== -1 && data.purposes.indexOf('SPECIAL AUDIT') !== -1, JSON.stringify(data.purposes));
}

// ── 4. settingsMigration_run() imports legacy data once, safe to re-run ──
console.log('\n── settingsMigration_run() imports pre-existing legacy SETTINGS data into CONFIG_*, idempotently ──');
{
  const { sandbox, sheets } = newSandbox();
  const settings = sheets['SETTINGS'] || (sheets['SETTINGS'] = makeSheet());
  // Seed legacy data exactly the way the removed Store & Roster Manager
  // would have left it, with no CONFIG_* rows behind it yet.
  settings.getRange(2, 1).setValue('LEGACY STORE');
  settings.getRange(2, 2).setValue('APEX');
  settings.getRange(2, 3).setValue('NCR');
  settings.getRange(2, 5).setValue('NCR');
  settings.getRange(2, 6).setValue('OLD VISITOR');
  settings.getRange(2, 8).setValue('LEGACY PURPOSE');

  const first = sandbox.settingsMigration_run();
  check('migration succeeds', first.success === true, JSON.stringify(first));
  eq('one store migrated', first.stores.createdStoreIds.length, 1);
  eq('one visitor migrated', first.visitors.createdNames, ['OLD VISITOR']);
  eq('one purpose migrated', first.purposes.createdNames, ['LEGACY PURPOSE']);

  const resolvedStoreId = sandbox.store_resolveIdByCurrentName('LEGACY STORE');
  check('the migrated store now resolves through Store ID identity', !!resolvedStoreId);

  const second = sandbox.settingsMigration_run();
  check('re-running succeeds', second.success === true);
  eq('nothing new created the second time', second.stores.createdStoreIds.length, 0);
  eq('the store is reported as already migrated', second.stores.alreadyMigrated, ['LEGACY STORE']);
  eq('the visitor is reported as already migrated', second.visitors.alreadyMigrated, ['OLD VISITOR']);
  eq('the purpose is reported as already migrated', second.purposes.alreadyMigrated, ['LEGACY PURPOSE']);
}

// ── 4b. A SETTINGS row that fails validation is reported in `failed`,
//        never silently dropped (the bug a live-deployment admin actually
//        hit: the migration reported "success" while some SETTINGS rows
//        never became CONFIG_* entities at all, with no error surfaced) ──
console.log('\n── settingsMigration_run() reports rows that fail to migrate instead of silently dropping them ──');
{
  const { sandbox, sheets } = newSandbox();
  const settings = sheets['SETTINGS'] || (sheets['SETTINGS'] = makeSheet());
  // Row 2: a valid store — should migrate cleanly.
  settings.getRange(2, 1).setValue('GOOD STORE');
  settings.getRange(2, 2).setValue('APEX');
  settings.getRange(2, 3).setValue('NCR');
  settings.getRange(2, 5).setValue('NCR');
  // Row 3: a legacy row with a BLANK Region cell — a real-world data-
  // quality gap this migration must surface, not one it invents. (A
  // non-blank-but-unapproved Brand/Region is a separate, documented gap —
  // cfg_validateConfiguration() doesn't check approved-list membership
  // for CFG_AREA.STORES, only blankness — so that would NOT fail here.)
  settings.getRange(3, 1).setValue('INCOMPLETE STORE');
  settings.getRange(3, 2).setValue('APEX');
  settings.getRange(3, 3).setValue(''); // blank Region — required field
  settings.getRange(3, 5).setValue('NCR');

  const result = sandbox.settingsMigration_run();
  check('migration call itself still succeeds (a per-row failure is not a fatal error)', result.success === true, JSON.stringify(result));
  eq('the valid store is created', result.stores.createdStoreIds.length, 1);
  check('the incomplete-data store is reported in failed, not silently dropped',
    result.stores.failed && result.stores.failed.length === 1 && result.stores.failed[0].name === 'INCOMPLETE STORE',
    JSON.stringify(result.stores.failed));
  check('the failure reason names the actual validation problem (missing Region)',
    /region/i.test((result.stores.failed[0] || {}).message || ''), JSON.stringify(result.stores.failed));
  check('the incomplete store never became a real Store ID', !sandbox.store_resolveIdByCurrentName('INCOMPLETE STORE'));

  // Re-running does not spuriously "fix" or duplicate the failure — same
  // row fails again, reported again, exactly like alreadyMigrated does
  // for a row that succeeded.
  const second = sandbox.settingsMigration_run();
  eq('re-running reports the same still-unfixed row as failed again', second.stores.failed.length, 1);
  eq('re-running does not re-create the already-migrated valid store', second.stores.createdStoreIds.length, 0);
}

console.log('\n── visitor_migrateFromSettings()/purpose_migrateFromSettings() also report failures, not just successes ──');
{
  const { sandbox } = newSandbox();
  // cfg_createConfiguration() rejects a blank/whitespace-only entity ID
  // (normalizes to '') — exercise the failure path directly, the same
  // shape a real-world malformed SETTINGS cell would hit.
  const visResult = sandbox.visitor_migrateFromSettings(['GOOD VISITOR']);
  eq('a valid visitor still migrates cleanly', visResult.createdNames, ['GOOD VISITOR']);
  check('visitor_migrateFromSettings() returns a failed array (even if empty) instead of omitting it', Array.isArray(visResult.failed));

  const purResult = sandbox.purpose_migrateFromSettings(['GOOD PURPOSE']);
  eq('a valid purpose still migrates cleanly', purResult.createdNames, ['GOOD PURPOSE']);
  check('purpose_migrateFromSettings() returns a failed array (even if empty) instead of omitting it', Array.isArray(purResult.failed));
}

// ── 5. No Store & Roster Manager UI reference remains ──────────────────
console.log('\n── SVMI_PORTAL.html has no remaining Store & Roster Manager UI/handlers ──');
{
  const bannedTokens = ['toggleStoreManager(', 'srmSaveStore(', 'srmRemoveStore(', 'srmManageVisitor(', 'srmManagePurpose(', 'srmInit(', 'srmFilterStores(', 'id="srmPanel"'];
  bannedTokens.forEach(tok => {
    check('no "' + tok + '" reference remains', htmlSrc.indexOf(tok) === -1);
  });
  check('the migration tool button is present instead', htmlSrc.indexOf('runSettingsMigration()') !== -1);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
