// ============================================================
// SVMKPI_IDENTITY_ACCESS.gs
// Phase 1H-C — getCurrentUser() / getAccessState(): the read side of the
// provider-neutral authentication boundary (D-015/D-016/D-024).
// ------------------------------------------------------------
// Both functions are informational only — they tell the CALLING browser
// what it may see/hide for its own UI convenience. Neither is, or is
// ever treated as, the actual authorization boundary: every mutating
// identity-admin function (SVMKPI_IDENTITY_ADMIN.gs) re-resolves the
// actor's permissions itself from _identity_currentUserHasPermission_(),
// exactly like the pre-existing sl_isAdmin() pattern this phase does not
// touch (D-025).
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
 * convenience only; it grants nothing by itself.
 * @returns {{
 *   status: 'NO_ACCOUNT'|'PENDING_VERIFICATION'|'PENDING_APPROVAL'|'ACTIVE'|'SUSPENDED'|'DISABLED'|'REJECTED',
 *   isActive: boolean,
 *   mfaRequired: boolean,
 *   mfaEnrolled: boolean,
 *   roles: string[],
 *   permissions: string[]
 * }}
 */
function getAccessState() {
  const record = _identity_currentUserRecord_();
  if (!record) {
    return { status: 'NO_ACCOUNT', isActive: false, mfaRequired: true, mfaEnrolled: false, roles: [], permissions: [] };
  }

  const isActive = record.accountStatus === IDENTITY_STATUS.ACTIVE;

  const mfaSheet = _identity_ensureSheet_(IDENTITY_SHEET.MFA, IDENTITY_HEADERS.MFA);
  const mfaRow = _identity_readAll_(mfaSheet).find(r => String(r[0]) === String(record.userId));
  const mfaEnrolled = !!mfaRow && mfaRow[1] === 'ENROLLED';

  const userRolesSheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_ROLES, IDENTITY_HEADERS.USER_ROLES);
  const roles = _identity_readAll_(userRolesSheet).filter(r => String(r[0]) === String(record.userId)).map(r => String(r[1]));

  return {
    status: record.accountStatus,
    isActive: isActive,
    // MFA is required for all ACTIVE users (approved scope) — reported
    // true even before ACTIVE so the frontend can prompt enrollment
    // proactively, but isActive is what every server-side check
    // actually gates on, not this flag.
    mfaRequired: true,
    mfaEnrolled: mfaEnrolled,
    roles: isActive ? roles : [],
    permissions: isActive ? _identity_getUserPermissions_(record.userId) : [],
  };
}
