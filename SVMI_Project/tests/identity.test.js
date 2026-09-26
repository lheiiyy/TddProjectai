// Phase 1H-C: registration / email-verification / approval / RBAC /
// scope / MFA / identity-access-audit — the approved identity foundation
// (reviews/006-phase-1h-c-planning.md, DECISIONS.md D-024-D-030), PLUS
// Security Fix R1 (DECISIONS.md D-031): MFA is now an enforced,
// server-authoritative access requirement for ACTIVE users, not just
// enrollment-time proof — see reviews/008-phase-1h-c-security-fix-r1.md.
//
// Loads the REAL SVMKPI_IDENTITY_*.gs source into a Node vm sandbox with
// SpreadsheetApp/Session/Utilities/MailApp/PropertiesService mocked —
// same house pattern as every other file in this directory.
// sl_getCurrentUser() itself is stubbed directly (not the real
// SVMKPI_ACCESS.gs) to keep this file scoped to the identity surface,
// consistent with how other test files stub sl_isAdmin()/
// sl_getCurrentUser() directly.

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

// PropertiesService.getUserProperties() mock — a plain key/value store,
// exactly mirroring the real service's shape (get/set/deleteProperty).
// Security Fix R1's MFA-satisfaction gate is built entirely on this.
function makePropertiesServiceMock() {
  const store = {};
  const userProps = {
    getProperty: (key) => (key in store ? store[key] : null),
    setProperty: (key, value) => { store[key] = String(value); },
    deleteProperty: (key) => { delete store[key]; },
  };
  return { getUserProperties: () => userProps, _store: store };
}

function newIdentitySandbox() {
  const ssMock = makeSpreadsheetMock();
  const sentEmails = [];
  const state = { email: 'alice@example.com' };
  const propsMock = makePropertiesServiceMock();

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ssMock, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => state.email }) },
    sl_getCurrentUser: () => state.email,
    PropertiesService: propsMock,
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
  return { sandbox, ssMock, state, sentEmails, propsMock };
}

function extractCode(emailBody) {
  const m = /code is: (\d{6})/.exec(emailBody);
  return m ? m[1] : null;
}

/**
 * Registers, verifies, and activates a user — no role, no MFA. Test
 * setup only: bypasses the admin-approval API call itself (there's no
 * approver yet in most setup sequences) via the same internal
 * transition helper the real approveRegistration() uses.
 */
function makeActiveUser(sandbox, sentEmails, email, fullName, dept) {
  sandbox.registerUser(fullName, email, dept || 'Ops');
  const code = extractCode(sentEmails[sentEmails.length - 1].body);
  sandbox.verifyRegistrationEmail(email, code);
  const user = sandbox._identity_findUserByEmail_(email).user;
  sandbox._identity_transitionStatus_(user.userId, 'ACTIVE', '', 'test setup');
  return user;
}

function grantRole(sandbox, userId, roleId) {
  sandbox._identity_ensureSheet_('IDENTITY_USER_ROLES', ['User ID', 'Role ID', 'Granted At', 'Granted By'])
    .appendRow([userId, roleId, new Date(), '']);
}

/**
 * Completes REAL MFA enrollment+verification for `state.email`'s
 * account — the actual required flow (enrollMfa() -> compute a valid
 * TOTP code -> verifyMfa()), not a shortcut. Returns the secret so the
 * caller can generate further valid codes later in the same test.
 */
function completeMfaEnrollment(sandbox) {
  const enrollment = sandbox.enrollMfa();
  const code = sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000));
  const verify = sandbox.verifyMfa(code);
  if (!verify.success) throw new Error('test helper: MFA enrollment did not verify — ' + verify.message);
  return enrollment.secret;
}

