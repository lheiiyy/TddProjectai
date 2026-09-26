// Phase 1H-C Security Fix R2 (DECISIONS.md D-032): closes the
// dual-authorization-path gap Security Fix R1 left open. R1 made MFA an
// enforced requirement for the NEW identity/permission surface
// (_identity_authorizeCurrentUser_()) but left the PRE-EXISTING
// SETTINGS!G admin-email mechanism (sl_isAdmin(), still the gate on 45+
// call sites) completely untouched — an admin could satisfy sl_isAdmin()
// with no MFA at all. See reviews/009-phase-1h-c-security-fix-r2.md.
//
// Loads the REAL SVMKPI_ACCESS.gs (sl_isAdmin(), the legacy admin-list
// mechanism, and this fix's new enrollAdminMfa()/verifyAdminMfa()/
// sl_getAdminMfaStatus()) together with the REAL SVMKPI_IDENTITY_CORE.gs
// and SVMKPI_IDENTITY_MFA.gs (the generic TOTP + PropertiesService-backed
// satisfaction-gate primitives this fix reuses) into one Node vm sandbox
// — same house pattern as every other file in this directory — PLUS a
// representative real protected legacy function from each of several
// different files/categories, to prove the fix is not confined to
// sl_isAdmin() in isolation. security-remediation.test.js is left
// unmodified/unaffected on purpose: its sandbox never loads the identity
// files, so the new MFA check is a documented no-op there (see its own
// "REQUIRED FINDING 1" section, still passing unchanged) — exactly the
// same typeof-guard precedent this fix reuses.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const accessSrc     = APPS('SVMKPI_ACCESS.gs');       // legacy: sl_isAdmin() + this fix
const coreSrc        = APPS('SVMKPI_IDENTITY_CORE.gs'); // MFA satisfaction gate primitives
const mfaSrc          = APPS('SVMKPI_IDENTITY_MFA.gs');  // TOTP primitives
const storeConfigSrc  = APPS('SVMKPI_STORE_CONFIG.gs');  // category: Store configuration
const complianceSrc   = APPS('SVMKPI_COMPLIANCE_CONFIG.gs'); // category: Compliance configuration
const reportSnapSrc   = APPS('SVMKPI_REPORT_SNAPSHOT.gs');   // category: Report snapshot admin
const adminSrc        = APPS('SVMKPI_ADMIN.gs');         // category: System Tools (portal_* wrappers)

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}

// ── Sheet mock (2D-array backed) — same pattern as identity.test.js ────
function makeSheet() {
  let data = [];
  const self = {
    getLastRow: () => data.length,
    getLastColumn: () => (data[0] ? data[0].length : 0),
    getRange(row, col, numRows, numCols) {
      numRows = numRows || 1; numCols = numCols || 1;
      const range = {
        getValues: () => {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const src = data[row - 1 + r] || [];
            const rowArr = [];
            for (let c = 0; c < numCols; c++) rowArr.push(src[col - 1 + c] != null ? src[col - 1 + c] : '');
            out.push(rowArr);
          }
          return out;
        },
        getValue() { return this.getValues()[0][0]; },
        setValues(rows) {
          rows.forEach((rowArr, ri) => {
            const idx = row - 1 + ri;
            while (data.length <= idx) data.push([]);
            rowArr.forEach((v, ci) => { data[idx][col - 1 + ci] = v; });
          });
          return range;
        },
        setValue(v) {
          const idx = row - 1;
          while (data.length <= idx) data.push([]);
          data[idx][col - 1] = v;
          return range;
        },
        setFontWeight() { return range; },
      };
      return range;
    },
    appendRow(arr) { data.push(arr.slice()); },
    deleteRow(rowNum) { data.splice(rowNum - 1, 1); },
    clear() { data = []; },
  };
  return self;
}

function makeSpreadsheetMock() {
  const sheets = {};
  return {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => { const s = makeSheet(); sheets[name] = s; return s; },
  };
}

