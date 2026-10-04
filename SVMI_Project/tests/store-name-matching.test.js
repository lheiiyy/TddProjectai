// Phase C.1 — Store Name Matching (SVMKPI_STORE_MATCH.gs).
// Runs the REAL Apps Script code (CORE + CONFIG + STORE_CONFIG + INPUT_PORTAL
// + TABLES + STORE_MATCH) in a Node vm sandbox against an in-memory
// spreadsheet seeded like the live data: one Figaro store saved twice
// (SANTA MARIA / STA MARIA) plus a third spelling (STA. MARIA (F)), an
// Angel's Pizza STA. MARIA in the same town, closed stores that were never
// configured, and an alias already reconciled by hand (SM SAN PEDRO).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');
const FILES = ['SVMKPI_CORE.gs', 'SVMKPI_CONFIG.gs', 'SVMKPI_STORE_CONFIG.gs', 'INPUT_PORTAL.gs', 'SVMKPI_TABLES.gs', 'SVMKPI_STORE_MATCH.gs'];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); fail++; }
}

// ── In-memory Sheet (same shape as visit-tables.test.js, plus getRangeList) ──
function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function makeSheet(name) {
  const cells = {};
  let maxRows = 1000;
  const k = (r, c) => r + ',' + c;
  const set = (r, c, v) => { if (v === '' || v == null) delete cells[k(r, c)]; else cells[k(r, c)] = v; };
  const get = (r, c) => { const v = cells[k(r, c)]; return v == null ? '' : v; };
  const lastRow = () => { let m = 0; Object.keys(cells).forEach(key => { const r = +key.split(',')[0]; if (r > m) m = r; }); return m; };
  function range(row, col, nr, nc) {
    if (typeof row === 'string') { row = 1; col = 1; nr = 1; nc = 1; }
    nr = nr || 1; nc = nc || 1;
    const r = {
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const a = []; for (let j = 0; j < nc; j++) a.push(get(row + i, col + j)); out.push(a); } return out; },
      setValues: (vals) => { vals.forEach((a, i) => a.forEach((v, j) => set(row + i, col + j, v))); return p; },
      setValue: (v) => { set(row, col, v); return p; },
      getValue: () => get(row, col),
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(row + i, col + j, ''); return p; },
    };
    const p = new Proxy(r, { get: (t, prop) => (prop in t ? t[prop] : (typeof prop === 'string' ? () => p : undefined)) });
    return p;
  }
  const s = {
    getName: () => name,
    getLastRow: lastRow,
    getMaxRows: () => maxRows,
    insertRowsAfter: (after, n) => { maxRows += n; },
    getRange: range,
    getRangeList: (refs) => ({
      setValue: (v) => {
        refs.forEach(a1 => { const m = /^([A-Z]+)(\d+)$/.exec(a1); if (!m) throw new Error('bad A1 ' + a1); set(+m[2], colNum(m[1]), v); });
        s._rangeListCalls++;
      },
    }),
    appendRow: (a) => { const r = lastRow() + 1; if (r > maxRows) maxRows = r; a.forEach((v, j) => set(r, j + 1, v)); },
    protect: () => { const pr = new Proxy({}, { get: () => () => pr }); return pr; },
    _cells: cells,
    _rangeListCalls: 0,
  };
  const sp = new Proxy(s, { get: (t, prop) => (prop in t ? t[prop] : (typeof prop === 'string' ? () => sp : undefined)) });
  return sp;
}

function newSandbox(opts) {
  opts = opts || {};
  const sheets = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { sheets[n] = makeSheet(n); return sheets[n]; },
  };
  const state = { isAdmin: true, lockFree: true };
  const errors = [];
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    Session: { getScriptTimeZone: () => 'Asia/Manila' },
    LockService: { getScriptLock: () => ({ tryLock: () => state.lockFree, releaseLock: () => {} }) },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p2 = n => String(n).padStart(2, '0');
        const ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        return fmt.indexOf('HH') !== -1 ? ymd + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) : ymd;
      },
      getUuid: (() => { let n = 0; return () => 'UUID-' + (++n); })(),
      computeDigest: (alg, text) => Array.from(crypto.createHash('sha256').update(String(text), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
    },
    sl_isAdmin: () => state.isAdmin,
    sl_getCurrentUser: () => 'admin@test.com',
    Logger: { log: () => {} },
    console: { log: () => {}, error: (m) => errors.push(m), warn: () => {} },
  };
  vm.createContext(sandbox);
  FILES.forEach(f => vm.runInContext(src(f), sandbox, { filename: f }));
  const master = ss.insertSheet('MASTER_LOG');
  master.getRange(1, 1, 1, 9).setValues([['TIMES STAMP', 'DATE VISITED', 'STORE', 'BRAND', 'REGION', 'VISITED BY', 'PURPOSE', 'REMARKS', 'STORE ID']]);
  const settings = ss.insertSheet('SETTINGS');
  settings.getRange(1, 1, 1, 8).setValues([['STORE', 'BRAND', 'REGION', 'CHECK', 'CATEGORY', 'VISITORS', 'ADMINS', 'PURPOSES']]);
  const SDate = vm.runInContext('Date', sandbox);
  return { sandbox, ss, sheets, master, settings, state, errors, SDate };
}

const OPTS = { backdateConfirmed: true };
const FIG = { brand: 'FIGARO', region: 'FRANCHISE', category: 'NEAR PROVINCIAL' };
const AP_PROV = { brand: "ANGEL'S PIZZA", region: 'PROVINCIAL' };