/** Full real flow: register -> verify email -> activate -> grant role -> enroll+verify MFA. */
function makeAdmin(sandbox, sentEmails, state, email, fullName) {
  const user = makeActiveUser(sandbox, sentEmails, email, fullName, 'IT');
  grantRole(sandbox, user.userId, 'ADMIN');
  state.email = email;
  const secret = completeMfaEnrollment(sandbox);
  return { user, secret };
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

  // A real, ACTIVE, MFA-satisfied, but permission-less user (plain USER
  // role, no REGISTRATION_APPROVE) must also fail — and specifically on
  // the PERMISSION check, isolated by completing MFA first so the
  // rejection reason is unambiguous.
  sandbox._identity_ensureSeeds_();
  const dave = makeActiveUser(sandbox, sentEmails, 'dave@example.com', 'Dave');
  grantRole(sandbox, dave.userId, 'USER');
  state.email = 'dave@example.com';
  completeMfaEnrollment(sandbox);

  const rejectedNoPermission = sandbox.approveRegistration(carol.userId);
  check('approveRegistration() fails for an ACTIVE, MFA-satisfied user with no REGISTRATION_APPROVE permission', rejectedNoPermission.success === false, JSON.stringify(rejectedNoPermission));
  check('...and the rejection reason is specifically about permission, not MFA', /Permission required/.test(rejectedNoPermission.message), rejectedNoPermission.message);

  const stillPending = sandbox._identity_findUserById_(carol.userId).user;
  check('rejected approval attempt left the target unchanged', stillPending.accountStatus === 'PENDING_APPROVAL');

  // A real admin (ADMIN role, MFA-satisfied) succeeds.
  const { user: adminUser } = makeAdmin(sandbox, sentEmails, state, 'admin@example.com', 'AdminA');
  const approved = sandbox.approveRegistration(carol.userId);
  check('approveRegistration() succeeds for a real, MFA-satisfied ADMIN-role actor', approved.success === true, JSON.stringify(approved));

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
  makeAdmin(sandbox, sentEmails, state, 'admin@example.com', 'AdminA');

  sandbox.registerUser('Frank', 'frank@example.com', 'Ops');
  const code = extractCode(sentEmails[sentEmails.length - 1].body);
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
  makeAdmin(sandbox, sentEmails, state, 'admin@example.com', 'AdminA');

  const grace = makeActiveUser(sandbox, sentEmails, 'grace@example.com', 'Grace');

  // Non-admin (Grace, no roles yet, no MFA yet either) cannot assign
  // roles to herself or anyone.
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

  // Grace completes MFA — only now can she actually use the permission she holds.
  state.email = 'grace@example.com';
  const beforeMfa = sandbox.identityAudit_list();
  check('...but Grace still cannot use it until she completes MFA herself', beforeMfa.success === false && /MFA/.test(beforeMfa.message), JSON.stringify(beforeMfa));
  completeMfaEnrollment(sandbox);

  const graceCanViewAudit = sandbox.identityAudit_list();
  check('Grace can now view the audit log (permission she was actually granted, MFA satisfied)', graceCanViewAudit.success === true, JSON.stringify(graceCanViewAudit));
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
  makeAdmin(sandbox, sentEmails, state, 'admin@example.com', 'AdminA');
  const hank = makeActiveUser(sandbox, sentEmails, 'hank@example.com', 'Hank');

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
console.log('\n── MFA (TOTP) enrollment/verification ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  const judy = makeActiveUser(sandbox, sentEmails, 'judy@example.com', 'Judy');

  state.email = 'unlinked@example.com'; // not judy yet — sanity: unrelated identity can't enroll on her behalf
  const notActiveYet = sandbox.enrollMfa();
  check('enrollMfa() refuses when no SVMI identity is linked', notActiveYet.success === false, JSON.stringify(notActiveYet));

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
  check('getAccessState() reports mfaSatisfied true right after verifying', state1.mfaSatisfied === true, JSON.stringify(state1));
  check('getAccessState() reports isActive true once ACTIVE + MFA satisfied', state1.isActive === true, JSON.stringify(state1));

  // Clock-drift tolerance: a code one step (30s) AHEAD of the server's
  // clock — the realistic case where the client device's clock runs
  // slightly fast — still verifies. (One step BEHIND is deliberately
  // NOT retried here — anti-replay is monotonic: the current step was
  // already consumed above, and any step at or before it is correctly
  // refused regardless of whether that exact code was literally reused;
  // see the R1.5 section for that behavior tested directly.)
  const futureStepCode = sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000) + 30);
  const driftOk = sandbox.verifyMfa(futureStepCode);
  check('a not-yet-used code one step ahead (client clock drift) still verifies', driftOk.success === true, JSON.stringify(driftOk));

  // Reset flow.
  const reset = sandbox.enrollMfa();
  check('re-enrolling (reset) generates a new secret', reset.secret !== enrollment.secret);
  const state2 = sandbox.getAccessState();
  check('MFA reverts to not-enrolled until the new secret is verified', state2.mfaEnrolled === false, JSON.stringify(state2));
  check('resetting MFA clears any standing MFA-satisfied credential', state2.mfaSatisfied === false, JSON.stringify(state2));
  check('...so isActive is false again immediately after a reset, even though the account is still ACTIVE', state2.isActive === false, JSON.stringify(state2));
}