// PropertiesService.getUserProperties() mock — same shape as the real
// service; the satisfaction gate this fix reuses is built entirely on it.
function makePropertiesServiceMock() {
  const store = {};
  const userProps = {
    getProperty: (key) => (key in store ? store[key] : null),
    setProperty: (key, value) => { store[key] = String(value); },
    deleteProperty: (key) => { delete store[key]; },
  };
  return { getUserProperties: () => userProps, _store: store };
}

function newSandbox() {
  const ssMock = makeSpreadsheetMock();
  const settings = ssMock.insertSheet('SETTINGS');
  const propsMock = makePropertiesServiceMock();
  const state = { email: 'admin@example.com' };

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {}, getUi: () => ({ alert: () => {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => state.email }), getEffectiveUser: () => ({ getEmail: () => state.email }) },
    PropertiesService: propsMock,
    Utilities: {
      getUuid: (() => { let n = 0; return () => 'uuid-' + (++n); })(),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (algo, value) => {
        const bytes = crypto.createHash('sha256').update(String(value)).digest();
        return Array.from(bytes).map(b => (b > 127 ? b - 256 : b));
      },
      computeHmacSha1Signature: (value, key) => {
        const toBuf = (arr) => Buffer.from(arr.map(b => (b < 0 ? b + 256 : b) & 0xff));
        const bytes = crypto.createHmac('sha1', toBuf(key)).update(toBuf(value)).digest();
        return Array.from(bytes).map(b => (b > 127 ? b - 256 : b));
      },
    },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({ setTitle: () => ({ addMetaTag: () => 'SERVED' }) }) }),
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example.com/exec' }) },
    Logger: { log: () => {} },
    logError: () => {},
    console,
  };
  vm.createContext(sandbox);
  [accessSrc, coreSrc, mfaSrc, storeConfigSrc, complianceSrc, reportSnapSrc, adminSrc].forEach(src => vm.runInContext(src, sandbox));
  return { sandbox, ssMock, settings, state, propsMock };
}

function setAdminList(settings, emails) {
  settings.getRange(1, 7).setValue('ADMIN_EMAILS');
  emails.forEach((email, i) => settings.getRange(2 + i, 7).setValue(email));
}

/** Completes the REAL enrollAdminMfa() -> verifyAdminMfa() flow. Returns the secret. */
function completeAdminMfaEnrollment(sandbox) {
  const enrollment = sandbox.enrollAdminMfa();
  if (!enrollment.success) throw new Error('test helper: enrollAdminMfa() failed — ' + enrollment.message);
  const code = sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000));
  const verify = sandbox.verifyAdminMfa(code);
  if (!verify.success) throw new Error('test helper: verifyAdminMfa() did not verify — ' + verify.message);
  return enrollment.secret;
}

function codeFor(sandbox, secret, offsetSeconds) {
  return sandbox._identity_totpCodeForTime_(secret, Math.floor(Date.now() / 1000) + (offsetSeconds || 0));
}

// Representative real protected legacy functions, one per category. Each
// is called with intentionally-incomplete args — sufficient to prove
// whether the sl_isAdmin() gate at the TOP of the function was passed:
// a REJECTED call returns the exact { success:false, message:'Admin
// access required.' } object immediately, before touching any other
// dependency; an call that got PAST the gate either succeeds or throws/
// returns something else entirely (it never returns that exact object).
const PROTECTED_OPS = [
  { name: 'store_create (Store configuration)', call: (sandbox) => sandbox.store_create({}, null, 'test', {}) },
  { name: 'cmp_create (Compliance configuration)', call: (sandbox) => sandbox.cmp_create('NCR', {}, null, 'test', {}) },
  { name: 'finalizeReport (Report snapshot admin)', call: (sandbox) => sandbox.finalizeReport(2026, null, 'test', {}) },
  { name: 'portal_rebuildStoreHealth (System Tools)', call: (sandbox) => sandbox.portal_rebuildStoreHealth() },
];