function seed(env) {
  const { sandbox: s, master, SDate } = env;
  const mk = (name, base, cat, from) => s.store_create(Object.assign({ storeName: name, category: cat || base.category }, base), from, 'Migrated from SETTINGS', OPTS).storeId;
  const ids = {
    K:    mk('SANTA MARIA', FIG, null, '2026-05-11'),
    M:    mk('STA MARIA', FIG, null, '2026-07-08'),
    APSM: mk('STA. MARIA', AP_PROV, 'NEAR PROVINCIAL', '2026-01-03'),
    SP:   mk('SAN PEDRO', AP_PROV, 'FAR PROVINCIAL', '2026-02-21'),
    URD:  mk('URDANETA', AP_PROV, 'FAR PROVINCIAL', '2026-02-26'),
  };
  ['LEO', 'ANN', 'CHARLIE'].forEach(v => s.cfg_createConfiguration('VISITORS', v, { visitorName: v }, '2026-01-01', null, 'setup', OPTS));
  const d = (y, m, dd) => new SDate(y, m - 1, dd);
  const ts = (y, m, dd) => new SDate(y, m - 1, dd, 9, 0, 0);
  const row = (date, store, brand, region, who, id) => [ts(...date), d(...date), store, brand, region, who, 'STORE VISIT', '', id || ''];
  const rows = [
    row([2026, 5, 11], 'SANTA MARIA', 'FIGARO', 'FRANCHISE', 'LEO'),            // 2
    row([2026, 6, 15], 'SANTA MARIA', 'FIGARO', 'FRANCHISE', 'ANN'),            // 3
    row([2026, 7, 8],  'STA MARIA', 'FIGARO', 'FRANCHISE', 'LEO'),              // 4
    row([2026, 7, 25], 'STA. MARIA (F)', 'FIGARO', 'FRANCHISE', 'ANN'),         // 5  unmatched
    row([2026, 8, 20], 'STA MARIA', 'FIGARO', 'FRANCHISE', 'LEO', ids.M),       // 6  portal row, col I = duplicate
    row([2026, 1, 3],  'STA. MARIA', "ANGEL'S PIZZA", 'PROVINCIAL', 'CHARLIE', ids.APSM), // 7
    row([2026, 1, 22], 'SHANGRILA', "ANGEL'S PIZZA", 'NCR', 'LEO'),             // 8  unmatched (closed store)
    row([2026, 5, 28], 'shangrila ', "ANGEL'S PIZZA", 'NCR', 'ANN'),            // 9  unmatched, messy case
    row([2026, 2, 21], 'SM SAN PEDRO', "ANGEL'S PIZZA", 'PROVINCIAL', 'LEO'),   // 10 reconciled by hand → SAN PEDRO
    row([2026, 5, 5],  'URDANETA FIGARO', 'FIGARO', 'FRANCHISE', 'ANN'),        // 11 unmatched (separate Figaro store)
    row([2026, 3, 1],  'SAN PEDRO', "ANGEL'S PIZZA", 'PROVINCIAL', 'ANN', ids.SP), // 12
  ];
  master.getRange(2, 1, rows.length, 9).setValues(rows);
  // CONFIG_UNMAPPED_STORES as the live migration left it
  const rec = (n, f, l, c) => s.store_recordUnmapped(n, f, l, c).unmappedId;
  const sp = rec('SM SAN PEDRO', '2026-02-21', '2026-02-21', 1);
  s.store_reconcileUnmapped(sp, ids.SP, 'same store');
  rec('SHANGRILA', '2026-01-22', '2026-05-28', 2);
  rec('URDANETA FIGARO', '2026-05-05', '2026-05-05', 1);
  rec('STA. MARIA (F)', '2026-07-25', '2026-07-25', 1);
  return ids;
}

const cell = (env, row, col) => env.master.getRange(row, col).getValue();
const sheetRows = (env, name, width) => { const sh = env.ss.getSheetByName(name); return sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : []; };
const settingsNames = env => sheetRows(env, 'SETTINGS', 1).map(r => String(r[0])).filter(Boolean);
const hasDate = v => v instanceof Date || Object.prototype.toString.call(v) === '[object Date]';
function anyDate(o) { if (hasDate(o)) return true; if (o && typeof o === 'object') return Object.keys(o).some(k => anyDate(o[k])); return false; }

