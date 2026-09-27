// ============================================================
// SVMKPI_IDENTITY_ACCESS.gs
// Phase 1H-C — getCurrentUser() / getAccessState(): the read side of the
// provider-neutral authentication boundary (D-015/D-016/D-024).
// ------------------------------------------------------------
// Both functions are informational only — they tell the CALLING browser
// what it may see/hide for its own UI convenience. Neither is, or is
// ever treated as, the actual authorization boundary: every mutating
// identity-admin function (SVMKPI_IDENTITY_ADMIN.gs) re-resolves the
// actor's authorization itself from _identity_authorizeCurrentUser_(),
// exactly like the pre-existing sl_isAdmin() pattern this phase does not
// touch (D-025).
//
// Security Fix R1: getAccessState().isActive now requires a satisfied
// MFA credential, not just ACTIVE account status (D-031) — matching the
// server-side authorization gate this file's own comment already
// describes as authoritative.
// ============================================================

/**
 * getCurrentUser()
 * @returns {{
 *   googleEmail: string,
 *   linked: boolean,
 *   user?: {userId, fullName, email, department, accountStatus, createdAt}
 * }}
 * `linked` is false when the Google account that reached this
 * deployment has no matching IDENTITY_USERS row (never registered, or
 * registered with a different email — see D-025's disclosed limitation).
 */
function getCurrentUser() {
  const googleEmail = sl_getCurrentUser();
  const record = _identity_currentUserRecord_();
  if (!record) {
    return { googleEmail: googleEmail, linked: false };
  }
  return {
    googleEmail: googleEmail,
    linked: true,
    user: {
      userId: record.userId,
      fullName: record.fullName,
      email: record.email,
      department: record.department,
      accountStatus: record.accountStatus,
      createdAt: record.createdAt,
    },
  };
}

/**
 * getAccessState()
 * The single call the frontend uses to decide what to show — analogous
 * to the existing loadAdminStatus()/sl_isAdmin() pair, but for the new
 * identity surface. D-016: this describes CURRENT state for UI
 * convenience only; it grants nothing by itself — the real gate is
 * _identity_authorizeCurrentUser_(), re-checked server-side inside every
 * protected function, never this read-only snapshot.
 *
 * Security Fix R1: `isActive` now requires BOTH an ACTIVE account status
 * AND a satisfied MFA credential (D-031) — matching the approved
 * requirement literally ("only after successful MFA may the user
 * establish an authenticated SVMI access state"). `accountStatus` is
 * still reported separately/unfiltered so the UI can distinguish
 * "not yet ACTIVE" from "ACTIVE but MFA not yet completed this cycle."
 * @returns {{
 *   status: 'NO_ACCOUNT'|'PENDING_VERIFICATION'|'PENDING_APPROVAL'|'ACTIVE'|'SUSPENDED'|'DISABLED'|'REJECTED',
 *   accountStatus: string,
 *   isActive: boolean,
 *   mfaRequired: boolean,
 *   mfaEnrolled: boolean,
 *   mfaSatisfied: boolean,
 *   roles: string[],
 *   permissions: string[]
 * }}
 */
function getAccessState() {
  const record = _identity_currentUserRecord_();
  if (!record) {
    return { status: 'NO_ACCOUNT', accountStatus: 'NO_ACCOUNT', isActive: false, mfaRequired: true, mfaEnrolled: false, mfaSatisfied: false, roles: [], permissions: [] };
  }

  const accountActive = record.accountStatus === IDENTITY_STATUS.ACTIVE;

  const mfaSheet = _identity_ensureSheet_(IDENTITY_SHEET.MFA, IDENTITY_HEADERS.MFA);
  const mfaRow = _identity_readAll_(mfaSheet).find(r => String(r[0]) === String(record.userId));
  const mfaEnrolled = !!mfaRow && mfaRow[1] === 'ENROLLED';
  const mfaSatisfied = accountActive && _identity_hasSatisfiedMfa_(record.userId);

  // "Authenticated" now means both — an ACTIVE account that has not
  // (yet, or not currently) satisfied MFA is not treated as fully
  // authenticated for the purpose of this status field.
  const isActive = accountActive && mfaSatisfied;

  const userRolesSheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_ROLES, IDENTITY_HEADERS.USER_ROLES);
  const roles = _identity_readAll_(userRolesSheet).filter(r => String(r[0]) === String(record.userId)).map(r => String(r[1]));

  return {
    status: record.accountStatus,
    accountStatus: record.accountStatus,
    isActive: isActive,
    mfaRequired: true,
    mfaEnrolled: mfaEnrolled,
    mfaSatisfied: mfaSatisfied,
    roles: isActive ? roles : [],
    permissions: isActive ? _identity_getUserPermissions_(record.userId) : [],
  };
}