function wasRejectedByAdminGate(result) {
  return result && result.success === false && result.message === 'Admin access required.';
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── static inspection: sl_isAdmin() is the ONLY legacy authorization mechanism ──');
{
  // Confirms the premise this whole fix rests on: strengthening
  // sl_isAdmin() alone, with zero edits to any of the 45+ call sites,
  // is sufficient to close the gap everywhere — there is no second,
  // independent legacy admin-check function anywhere in the project.
  const allAppsScriptDir = path.join(__dirname, '..', 'Apps Script');
  const files = fs.readdirSync(allAppsScriptDir).filter(f => f.endsWith('.gs'));
  const otherAdminCheckPattern = /function\s+(?!sl_isAdmin\b)\w*[Ii]s[Aa]dmin\w*\s*\(/;
  const offenders = files.filter(f => otherAdminCheckPattern.test(fs.readFileSync(path.join(allAppsScriptDir, f), 'utf8')));
  check('no second, independent admin-check function exists anywhere in Apps Script/*.gs', offenders.length === 0, JSON.stringify(offenders));
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── R2.1 — a non-MFA-satisfied admin cannot call a protected legacy Admin operation ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'admin@example.com';

  check('sl_isAdmin() is false before any MFA enrollment, even though the email IS on the admin list', sandbox.sl_isAdmin() === false);

  PROTECTED_OPS.forEach(op => {
    const result = op.call(sandbox);
    check(op.name + ': rejected with "Admin access required." while MFA is unsatisfied', wasRejectedByAdminGate(result), JSON.stringify(result));
  });
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── R2.2 — an MFA-satisfied, admin-listed user CAN call the same operations (passes the gate) ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'admin@example.com';
  completeAdminMfaEnrollment(sandbox);

  check('sl_isAdmin() is true once admin-listed AND MFA-satisfied', sandbox.sl_isAdmin() === true);

  PROTECTED_OPS.forEach(op => {
    let result, threw = false;
    try { result = op.call(sandbox); } catch (e) { threw = true; result = e; }
    // Getting PAST the gate means either it threw further down (a
    // missing unrelated dependency in this minimal sandbox) or it
    // returned something other than the admin-gate rejection — either
    // way, proof the sl_isAdmin() check itself let the call through.
    const passedGate = threw || !wasRejectedByAdminGate(result);
    check(op.name + ': the sl_isAdmin() gate is passed once MFA is satisfied (no longer short-circuits on "Admin access required.")', passedGate, JSON.stringify(result && result.message));
  });
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── R2.3 — invalid admin MFA code is rejected ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'admin@example.com';
  const enrollment = sandbox.enrollAdminMfa();

  const wrong = sandbox.verifyAdminMfa('000000' === sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000)) ? '111111' : '000000');
  check('an incorrect TOTP code is rejected', wrong.success === false, JSON.stringify(wrong));
  check('sl_isAdmin() remains false after a rejected code', sandbox.sl_isAdmin() === false);
}

console.log('\n── R2.4 — expired admin MFA satisfaction is rejected ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'admin@example.com';
  completeAdminMfaEnrollment(sandbox);
  check('sl_isAdmin() is true immediately after verification', sandbox.sl_isAdmin() === true);

  // Simulate expiry directly via the same PropertiesService key the real
  // code reads — same technique identity.test.js's R1.4 uses.
  const propKey = sandbox._identity_mfaGatePropertyKey_(sandbox._legacyAdminMfaKey_('admin@example.com'));
  sandbox.PropertiesService.getUserProperties().setProperty(propKey, String(Date.now() - 1000));
  check('sl_isAdmin() is false once the satisfaction credential has expired', sandbox.sl_isAdmin() === false);
}

