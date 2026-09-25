// Phase 1H-C: registration / email-verification / approval / RBAC /
// scope / MFA / identity-access-audit — the approved identity foundation
// (reviews/006-phase-1h-c-planning.md, DECISIONS.md D-024-D-030).
//
// Loads the REAL SVMKPI_IDENTITY_*.gs source into a Node vm sandbox with
// SpreadsheetApp/Session/Utilities/MailApp mocked — same house pattern
// as every other file in this directory. sl_getCurrentUser() itself is
// stubbed directly (not the real SVMKPI_ACCESS.gs) to keep this file
// scoped to the identity surface, consistent with how other test files
// stub sl_isAdmin()/sl_getCurrentUser() directly.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const APPS = (name) => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', name), 'utf8');
const coreSrc     = APPS('SVMKPI_IDENTITY_CORE.gs');
const regSrc      = APPS('SVMKPI_IDENTITY_REGISTRATION.gs');
const adminSrc    = APPS('SVMKPI_IDENTITY_ADMIN.gs');
const accessSrc   = APPS('SVMKPI_IDENTITY_ACCESS.gs');
const mfaSrc      = APPS('SVMKPI_IDENTITY_MFA.gs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); fail++; }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// ── Sheet mock (2D-array backed, supports deleteRow — the identity
// service layer is the first area needing row deletion: consumed email
// verifications, revoked role/permission/scope grants) ────────────────
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

function newIdentitySandbox() {
  const ssMock = makeSpreadsheetMock();
  const sentEmails = [];
  const state = { email: 'alice@example.com' };

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => state.email }) },
    sl_getCurrentUser: () => state.email,
    Utilities: {
      getUuid: (() => { let n = 0; return () => 'uuid-' + (++n); })(),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (algo, value) => {
        const bytes = crypto.createHash('sha256').update(String(value)).digest();
        return Array.from(bytes).map(b => (b > 127 ? b - 256 : b)); // Java-signed-byte semantics, matching real Apps Script
      },
      computeHmacSha1Signature: (value, key) => {
        const toBuf = (arr) => Buffer.from(arr.map(b => (b < 0 ? b + 256 : b) & 0xff));
        const bytes = crypto.createHmac('sha1', toBuf(key)).update(toBuf(value)).digest();
        return Array.from(bytes).map(b => (b > 127 ? b - 256 : b));
      },
    },
    MailApp: { sendEmail: (opts) => { sentEmails.push(opts); } },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  [coreSrc, regSrc, adminSrc, accessSrc, mfaSrc].forEach(src => vm.runInContext(src, sandbox));
  return { sandbox, ssMock, state, sentEmails };
}

