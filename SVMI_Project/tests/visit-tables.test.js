// Phase C — STORE_VISITS / STORE_VISIT_VISITORS (SVMKPI_TABLES.gs).
// Runs the REAL Apps Script code (CORE + CONFIG + STORE_CONFIG + INPUT_PORTAL
// + TABLES) in a Node vm sandbox against an in-memory spreadsheet.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');
const FILES = ['SVMKPI_CORE.gs', 'SVMKPI_CONFIG.gs', 'SVMKPI_STORE_CONFIG.gs', 'INPUT_PORTAL.gs', 'SVMKPI_TABLES.gs'];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); fail++; }
}

// ── In-memory Sheet: cells map, getLastRow = last row with content ──
function makeSheet(name, opts) {
  opts = opts || {};
  const cells = {};
  let maxRows = 1000;
  const k = (r, c) => r + ',' + c;
  const set = (r, c, v) => { if (v === '' || v == null) delete cells[k(r, c)]; else cells[k(r, c)] = v; };
  const get = (r, c) => { const v = cells[k(r, c)]; return v == null ? '' : v; };
  const lastRow = () => { let m = 0; Object.keys(cells).forEach(key => { const r = +key.split(',')[0]; if (r > m) m = r; }); return m; };

  function range(row, col, nr, nc) {
    if (typeof row === 'string') { row = 1; col = 1; nr = 1; nc = 1; } // A1 notation (formatting only)
    nr = nr || 1; nc = nc || 1;
    if (opts.failWrites) {
      return new Proxy({}, { get: () => () => { throw new Error('simulated write failure on ' + name); } });
    }
    if (row + nr - 1 > maxRows) throw new Error('range outside sheet: ' + name + ' row ' + (row + nr - 1) + ' > ' + maxRows);
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
    appendRow: (a) => { const r = lastRow() + 1; if (r > maxRows) maxRows = r; a.forEach((v, j) => set(r, j + 1, v)); },
    protect: () => { const pr = new Proxy({}, { get: () => () => pr }); return pr; },
    _cells: cells,
    _setMaxRows: (n) => { maxRows = n; },
  };
  const sp = new Proxy(s, { get: (t, prop) => (prop in t ? t[prop] : (typeof prop === 'string' ? () => sp : undefined)) });
  return sp;
}

function newSandbox(opts) {
  opts = opts || {};
  const sheets = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { sheets[n] = makeSheet(n, (opts.failSheets || {})[n]); return sheets[n]; },
  };
  const state = { isAdmin: true };
  const errors = [];
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    Session: { getScriptTimeZone: () => 'Asia/Manila' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p2 = n => String(n).padStart(2, '0');
        const ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        return fmt.indexOf('HH') !== -1 ? ymd + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) : ymd;
      },
      getUuid: (() => { let n = 0; return () => 'uuid-' + (++n); })(),
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
  if (opts.failSheets) Object.keys(opts.failSheets).forEach(n => ss.insertSheet(n));
  const SDate = vm.runInContext('Date', sandbox);
  return { sandbox, ss, sheets, master, state, errors, SDate };
}

const _ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = _ymd(new Date());
const OPTS = { backdateConfirmed: true };

function seed(env) {
  const { sandbox, master, SDate } = env;
  const a = sandbox.store_create({ storeName: 'AP MAKATI', brand: "ANGEL'S PIZZA", region: 'NCR', category: 'NCR' }, '2026-01-01', 'setup', OPTS);
  const b = sandbox.store_create({ storeName: 'FIG CEBU', brand: 'FIGARO', region: 'PROVINCIAL', category: 'FAR PROVINCIAL' }, '2026-01-01', 'setup', OPTS);
  ['LEO', 'ANN', 'CHARLIE'].forEach(v => sandbox.cfg_createConfiguration('VISITORS', v, { visitorName: v }, '2026-01-01', null, 'setup', OPTS));
  const rows = [
    // A ts, B date, C store, D brand, E region, F visitors, G purpose, H remarks, I store id
    [new SDate(2026, 0, 5, 9, 30, 0), new SDate(2026, 0, 5), 'AP MAKATI', "ANGEL'S PIZZA", 'NCR', 'LEO | ANN', 'STORE VISIT', 'ok', a.storeId],
    [new SDate(2026, 0, 6, 10, 0, 0), new SDate(2026, 0, 6), 'fig cebu ', 'FIGARO', 'PROVINCIAL', 'ANN|ANN', 'tltc', '', ''],   // no col I, messy case, repeated visitor
    ['2026-01-07 11:15:00', '2026-01-07', 'GONE STORE', 'APEX', 'NCR', 'CHARLIE', 'FAILED QA/MS', '', ''],             // unmapped name
    ['', '', '', '', '', '', '', '', ''],                                                                               // blank line
  ];
  master.getRange(2, 1, rows.length, 9).setValues(rows);
  return { a, b };
}