console.log('\n── R2.5 — a replayed admin MFA code cannot be reused ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'admin@example.com';
  const enrollment = sandbox.enrollAdminMfa();
  const code = sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000));

  const first = sandbox.verifyAdminMfa(code);
  check('first verification with a fresh code succeeds', first.success === true, JSON.stringify(first));
  const second = sandbox.verifyAdminMfa(code); // same code again
  check('replaying the EXACT SAME code a second time is rejected', second.success === false, JSON.stringify(second));
  check('the rejection is specifically the replay message, not a generic failure', /already been used/.test(second.message), second.message);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── R2.6 — client-supplied MFA/admin state cannot bypass the gate ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'admin@example.com';

  // sl_isAdmin() takes no arguments at all — there is no parameter an
  // RPC caller could supply to influence the result.
  check('sl_isAdmin() takes no parameters (nothing for a client to spoof)', sandbox.sl_isAdmin.length === 0);

  // A forged/guessed PropertiesService key under a DIFFERENT namespace
  // (e.g. a real identity userId, or a plausible-looking guess) has no
  // effect on the legacy admin gate — only the exact
  // 'LEGACY_ADMIN:<email>' key, settable only via a real verifyAdminMfa()
  // success, is ever consulted.
  sandbox.PropertiesService.getUserProperties().setProperty('SVMI_MFA_SATISFIED_UNTIL_USR-fake-admin', String(Date.now() + 999999));
  sandbox.PropertiesService.getUserProperties().setProperty('mfaVerified', 'true');
  sandbox.PropertiesService.getUserProperties().setProperty('isAdmin', 'true');
  check('unrelated/forged PropertiesService keys under a different namespace do not satisfy the legacy admin gate', sandbox.sl_isAdmin() === false);

  PROTECTED_OPS.forEach(op => {
    const result = op.call(sandbox);
    check(op.name + ': still rejected despite forged unrelated PropertiesService keys', wasRejectedByAdminGate(result), JSON.stringify(result));
  });

  // Passing extra/forged arguments to the protected functions themselves
  // has no effect either — none of them accept an MFA/role/status flag.
  const spoofed = sandbox.store_create({ __mfaVerified: true, __isAdmin: true }, null, 'test', {});
  check('a spoofed extra field on the operation\'s own arguments has no effect', wasRejectedByAdminGate(spoofed), JSON.stringify(spoofed));
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── R2.7 — existing Admin authorization still rejects a user NOT on the admin list ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'nobody@example.com';

  check('sl_isAdmin() is false for an email never on the admin list', sandbox.sl_isAdmin() === false);
  const enroll = sandbox.enrollAdminMfa();
  check('enrollAdminMfa() itself refuses a non-admin-listed email (list membership required to even start)', enroll.success === false, JSON.stringify(enroll));

  PROTECTED_OPS.forEach(op => {
    const result = op.call(sandbox);
    check(op.name + ': rejected for a non-admin-listed user, independent of MFA', wasRejectedByAdminGate(result), JSON.stringify(result));
  });
}

console.log('\n── R2.7b — pre-existing admin-list behavior is otherwise unchanged (Phase 1H-B.1 findings intact) ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  settings.getRange(1, 9).setValue('GUEST_PASSWORD');
  settings.getRange(2, 9).setValue('secret-pw');
  state.email = 'admin@example.com';

  check('_getAdminEmails is still not a global of any kind (Phase 1H-B.1 Required finding 1)', typeof sandbox._getAdminEmails === 'undefined');
  check('_getGuestPassword is still not a global of any kind', typeof sandbox._getGuestPassword === 'undefined');
  const wrongPw = sandbox._handleWebAppRequest_({ parameter: { pw: 'guess' } });
  check('the guest-password gate is unaffected by this fix', wrongPw === 'SERVED');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── R2.8 — the legacy admin TOTP secret is never returned to the client after enrollment ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'admin@example.com';
  const secret = completeAdminMfaEnrollment(sandbox);

  const status = sandbox.sl_getAdminMfaStatus();
  check('sl_getAdminMfaStatus() never includes a "secret" field', !('secret' in status), JSON.stringify(status));
  check('sl_getAdminMfaStatus() reports mfaSatisfied truthfully', status.onAdminList === true && status.mfaEnrolled === true && status.mfaSatisfied === true);

  const reEnroll = sandbox.enrollAdminMfa();
  check('re-enrolling returns a secret (by design, exactly like enrollMfa()) but it is a FRESH one, not the original re-exposed', reEnroll.secret !== secret && typeof reEnroll.secret === 'string' && reEnroll.secret.length > 0);
}