function extractCode(emailBody) {
  const m = /code is: (\d{6})/.exec(emailBody);
  return m ? m[1] : null;
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── registerUser() ──');
{
  const { sandbox, sentEmails } = newIdentitySandbox();
  const result = sandbox.registerUser('Alice Reyes', 'alice@example.com', 'Training');
  check('registration succeeds', result.success === true, JSON.stringify(result));
  check('exactly one verification email sent', sentEmails.length === 1);
  check('the email body contains a 6-digit code', /code is: \d{6}/.test(sentEmails[0].body));

  const detail = sandbox._identity_findUserByEmail_('alice@example.com');
  check('new user starts PENDING_VERIFICATION', detail.user.accountStatus === 'PENDING_VERIFICATION');

  const auditList = sandbox.identityAudit_list; // not callable yet (no permission) — checked separately below
  const rawAudit = sandbox._identity_readAll_(sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('IDENTITY_AUDIT'));
  check('REGISTRATION_SUBMITTED audit event written', rawAudit.some(r => r[2] === 'REGISTRATION_SUBMITTED'));
}

console.log('\n── registerUser() validation ──');
{
  const { sandbox } = newIdentitySandbox();
  eq('missing full name rejected', sandbox.registerUser('', 'a@b.com', 'Dept').success, false);
  eq('missing email rejected', sandbox.registerUser('A', '', 'Dept').success, false);
  eq('invalid email rejected', sandbox.registerUser('A', 'not-an-email', 'Dept').success, false);
  eq('missing department rejected', sandbox.registerUser('A', 'a@b.com', '').success, false);

  sandbox.registerUser('A', 'dup@b.com', 'Dept');
  const dup = sandbox.registerUser('A2', 'dup@b.com', 'Dept2');
  eq('duplicate email rejected', dup.success, false);
}

console.log('\n── verifyRegistrationEmail() ──');
{
  const { sandbox, sentEmails } = newIdentitySandbox();
  sandbox.registerUser('Alice Reyes', 'alice@example.com', 'Training');
  const code = extractCode(sentEmails[0].body);

  const wrong = sandbox.verifyRegistrationEmail('alice@example.com', '000000' === code ? '111111' : '000000');
  check('wrong code rejected', wrong.success === false, JSON.stringify(wrong));

  const found1 = sandbox._identity_findUserByEmail_('alice@example.com');
  check('status unchanged after wrong code', found1.user.accountStatus === 'PENDING_VERIFICATION');

  const right = sandbox.verifyRegistrationEmail('alice@example.com', code);
  check('correct code accepted', right.success === true, JSON.stringify(right));

  const found2 = sandbox._identity_findUserByEmail_('alice@example.com');
  check('status now PENDING_APPROVAL', found2.user.accountStatus === 'PENDING_APPROVAL');

  const verifSheet = sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('IDENTITY_VERIFICATIONS');
  eq('verification row consumed (deleted) after success', sandbox._identity_readAll_(verifSheet).length, 0);

  const reuse = sandbox.verifyRegistrationEmail('alice@example.com', code);
  check('the same code cannot be replayed after success', reuse.success === false, JSON.stringify(reuse));
}

console.log('\n── verifyRegistrationEmail() attempt lockout ──');
{
  const { sandbox, sentEmails } = newIdentitySandbox();
  sandbox.registerUser('Bob', 'bob@example.com', 'Ops');
  const code = extractCode(sentEmails[0].body);
  const wrongCode = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) sandbox.verifyRegistrationEmail('bob@example.com', wrongCode);
  const stillLocked = sandbox.verifyRegistrationEmail('bob@example.com', code); // correct code, but attempts exhausted
  check('correct code rejected once max attempts exceeded (fails closed)', stillLocked.success === false, JSON.stringify(stillLocked));
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── registration approval — permission-gated, fails closed ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();

  // Register + verify a registrant, reaching PENDING_APPROVAL.
  sandbox.registerUser('Carol', 'carol@example.com', 'Ops');
  let code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail('carol@example.com', code);
  const carol = sandbox._identity_findUserByEmail_('carol@example.com').user;

  // No current SVMI identity at all (Session email matches nobody) — every admin op must fail.
  state.email = 'nobody@example.com';
  const rejectedNoIdentity = sandbox.approveRegistration(carol.userId);
  check('approveRegistration() fails with no linked identity at all', rejectedNoIdentity.success === false, JSON.stringify(rejectedNoIdentity));

  // A real, ACTIVE, but permission-less user (plain USER role, no REGISTRATION_APPROVE) must also fail.
  sandbox._identity_ensureSeeds_();
  sandbox.registerUser('Dave', 'dave@example.com', 'Ops');
  code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail('dave@example.com', code);
  const dave = sandbox._identity_findUserByEmail_('dave@example.com').user;
  sandbox._identity_transitionStatus_(dave.userId, 'ACTIVE', '', 'test setup'); // bypass approval flow directly for setup only
  sandbox._identity_ensureSheet_('IDENTITY_USER_ROLES', ['User ID', 'Role ID', 'Granted At', 'Granted By']).appendRow([dave.userId, 'USER', new Date(), '']);

  state.email = 'dave@example.com';
  const rejectedNoPermission = sandbox.approveRegistration(carol.userId);
  check('approveRegistration() fails for an ACTIVE user with no REGISTRATION_APPROVE permission', rejectedNoPermission.success === false, JSON.stringify(rejectedNoPermission));

  const stillPending = sandbox._identity_findUserById_(carol.userId).user;
  check('rejected approval attempt left the target unchanged', stillPending.accountStatus === 'PENDING_APPROVAL');

  // A real admin (ADMIN role, seeded with REGISTRATION_APPROVE via role_permissions) succeeds.
  sandbox.registerUser('AdminA', 'admin@example.com', 'IT');
  code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail('admin@example.com', code);
  const adminUser = sandbox._identity_findUserByEmail_('admin@example.com').user;
  sandbox._identity_transitionStatus_(adminUser.userId, 'ACTIVE', '', 'test setup');
  sandbox._identity_ensureSheet_('IDENTITY_USER_ROLES', ['User ID', 'Role ID', 'Granted At', 'Granted By']).appendRow([adminUser.userId, 'ADMIN', new Date(), '']);

  state.email = 'admin@example.com';
  const approved = sandbox.approveRegistration(carol.userId);
  check('approveRegistration() succeeds for a real ADMIN-role actor', approved.success === true, JSON.stringify(approved));

  const carolNow = sandbox._identity_findUserById_(carol.userId).user;
  eq('carol is now ACTIVE', carolNow.accountStatus, 'ACTIVE');

  // Invalid transition: cannot approve someone still in PENDING_VERIFICATION.
  sandbox.registerUser('Eve', 'eve@example.com', 'Ops');
  const eve = sandbox._identity_findUserByEmail_('eve@example.com').user;
  const invalidTransition = sandbox.approveRegistration(eve.userId);
  check('approveRegistration() refuses PENDING_VERIFICATION -> ACTIVE (must go through PENDING_APPROVAL first)', invalidTransition.success === false, JSON.stringify(invalidTransition));

  const rawAudit = sandbox._identity_readAll_(sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('IDENTITY_AUDIT'));
  check('REGISTRATION_APPROVED audit event recorded', rawAudit.some(r => r[2] === 'REGISTRATION_APPROVED' && r[4] === carol.userId));
}

