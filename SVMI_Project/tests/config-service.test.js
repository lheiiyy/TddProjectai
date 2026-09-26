// Phase 1A: configuration data model + versioning + audit foundation
// (SVMKPI_CONFIG.gs). Covers every category the phase spec asked for:
// creation validation, effective-dating/resolution, versioning, audit,
// security, rollback, and portability (nothing depends on a spreadsheet
// row number being an object's identity).
//
// Runs the REAL Apps Script code (SVMKPI_CORE.gs for _parseDateCell() +
// SVMKPI_CONFIG.gs) in a Node vm sandbox. sl_isAdmin()/sl_getCurrentUser()
// and logError() are stubbed directly rather than loading their real
// files, matching this project's established test convention (see
// roster-auto-refresh.test.js) — SVMKPI_CONFIG.gs only calls them, it
// doesn't define them.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const coreSrc   = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CORE.gs'), 'utf8');
const configSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_CONFIG.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

// ── Generic writable Sheet mock (cells: {row,col} -> value), same
//    Proxy-no-op-fallback pattern used elsewhere in this project so any
//    styling call SVMKPI_CONFIG.gs makes (.setFontWeight(), etc.) never
//    needs a matching stub added here ──────────────────────────────────
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
  };
}

function newSandbox() {
  const ssMock = makeSpreadsheetMock();
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      },
    },
    sl_isAdmin: () => true,
    sl_getCurrentUser: () => 'admin@test.com',
    logError: () => {},
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);   // _parseDateCell()
  vm.runInContext(configSrc, sandbox); // the module under test
  return { sandbox, ssMock };
}

const OPTS = { backdateConfirmed: true }; // sidesteps backdate-confirmation for tests not about that rule
const STORE_FIELDS = (overrides) => Object.assign({ storeName: 'ALPHA', brand: 'FIGARO', region: 'NCR', category: 'NCR' }, overrides || {});