console.log('\n── R2.9 — the legacy admin TOTP secret/code is never written to IDENTITY_AUDIT ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'admin@example.com';
  const secret = completeAdminMfaEnrollment(sandbox);
  const code = codeFor(sandbox, secret, 30); // a fresh, not-yet-used step
  sandbox.verifyAdminMfa(code); // second verification (also exercises the audit path again)
  sandbox.verifyAdminMfa('000000'); // a failed attempt too, for good measure

  const auditSheet = sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('IDENTITY_AUDIT');
  const rows = sandbox._identity_readAll_(auditSheet);
  check('at least one legacy admin MFA audit row was written', rows.length > 0);
  const secretLeaked = rows.some(r => r.some(cell => String(cell).indexOf(secret) !== -1));
  const codeLeaked = rows.some(r => r.some(cell => String(cell) === code));
  check('the TOTP secret never appears in any IDENTITY_AUDIT row', !secretLeaked);
  check('the submitted TOTP code never appears in any IDENTITY_AUDIT row', !codeLeaked);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── R2.10 — sl_getAdminMfaStatus() reveals nothing about the admin list to a non-admin ──');
{
  const { sandbox, settings, state } = newSandbox();
  setAdminList(settings, ['admin@example.com']);
  state.email = 'nobody@example.com';

  const status = sandbox.sl_getAdminMfaStatus();
  check('a non-admin-listed caller gets onAdminList:false, mfaEnrolled:false, mfaSatisfied:false — nothing else', JSON.stringify(status) === JSON.stringify({ onAdminList: false, mfaEnrolled: false, mfaSatisfied: false }));
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── R2.11 — the unattended daily-trigger bypass (__systemToken) is unaffected ──');
{
  // refreshRiskEngine() itself lives in SVMKPI_RISK.gs (not loaded here —
  // heavy MASTER_LOG/risk-engine dependencies unrelated to this fix), but
  // its bypass condition is `!isSystemTrigger && ... !sl_isAdmin()` — the
  // system-trigger branch never reaches sl_isAdmin() at all when the
  // token matches, so strengthening sl_isAdmin() itself cannot affect it.
  // Confirmed here by static inspection of the actual source line, since
  // that guarantee is what this fix's safety claim rests on.
  const riskSrc = fs.readFileSync(path.join(__dirname, '..', 'Apps Script', 'SVMKPI_RISK.gs'), 'utf8');
  check('refreshRiskEngine()\'s system-trigger check short-circuits BEFORE calling sl_isAdmin()',
    /if\s*\(!isSystemTrigger\s*&&\s*typeof sl_isAdmin === 'function' && !sl_isAdmin\(\)\)/.test(riskSrc));
}

console.log('\n── R2.12 — degrades gracefully (does not throw) when the identity subsystem is not loaded ──');
{
  // Mirrors the existing, already-established precedent this fix reuses
  // (see security-remediation.test.js's own "sandbox that never loaded
  // SVMKPI_ACCESS.gs" case): a sandbox that loads ONLY SVMKPI_ACCESS.gs,
  // without SVMKPI_IDENTITY_CORE.gs, must not throw a ReferenceError —
  // it degrades to the pre-R2 admin-list-only check, exactly as
  // documented in sl_isAdmin()'s own comment and DECISIONS.md D-032.
  const ssMock = makeSpreadsheetMock();
  const settings = ssMock.insertSheet('SETTINGS');
  setAdminList(settings, ['admin@example.com']);
  const state = { email: 'admin@example.com' };
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock },
    Session: { getActiveUser: () => ({ getEmail: () => state.email }) },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(accessSrc, sandbox); // ACCESS.gs ONLY — no identity files
  let threw = false, result;
  try { result = sandbox.sl_isAdmin(); } catch (e) { threw = true; }
  check('sl_isAdmin() does not throw when SVMKPI_IDENTITY_CORE.gs is not loaded', !threw);
  check('...and degrades to the pre-R2 admin-list-only check (documented, not a silent security regression in production, where all files always load together)', result === true);
}

// ═══════════════════════════════════════════════════════════════
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