console.log('\n── rejectRegistration() — terminal, no re-approval ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  sandbox._identity_ensureSeeds_();
  sandbox.registerUser('AdminA', 'admin@example.com', 'IT');
  let code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail('admin@example.com', code);
  const adminUser = sandbox._identity_findUserByEmail_('admin@example.com').user;
  sandbox._identity_transitionStatus_(adminUser.userId, 'ACTIVE', '', 'test setup');
  sandbox._identity_ensureSheet_('IDENTITY_USER_ROLES', ['User ID', 'Role ID', 'Granted At', 'Granted By']).appendRow([adminUser.userId, 'ADMIN', new Date(), '']);

  sandbox.registerUser('Frank', 'frank@example.com', 'Ops');
  code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail('frank@example.com', code);
  const frank = sandbox._identity_findUserByEmail_('frank@example.com').user;

  state.email = 'admin@example.com';
  const rejected = sandbox.rejectRegistration(frank.userId, 'duplicate account');
  check('rejectRegistration() succeeds for an admin', rejected.success === true, JSON.stringify(rejected));
  eq('frank is now REJECTED', sandbox._identity_findUserById_(frank.userId).user.accountStatus, 'REJECTED');

  const reApprove = sandbox.approveRegistration(frank.userId);
  check('REJECTED is terminal — cannot later approve', reApprove.success === false, JSON.stringify(reApprove));
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── role / permission / scope assignment ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  sandbox._identity_ensureSeeds_();

  sandbox.registerUser('AdminA', 'admin@example.com', 'IT');
  let code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail('admin@example.com', code);
  const adminUser = sandbox._identity_findUserByEmail_('admin@example.com').user;
  sandbox._identity_transitionStatus_(adminUser.userId, 'ACTIVE', '', 'test setup');
  sandbox._identity_ensureSheet_('IDENTITY_USER_ROLES', ['User ID', 'Role ID', 'Granted At', 'Granted By']).appendRow([adminUser.userId, 'ADMIN', new Date(), '']);

  sandbox.registerUser('Grace', 'grace@example.com', 'Ops');
  code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail('grace@example.com', code);
  const grace = sandbox._identity_findUserByEmail_('grace@example.com').user;
  sandbox._identity_transitionStatus_(grace.userId, 'ACTIVE', '', 'test setup');

  // Non-admin (Grace, no roles yet) cannot assign roles to herself or anyone.
  state.email = 'grace@example.com';
  const selfEscalate = sandbox.assignRole(grace.userId, 'ADMIN', true);
  check('a permission-less ACTIVE user cannot grant itself a role (no self-escalation)', selfEscalate.success === false, JSON.stringify(selfEscalate));

  // Admin grants Grace the USER role.
  state.email = 'admin@example.com';
  const grant = sandbox.assignRole(grace.userId, 'USER', true);
  check('admin grants USER role', grant.success === true, JSON.stringify(grant));
  eq('effective permissions for a plain USER are empty (USER seeded with none)', sandbox._identity_getUserPermissions_(grace.userId), []);

  // Admin grants Grace a DIRECT permission beyond her role.
  const directGrant = sandbox.assignPermissions(grace.userId, 'IDENTITY_AUDIT_VIEW', true);
  check('admin grants a direct permission', directGrant.success === true, JSON.stringify(directGrant));
  check('effective permissions now include the direct grant (additive to role)', sandbox._identity_getUserPermissions_(grace.userId).indexOf('IDENTITY_AUDIT_VIEW') !== -1);

  // Grace can now use exactly that one permission — no more, no less.
  state.email = 'grace@example.com';
  const graceCanViewAudit = sandbox.identityAudit_list();
  check('Grace can now view the audit log (permission she was actually granted)', graceCanViewAudit.success === true, JSON.stringify(graceCanViewAudit));
  const graceCannotApprove = sandbox.approveRegistration(grace.userId);
  check('Grace still cannot approve registrations (permission she was NOT granted)', graceCannotApprove.success === false, JSON.stringify(graceCannotApprove));

  // Revoke the direct permission; Grace loses it again.
  state.email = 'admin@example.com';
  sandbox.assignPermissions(grace.userId, 'IDENTITY_AUDIT_VIEW', false);
  check('revoked direct permission no longer in effective set', sandbox._identity_getUserPermissions_(grace.userId).indexOf('IDENTITY_AUDIT_VIEW') === -1);

  // Scope assignment.
  const scopeGrant = sandbox.assignScope(grace.userId, 'REGION', 'NCR', true);
  check('admin grants a REGION scope', scopeGrant.success === true, JSON.stringify(scopeGrant));
  const badScope = sandbox.assignScope(grace.userId, 'REGION', '', true);
  check('REGION scope requires a non-blank scopeValue', badScope.success === false, JSON.stringify(badScope));
  const scopeSheet = sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('IDENTITY_USER_SCOPE');
  check('exactly one scope row exists for Grace', sandbox._identity_readAll_(scopeSheet).filter(r => r[0] === grace.userId).length === 1);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── suspend / reactivate / disable ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  sandbox._identity_ensureSeeds_();
  sandbox.registerUser('AdminA', 'admin@example.com', 'IT');
  let code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail('admin@example.com', code);
  const adminUser = sandbox._identity_findUserByEmail_('admin@example.com').user;
  sandbox._identity_transitionStatus_(adminUser.userId, 'ACTIVE', '', 'test setup');
  sandbox._identity_ensureSheet_('IDENTITY_USER_ROLES', ['User ID', 'Role ID', 'Granted At', 'Granted By']).appendRow([adminUser.userId, 'ADMIN', new Date(), '']);

  sandbox.registerUser('Hank', 'hank@example.com', 'Ops');
  code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail('hank@example.com', code);
  const hank = sandbox._identity_findUserByEmail_('hank@example.com').user;
  sandbox._identity_transitionStatus_(hank.userId, 'ACTIVE', '', 'test setup');

  state.email = 'admin@example.com';
  const suspend = sandbox.suspendAccount(hank.userId, 'policy violation');
  check('admin suspends account', suspend.success === true, JSON.stringify(suspend));
  eq('hank is SUSPENDED', sandbox._identity_findUserById_(hank.userId).user.accountStatus, 'SUSPENDED');

  const reactivate = sandbox.reactivateAccount(hank.userId, 'resolved');
  check('admin reactivates account', reactivate.success === true, JSON.stringify(reactivate));
  eq('hank is ACTIVE again', sandbox._identity_findUserById_(hank.userId).user.accountStatus, 'ACTIVE');

  const disable = sandbox.disableAccount(hank.userId, 'offboarded');
  check('admin disables account', disable.success === true, JSON.stringify(disable));
  eq('hank is DISABLED', sandbox._identity_findUserById_(hank.userId).user.accountStatus, 'DISABLED');

  const reactivateDisabled = sandbox.reactivateAccount(hank.userId, 'oops');
  check('DISABLED is terminal — cannot reactivate from it', reactivateDisabled.success === false, JSON.stringify(reactivateDisabled));
}