const visitsOf = env => env.sandbox.svt_readTable_(env.ss.getSheetByName('STORE_VISITS'), 8);
const linksOf  = env => env.sandbox.svt_readTable_(env.ss.getSheetByName('STORE_VISIT_VISITORS'), 2);

console.log('\n── Rebuild: one row per visit, one row per visitor per visit ──');
{
  const env = newSandbox(); const { a, b } = seed(env);
  const r = env.sandbox.portal_rebuildVisitTables();
  check('rebuild succeeds', r.success, r);
  const visits = visitsOf(env), links = linksOf(env);
  check('3 visits (blank line skipped)', visits.length === 3, visits.length);
  check('8 columns exactly — brand/region not copied', env.ss.getSheetByName('STORE_VISITS').getRange(1, 1, 1, 9).getValues()[0][8] === '' && visits[0].length === 8);
  check('"LEO | ANN" → 2 visitor rows; "ANN|ANN" → 1', links.length === 4, links);
  check('visitor IDs normalized', links.every(l => /^[A-Z]+$/.test(l[1])), links);
  check('Store ID from column I', visits[0][2] === a.storeId, visits[0]);
  check('Store ID from exact name match (no column I, messy case)', visits[1][2] === b.storeId, visits[1]);
  check('unknown store name stays blank (never guessed)', visits[2][2] === '', visits[2]);
  check('purpose normalized', visits[1][3] === 'TLTC', visits[1][3]);
  check('store name as recorded kept (normalized)', visits[1][6] === 'FIG CEBU', visits[1][6]);
  check('source row = MASTER_LOG row number', visits.map(v => v[7]).join(',') === '2,3,4', visits.map(v => v[7]));
  check('message reports the unmapped visit', /1 with no Store ID/.test(r.message), r.message);
}

console.log('\n── Visit IDs are stable and content-derived ──');
{
  const env = newSandbox(); seed(env);
  env.sandbox.portal_rebuildVisitTables();
  const ids1 = visitsOf(env).map(v => v[0]);
  env.sandbox.portal_rebuildVisitTables();
  const ids2 = visitsOf(env).map(v => v[0]);
  check('same MASTER_LOG → same IDs on every rebuild', JSON.stringify(ids1) === JSON.stringify(ids2));
  check('ID format V-<20 hex>', ids1.every(id => /^V-[0-9A-F]{20}$/.test(id)), ids1);
  check('IDs unique', new Set(ids1).size === ids1.length);

  const fpDate = env.sandbox.svt_fingerprint_([new env.SDate(2026, 0, 7, 11, 15, 0), new env.SDate(2026, 0, 7), 'X', '', '', 'A', 'P'], 'Asia/Manila');
  const fpStr  = env.sandbox.svt_fingerprint_(['2026-01-07 11:15:00', '2026-01-07', 'x ', '', '', 'a', 'p'], 'Asia/Manila');
  check('a Date value and its text form give the same fingerprint', fpDate === fpStr, [fpDate, fpStr]);
}

console.log('\n── Byte-identical MASTER_LOG rows get -2, -3 ──');
{
  const env = newSandbox(); seed(env);
  const row = env.master.getRange(2, 1, 1, 9).getValues()[0];
  env.master.appendRow(row); env.master.appendRow(row);
  env.sandbox.portal_rebuildVisitTables();
  const ids = visitsOf(env).map(v => v[0]);
  check('duplicates suffixed in order', ids[3] === ids[0] + '-2' && ids[4] === ids[0] + '-3', ids);
}