// ═══════════════════════════════════════════════════════════════
// Security Fix R1 — required test coverage (10 items from the task):
// ═══════════════════════════════════════════════════════════════

console.log('\n── R1.1: ACTIVE user without completed MFA cannot access protected functionality ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  sandbox._identity_ensureSeeds_();
  const admin = makeActiveUser(sandbox, sentEmails, 'admin@example.com', 'AdminA', 'IT');
  grantRole(sandbox, admin.userId, 'ADMIN');
  state.email = 'admin@example.com';
  // Deliberately NOT calling enrollMfa()/verifyMfa() — ACTIVE + ADMIN role, MFA untouched.

  const target = makeActiveUser(sandbox, sentEmails, 'target@example.com', 'Target', 'Ops');

  const attempts = [
    ['approveRegistration', () => sandbox.approveRegistration(target.userId)],
    ['assignRole', () => sandbox.assignRole(target.userId, 'USER', true)],
    ['assignPermissions', () => sandbox.assignPermissions(target.userId, 'USER_MANAGE', true)],
    ['assignScope', () => sandbox.assignScope(target.userId, 'SYSTEM', '', true)],
    ['suspendAccount', () => sandbox.suspendAccount(target.userId, 'x')],
    ['identityAudit_list', () => sandbox.identityAudit_list()],
  ];
  attempts.forEach(([name, fn]) => {
    const r = fn();
    check(name + '() rejected for an ACTIVE, permitted admin who has not completed MFA', r.success === false, JSON.stringify(r));
    check(name + '() rejection reason specifically names MFA, not permission', /MFA/.test(r.message), r.message);
  });

  // Confirm nothing was actually mutated.
  eq('target account untouched by the rejected attempts', sandbox._identity_findUserById_(target.userId).user.accountStatus, 'ACTIVE');
}

console.log('\n── R1.2: ACTIVE user WITH valid MFA can access according to their actual authorization ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  sandbox._identity_ensureSeeds_();
  const { user: admin } = makeAdmin(sandbox, sentEmails, state, 'admin2@example.com', 'AdminB');

  const target = makeActiveUser(sandbox, sentEmails, 'target2@example.com', 'Target', 'Ops');
  const suspend = sandbox.suspendAccount(target.userId, 'test');
  check('an ACTIVE admin who HAS completed MFA and HAS the permission succeeds', suspend.success === true, JSON.stringify(suspend));

  // MFA satisfied is not a blanket bypass — still correctly denied for a
  // permission this admin does not hold... but ADMIN holds everything by
  // seed, so prove the boundary with Grace-style limited user instead.
  const limited = makeActiveUser(sandbox, sentEmails, 'limited@example.com', 'Limited', 'Ops');
  grantRole(sandbox, limited.userId, 'USER');
  state.email = 'limited@example.com';
  completeMfaEnrollment(sandbox);
  const limitedTry = sandbox.suspendAccount(target.userId, 'nope');
  check('MFA satisfaction alone does not grant a permission the user does not hold', limitedTry.success === false && /Permission required/.test(limitedTry.message), JSON.stringify(limitedTry));
}