const STA_MARIA_DECISIONS = (ids) => ([
  { key: 'U-STA', type: 'map', name: 'STA. MARIA (F)', storeId: ids.M }, // picks the duplicate on purpose
  { key: 'G-STA', type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' },
  { key: 'U-SHA', type: 'create', name: 'SHANGRILA', storeName: 'SHANGRILA', brand: "ANGEL'S PIZZA", region: 'NCR', category: 'NCR', active: false, closedFrom: '2026-06-01' },
  { key: 'U-URD', type: 'create', name: 'URDANETA FIGARO', storeName: 'URDANETA FIGARO', brand: 'FIGARO', region: 'FRANCHISE', category: 'FAR PROVINCIAL', active: false, closedFrom: '' },
  { key: 'G-SP', type: 'merge', keepId: ids.SP, mergeIds: [], finalName: 'SAN PEDRO' },
]);

console.log('\n── Find: unmatched names, duplicates, spellings ──');
{
  const env = newSandbox(); const ids = seed(env);
  const r = env.sandbox.portal_getStoreCleanup();
  check('loads', r.success, r.message);
  check('no Date objects in the result (google.script.run cannot return them)', !anyDate(r));
  check('3 unmatched names, most visits first', JSON.stringify(r.unmatched.map(u => u.name)) === JSON.stringify(['SHANGRILA', 'STA. MARIA (F)', 'URDANETA FIGARO']), r.unmatched.map(u => u.name));
  check('messy "shangrila " counted with SHANGRILA', r.unmatched[0].visits === 2, r.unmatched[0]);
  check('4 visits with no Store ID', r.unmatchedVisits === 4, r.unmatchedVisits);
  check('SM SAN PEDRO is not listed (already reconciled)', !r.unmatched.some(u => u.name === 'SM SAN PEDRO'));

  const sta = r.unmatched.filter(u => u.name === 'STA. MARIA (F)')[0];
  check('STA. MARIA (F): first suggestion is the older Figaro store, strong', sta.suggestions[0].storeId === ids.K && sta.suggestions[0].strong, sta.suggestions);
  check('STA. MARIA (F): the other Figaro spelling is also strong', sta.suggestions.some(x => x.storeId === ids.M && x.strong), sta.suggestions);
  check('STA. MARIA (F): Angel\'s Pizza STA. MARIA suggested but NOT strong (other brand)', sta.suggestions.some(x => x.storeId === ids.APSM && !x.strong), sta.suggestions);
  check('STA. MARIA (F): recorded brand FIGARO', sta.brand === 'FIGARO', sta.brand);

  const urd = r.unmatched.filter(u => u.name === 'URDANETA FIGARO')[0];
  check('URDANETA FIGARO: AP URDANETA suggested but not strong', urd.suggestions.some(x => x.storeId === ids.URD && !x.strong) && !urd.suggestions.some(x => x.strong), urd.suggestions);
  check('URDANETA FIGARO: category pre-filled from the same-town store', urd.defaultCategory === 'FAR PROVINCIAL', urd.defaultCategory);
  check('URDANETA FIGARO: closed-from defaults to the day after the last visit', urd.defaultClosedFrom === '2026-05-06', urd.defaultClosedFrom);
  const sha = r.unmatched[0];
  check('SHANGRILA: NCR region → NCR category', sha.region === 'NCR' && sha.defaultCategory === 'NCR', sha);
  check('SHANGRILA: has its CONFIG_UNMAPPED_STORES entry', /^UNMAPPED-/.test(sha.unmappedId), sha.unmappedId);

  const dup = r.groups.filter(g => g.type === 'duplicate');
  check('one possible-duplicate group', dup.length === 1, r.groups);
  check('it is the two Figaro Sta. Maria stores', dup[0] && dup[0].brand === 'FIGARO' && dup[0].stores.map(s => s.storeId).sort().join() === [ids.K, ids.M].sort().join(), dup[0]);
  check('keep suggestion = the store that existed first (SANTA MARIA)', dup[0] && dup[0].suggestedKeep === ids.K, dup[0] && dup[0].suggestedKeep);
  check('name suggestion = STA. MARIA (F)', dup[0] && dup[0].suggestedName === 'STA. MARIA (F)', dup[0] && dup[0].suggestedName);
  check('Angel\'s Pizza STA. MARIA is in no group (brands never merge)', !r.groups.some(g => g.stores.some(s => s.storeId === ids.APSM)));
  const spell = r.groups.filter(g => g.type === 'spelling');
  check('SAN PEDRO listed as recorded under two spellings', spell.length === 1 && spell[0].stores[0].storeId === ids.SP && spell[0].names.map(n => n.name).sort().join() === 'SAN PEDRO,SM SAN PEDRO', spell);
  check('every store is offered for "same store as"', r.stores.length === 5, r.stores.length);
  check('option lists come from the approved lists', r.options.brands.indexOf('FIGARO') !== -1 && r.options.categories.indexOf('FAR PROVINCIAL') !== -1);
}

console.log('\n── Defaults hold up when old rows carry no brand ──');
{
  const env = newSandbox(); const ids = seed(env);
  env.master.getRange(5, 4, 1, 2).setValues([['', '']]); // STA. MARIA (F) row: brand/region blank
  let r = env.sandbox.portal_getStoreCleanup();
  const sta = r.unmatched.filter(u => u.name === 'STA. MARIA (F)')[0];
  check('brand guessed from the "(F)" tag', sta.brand === 'FIGARO', sta.brand);
  check('still a strong match to the Figaro store', sta.suggestions[0].storeId === ids.K && sta.suggestions[0].strong, sta.suggestions);
  check('suggested group name still STA. MARIA (F)', r.groups.filter(g => g.type === 'duplicate')[0].suggestedName === 'STA. MARIA (F)');

  env.master.getRange(5, 1, 1, 9).clearContent(); // no "(F)" spelling anywhere in MASTER_LOG
  r = env.sandbox.portal_getStoreCleanup();
  check('without it, the name comes from the same-town Angel\'s Pizza store + (F)', r.groups.filter(g => g.type === 'duplicate')[0].suggestedName === 'STA. MARIA (F)', r.groups);
  check('a brand with no tag keeps its own name', env.sandbox.smt_suggestName_(env.sandbox.smt_loadContext_(), { name: 'SAN PEDRO', brand: "ANGEL'S PIZZA" }, ['SAN PEDRO'], {}) === 'SAN PEDRO');
}

console.log('\n── Preview: order, counts, nothing written ──');
{
  const env = newSandbox(); const ids = seed(env);
  const before = JSON.stringify(env.master._cells);
  const p = env.sandbox.portal_previewStoreCleanup(STA_MARIA_DECISIONS(ids));
  check('preview succeeds', p.success, p.message);
  check('order: merges, then new stores, then "same store as"', p.order.join() === 'G-STA,G-SP,U-SHA,U-URD,U-STA', p.order);
  check('every plan is OK', p.plans.every(x => x.ok), p.plans.filter(x => !x.ok));
  const g = p.plans.filter(x => x.key === 'G-STA')[0];
  check('merge touches the 4 Figaro Sta. Maria rows', g.rows === 4, g);
  check('merge says it renames to STA. MARIA (F)', g.lines.some(l => /Rename SANTA MARIA → STA\. MARIA \(F\)/.test(l)), g.lines);
  const u = p.plans.filter(x => x.key === 'U-STA')[0];
  check('"same store as" the duplicate is redirected to the kept store', u.lines.some(l => /→ STA\. MARIA \(F\) \(FIGARO\)/.test(l)), u.lines);
  const sp = p.plans.filter(x => x.key === 'G-SP')[0];
  check('one-name for SAN PEDRO touches only the SM SAN PEDRO row', sp.rows === 1, sp);
  check('MASTER_LOG untouched by preview', JSON.stringify(env.master._cells) === before);
  check('no new sheets created by preview', !env.ss.getSheetByName('CONFIG_STORE_MERGES') && !env.ss.getSheetByName('MASTER_LOG_FIXES'));
}

console.log('\n── Apply: Sta. Maria merge, closed stores, alias, one name ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  const p = s.portal_previewStoreCleanup(STA_MARIA_DECISIONS(ids));
  const byKey = {}; STA_MARIA_DECISIONS(ids).forEach(d => { byKey[d.key] = d; });
  env.errors.length = 0;
  const results = p.order.map(k => ({ k, r: s.portal_applyStoreCleanupDecision(byKey[k]) }));
  results.forEach(x => check('applied ' + x.k + ' — ' + (x.r.message || ''), x.r.success && !x.r.warning, x.r));
  check('no Store Health rebuild attempted per decision', !env.errors.some(m => /auto-refresh/.test(m)), env.errors);

  // Merge
  const kNow = s.store_getById(ids.K);
  check('kept store renamed STA. MARIA (F)', kNow && kNow.fields.storeName === 'STA. MARIA (F)', kNow && kNow.fields);
  check('kept store keeps its Store ID and brand', kNow && kNow.storeId === ids.K && kNow.fields.brand === 'FIGARO');
  check('old name still valid for old dates (history kept)', s.resolveStoreAsOf(ids.K, '2026-06-01').fields.storeName === 'SANTA MARIA');
  check('duplicate resolves on no date at all', !s.resolveStoreAsOf(ids.M, '2026-07-10') && !s.store_getById(ids.M));
  check('duplicate gone from the Input Portal list', !s.store_getOperationalList().some(x => x.storeId === ids.M));
  const merges = sheetRows(env, 'CONFIG_STORE_MERGES', 8);
  check('merge recorded: duplicate → kept', merges.length === 1 && merges[0][1] === ids.M && merges[0][3] === ids.K && merges[0][2] === 'STA MARIA', merges);
  [2, 3, 4, 6].forEach(r => check('MASTER_LOG row ' + r + ' → STA. MARIA (F) + kept Store ID', cell(env, r, 3) === 'STA. MARIA (F)' && cell(env, r, 9) === ids.K, [cell(env, r, 3), cell(env, r, 9)]));
  check('row 6 (col I was the duplicate) now carries the kept ID', cell(env, 6, 9) === ids.K);
  check('Angel\'s Pizza STA. MARIA row untouched', cell(env, 7, 3) === 'STA. MARIA' && cell(env, 7, 9) === ids.APSM);
  check('brand/region/visitors columns untouched', cell(env, 4, 4) === 'FIGARO' && cell(env, 4, 5) === 'FRANCHISE' && cell(env, 4, 6) === 'LEO');
  const settings = settingsNames(env);
  check('SETTINGS mirror: STA. MARIA (F) in, SANTA MARIA / STA MARIA out', settings.indexOf('STA. MARIA (F)') !== -1 && settings.indexOf('SANTA MARIA') === -1 && settings.indexOf('STA MARIA') === -1, settings);
  check('SETTINGS mirror: Angel\'s Pizza STA. MARIA still there', settings.indexOf('STA. MARIA') !== -1, settings);

  // Alias
  check('STA. MARIA (F) row gets the kept Store ID', cell(env, 5, 3) === 'STA. MARIA (F)' && cell(env, 5, 9) === ids.K, [cell(env, 5, 3), cell(env, 5, 9)]);
  const unm = s.store_getUnmappedStores();
  const staEntry = unm.filter(u => u.originalStoreName === 'STA. MARIA (F)')[0];
  check('its unmapped entry RECONCILED to the kept store', staEntry && staEntry.status === 'RECONCILED' && staEntry.resolvedStoreId === ids.K, staEntry);

  // Closed stores
  const sha = results.filter(x => x.k === 'U-SHA')[0].r.storeId;
  check('SHANGRILA created', /^STR-/.test(sha), sha);
  check('SHANGRILA open during its visits', s.resolveStoreAsOf(sha, '2026-03-01').fields.status === 'ACTIVE');
  check('SHANGRILA closed from 2026-06-01', s.resolveStoreAsOf(sha, '2026-06-01').fields.status === 'INACTIVE' && s.resolveStoreAsOf(sha, '2026-05-31').fields.status === 'ACTIVE');
  check('SHANGRILA starts at its first visit', s.resolveStoreAsOf(sha, '2026-01-22') && !s.resolveStoreAsOf(sha, '2026-01-21'));
  check('SHANGRILA not in the Input Portal list', !s.store_getOperationalList().some(x => x.storeId === sha));
  check('SHANGRILA not left in SETTINGS', settings.indexOf('SHANGRILA') === -1, settings);
  check('both SHANGRILA rows carry its Store ID; messy name cleaned', cell(env, 8, 9) === sha && cell(env, 9, 9) === sha && cell(env, 9, 3) === 'SHANGRILA', [cell(env, 9, 3), cell(env, 9, 9)]);
  const urd = results.filter(x => x.k === 'U-URD')[0].r.storeId;
  check('URDANETA FIGARO closed from the day after its last visit', s.resolveStoreAsOf(urd, '2026-05-06').fields.status === 'INACTIVE' && s.resolveStoreAsOf(urd, '2026-05-05').fields.status === 'ACTIVE');
  check('URDANETA FIGARO is Figaro, separate from AP URDANETA', s.store_getById(urd).fields.brand === 'FIGARO' && urd !== ids.URD);
  const shaEntry = unm.filter(u => u.originalStoreName === 'SHANGRILA')[0];
  check('SHANGRILA unmapped entry RECONCILED to the new store', shaEntry && shaEntry.status === 'RECONCILED' && shaEntry.resolvedStoreId === sha, shaEntry);

  // One name
  check('SM SAN PEDRO row → SAN PEDRO with its Store ID', cell(env, 10, 3) === 'SAN PEDRO' && cell(env, 10, 9) === ids.SP);
  check('SAN PEDRO row that was already right is untouched', cell(env, 12, 3) === 'SAN PEDRO');

  // The log keeps the original spelling
  const fixes = sheetRows(env, 'MASTER_LOG_FIXES', 10);
  const fixFor = r => fixes.filter(f => f[4] === r)[0];
  // 4 Sta. Maria rows + SM SAN PEDRO + 2 SHANGRILA + URDANETA FIGARO + STA. MARIA (F)
  check('one MASTER_LOG_FIXES row per changed MASTER_LOG row', fixes.length === 9, fixes.length);
  check('fix log keeps the old name and old Store ID', fixFor(6) && fixFor(6)[6] === 'STA MARIA' && fixFor(6)[8] === ids.M && fixFor(6)[7] === 'STA. MARIA (F)' && fixFor(6)[9] === ids.K, fixFor(6));
  check('fix log keeps "shangrila " exactly as typed', fixFor(9) && fixFor(9)[6] === 'shangrila ', fixFor(9));
  check('fix log records who and which action', fixFor(2) && fixFor(2)[2] === 'admin@test.com' && fixFor(2)[3] === 'MERGE', fixFor(2));
  check('changes written in batches (RangeList), not cell by cell', env.master._rangeListCalls <= 10, env.master._rangeListCalls);

  // Visit tables
  const fin = s.portal_finishStoreCleanup();
  check('finish succeeds without a Store Health sheet', fin.success, fin);
  const rb = s.portal_rebuildVisitTables();
  check('rebuild: no visit without a Store ID', rb.success && !/no Store ID/.test(rb.message), rb.message);
  const chk = s.portal_checkVisitTables();
  check('check: in sync, nothing unmapped', chk.success && chk.stats.unmapped === 0, chk.stats);
  const visits = sheetRows(env, 'STORE_VISITS', 8);
  check('all 5 Figaro Sta. Maria visits under one Store ID', visits.filter(v => v[2] === ids.K).length === 5, visits.map(v => v[2]));

  const again = s.portal_getStoreCleanup();
  check('Find again: nothing left to fix', again.success && again.unmatched.length === 0 && again.groups.length === 0, again);
  const redo = s.portal_applyStoreCleanupDecision(byKey['G-STA']);
  check('re-applying the merge is refused (duplicate already merged)', !redo.success && /not found|already merged/.test(redo.message), redo);
}

console.log('\n── Resolver follows merges ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  s.portal_applyStoreCleanupDecision({ type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' });
  const resolve = s.svt_buildStoreResolver_();
  check('a Store ID in column I that was merged → kept store', resolve('ANYTHING', ids.M) === ids.K);
  check('the duplicate\'s old name → kept store', resolve('STA MARIA', '') === ids.K);
  check('the kept store\'s old name → kept store', resolve('SANTA MARIA', '') === ids.K);
  check('the new name → kept store', resolve('STA. MARIA (F)', '') === ids.K);
  check('the Angel\'s Pizza name is unaffected', resolve('STA. MARIA', '') === ids.APSM);
  check('a portal submission now resolves to the kept store', s.store_resolveIdByCurrentName('STA. MARIA (F)') === ids.K);
  check('the duplicate\'s name no longer resolves for new submissions', s.store_resolveIdByCurrentName('STA MARIA') === null);
}

