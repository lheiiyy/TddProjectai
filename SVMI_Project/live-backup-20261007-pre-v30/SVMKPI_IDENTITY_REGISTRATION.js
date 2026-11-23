// ============================================================
// SVMKPI_IDENTITY_REGISTRATION.gs
// Phase 1H-C — registerUser() / verifyRegistrationEmail(): the
// self-service half of the approved registration flow (see
// reviews/006-phase-1h-c-planning.md):
//   registerUser() -> email OTP sent -> verifyRegistrationEmail()
//   -> PENDING_APPROVAL -> (SVMKPI_IDENTITY_ADMIN.gs) -> ACTIVE
// No self-service path reaches ACTIVE directly — approval is mandatory,
// enforced by IDENTITY_VALID_TRANSITIONS (SVMKPI_IDENTITY_CORE.gs), not
// by this file choosing not to call it.
// ============================================================

const IDENTITY_VERIFICATION_TTL_MINUTES = 15;
const IDENTITY_VERIFICATION_MAX_ATTEMPTS = 5;

const IDENTITY_VERIFICATIONS_COL = { USER_ID: 1, CODE_HASH: 2, EXPIRES_AT: 3, ATTEMPTS: 4 };

/**
 * registerUser(fullName, email, department)
 * Public — reachable by anyone who has already passed the pilot's outer
 * Google-sign-in + guest-password gate (D-025); no admin/approval check
 * here, since registering is exactly what an unapproved person is
 * allowed to do. Any syntactically valid email may register (D-024) —
 * not restricted to the visitor's own Google account email, though see
 * D-025 for why THIS pilot's getCurrentUser() still correlates by it.
 * @returns {{success:boolean, message:string, userId?:string}}
 */
function registerUser(fullName, email, department) {
  try {
    _identity_ensureSeeds_();

    const name = String(fullName || '').trim();
    const normalizedEmail = _identity_normalizeEmail_(email);
    const dept = String(department || '').trim();

    if (!name) return { success: false, message: 'Full name is required.' };
    if (!_identity_isValidEmail_(normalizedEmail)) return { success: false, message: 'A valid email address is required.' };
    if (!dept) return { success: false, message: 'Department is required.' };

    const existing = _identity_findUserByEmail_(normalizedEmail);
    if (existing) {
      // Never leak WHICH status blocks re-registration beyond what the
      // registrant needs to act on — but do distinguish "already
      // pending" (nothing to do) from "already active" (no action makes
      // sense) in a way that doesn't expose other people's data, since
      // this is the registrant's own email they just submitted.
      return { success: false, message: 'An account for this email already exists (status: ' + existing.user.accountStatus + ').' };
    }

    const userId = _identity_newUserId_();
    const usersSheet = _identity_ensureSheet_(IDENTITY_SHEET.USERS, IDENTITY_HEADERS.USERS);
    const now = new Date();
    usersSheet.appendRow([
      userId, name, normalizedEmail, dept, IDENTITY_STATUS.PENDING_VERIFICATION,
      'native', '', '', now, '', now, '',
    ]);

    _identity_issueVerificationCode_(userId, normalizedEmail, name);
    SpreadsheetApp.flush();

    _identity_writeAudit_(IDENTITY_AUDIT_EVENT.REGISTRATION_SUBMITTED, '', userId, 'email=' + normalizedEmail + '; department=' + dept);

    return { success: true, message: 'Registered. Check your email for a verification code.', userId: userId };
  } catch (e) {
    typeof logError === 'function' && logError('registerUser', e);
    return { success: false, message: e.message };
  }
}

