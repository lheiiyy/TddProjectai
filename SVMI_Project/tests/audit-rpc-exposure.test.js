// reviews/014 finding 2 / reviews/015: the CONFIG_AUDIT writer must not be
// callable over google.script.run.
//
// Apps Script exposes every top-level function whose name does not end in
// "_" to any client that loaded the portal. `_cfg_writeAudit` (leading
// underscore only) was therefore public, unguarded, and took `actor` as an
// argument — a portal user could append CONFIG_AUDIT rows attributed to
// anyone. It is now `_cfg_writeAudit_` (private). This file proves that
// structurally (no public audit-writing function exists anywhere) and
// behaviorally (real audit rows are still written, with the actor derived
// server-side, by the real mutation paths).
//
// Loads the REAL .gs sources; no reimplementation of the fix.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'Apps Script');
const gsFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.gs')).sort();
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

// ── Structural: what google.script.run can reach ───────────────────────
console.log('\n── No client-reachable function writes an audit row ──');
const topLevel = [];   // { name, file, body }
for (const f of gsFiles) {
  const src = read(f);
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    // body = from the opening brace to its matching close
    let i = src.indexOf('{', m.index + m[0].length), depth = 0, start = i;
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
    topLevel.push({ name: m[1], file: f, body: src.slice(start, i + 1) });
  }
}
const isPublic = (n) => !n.endsWith('_');
const auditWriters = topLevel.filter(fn => /writeAudit/i.test(fn.name));

check('the old public name `_cfg_writeAudit` no longer exists', !topLevel.some(fn => fn.name === '_cfg_writeAudit'));
check('the audit writers that remain are all private (trailing "_")',
  auditWriters.length >= 2 && auditWriters.every(fn => !isPublic(fn.name)),
  auditWriters.map(fn => fn.name).join(', '));
check('every reference to the writer in the code uses the private name',
  !gsFiles.some(f => /_cfg_writeAudit(?!_)/.test(read(f).replace(/\/\/.*$/gm, ''))),
  gsFiles.filter(f => /_cfg_writeAudit(?!_)/.test(read(f).replace(/\/\/.*$/gm, ''))).join(', '));

// Defense in depth: a *public* function that appends to an audit sheet must
// carry its own gate as a real check, not merely be reachable.
const gated = (body) => /sl_isAdmin\(\)|_identity_authorizeCurrentUser_\(/.test(body);
// Scope: the CONFIG_AUDIT writer. Identity self-service functions (register,
// verify, MFA) write IDENTITY_AUDIT for the *caller's own* record by design
// and are covered by identity.test.js.
const publicAuditCallers = topLevel.filter(fn => isPublic(fn.name) && /_cfg_writeAudit_?\(/.test(fn.body));
const ungated = publicAuditCallers.filter(fn => !gated(fn.body));
// cfg_createConfiguration/rollback/setStatus etc. either gate directly or
// delegate to a helper that does; the delegating ones are listed in
// API_CONTRACT.md. Anything else that writes audit rows without a gate is a bug.
const delegating = new Set(['store_activate', 'store_deactivate', 'cfg_activateConfiguration', 'cfg_deactivateConfiguration']);
check('no public function writes audit rows without an admin/identity gate',
  ungated.every(fn => delegating.has(fn.name)),
  ungated.filter(fn => !delegating.has(fn.name)).map(fn => fn.name).join(', '));

// ── Behavioral: real paths still write real, server-attributed rows ────
console.log('\n── Real mutations still write CONFIG_AUDIT, actor derived server-side ──');

function makeSheet(headerRows) {
  const rows = headerRows ? headerRows.map(r => r.slice()) : [];
  const sheet = {
    _rows: rows,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((n, r) => Math.max(n, r.length), 0),
    getRange: (r, c, nr, nc) => {
      const range = {
        getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = rows[r - 1 + i] || []; const o = []; for (let j = 0; j < (nc || 1); j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValues: (vals) => { vals.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((v, j) => { rows[r - 1 + i][c - 1 + j] = v; }); }); return proxy; },
        setValue: (v) => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; return proxy; },
      };
      // every formatting call (setFontWeight, setBackground, ...) is a chainable no-op
      const proxy = new Proxy(range, { get: (t, p) => (p in t ? t[p] : (typeof p === 'string' ? () => proxy : undefined)) });
      return proxy;
    },
    appendRow: (row) => { rows.push(row.slice()); },
    setFrozenRows: () => {}, setColumnWidth: () => {}, setColumnWidths: () => {}, hideSheet: () => {},
    getName: () => 'x', autoResizeColumns: () => {}, deleteRow: () => {},
  };
  return sheet;
}
const sheets = {};
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = makeSheet()),
  getSpreadsheetTimeZone: () => 'UTC',
};
const sandbox = {
  console, Logger: { log() {} },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {}, getUi: () => ({ alert() {}, ButtonSet: { OK: 1 } }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'admin@example.com' }), getScriptTimeZone: () => 'UTC' },
  Utilities: {
    getUuid: () => 'uuid-' + Math.random().toString(16).slice(2),
    formatDate: (d) => d.toISOString().slice(0, 10),
    sleep() {},
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  PropertiesService: { getUserProperties: () => ({ getProperty: () => null, setProperty() {} }), getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
};
vm.createContext(sandbox);
for (const f of ['SVMKPI_CORE.gs', 'SVMKPI_CONFIG.gs']) {
  try { vm.runInContext(read(f), sandbox, { filename: f }); } catch (e) { console.log('  (load ' + f + ': ' + e.message + ')'); }
}
// Admin gate + server-side identity: stubbed the way the other suites do.
sandbox.sl_isAdmin = () => true;
sandbox.sl_getCurrentUser = () => 'admin@example.com';
sandbox.logError = (ctx, e) => { sandbox.__lastError = ctx + ': ' + (e && e.message); };

check('`_cfg_writeAudit_` (private) exists in the loaded code', typeof sandbox._cfg_writeAudit_ === 'function');
check('`_cfg_writeAudit` (public) does not exist in the loaded code', typeof sandbox._cfg_writeAudit === 'undefined');

let res;
try {
  res = sandbox.cfg_createConfiguration('SYSTEM', 'audit-probe', { settingKey: 'probe', settingValue: 'v' }, '2026-01-01', undefined, 'exposure test', { backdateConfirmed: true });
} catch (e) { res = { success: false, message: String(e && e.message) }; }
const auditRows = (sheets['CONFIG_AUDIT'] && sheets['CONFIG_AUDIT']._rows) || [];
const probeRows = auditRows.filter(r => String(r[4]).toUpperCase() === 'AUDIT-PROBE');
check('a real configuration change appends exactly one audit row for that entity', probeRows.length === 1, JSON.stringify(res) + ' ' + (sandbox.__lastError || ''));
const last = probeRows[0] || [];
check('the audit row is attributed to the signed-in server-side identity', last[2] === 'admin@example.com', JSON.stringify(last));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