console.log('\n── handleExternalIdentityDisabled() — offboarding hook ──');
{
  const { sandbox } = newIdentitySandbox();
  sandbox._identity_ensureSeeds_();
  const usersSheet = sandbox._identity_ensureSheet_('IDENTITY_USERS', ['User ID','Full Name','Email','Department','Account Status','Auth Provider','Auth Subject','Email Verified At','Created At','Last Seen At','Status Changed At','Status Changed By']);
  usersSheet.appendRow(['USR-1', 'Ivy', 'ivy@example.com', 'Ops', 'ACTIVE', 'google', 'ivy-google-sub', new Date(), new Date(), '', new Date(), '']);
  const result = sandbox.handleExternalIdentityDisabled('google', 'ivy-google-sub');
  check('external disablement hook disables the matching account', result.success === true, JSON.stringify(result));
  eq('ivy is now DISABLED', sandbox._identity_findUserById_('USR-1').user.accountStatus, 'DISABLED');

  const noMatch = sandbox.handleExternalIdentityDisabled('google', 'no-such-subject');
  check('no matching account -> fails, not silently ignored', noMatch.success === false, JSON.stringify(noMatch));
}

// ═══════════════════════════════════════════════════════════════
console.log('\n── MFA (TOTP) foundation ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  sandbox.registerUser('Judy', 'judy@example.com', 'Ops');
  const code = extractCode(sentEmails[0].body);
  sandbox.verifyRegistrationEmail('judy@example.com', code);
  const judy = sandbox._identity_findUserByEmail_('judy@example.com').user;

  const notActiveYet = sandbox.enrollMfa();
  check('enrollMfa() refuses a non-ACTIVE account', notActiveYet.success === false, JSON.stringify(notActiveYet));

  sandbox._identity_transitionStatus_(judy.userId, 'ACTIVE', '', 'test setup');
  state.email = 'judy@example.com';

  const enrollment = sandbox.enrollMfa();
  check('enrollMfa() succeeds for an ACTIVE user and returns a secret exactly once', enrollment.success === true && !!enrollment.secret, JSON.stringify(enrollment));
  check('otpauth URI references the secret and the account email', enrollment.otpauthUri.indexOf(enrollment.secret) !== -1 && enrollment.otpauthUri.indexOf(encodeURIComponent('judy@example.com')) !== -1);

  const wrongMfaCode = sandbox.verifyMfa('000000');
  check('wrong TOTP code rejected', wrongMfaCode.success === false, JSON.stringify(wrongMfaCode));

  const validCode = sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000));
  const rightMfa = sandbox.verifyMfa(validCode);
  check('correct TOTP code (as a real authenticator app would generate) accepted', rightMfa.success === true, JSON.stringify(rightMfa));

  const state1 = sandbox.getAccessState();
  check('getAccessState() reports mfaEnrolled true after successful verification', state1.mfaEnrolled === true, JSON.stringify(state1));

  // Clock-drift tolerance: a code from one step (30s) in the past still verifies.
  const pastStepCode = sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000) - 30);
  const driftOk = sandbox.verifyMfa(pastStepCode);
  check('a code from one time-step ago still verifies (clock-drift tolerance)', driftOk.success === true, JSON.stringify(driftOk));

  // Reset flow.
  const reset = sandbox.enrollMfa();
  check('re-enrolling (reset) generates a new secret', reset.secret !== enrollment.secret);
  const state2 = sandbox.getAccessState();
  check('MFA reverts to not-enrolled until the new secret is verified', state2.mfaEnrolled === false, JSON.stringify(state2));
}