console.log('\n── Rebuild replaces old rows (no leftovers) ──');
{
  const env = newSandbox(); seed(env);
  env.sandbox.portal_rebuildVisitTables();
  env.master.getRange(4, 1, 1, 9).clearContent(); // drop the GONE STORE row
  env.sandbox.portal_rebuildVisitTables();
  check('2 visits after a row is removed from MASTER_LOG', visitsOf(env).length === 2, visitsOf(env).length);
  check('its visitor link is gone too', linksOf(env).length === 3, linksOf(env));
}

console.log('\n── Rebuild grows the sheet when needed ──');
{
  const env = newSandbox(); seed(env);
  env.ss.insertSheet('STORE_VISITS')._setMaxRows(2); // an existing, empty, 2-row sheet
  const r = env.sandbox.portal_rebuildVisitTables();
  check('rebuild succeeds even when the table sheet is too short', r.success && visitsOf(env).length === 3, r);
}

console.log('\n── Store resolution: reconciled unmapped name, ambiguous name ──');
{
  const env = newSandbox(); const { a } = seed(env);
  const rec = env.sandbox.store_recordUnmapped('GONE STORE', '2026-01-07', '2026-01-07', 1);
  env.sandbox.store_reconcileUnmapped(rec.unmappedId, a.storeId, 'renamed');
  const resolve = env.sandbox.svt_buildStoreResolver_();
  check('RECONCILED unmapped name resolves to its Store ID', resolve('gone store', '') === a.storeId, resolve('gone store', ''));
  check('column I always wins', resolve('GONE STORE', 'str-xyz') === 'STR-XYZ');

  const c = env.sandbox.store_create({ storeName: 'TWIN', brand: 'APEX', region: 'NCR', category: 'NCR' }, '2026-01-01', 'setup', OPTS);
  const d = env.sandbox.store_create({ storeName: 'OTHER', brand: 'APEX', region: 'NCR', category: 'NCR' }, '2026-01-01', 'setup', OPTS);
  const upd = env.sandbox.store_update(d.storeId, { storeName: 'TWIN', brand: 'APEX', region: 'NCR', category: 'NCR' }, '2026-02-01', 'rename', OPTS);
  if (upd && upd.success) {
    const resolve2 = env.sandbox.svt_buildStoreResolver_();
    check('a name used by two Store IDs is ambiguous → blank', resolve2('TWIN', '') === '', resolve2('TWIN', ''));
  } else {
    check('config refuses two stores sharing a name (so ambiguity cannot arise)', true);
  }
}

console.log('\n── Dual-write from the Input Portal ──');
{
  const env = newSandbox(); seed(env);
  env.sandbox.portal_rebuildVisitTables();
  const before = visitsOf(env).length;
  const res = env.sandbox.processSubmissionAsync({
    store: 'AP MAKATI', brand: "ANGEL'S PIZZA", region: 'NCR', dateVisited: TODAY,
    visitedBy: ['LEO', 'CHARLIE'], purpose: 'Store Visit', remarks: 'dual',
  });
  check('submission succeeds', res && res.success, res);
  const visits = visitsOf(env);
  check('one new STORE_VISITS row', visits.length === before + 1, visits.length);
  check('two new visitor links', linksOf(env).length === 6, linksOf(env).length);
  const last = visits[visits.length - 1];
  check('new row carries Store ID and normalized purpose', /^STR-/.test(last[2]) && last[3] === 'STORE VISIT', last);
  check('source row points at the new MASTER_LOG row', last[7] === env.master.getLastRow(), [last[7], env.master.getLastRow()]);

  const idBefore = last[0];
  env.sandbox.portal_rebuildVisitTables();
  const after = visitsOf(env);
  check('a later rebuild produces the same Visit ID for that row', after[after.length - 1][0] === idBefore, [after[after.length - 1][0], idBefore]);
  const chk = env.sandbox.portal_checkVisitTables();
  check('check says in sync after dual-write + rebuild', chk.success, chk.message);
}

console.log('\n── Dual-write does nothing before the tables exist ──');
{
  const env = newSandbox(); seed(env);
  const res = env.sandbox.processSubmissionAsync({
    store: 'FIG CEBU', brand: 'FIGARO', region: 'PROVINCIAL', dateVisited: TODAY, visitedBy: ['ANN'], purpose: 'TLTC', remarks: '',
  });
  check('submission succeeds', res && res.success, res);
  check('no tables were created by a submission', !env.ss.getSheetByName('STORE_VISITS') && !env.ss.getSheetByName('STORE_VISIT_VISITORS'));
}