function _identity_issueVerificationCode_(userId, email, fullName) {
  const code = _identity_generateVerificationCode_();
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.VERIFICATIONS, IDENTITY_HEADERS.VERIFICATIONS);
  const rows = _identity_readAll_(sheet);
  let rowNum = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][IDENTITY_VERIFICATIONS_COL.USER_ID - 1]) === String(userId)) { rowNum = i + 2; break; }
  }
  const expiresAt = new Date(Date.now() + IDENTITY_VERIFICATION_TTL_MINUTES * 60 * 1000);
  const codeHash = _identity_hash_(code);
  if (rowNum === -1) {
    sheet.appendRow([userId, codeHash, expiresAt, 0]);
  } else {
    sheet.getRange(rowNum, IDENTITY_VERIFICATIONS_COL.CODE_HASH).setValue(codeHash);
    sheet.getRange(rowNum, IDENTITY_VERIFICATIONS_COL.EXPIRES_AT).setValue(expiresAt);
    sheet.getRange(rowNum, IDENTITY_VERIFICATIONS_COL.ATTEMPTS).setValue(0);
  }

  // The ONLY place the plaintext code is ever transmitted — never
  // logged, never stored (only its hash is), never returned to
  // registerUser()'s own caller.
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'SVMI — verify your email',
      body: 'Hi ' + fullName + ',\n\nYour SVMI verification code is: ' + code +
        '\n\nThis code expires in ' + IDENTITY_VERIFICATION_TTL_MINUTES + ' minutes.\n\n' +
        'If you did not request this, ignore this email.',
    });
  } catch (e) {
    // Email delivery failure must not silently strand the registrant —
    // surfaced to the caller as part of registerUser()'s own try/catch.
    throw new Error('Could not send verification email: ' + e.message);
  }
}

/**
 * verifyRegistrationEmail(email, code)
 * Public. Fails closed on: no pending verification, expired code, wrong
 * code, or attempts exhausted (IDENTITY_VERIFICATION_MAX_ATTEMPTS) — the
 * registrant must re-register to get a fresh code past that point,
 * rather than this function silently reissuing one (avoids an
 * unauthenticated "regenerate code" surface).
 * @returns {{success:boolean, message:string}}
 */
function verifyRegistrationEmail(email, code) {
  try {
    const found = _identity_findUserByEmail_(email);
    if (!found || found.user.accountStatus !== IDENTITY_STATUS.PENDING_VERIFICATION) {
      return { success: false, message: 'No pending verification for this email.' };
    }

    const sheet = _identity_ensureSheet_(IDENTITY_SHEET.VERIFICATIONS, IDENTITY_HEADERS.VERIFICATIONS);
    const rows = _identity_readAll_(sheet);
    let rowNum = -1, record = null;
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][IDENTITY_VERIFICATIONS_COL.USER_ID - 1]) === String(found.user.userId)) {
        rowNum = i + 2; record = rows[i]; break;
      }
    }
    if (!record) return { success: false, message: 'No pending verification for this email.' };

    const attempts = Number(record[IDENTITY_VERIFICATIONS_COL.ATTEMPTS - 1]) || 0;
    if (attempts >= IDENTITY_VERIFICATION_MAX_ATTEMPTS) {
      return { success: false, message: 'Too many attempts. Register again to receive a new code.' };
    }
    const expiresAt = new Date(record[IDENTITY_VERIFICATIONS_COL.EXPIRES_AT - 1]);
    if (Date.now() > expiresAt.getTime()) {
      return { success: false, message: 'Verification code expired. Register again to receive a new code.' };
    }

    const submittedHash = _identity_hash_(String(code || '').trim());
    const storedHash = record[IDENTITY_VERIFICATIONS_COL.CODE_HASH - 1];
    if (submittedHash !== storedHash) {
      sheet.getRange(rowNum, IDENTITY_VERIFICATIONS_COL.ATTEMPTS).setValue(attempts + 1);
      SpreadsheetApp.flush();
      return { success: false, message: 'Incorrect verification code.' };
    }

    const transition = _identity_transitionStatus_(found.user.userId, IDENTITY_STATUS.PENDING_APPROVAL, found.user.userId, 'Email verified');
    if (!transition.success) return transition;

    found.sheet.getRange(found.rowNum, IDENTITY_USERS_COL.EMAIL_VERIFIED_AT).setValue(new Date());
    sheet.deleteRow(rowNum); // verification consumed — not left around for reuse
    SpreadsheetApp.flush();

    _identity_writeAudit_(IDENTITY_AUDIT_EVENT.EMAIL_VERIFIED, found.user.userId, found.user.userId, 'email verified, now PENDING_APPROVAL');

    return { success: true, message: 'Email verified. Your registration is now pending administrator approval.' };
  } catch (e) {
    typeof logError === 'function' && logError('verifyRegistrationEmail', e);
    return { success: false, message: e.message };
  }
}