console.log('\n── audit log never contains a secret value ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  sandbox.registerUser('Karl', 'karl@example.com', 'Ops');
  const code = extractCode(sentEmails[0].body);
  sandbox.verifyRegistrationEmail('karl@example.com', code);
  const karl = sandbox._identity_findUserByEmail_('karl@example.com').user;
  sandbox._identity_transitionStatus_(karl.userId, 'ACTIVE', '', 'test setup');
  state.email = 'karl@example.com';
  const enrollment = sandbox.enrollMfa();
  const validCode = sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000));
  sandbox.verifyMfa(validCode);

  const rawAudit = sandbox._identity_readAll_(sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('IDENTITY_AUDIT'));
  const allDetails = rawAudit.map(r => String(r[5] || '')).join(' | ');
  check('the verification code never appears in any audit "details" field', allDetails.indexOf(code) === -1, allDetails);
  check('the MFA secret never appears in any audit "details" field', allDetails.indexOf(enrollment.secret) === -1, allDetails);
}

console.log('\n── getCurrentUser() / getAccessState() ──');
{
  const { sandbox, state } = newIdentitySandbox();
  state.email = 'unregistered@example.com';
  const noAccount = sandbox.getCurrentUser();
  eq('unregistered Google account -> linked:false', noAccount.linked, false);
  const noAccountState = sandbox.getAccessState();
  eq('unregistered -> status NO_ACCOUNT', noAccountState.status, 'NO_ACCOUNT');
  eq('unregistered -> isActive false', noAccountState.isActive, false);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