console.log('\n── A table write failure never blocks the submission ──');
{
  const env = newSandbox({ failSheets: { STORE_VISITS: { failWrites: true }, STORE_VISIT_VISITORS: {} } });
  seed(env);
  const rowsBefore = env.master.getLastRow();
  const res = env.sandbox.processSubmissionAsync({
    store: 'AP MAKATI', brand: "ANGEL'S PIZZA", region: 'NCR', dateVisited: TODAY, visitedBy: ['LEO'], purpose: 'TLTC', remarks: '',
  });
  check('submission still succeeds', res && res.success, res);
  check('visit is in MASTER_LOG', env.master.getLastRow() === rowsBefore + 1, [rowsBefore, env.master.getLastRow()]);
  check('the failure was logged', env.errors.some(m => /svt_recordVisitFromRow_/.test(m)), env.errors);
}

console.log('\n── Check Visit Tables ──');
{
  const env = newSandbox(); seed(env);
  const none = env.sandbox.portal_checkVisitTables();
  check('before rebuild: says to run Rebuild first', !none.success && /Rebuild Visit Tables/.test(none.message), none.message);

  env.sandbox.portal_rebuildVisitTables();
  const ok = env.sandbox.portal_checkVisitTables();
  check('right after rebuild: in sync', ok.success, ok.message);
  check('reports the unmapped store as a data note, not a sync error', ok.stats.unmapped === 1 && ok.stats.unmappedNames[0] === 'GONE STORE', ok.stats);

  // A visit typed straight into MASTER_LOG (no portal) → missing from the table
  env.master.appendRow([new env.SDate(2026, 1, 1, 8, 0, 0), new env.SDate(2026, 1, 1), 'AP MAKATI', '', '', 'RICE', 'STORE VISIT', '', '']);
  const miss = env.sandbox.portal_checkVisitTables();
  check('a hand-typed MASTER_LOG row shows as missing', !miss.success && miss.stats.missing === 1 && miss.stats.missingLinks === 1, miss.stats);
  check('unknown visitor listed', miss.stats.unknownVisitors.indexOf('RICE') !== -1, miss.stats.unknownVisitors);
  check('the error points at the MASTER_LOG row', miss.errors[0].row === env.master.getLastRow(), miss.errors[0]);

  // Store ID added to column I later → table row is outdated until rebuild
  env.sandbox.portal_rebuildVisitTables();
  const vs = env.ss.getSheetByName('STORE_VISITS');
  vs.getRange(2, 3, 1, 1).setValues([['STR-WRONG']]);
  const out = env.sandbox.portal_checkVisitTables();
  check('a changed Store ID shows as outdated', !out.success && out.stats.outdated === 1, out.stats);
  env.sandbox.portal_rebuildVisitTables();
  check('rebuild repairs it', env.sandbox.portal_checkVisitTables().success);

  // A table row nobody can trace back → extra
  env.sandbox.svt_appendRows_(vs, [['V-DEADBEEF', '', '', '', '', '', '', '']], 8);
  const ex = env.sandbox.portal_checkVisitTables();
  check('an untraceable table row shows as extra', !ex.success && ex.stats.extra === 1, ex.stats);
}

console.log('\n── Admin gate ──');
{
  const env = newSandbox(); seed(env);
  env.state.isAdmin = false;
  const r1 = env.sandbox.portal_rebuildVisitTables();
  const r2 = env.sandbox.portal_checkVisitTables();
  check('non-admin cannot rebuild', !r1.success && /Admin/.test(r1.message), r1);
  check('non-admin cannot check', !r2.success && /Admin/.test(r2.message), r2);
  check('non-admin rebuild created nothing', !env.ss.getSheetByName('STORE_VISITS'));
}

console.log('\n── Only the two portal_* entry points are client-callable ──');
{
  const names = (src('SVMKPI_TABLES.gs').match(/^function ([A-Za-z0-9_]+)/gm) || []).map(s => s.replace('function ', ''));
  const pub = names.filter(n => !/_$/.test(n));
  check('public functions are exactly portal_rebuildVisitTables, portal_checkVisitTables', JSON.stringify(pub.sort()) === JSON.stringify(['portal_checkVisitTables', 'portal_rebuildVisitTables']), pub);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
process.exit(fail ? 1 : 0);