// ════════════════════════════════════════════════════════════════════
console.log('\n── Configuration creation: valid + every required/invalid-input rejection ──');
{
  const { sandbox } = newSandbox();

  const valid = sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS(), '2026-01-01', null, 'initial config', OPTS);
  check('valid configuration is created', valid.success === true, JSON.stringify(valid));
  check('version ID follows the area-entity-version pattern', valid.versionId === 'STORES-ALPHA-v1', valid.versionId);
  check('first version is numbered 1', valid.version === 1, valid.version);

  const missingField = sandbox.cfg_createConfiguration('STORES', 'BETA', STORE_FIELDS({ brand: '' }), '2026-01-01', null, '', OPTS);
  check('missing required field is rejected', missingField.success === false && /Brand/.test(missingField.message), JSON.stringify(missingField));

  const invalidDate = sandbox.cfg_createConfiguration('STORES', 'GAMMA', STORE_FIELDS(), 'not-a-date', null, '', OPTS);
  check('invalid Effective From date is rejected', invalidDate.success === false, JSON.stringify(invalidDate));

  const invalidToDate = sandbox.cfg_createConfiguration('STORES', 'GAMMA', STORE_FIELDS(), '2026-01-01', 'garbage', '', OPTS);
  check('invalid Effective To date is rejected', invalidToDate.success === false, JSON.stringify(invalidToDate));

  const blankEntity = sandbox.cfg_createConfiguration('STORES', '', STORE_FIELDS(), '2026-01-01', null, '', OPTS);
  check('blank entity ID is rejected', blankEntity.success === false, JSON.stringify(blankEntity));

  const unknownArea = sandbox.cfg_createConfiguration('NOT_A_REAL_AREA', 'X', {}, '2026-01-01', null, '', OPTS);
  check('an unknown configuration area is rejected', unknownArea.success === false && /area/i.test(unknownArea.message), JSON.stringify(unknownArea));

  const invalidStatus = sandbox._cfg_setStatus('STORES', 'STORES-ALPHA-v1', 'BOGUS_STATUS', 'x');
  check('an invalid status value is rejected', invalidStatus.success === false, JSON.stringify(invalidStatus));

  // Nothing invalid was ever actually written
  const alphaVersions = sandbox.cfg_getConfiguration('STORES', 'ALPHA');
  check('only the one valid ALPHA version exists (no partial writes from rejected attempts)', alphaVersions.length === 1, alphaVersions.length);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Effective dating: before / on / after / boundary / overlap / adjacent ──');
{
  const { sandbox } = newSandbox();
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ category: 'NCR' }), '2026-01-01', null, 'v1', OPTS);
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ category: 'FAR PROVINCIAL' }), '2027-01-01', null, 'v2 — category change', OPTS);

  check('a date before any version exists resolves to null',
    sandbox.cfg_resolveConfigurationAsOf('STORES', 'ALPHA', '2025-06-01') === null);

  const during2026 = sandbox.cfg_resolveConfigurationAsOf('STORES', 'ALPHA', '2026-06-15');
  check('a date within v1\'s window resolves to v1', during2026 && during2026.versionNum === 1 && during2026.fields.category === 'NCR', JSON.stringify(during2026));

  const dayBeforeBoundary = sandbox.cfg_resolveConfigurationAsOf('STORES', 'ALPHA', '2026-12-31');
  check('the day before v2\'s Effective From still resolves to v1', dayBeforeBoundary.versionNum === 1, JSON.stringify(dayBeforeBoundary));

  const onBoundary = sandbox.cfg_resolveConfigurationAsOf('STORES', 'ALPHA', '2027-01-01');
  check('exactly on v2\'s Effective From resolves to v2 (boundary is inclusive)', onBoundary.versionNum === 2, JSON.stringify(onBoundary));

  const after = sandbox.cfg_resolveConfigurationAsOf('STORES', 'ALPHA', '2028-01-01');
  check('a date well after v2 still resolves to v2 (open-ended)', after.versionNum === 2 && after.fields.category === 'FAR PROVINCIAL', JSON.stringify(after));

  // Bounded (explicit Effective To) windows: overlap rejected, adjacent allowed
  sandbox.cfg_createConfiguration('PURPOSES', 'PROMO', { purposeName: 'PROMO' }, '2026-03-01', '2026-03-31', 'temporary promo purpose', OPTS);

  const overlap = sandbox.cfg_createConfiguration('PURPOSES', 'PROMO', { purposeName: 'PROMO' }, '2026-03-15', '2026-04-15', 'overlap attempt', OPTS);
  check('an overlapping bounded effective window is rejected', overlap.success === false && /overlap/i.test(overlap.message), JSON.stringify(overlap));

  const adjacent = sandbox.cfg_createConfiguration('PURPOSES', 'PROMO', { purposeName: 'PROMO' }, '2026-04-01', null, 'adjacent, non-overlapping', OPTS);
  check('an adjacent (non-overlapping, starts the day after) window is allowed', adjacent.success === true, JSON.stringify(adjacent));

  const duplicateDate = sandbox.cfg_createConfiguration('PURPOSES', 'PROMO', { purposeName: 'PROMO' }, '2026-03-01', null, 'exact duplicate date', OPTS);
  check('an exact duplicate Effective From for the same entity is rejected', duplicateDate.success === false && /already exists/i.test(duplicateDate.message), JSON.stringify(duplicateDate));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Versioning: 1st / 2nd / multiple / historical vs. current resolution ──');
{
  const { sandbox } = newSandbox();
  const v1 = sandbox.cfg_createConfiguration('VISITORS', 'LEO', { visitorName: 'LEO' }, '2026-01-01', null, 'onboarded', OPTS);
  check('first version is v1', v1.version === 1, v1.version);

  const v2 = sandbox.cfg_createConfiguration('VISITORS', 'LEO', { visitorName: 'LEO' }, '2026-06-01', null, 're-confirmed', OPTS);
  check('second version is v2', v2.version === 2, v2.version);

  const v3 = sandbox.cfg_createConfiguration('VISITORS', 'LEO', { visitorName: 'LEO' }, '2027-01-01', null, 'third version', OPTS);
  check('a third version is v3 (multiple versions accumulate correctly)', v3.version === 3, v3.version);

  const all = sandbox.cfg_getConfiguration('VISITORS', 'LEO');
  check('cfg_getConfiguration returns all 3 versions, not just the current one', all.length === 3, all.length);

  const historical = sandbox.cfg_resolveConfigurationAsOf('VISITORS', 'LEO', '2026-03-01');
  check('historical resolution (a date matching v1\'s window) returns v1', historical.versionNum === 1, JSON.stringify(historical));

  const current = sandbox.cfg_resolveConfigurationAsOf('VISITORS', 'LEO', '2027-06-01');
  check('current resolution (latest applicable date) returns v3', current.versionNum === 3, JSON.stringify(current));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Audit: successful mutations recorded; failed mutations are not ──');
{
  const { sandbox } = newSandbox();
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ category: 'NCR' }), '2026-01-01', null, 'initial config', OPTS);
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ category: 'FAR PROVINCIAL' }), '2027-01-01', null, 'category change', OPTS);

  const audit = sandbox.cfg_getAuditLog('STORES', 'ALPHA');
  check('one audit entry per successful create', audit.length === 2, audit.length);
  check('audit entry records the actor', audit[0].actor === 'admin@test.com', audit[0].actor);
  check('audit entry records the action', audit[0].action === 'CREATE', audit[0].action);
  check('first entry\'s previous value is "(none)" — nothing existed before it', audit[0].previousValue === '(none)', audit[0].previousValue);
  check('second entry\'s previous value reflects v1\'s actual fields', /category=NCR/.test(audit[1].previousValue), audit[1].previousValue);
  check('second entry\'s new value reflects v2\'s actual fields', /category=FAR PROVINCIAL/.test(audit[1].newValue), audit[1].newValue);
  check('audit entry records the reason', audit[1].reason === 'category change', audit[1].reason);

  const beforeCount = sandbox.cfg_getAuditLog('STORES', 'ALPHA').length;
  const rejected = sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ brand: '' }), '2028-01-01', null, 'missing brand', OPTS);
  check('the invalid attempt itself was rejected', rejected.success === false);
  const afterCount = sandbox.cfg_getAuditLog('STORES', 'ALPHA').length;
  check('a failed/rejected mutation creates NO audit entry', afterCount === beforeCount, 'before=' + beforeCount + ' after=' + afterCount);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Security: admin-gated server-side, not client-trusted ──');
{
  const { sandbox } = newSandbox();
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS(), '2026-01-01', null, 'setup', OPTS);

  sandbox.sl_isAdmin = () => false;

  const nonAdminCreate = sandbox.cfg_createConfiguration('STORES', 'BETA', STORE_FIELDS({ storeName: 'BETA' }), '2026-01-01', null, '', OPTS);
  check('non-admin cannot create configuration', nonAdminCreate.success === false && /admin/i.test(nonAdminCreate.message), JSON.stringify(nonAdminCreate));

  const nonAdminActivate = sandbox.cfg_activateConfiguration('STORES', 'STORES-ALPHA-v1', 'x');
  check('non-admin cannot activate configuration', nonAdminActivate.success === false, JSON.stringify(nonAdminActivate));

  const nonAdminDeactivate = sandbox.cfg_deactivateConfiguration('STORES', 'STORES-ALPHA-v1', 'x');
  check('non-admin cannot deactivate configuration', nonAdminDeactivate.success === false, JSON.stringify(nonAdminDeactivate));

  const nonAdminRollback = sandbox.cfg_rollbackConfiguration('STORES', 'ALPHA', 'STORES-ALPHA-v1', 'x');
  check('non-admin cannot roll back configuration', nonAdminRollback.success === false, JSON.stringify(nonAdminRollback));

  // No cfg_* function reads any client-supplied "admin"/"role" field from
  // its payload at all — embedding one proves nothing, but confirms there
  // is no such backdoor to find.
  const spoofed = sandbox.cfg_createConfiguration('STORES', 'BETA',
    Object.assign(STORE_FIELDS({ storeName: 'BETA' }), { isAdmin: true, __admin: true, role: 'ADMIN' }),
    '2026-01-01', null, '', OPTS);
  check('embedding a fake admin/role flag in the payload does not bypass the server-side sl_isAdmin() check',
    spoofed.success === false, JSON.stringify(spoofed));

  sandbox.sl_isAdmin = () => true;
  const adminCreate = sandbox.cfg_createConfiguration('STORES', 'BETA', STORE_FIELDS({ storeName: 'BETA' }), '2026-01-01', null, 'test setup', OPTS);
  check('an actual admin can create valid configuration', adminCreate.success === true, JSON.stringify(adminCreate));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Backdating: requires explicit confirmation + reason, never silent ──');
{
  const { sandbox, ssMock } = newSandbox();
  void ssMock;
  const SDate = vm.runInContext('Date', sandbox);
  const fmt = (d) => { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; };
  const now = new SDate();
  const fiveDaysAgo = new SDate(now.getFullYear(), now.getMonth(), now.getDate() - 5);
  const fiveDaysAhead = new SDate(now.getFullYear(), now.getMonth(), now.getDate() + 5);

  const noConfirm = sandbox.cfg_createConfiguration('VISITORS', 'YANA', { visitorName: 'YANA' }, fmt(fiveDaysAgo), null, '');
  check('a backdated change without confirmation is rejected', noConfirm.success === false, JSON.stringify(noConfirm));
  check('the rejection flags requiresBackdateConfirmation', noConfirm.requiresBackdateConfirmation === true, JSON.stringify(noConfirm));

  const confirmedNoReason = sandbox.cfg_createConfiguration('VISITORS', 'YANA', { visitorName: 'YANA' }, fmt(fiveDaysAgo), null, '', { backdateConfirmed: true });
  check('a backdated change confirmed but with no reason is still rejected', confirmedNoReason.success === false, JSON.stringify(confirmedNoReason));

  const confirmedWithReason = sandbox.cfg_createConfiguration('VISITORS', 'YANA', { visitorName: 'YANA' }, fmt(fiveDaysAgo), null, 'correcting a data-entry error', { backdateConfirmed: true });
  check('a backdated change with confirmation AND a reason succeeds', confirmedWithReason.success === true, JSON.stringify(confirmedWithReason));

  const future = sandbox.cfg_createConfiguration('VISITORS', 'GIO', { visitorName: 'GIO' }, fmt(fiveDaysAhead), null, '');
  check('a FUTURE effective date needs no backdate confirmation', future.success === true, JSON.stringify(future));

  const today = sandbox.cfg_createConfiguration('VISITORS', 'RICE', { visitorName: 'RICE' }, fmt(now), null, '');
  check('an effective date of exactly today needs no backdate confirmation (not backdated)', today.success === true, JSON.stringify(today));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Rollback: never deletes, always a new version, history stays queryable ──');
{
  const { sandbox } = newSandbox();
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ category: 'NCR' }), '2026-01-01', null, 'v1', OPTS);
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ category: 'FAR PROVINCIAL' }), '2027-01-01', null, 'v2', OPTS);
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ category: 'FLIGHT PROVINCIAL' }), '2028-01-01', null, 'v3', OPTS);

  const rollback = sandbox.cfg_rollbackConfiguration('STORES', 'ALPHA', 'STORES-ALPHA-v1', 'reverting a mistaken category change', '2029-01-01', OPTS);
  check('rollback succeeds', rollback.success === true, JSON.stringify(rollback));
  check('rollback creates a NEW version (v4), not an edit to v1', rollback.version === 4, rollback.version);

  const all = sandbox.cfg_getConfiguration('STORES', 'ALPHA');
  check('all 4 versions exist after rollback — nothing was deleted', all.length === 4, all.length);

  const origV1 = all.filter(v => v.versionNum === 1)[0];
  check('version 1\'s original fields are completely untouched by the rollback', origV1.fields.category === 'NCR', origV1.fields.category);
  const origV2 = all.filter(v => v.versionNum === 2)[0];
  check('version 2 is still fully queryable, unchanged', origV2.fields.category === 'FAR PROVINCIAL', origV2.fields.category);

  const resolvedBeforeRollback = sandbox.cfg_resolveConfigurationAsOf('STORES', 'ALPHA', '2028-06-01');
  check('a date before the rollback\'s effective date still resolves to v3 (history is reproducible)', resolvedBeforeRollback.versionNum === 3, JSON.stringify(resolvedBeforeRollback));

  const resolvedAfterRollback = sandbox.cfg_resolveConfigurationAsOf('STORES', 'ALPHA', '2029-06-01');
  check('a date after the rollback resolves to v4, carrying v1\'s restored values', resolvedAfterRollback.versionNum === 4 && resolvedAfterRollback.fields.category === 'NCR', JSON.stringify(resolvedAfterRollback));

  const rollbackAudit = sandbox.cfg_getAuditLog('STORES', 'ALPHA').filter(a => a.action === 'ROLLBACK');
  check('the rollback itself is audited as a ROLLBACK action', rollbackAudit.length === 1, rollbackAudit.length);
  check('rollback audit names what was restored', /STORES-ALPHA-v1/.test(rollbackAudit[0].reason), rollbackAudit[0].reason);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Activate / Deactivate: status changes are audited, resolution respects them ──');
{
  const { sandbox } = newSandbox();
  sandbox.cfg_createConfiguration('PURPOSES', 'FIELD_AUDIT', { purposeName: 'FIELD_AUDIT' }, '2026-01-01', null, 'new purpose', OPTS);

  const beforeDeactivate = sandbox.cfg_resolveConfigurationAsOf('PURPOSES', 'FIELD_AUDIT', '2026-06-01');
  check('the purpose resolves normally before deactivation', beforeDeactivate !== null);

  const deactivate = sandbox.cfg_deactivateConfiguration('PURPOSES', 'PURPOSES-FIELD_AUDIT-v1', 'purpose retired');
  check('deactivate succeeds', deactivate.success === true, JSON.stringify(deactivate));

  const afterDeactivate = sandbox.cfg_resolveConfigurationAsOf('PURPOSES', 'FIELD_AUDIT', '2026-06-01');
  check('an INACTIVE version is no longer returned by resolution', afterDeactivate === null, JSON.stringify(afterDeactivate));

  const stillListed = sandbox.cfg_getConfiguration('PURPOSES', 'FIELD_AUDIT');
  check('the deactivated version is still visible via full history (not deleted)', stillListed.length === 1 && stillListed[0].status === 'INACTIVE', JSON.stringify(stillListed));

  const reactivate = sandbox.cfg_activateConfiguration('PURPOSES', 'PURPOSES-FIELD_AUDIT-v1', 'reinstated');
  check('reactivate succeeds', reactivate.success === true);
  const afterReactivate = sandbox.cfg_resolveConfigurationAsOf('PURPOSES', 'FIELD_AUDIT', '2026-06-01');
  check('resolution finds it again after reactivation', afterReactivate !== null && afterReactivate.status === 'ACTIVE');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Portability: identity is Version ID / Entity ID / Version #, never a row number ──');
{
  const { sandbox } = newSandbox();
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ category: 'NCR' }), '2026-01-01', null, 'v1', OPTS);
  sandbox.cfg_createConfiguration('STORES', 'ALPHA', STORE_FIELDS({ category: 'FAR PROVINCIAL' }), '2027-01-01', null, 'v2', OPTS);

  const all = sandbox.cfg_getConfiguration('STORES', 'ALPHA');
  // Deliberately look the record up by its business identity fields, in
  // reverse array order, rather than assuming array/row position implies
  // anything about which version it is.
  const byVersionId = all.slice().reverse().filter(v => v.versionId === 'STORES-ALPHA-v1')[0];
  check('a version is fully addressable by Version ID alone, regardless of array/row position',
    byVersionId && byVersionId.fields.category === 'NCR', JSON.stringify(byVersionId));

  const resolvedById = sandbox.cfg_resolveConfigurationAsOf('STORES', byVersionId.entityId, '2026-06-01');
  check('resolution keys off Entity ID, not any positional assumption', resolvedById.versionId === 'STORES-ALPHA-v1');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Schema coverage: the generic engine works across every configuration area ──');
{
  const { sandbox } = newSandbox();
  const areas = [
    ['STORES',     'ALPHA', STORE_FIELDS()],
    ['VISITORS',   'LEO',   { visitorName: 'LEO' }],
    ['PURPOSES',   'STORE VISIT', { purposeName: 'STORE VISIT' }],
    ['RISK',       'DEFAULT', { lowThreshold: 0, mediumThreshold: 5, highThreshold: 10, weightFailedQaMs: 5, weightStoreVisit: -2, weightCuringSupport: -4, weightTltc: -1 }],
    ['COMPLIANCE', 'NCR',   { cadenceType: 'MONTHLY', cadenceDays: 31, graceDays: 0 }],
    ['KPI',        'STORE_VISIT_COUNT', { kpiName: 'Store Visit Count' }],
    ['SYSTEM',     'EXAMPLE', { settingKey: 'EXAMPLE', settingValue: 'x' }],
  ];
  areas.forEach(([area, entityId, fields]) => {
    const r = sandbox.cfg_createConfiguration(area, entityId, fields, '2026-01-01', null, 'schema coverage', OPTS);
    check(area + ': valid configuration creates successfully', r.success === true, JSON.stringify(r));
  });

  const badRisk = sandbox.cfg_createConfiguration('RISK', 'DEFAULT', { lowThreshold: 10, mediumThreshold: 5, highThreshold: 20 }, '2027-01-01', null, '', OPTS);
  check('RISK: Low >= Medium threshold is rejected', badRisk.success === false && /Low Threshold/.test(badRisk.message), JSON.stringify(badRisk));

  const badCompliance = sandbox.cfg_createConfiguration('COMPLIANCE', 'FAR PROVINCIAL', { cadenceType: 'WEEKLY', cadenceDays: 7 }, '2026-01-01', null, '', OPTS);
  check('COMPLIANCE: an invalid Cadence Type is rejected', badCompliance.success === false && /Cadence Type/.test(badCompliance.message), JSON.stringify(badCompliance));
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