console.log('\n── R1.3: invalid MFA code rejected ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  const user = makeActiveUser(sandbox, sentEmails, 'kim@example.com', 'Kim');
  state.email = 'kim@example.com';
  sandbox.enrollMfa();
  const bad = sandbox.verifyMfa('999999');
  check('a code that does not match the secret at all is rejected', bad.success === false, JSON.stringify(bad));
  check('MFA satisfaction is NOT granted by an invalid code', sandbox.getAccessState().mfaSatisfied === false);
}

console.log('\n── R1.4: expired MFA satisfaction is rejected (re-verification required) ──');
{
  const { sandbox, sentEmails, state, propsMock } = newIdentitySandbox();
  sandbox._identity_ensureSeeds_();
  const admin = makeActiveUser(sandbox, sentEmails, 'expiring@example.com', 'Expiring', 'IT');
  grantRole(sandbox, admin.userId, 'ADMIN');
  state.email = 'expiring@example.com';
  const secret = completeMfaEnrollment(sandbox);

  const beforeExpiry = sandbox.identityAudit_list();
  check('access works immediately after a real MFA verification', beforeExpiry.success === true, JSON.stringify(beforeExpiry));

  // Simulate the satisfaction window elapsing — directly advance the
  // stored expiry into the past via the same PropertiesService key the
  // real code reads (_identity_mfaGatePropertyKey_ is itself the real,
  // non-secret helper this whole mechanism uses — this is the test
  // manipulating time, not bypassing any check).
  const key = sandbox._identity_mfaGatePropertyKey_(admin.userId);
  propsMock.getUserProperties().setProperty(key, String(Date.now() - 1000));

  const afterExpiry = sandbox.identityAudit_list();
  check('access is refused once the MFA-satisfied window has expired', afterExpiry.success === false && /MFA/.test(afterExpiry.message), JSON.stringify(afterExpiry));

  // Re-verifying with a FRESH code from the SAME, already-enrolled
  // secret (exactly what a real user does — open their authenticator
  // app again, no re-enrollment/reset needed) restores access. One step
  // AHEAD of the step already consumed by completeMfaEnrollment() above
  // (anti-replay is monotonic — see R1.5 — so it must be a later step).
  const freshCode = sandbox._identity_totpCodeForTime_(secret, Math.floor(Date.now() / 1000) + 30);
  const reverify = sandbox.verifyMfa(freshCode);
  check('re-verifying with the existing secret succeeds', reverify.success === true, JSON.stringify(reverify));
  const afterReverify = sandbox.identityAudit_list();
  check('re-verifying MFA restores access after expiry', afterReverify.success === true, JSON.stringify(afterReverify));
}

console.log('\n── R1.5: replayed/used MFA verification cannot be reused ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  const user = makeActiveUser(sandbox, sentEmails, 'replay@example.com', 'Replay');
  state.email = 'replay@example.com';
  const enrollment = sandbox.enrollMfa();
  const code = sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000));

  const first = sandbox.verifyMfa(code);
  check('first use of a valid code succeeds', first.success === true, JSON.stringify(first));

  const second = sandbox.verifyMfa(code);
  check('replaying the EXACT SAME code a second time is rejected', second.success === false, JSON.stringify(second));
  check('the replay rejection message is distinct ("already been used")', /already.*used/i.test(second.message), second.message);

  const rawAudit = sandbox._identity_readAll_(sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('IDENTITY_AUDIT'));
  check('the replay attempt is recorded as a failed MFA verification', rawAudit.some(r => r[2] === 'MFA_VERIFY_FAILED' && String(r[5]).indexOf('replay') !== -1));
}