console.log('\n── Validation: refused before anything is written ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  const before = JSON.stringify(env.master._cells);
  const plan = d => s.portal_previewStoreCleanup([Object.assign({ key: 'x' }, d)]).plans[0];
  const base = { type: 'create', name: 'SHANGRILA', storeName: 'SHANGRILA', brand: "ANGEL'S PIZZA", region: 'NCR', category: 'NCR', active: false, closedFrom: '2026-06-01' };

  let p = plan(Object.assign({}, base, { storeName: 'STA. MARIA' }));
  check('new store cannot take another store\'s name (any brand)', !p.ok && /already a name of STA\. MARIA \(ANGEL'S PIZZA\)/.test(p.errors.join(' ')), p.errors);
  p = plan(Object.assign({}, base, { closedFrom: '2026-05-28' }));
  check('closed-from must be after the last visit', !p.ok && /after the last visit \(2026-05-28\)/.test(p.errors.join(' ')), p.errors);
  p = plan(Object.assign({}, base, { brand: 'PIZZA HUT' }));
  check('brand must be an approved brand', !p.ok && /Pick a brand/.test(p.errors.join(' ')), p.errors);
  p = plan(Object.assign({}, base, { category: '' }));
  check('category required', !p.ok && /Pick a category/.test(p.errors.join(' ')), p.errors);
  p = plan(Object.assign({}, base, { name: 'NO SUCH NAME' }));
  check('a name with no unmatched visits is refused', !p.ok && /no unmatched visits/.test(p.errors.join(' ')), p.errors);
  p = plan({ type: 'map', name: 'STA. MARIA (F)', storeId: '' });
  check('"same store as" needs a store', !p.ok && /Pick the store/.test(p.errors.join(' ')), p.errors);
  p = plan({ type: 'map', name: 'STA. MARIA (F)', storeId: ids.APSM });
  check('"same store as" another brand is allowed but warned', p.ok && /saved under brand FIGARO/.test(p.warnings.join(' ')), p);
  p = plan({ type: 'merge', keepId: ids.K, mergeIds: [ids.APSM], finalName: 'STA. MARIA (F)' });
  check('merging across brands is refused', !p.ok && /different brands/.test(p.errors.join(' ')), p.errors);
  p = plan({ type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'SAN PEDRO' });
  check('final name cannot be another store\'s name', !p.ok && /already a name of SAN PEDRO/.test(p.errors.join(' ')), p.errors);
  p = plan({ type: 'merge', keepId: ids.APSM, mergeIds: [], finalName: '' });
  check('nothing to change is refused', !p.ok && /Nothing to change/.test(p.errors.join(' ')), p.errors);
  p = plan({ type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA MARIA' });
  check('final name may be the duplicate\'s own name', p.ok, p.errors);

  const two = s.portal_previewStoreCleanup([
    Object.assign({ key: 'a' }, base),
    { key: 'b', type: 'create', name: 'URDANETA FIGARO', storeName: 'SHANGRILA', brand: 'FIGARO', region: 'FRANCHISE', category: 'FAR PROVINCIAL', active: false },
  ]).plans;
  check('two new stores with the same name in one list: second refused', two[0].ok && !two[1].ok && /another change in this list/.test(two[1].errors.join(' ')), two);
  const both = s.portal_previewStoreCleanup([
    { key: 'a', type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' },
    { key: 'b', type: 'merge', keepId: ids.M, mergeIds: [], finalName: 'STA MARIA 2' },
  ]).plans;
  check('a store used by two merges in one list: second refused', both[0].ok && !both[1].ok, both);

  const bad = s.portal_applyStoreCleanupDecision({ type: 'merge', keepId: ids.K, mergeIds: [ids.APSM], finalName: 'X' });
  check('apply re-validates and refuses', !bad.success && /different brands/.test(bad.message), bad);
  check('MASTER_LOG untouched by refused changes', JSON.stringify(env.master._cells) === before);
  check('no merge recorded by refused changes', !env.ss.getSheetByName('CONFIG_STORE_MERGES'));
}

console.log('\n── A store already changed today cannot be renamed — refused up front ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  const today = s._store_dateToStr(s._store_today());
  s.store_update(ids.SP, { storeName: 'SAN PEDRO', brand: "ANGEL'S PIZZA", region: 'PROVINCIAL', category: 'FAR PROVINCIAL' }, today, 'edited today');
  const d = { type: 'merge', keepId: ids.SP, mergeIds: [], finalName: 'SAN PEDRO CITY' };
  const p = s.portal_previewStoreCleanup([Object.assign({ key: 'x' }, d)]).plans[0];
  check('preview refuses: already changed today', !p.ok && /change dated today/.test(p.errors.join(' ')), p.errors);
  const before = JSON.stringify(env.master._cells);
  const r = s.portal_applyStoreCleanupDecision(d);
  check('apply refuses too, before writing anything', !r.success && JSON.stringify(env.master._cells) === before, r);
  const same = s.portal_previewStoreCleanup([{ key: 'y', type: 'merge', keepId: ids.SP, mergeIds: [], finalName: 'SAN PEDRO' }]).plans[0];
  check('one name without renaming still works today', same.ok, same.errors);
}

console.log('\n── A name saved under two brands is split first, never lumped together ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox; const SD = env.SDate;
  env.master.appendRow([new SD(2026, 2, 6, 9), new SD(2026, 2, 6), 'GLORIETTA', "ANGEL'S PIZZA", 'NCR', 'LEO', 'STORE VISIT', '', '']); // 13
  env.master.appendRow([new SD(2026, 2, 11, 9), new SD(2026, 2, 11), 'GLORIETTA', 'FIGARO', 'NCR', 'ANN', 'STORE VISIT', '', '']);     // 14
  env.master.appendRow([new SD(2026, 2, 12, 9), new SD(2026, 2, 12), 'GLORIETTA', '', '', 'ANN', 'STORE VISIT', '', '']);              // 15
  let r = s.portal_getStoreCleanup();
  const g = r.unmatched.filter(u => u.name === 'GLORIETTA')[0];
  check('flagged as two brands (+1 with no brand)', g.mixed && g.brands.length === 2 && g.noBrand === 1, g);
  check('Angel\'s Pizza keeps the plain name by default', g.splitKeepBrand === "ANGEL'S PIZZA", g.splitKeepBrand);
  const create = s.portal_previewStoreCleanup([{ key: 'c', type: 'create', name: 'GLORIETTA', storeName: 'GLORIETTA', brand: "ANGEL'S PIZZA", region: 'NCR', category: 'NCR', active: false }]).plans[0];
  check('one new store for both brands is refused', !create.ok && /Split by brand/.test(create.errors.join(' ')), create.errors);
  const map = s.portal_previewStoreCleanup([{ key: 'm', type: 'map', name: 'GLORIETTA', storeId: ids.SP }]).plans[0];
  check('"same store as" for both brands is refused', !map.ok && /Split by brand/.test(map.errors.join(' ')), map.errors);
  const both = s.portal_previewStoreCleanup([
    { key: 'a', type: 'split', name: 'GLORIETTA', keepBrand: "ANGEL'S PIZZA" },
    { key: 'b', type: 'split', name: 'GLORIETTA', keepBrand: 'FIGARO' },
  ]).plans;
  check('two choices for one name in one list: second refused', both[0].ok && !both[1].ok, both);

  const split = s.portal_applyStoreCleanupDecision({ type: 'split', name: 'GLORIETTA', keepBrand: "ANGEL'S PIZZA" });
  check('split applied: 1 row renamed', split.success && split.rowsUpdated === 1, split);
  check('Figaro visit renamed GLORIETTA (F)', cell(env, 14, 3) === 'GLORIETTA (F)', cell(env, 14, 3));
  check('Angel\'s Pizza and no-brand visits keep GLORIETTA', cell(env, 13, 3) === 'GLORIETTA' && cell(env, 15, 3) === 'GLORIETTA');
  check('split leaves Store ID alone', cell(env, 14, 9) === '');
  const fix = sheetRows(env, 'MASTER_LOG_FIXES', 10).filter(f => f[4] === 14)[0];
  check('split logged with the old name', fix && fix[3] === 'SPLIT BY BRAND' && fix[6] === 'GLORIETTA' && fix[7] === 'GLORIETTA (F)', fix);
  r = s.portal_getStoreCleanup();
  check('Find again: two single-brand names', ['GLORIETTA', 'GLORIETTA (F)'].every(n => r.unmatched.some(u => u.name === n && !u.mixed)), r.unmatched.map(u => u.name));
  check('GLORIETTA (F) reads as Figaro', r.unmatched.filter(u => u.name === 'GLORIETTA (F)')[0].brand === 'FIGARO');
  const again = s.portal_previewStoreCleanup([{ key: 's', type: 'split', name: 'GLORIETTA', keepBrand: "ANGEL'S PIZZA" }]).plans[0];
  check('splitting again is refused (one brand left)', !again.ok && /one brand only/.test(again.errors.join(' ')), again.errors);
}

console.log('\n── Merge points out visits saved under another brand ──');
{
  const env = newSandbox(); const ids = seed(env);
  env.master.getRange(4, 4).setValue("ANGEL'S PIZZA"); // a STA MARIA visit typed as Angel's Pizza
  const p = env.sandbox.portal_previewStoreCleanup([{ key: 'g', type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' }]).plans[0];
  check('warning names the brand and the row', p.ok && /another brand \(ANGEL'S PIZZA ×1\) — MASTER_LOG row 4/.test(p.warnings.join(' ')), p.warnings);
}

console.log('\n── MASTER_LOG changed by hand during a run: no row is touched ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  const realUpdate = s.store_update;
  // While the merge renames the store, someone deletes MASTER_LOG row 3 (rows below move up).
  s.store_update = function () {
    const out = realUpdate.apply(null, arguments);
    const last = env.master.getLastRow();
    env.master.getRange(3, 1, last - 3, 9).setValues(env.master.getRange(4, 1, last - 3, 9).getValues());
    env.master.getRange(last, 1, 1, 9).clearContent();
    afterHumanEdit = JSON.stringify(env.master._cells);
    return out;
  };
  let afterHumanEdit = null;
  const r = s.portal_applyStoreCleanupDecision({ type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' });
  s.store_update = realUpdate;
  check('reported as not done in MASTER_LOG', !r.success && /MASTER_LOG changed while this ran/.test(r.message), r);
  check('no MASTER_LOG cell written by the tool after the hand edit', afterHumanEdit !== null && JSON.stringify(env.master._cells) === afterHumanEdit);
  check('the Angel\'s Pizza STA. MARIA row (moved up to row 6) is untouched', cell(env, 6, 3) === 'STA. MARIA' && cell(env, 6, 9) === ids.APSM);
  check('nothing logged as fixed', sheetRows(env, 'MASTER_LOG_FIXES', 10).length === 0);
}

console.log('\n── Write order: the log before the rows, the merge record before retiring ──');
{
  const env = newSandbox(); seed(env);
  const s = env.sandbox;
  env.ss.insertSheet('MASTER_LOG_FIXES').getRange = () => { throw new Error('simulated quota error'); };
  const r = s.portal_applyStoreCleanupDecision({ type: 'create', name: 'SHANGRILA', storeName: 'SHANGRILA', brand: "ANGEL'S PIZZA", region: 'NCR', category: 'NCR', active: false, closedFrom: '2026-06-01' });
  check('fix log cannot be written → reported as failed', !r.success && /quota/.test(r.message), r);
  check('…and the MASTER_LOG rows were not changed (original spelling kept)', cell(env, 9, 3) === 'shangrila ' && cell(env, 8, 9) === '' && cell(env, 9, 9) === '');
}
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  env.ss.insertSheet('CONFIG_STORE_MERGES').appendRow = () => { throw new Error('simulated quota error'); };
  const r = s.portal_applyStoreCleanupDecision({ type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' });
  check('merge record cannot be written → reported as failed', !r.success && /quota/.test(r.message), r);
  check('…and the duplicate was NOT retired, so the merge can simply be run again', !!s.store_getById(ids.M));
}

console.log('\n── Closed stores ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  s.store_deactivate(ids.K, 'closed', '2026-07-01', OPTS); // SANTA MARIA closed, STA MARIA open
  const r = s.portal_getStoreCleanup();
  const dup = r.groups.filter(g => g.type === 'duplicate')[0];
  check('Keep suggestion is the open store', dup.suggestedKeep === ids.M, dup.suggestedKeep);
  const p = s.portal_previewStoreCleanup([{ key: 'g', type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' }]).plans[0];
  check('keeping the closed one is warned', p.ok && /which is closed/.test(p.warnings.join(' ')), p.warnings);
  check('visits after it closed are pointed out', /on or after SANTA MARIA closed \(2026-07-01\)/.test(p.warnings.join(' ')), p.warnings);
  const m = s.portal_previewStoreCleanup([{ key: 'm', type: 'map', name: 'STA. MARIA (F)', storeId: ids.K }]).plans[0];
  check('"same store as" a closed store with later visits is warned', m.ok && /on or after SANTA MARIA closed/.test(m.warnings.join(' ')), m.warnings);
}

console.log('\n── Visits older than the store: its start moves back ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox; const SD = env.SDate;
  env.master.appendRow([new SD(2026, 0, 10, 9), new SD(2026, 0, 10), 'SAN PEDRO CITY', "ANGEL'S PIZZA", 'PROVINCIAL', 'LEO', 'STORE VISIT', '', '']);
  const d = { key: 'm', type: 'map', name: 'SAN PEDRO CITY', storeId: ids.SP };
  const p = s.portal_previewStoreCleanup([d]).plans[0];
  check('preview says the start moves back', p.ok && p.lines.some(l => /start moves back to 2026-01-10/.test(l)), p.lines);
  check('the store did not resolve on that date before', !s.resolveStoreAsOf(ids.SP, '2026-01-10'));
  const r = s.portal_applyStoreCleanupDecision(d);
  check('applied without warnings', r.success && !r.warning, r);
  const then = s.resolveStoreAsOf(ids.SP, '2026-01-10');
  check('the store resolves on the visit date now, same brand/category', !!then && then.fields.brand === "ANGEL'S PIZZA" && then.fields.category === 'FAR PROVINCIAL', then && then.fields);
  check('its current version is unchanged', s.store_getById(ids.SP).fields.storeName === 'SAN PEDRO');
}

console.log('\n── SETTINGS: a same-named store of another brand keeps its row ──');
{
  const env = newSandbox(); seed(env);
  const s = env.sandbox;
  const mk = (n, b) => s.store_create({ storeName: n, brand: b, region: 'NCR', category: 'NCR' }, '2026-01-01', 'legacy', OPTS).storeId;
  mk('ROBINSONS', "ANGEL'S PIZZA");
  const figDup = mk('ROBINSONS', 'FIGARO');   // legacy: same exact name as the Angel's Pizza store
  const figKeep = mk('ROBINSONS (F)', 'FIGARO');
  const r = s.portal_applyStoreCleanupDecision({ type: 'merge', keepId: figKeep, mergeIds: [figDup], finalName: 'ROBINSONS (F)' });
  check('merge applied', r.success, r);
  const rows = sheetRows(env, 'SETTINGS', 2);
  const rob = rows.filter(x => x[0] === 'ROBINSONS');
  check('Angel\'s Pizza ROBINSONS is back in SETTINGS as Angel\'s Pizza', rob.length === 1 && rob[0][1] === "ANGEL'S PIZZA", rob);
  check('ROBINSONS (F) in SETTINGS', rows.some(x => x[0] === 'ROBINSONS (F)'));
}

console.log('\n── A change scheduled for later is pointed out ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  const later = new Date(); later.setDate(later.getDate() + 30);
  const laterStr = later.getFullYear() + '-' + String(later.getMonth() + 1).padStart(2, '0') + '-' + String(later.getDate()).padStart(2, '0');
  s.store_update(ids.K, { storeName: 'SANTA MARIA', brand: 'FIGARO', region: 'FRANCHISE', category: 'FAR PROVINCIAL' }, laterStr, 'category change');
  const p = s.portal_previewStoreCleanup([{ key: 'g', type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' }]).plans[0];
  check('warning about the scheduled change', p.ok && new RegExp('scheduled for ' + laterStr).test(p.warnings.join(' ')), p.warnings);
}

console.log('\n── "Same store as" twice: refused the second time, no extra entries ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  s.portal_applyStoreCleanupDecision({ type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA (F)' });
  const d = { type: 'map', name: 'STA. MARIA (F)', storeId: ids.K };
  const entries = () => s.store_getUnmappedStores().filter(u => u.originalStoreName === 'STA. MARIA (F)').length;
  const r1 = s.portal_applyStoreCleanupDecision(d);
  check('first time: row gets the Store ID, entry reconciled', r1.success && cell(env, 5, 9) === ids.K, r1);
  const n = entries();
  const r2 = s.portal_applyStoreCleanupDecision(d);
  check('second time: nothing to change', !r2.success && /Nothing to change/.test(r2.message), r2);
  check('no extra CONFIG_UNMAPPED_STORES rows', entries() === n, [n, entries()]);
}

console.log('\n── A reconciled alias is a taken name ──');
{
  const env = newSandbox(); seed(env);
  const p = env.sandbox.portal_previewStoreCleanup([{ key: 'c', type: 'create', name: 'SHANGRILA', storeName: 'SM SAN PEDRO', brand: "ANGEL'S PIZZA", region: 'NCR', category: 'NCR', active: false, closedFrom: '2026-06-01' }]).plans[0];
  check('new store named like an alias is refused', !p.ok && /already a name of SAN PEDRO/.test(p.errors.join(' ')), p.errors);
}

console.log('\n── Admin gate and lock ──');
{
  const env = newSandbox(); const ids = seed(env);
  const s = env.sandbox;
  const before = JSON.stringify(env.master._cells);
  env.state.isAdmin = false;
  const calls = [
    s.portal_getStoreCleanup(),
    s.portal_previewStoreCleanup(STA_MARIA_DECISIONS(ids)),
    s.portal_applyStoreCleanupDecision(STA_MARIA_DECISIONS(ids)[1]),
    s.portal_finishStoreCleanup(),
  ];
  check('non-admin refused by all four entry points', calls.every(c => !c.success && /Admin/.test(c.message)), calls);
  check('non-admin wrote nothing', JSON.stringify(env.master._cells) === before && !env.ss.getSheetByName('CONFIG_STORE_MERGES'));

  env.state.isAdmin = true;
  env.state.lockFree = false;
  const busy = s.portal_applyStoreCleanupDecision(STA_MARIA_DECISIONS(ids)[1]);
  check('busy lock → try again, nothing written', !busy.success && /try again/.test(busy.message) && JSON.stringify(env.master._cells) === before, busy);
}

console.log('\n── Finish: one Store Health refresh, result passed through ──');
{
  const env = newSandbox(); seed(env);
  const s = env.sandbox;
  let calls = 0;
  s.RISK_SHEET_NAME = 'STORE HEALTH';
  env.ss.insertSheet('STORE HEALTH');
  s.refreshRiskEngine = () => { calls++; return { success: true, rows: 11 }; };
  const ok = s.portal_finishStoreCleanup();
  check('refreshes Store Health once', ok.success && calls === 1 && /11 MASTER_LOG rows/.test(ok.message), ok);
  s.refreshRiskEngine = () => ({ success: false, rows: 0, message: 'Admin access required.' });
  const bad = s.portal_finishStoreCleanup();
  check('a failed refresh is reported, not shown as success', !bad.success && /Admin access required/.test(bad.message), bad);
}

console.log('\n── Only the four portal_* entry points are client-callable ──');
{
  const names = (src('SVMKPI_STORE_MATCH.gs').match(/^function ([A-Za-z0-9_]+)/gm) || []).map(x => x.replace('function ', ''));
  const pub = names.filter(n => !/_$/.test(n)).sort();
  check('public functions are exactly the four portal_* ones', JSON.stringify(pub) === JSON.stringify(['portal_applyStoreCleanupDecision', 'portal_finishStoreCleanup', 'portal_getStoreCleanup', 'portal_previewStoreCleanup']), pub);
  const bodies = src('SVMKPI_STORE_MATCH.gs').split(/^function /m).slice(1);
  check('each one checks sl_isAdmin() first', bodies.filter(b => /^portal_/.test(b)).every(b => /^[^{]*\{\s*if \(!sl_isAdmin\(\)\)/.test(b)));
}

console.log('\n── Suggestion helpers ──');
{
  const env = newSandbox();
  const s = env.sandbox;
  check('STA. MARIA (F) / SANTA MARIA / STA MARIA compare equal', s.smt_canonKey_('STA. MARIA (F)') === 'SANTA MARIA' && s.smt_canonKey_('SANTA MARIA') === 'SANTA MARIA' && s.smt_canonKey_('sta maria') === 'SANTA MARIA');
  check('brand words dropped (DAGUPAN FIGARO, F DASMA, BALIWAG F)', s.smt_canonKey_('DAGUPAN FIGARO') === 'DAGUPAN' && s.smt_canonKey_('F DASMA') === 'DASMA' && s.smt_canonKey_('BALIWAG F') === 'BALIWAG');
  check('SM SAN PEDRO ~ SAN PEDRO', s.smt_canonKey_('SM SAN PEDRO') === s.smt_canonKey_('SAN PEDRO'));
  check('numbers kept: MANULIFE 1 ≠ MANULIFE 2', s.smt_canonKey_('MANULIFE 1') !== s.smt_canonKey_('MANULIFE 2'));
  check('SHANGRI-LA ~ SHANGRILA scores high', s.smt_similarity_(s.smt_canonKey_('SHANGRI-LA'), s.smt_canonKey_('SHANGRILA')) >= 0.9);
  check('unrelated names score low', s.smt_similarity_('GLORIETTA', 'TRINOMA') < 0.6);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
process.exit(fail ? 1 : 0);