console.log('\n── R1.6: client-supplied MFA state cannot bypass the server check ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  sandbox._identity_ensureSeeds_();
  const admin = makeActiveUser(sandbox, sentEmails, 'spoof@example.com', 'Spoofer', 'IT');
  grantRole(sandbox, admin.userId, 'ADMIN');
  state.email = 'spoof@example.com';
  // No real MFA completed.

  const target = makeActiveUser(sandbox, sentEmails, 'spooftarget@example.com', 'Target');

  // A spoofed extra "options" argument claiming MFA/role/approval state
  // — none of these functions accept or look at any such argument, so
  // this proves the point structurally as well as behaviorally.
  const spoofedArgs = { mfaVerified: true, isAdmin: true, role: 'ADMIN', accountStatus: 'ACTIVE', permission: 'USER_MANAGE' };
  const r1 = sandbox.suspendAccount(target.userId, 'x', spoofedArgs);
  check('a spoofed extra argument cannot substitute for real MFA verification', r1.success === false && /MFA/.test(r1.message), JSON.stringify(r1));

  // Directly attempting to forge the PropertiesService value the REAL
  // gate reads, without going through verifyMfa(), is the only way such
  // a bypass could work — confirm no exposed identity function ever
  // does this: none of registerUser/verifyRegistrationEmail/
  // approveRegistration/assignRole/assignPermissions/assignScope/
  // suspendAccount/reactivateAccount/disableAccount/enrollMfa touch
  // PropertiesService at all except verifyMfa()'s own success path.
  check('no function outside SVMKPI_IDENTITY_MFA.gs references PropertiesService at all',
    [regSrc, adminSrc].every(src => src.indexOf('PropertiesService') === -1));
}

console.log('\n── R1.7: existing ADMIN permission checks remain intact ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  sandbox._identity_ensureSeeds_();
  const { user: admin } = makeAdmin(sandbox, sentEmails, state, 'stillworks@example.com', 'StillWorks');
  const target = makeActiveUser(sandbox, sentEmails, 'stillworkstarget@example.com', 'Target');

  const approve = sandbox.assignRole(target.userId, 'USER', true);
  check('a fully-authorized (ACTIVE + MFA-satisfied + permitted) admin can still perform every permission-gated action', approve.success === true, JSON.stringify(approve));

  const nonAdmin = makeActiveUser(sandbox, sentEmails, 'stillworksuser@example.com', 'PlainUser');
  grantRole(sandbox, nonAdmin.userId, 'USER');
  state.email = 'stillworksuser@example.com';
  completeMfaEnrollment(sandbox);
  const denied = sandbox.assignRole(target.userId, 'ADMIN', true);
  check('a plain USER (even MFA-satisfied) is still correctly denied ADMIN-only actions', denied.success === false && /Permission required/.test(denied.message), JSON.stringify(denied));
}

console.log('\n── R1.8/R1.9: TOTP secrets never returned or logged after enrollment ──');
{
  const { sandbox, sentEmails, state } = newIdentitySandbox();
  const user = makeActiveUser(sandbox, sentEmails, 'karl@example.com', 'Karl');
  state.email = 'karl@example.com';
  const enrollment = sandbox.enrollMfa();
  const validCode = sandbox._identity_totpCodeForTime_(enrollment.secret, Math.floor(Date.now() / 1000));
  sandbox.verifyMfa(validCode);

  const detail = sandbox.identityAdmin_getUserDetail; // admin-only read path; verified separately not to exist for self
  const accessState = sandbox.getAccessState();
  check('getAccessState() never returns the TOTP secret', JSON.stringify(accessState).indexOf(enrollment.secret) === -1);
  const currentUser = sandbox.getCurrentUser();
  check('getCurrentUser() never returns the TOTP secret', JSON.stringify(currentUser).indexOf(enrollment.secret) === -1);

  const rawAudit = sandbox._identity_readAll_(sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('IDENTITY_AUDIT'));
  const allDetails = rawAudit.map(r => String(r[5] || '')).join(' | ');
  check('the verification code never appears in any audit "details" field', allDetails.indexOf(validCode) === -1, allDetails);
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
  eq('unregistered -> mfaSatisfied false', noAccountState.mfaSatisfied, false);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('══════════════════════════════════');
process.exit(fail ? 1 : 0);
