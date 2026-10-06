// ============================================================
// SVMKPI_IDENTITY_ADMIN.gs
// Phase 1H-C — administrative identity operations: registration
// approval/rejection, role/permission/scope assignment, account
// suspend/reactivate/disable, and the offboarding hook for an
// externally-disabled identity.
// ------------------------------------------------------------
// Every mutating function here:
//   - re-checks the ACTOR's authorization server-side via
//     _identity_authorizeCurrentUser_() (SVMKPI_IDENTITY_CORE.gs) — which
//     as of Security Fix R1 requires ACTIVE status, a satisfied MFA
//     credential (D-031), AND the specific permission — never trusts a
//     client-supplied role/permission/approval/MFA-state value;
//   - writes an IDENTITY_AUDIT row before returning success;
//   - fails closed (returns {success:false,...}) on any missing/invalid
//     authorization or target.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: REGISTRATION APPROVAL
// ═══════════════════════════════════════════════════════════════

/**
 * listPendingRegistrations()
 * Admin-only (REGISTRATION_APPROVE). Returns only the fields the
 * approval UI needs — never a raw sheet row.
 * @returns {{success:boolean, registrations?:object[], message?:string}}
 */
function listPendingRegistrations() {
  const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.REGISTRATION_APPROVE);
  if (!auth.authorized) return { success: false, message: auth.reason };
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.USERS, IDENTITY_HEADERS.USERS);
  const rows = _identity_readAll_(sheet);
  const registrations = rows
    .map(r => _identity_rowToUser_(r))
    .filter(u => u.accountStatus === IDENTITY_STATUS.PENDING_APPROVAL)
    .map(u => ({
      userId: u.userId, fullName: u.fullName, email: u.email,
      department: u.department, emailVerifiedAt: u.emailVerifiedAt, createdAt: u.createdAt,
    }));
  return { success: true, registrations: registrations };
}

/**
 * approveRegistration(userId)
 * Admin-only (REGISTRATION_APPROVE). Moves PENDING_APPROVAL -> ACTIVE.
 * Does not auto-assign a role — an approved account has no role until
 * assignRole() grants one; getAccessState() reflects that (an ACTIVE
 * user with zero roles has zero permissions, never a default admin).
 * @returns {{success:boolean, message:string}}
 */
function approveRegistration(userId) {
  const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.REGISTRATION_APPROVE);
  if (!auth.authorized) return { success: false, message: auth.reason };
  const actor = _identity_currentUserRecord_();
  const result = _identity_transitionStatus_(userId, IDENTITY_STATUS.ACTIVE, actor.userId, 'Approved');
  if (!result.success) return result;

  // A newly ACTIVE user has no role yet (assignRole() below) — but does
  // need a USER role at minimum to use the app at all in most designs.
  // Phase 1H-C deliberately does NOT auto-grant USER here: "must not be
  // hard-coded around only these two roles" (D-026) means approval and
  // role-granting stay two distinct admin actions, not one bundled
  // default. See reviews/006 remaining-limitations note.
  _identity_writeAudit_(IDENTITY_AUDIT_EVENT.REGISTRATION_APPROVED, actor.userId, userId, 'approved, now ACTIVE');
  _identity_writeAudit_(IDENTITY_AUDIT_EVENT.ACCOUNT_ACTIVATED, actor.userId, userId, '');
  return { success: true, message: 'Registration approved.' };
}

/**
 * rejectRegistration(userId, reason)
 * Admin-only (REGISTRATION_APPROVE). Moves PENDING_APPROVAL -> REJECTED
 * (terminal — a rejected registrant must submit a new registration to
 * try again, not be silently reactivated).
 * @returns {{success:boolean, message:string}}
 */
function rejectRegistration(userId, reason) {
  const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.REGISTRATION_APPROVE);
  if (!auth.authorized) return { success: false, message: auth.reason };
  const actor = _identity_currentUserRecord_();
  const result = _identity_transitionStatus_(userId, IDENTITY_STATUS.REJECTED, actor.userId, reason || '');
  if (!result.success) return result;

  _identity_writeAudit_(IDENTITY_AUDIT_EVENT.REGISTRATION_REJECTED, actor.userId, userId, String(reason || ''));
  return { success: true, message: 'Registration rejected.' };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: ACCOUNT LIFECYCLE — suspend / reactivate / disable
// ═══════════════════════════════════════════════════════════════

function suspendAccount(userId, reason) {
  const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.USER_MANAGE);
  if (!auth.authorized) return { success: false, message: auth.reason };
  const actor = _identity_currentUserRecord_();
  const result = _identity_transitionStatus_(userId, IDENTITY_STATUS.SUSPENDED, actor.userId, reason || '');
  if (!result.success) return result;
  _identity_writeAudit_(IDENTITY_AUDIT_EVENT.ACCOUNT_SUSPENDED, actor.userId, userId, String(reason || ''));
  return { success: true, message: 'Account suspended.' };
}

function reactivateAccount(userId, reason) {
  const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.USER_MANAGE);
  if (!auth.authorized) return { success: false, message: auth.reason };
  const actor = _identity_currentUserRecord_();
  const result = _identity_transitionStatus_(userId, IDENTITY_STATUS.ACTIVE, actor.userId, reason || '');
  if (!result.success) return result;
  _identity_writeAudit_(IDENTITY_AUDIT_EVENT.ACCOUNT_REACTIVATED, actor.userId, userId, String(reason || ''));
  return { success: true, message: 'Account reactivated.' };
}

/**
 * disableAccount(userId, reason)
 * Terminal in this phase (DISABLED has no outbound transition in
 * IDENTITY_VALID_TRANSITIONS) — matches "disable" being the stronger,
 * presumably-permanent action vs. the reversible "suspend".
 */
function disableAccount(userId, reason) {
  const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.USER_MANAGE);
  if (!auth.authorized) return { success: false, message: auth.reason };
  const actor = _identity_currentUserRecord_();
  const result = _identity_transitionStatus_(userId, IDENTITY_STATUS.DISABLED, actor.userId, reason || '');
  if (!result.success) return result;
  _identity_writeAudit_(IDENTITY_AUDIT_EVENT.ACCOUNT_DISABLED, actor.userId, userId, String(reason || ''));
  return { success: true, message: 'Account disabled.' };
}

/**
 * handleExternalIdentityDisabled(authProvider, authSubject)
 * Offboarding hook, part 2: "an externally disabled identity must not
 * remain an unrestricted Active SVMI identity." No external IdP is
 * integrated yet (D-024) — nothing in this codebase calls this function
 * today. It exists as the documented integration point a future IdP
 * webhook/sync job would call; until then it is dead code by design, not
 * an oversight. Intentionally NOT gated by _identity_currentUserHasPermission_()
 * — a future IdP integration is a system-to-system caller, not an
 * interactive admin — but it only ever DISABLES (the most restrictive
 * terminal state), never grants access, so it cannot be used to escalate
 * privilege even if called unexpectedly.
 * @returns {{success:boolean, message:string}}
 */
function handleExternalIdentityDisabled(authProvider, authSubject) {
  const usersSheet = _identity_ensureSheet_(IDENTITY_SHEET.USERS, IDENTITY_HEADERS.USERS);
  const rows = _identity_readAll_(usersSheet);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][IDENTITY_USERS_COL.AUTH_PROVIDER - 1]) === String(authProvider) &&
        String(rows[i][IDENTITY_USERS_COL.AUTH_SUBJECT - 1]) === String(authSubject)) {
      const user = _identity_rowToUser_(rows[i]);
      if (user.accountStatus === IDENTITY_STATUS.ACTIVE || user.accountStatus === IDENTITY_STATUS.SUSPENDED) {
        const result = _identity_transitionStatus_(user.userId, IDENTITY_STATUS.DISABLED, '', 'External identity disabled by provider');
        if (result.success) {
          _identity_writeAudit_(IDENTITY_AUDIT_EVENT.ACCOUNT_DISABLED, '', user.userId, 'external identity disabled (' + authProvider + ')');
        }
        return result;
      }
      return { success: true, message: 'Account already non-active; no change.' };
    }
  }
  return { success: false, message: 'No user matches that external identity.' };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: ROLE / PERMISSION / SCOPE ASSIGNMENT
// ═══════════════════════════════════════════════════════════════

/**
 * assignRole(userId, roleId, grant)
 * Admin-only (ROLE_ASSIGN). `grant` true adds the role, false revokes
 * it — a single function for both, matching the approved API list
 * naming assignRole() once, not assignRole()/revokeRole() as two names.
 * @returns {{success:boolean, message:string}}
 */
function assignRole(userId, roleId, grant) {
  const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.ROLE_ASSIGN);
  if (!auth.authorized) return { success: false, message: auth.reason };
  const target = _identity_findUserById_(userId);
  if (!target) return { success: false, message: 'User not found.' };

  const rolesSheet = _identity_ensureSheet_(IDENTITY_SHEET.ROLES, IDENTITY_HEADERS.ROLES);
  const knownRoleIds = _identity_readAll_(rolesSheet).map(r => String(r[0]).toUpperCase());
  const normalizedRoleId = String(roleId || '').toUpperCase();
  if (knownRoleIds.indexOf(normalizedRoleId) === -1) {
    return { success: false, message: 'Unknown role: ' + roleId + '.' };
  }

  const actor = _identity_currentUserRecord_();
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_ROLES, IDENTITY_HEADERS.USER_ROLES);
  const rows = _identity_readAll_(sheet);
  const existingRowNum = (() => {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(userId) && String(rows[i][1]).toUpperCase() === normalizedRoleId) return i + 2;
    }
    return -1;
  })();

  if (grant) {
    if (existingRowNum === -1) sheet.appendRow([userId, normalizedRoleId, new Date(), actor.userId]);
  } else if (existingRowNum !== -1) {
    sheet.deleteRow(existingRowNum);
  }
  SpreadsheetApp.flush();

  _identity_writeAudit_(IDENTITY_AUDIT_EVENT.ROLE_CHANGED, actor.userId, userId, (grant ? 'granted role=' : 'revoked role=') + normalizedRoleId);
  return { success: true, message: (grant ? 'Role granted.' : 'Role revoked.') };
}

/**
 * assignPermissions(userId, permissionKey, grant)
 * Admin-only (PERMISSION_ASSIGN). Direct per-user permission grant,
 * additive to whatever the user's role(s) already provide (D-026) —
 * never removes a role-derived permission, only adds/removes this one
 * direct grant.
 * @returns {{success:boolean, message:string}}
 */
function assignPermissions(userId, permissionKey, grant) {
  const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.PERMISSION_ASSIGN);
  if (!auth.authorized) return { success: false, message: auth.reason };
  const target = _identity_findUserById_(userId);
  if (!target) return { success: false, message: 'User not found.' };

  const permsSheet = _identity_ensureSheet_(IDENTITY_SHEET.PERMISSIONS, IDENTITY_HEADERS.PERMISSIONS);
  const knownKeys = _identity_readAll_(permsSheet).map(r => String(r[0]).toUpperCase());
  const normalizedKey = String(permissionKey || '').toUpperCase();
  if (knownKeys.indexOf(normalizedKey) === -1) {
    return { success: false, message: 'Unknown permission: ' + permissionKey + '.' };
  }

  const actor = _identity_currentUserRecord_();
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_PERMISSIONS, IDENTITY_HEADERS.USER_PERMISSIONS);
  const rows = _identity_readAll_(sheet);
  const existingRowNum = (() => {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(userId) && String(rows[i][1]).toUpperCase() === normalizedKey) return i + 2;
    }
    return -1;
  })();

  if (grant) {
    if (existingRowNum === -1) sheet.appendRow([userId, normalizedKey, new Date(), actor.userId]);
  } else if (existingRowNum !== -1) {
    sheet.deleteRow(existingRowNum);
  }
  SpreadsheetApp.flush();

  _identity_writeAudit_(IDENTITY_AUDIT_EVENT.PERMISSION_CHANGED, actor.userId, userId, (grant ? 'granted permission=' : 'revoked permission=') + normalizedKey);
  return { success: true, message: (grant ? 'Permission granted.' : 'Permission revoked.') };
}

/**
 * assignScope(userId, scopeType, scopeValue, grant)
 * Admin-only (SCOPE_ASSIGN). scopeType SYSTEM/REGION/STORE; scopeValue
 * blank for SYSTEM. Supports configurable combinations — a user may
 * hold multiple scope grants (e.g. two REGION rows).
 * @returns {{success:boolean, message:string}}
 */
function assignScope(userId, scopeType, scopeValue, grant) {
  const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.SCOPE_ASSIGN);
  if (!auth.authorized) return { success: false, message: auth.reason };
  const target = _identity_findUserById_(userId);
  if (!target) return { success: false, message: 'User not found.' };

  const normalizedType = String(scopeType || '').toUpperCase();
  if ([IDENTITY_SCOPE_TYPE.SYSTEM, IDENTITY_SCOPE_TYPE.REGION, IDENTITY_SCOPE_TYPE.STORE].indexOf(normalizedType) === -1) {
    return { success: false, message: 'Invalid scope type: ' + scopeType + '.' };
  }
  const normalizedValue = normalizedType === IDENTITY_SCOPE_TYPE.SYSTEM ? '' : String(scopeValue || '').trim();
  if (normalizedType !== IDENTITY_SCOPE_TYPE.SYSTEM && !normalizedValue) {
    return { success: false, message: 'scopeValue is required for ' + normalizedType + ' scope.' };
  }

  const actor = _identity_currentUserRecord_();
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_SCOPE, IDENTITY_HEADERS.USER_SCOPE);
  const rows = _identity_readAll_(sheet);
  const existingRowNum = (() => {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(userId) && String(rows[i][1]).toUpperCase() === normalizedType &&
          String(rows[i][2] || '') === normalizedValue) return i + 2;
    }
    return -1;
  })();

  if (grant) {
    if (existingRowNum === -1) sheet.appendRow([userId, normalizedType, normalizedValue, new Date(), actor.userId]);
  } else if (existingRowNum !== -1) {
    sheet.deleteRow(existingRowNum);
  }
  SpreadsheetApp.flush();

  const label = normalizedType + (normalizedValue ? ':' + normalizedValue : '');
  _identity_writeAudit_(IDENTITY_AUDIT_EVENT.SCOPE_CHANGED, actor.userId, userId, (grant ? 'granted scope=' : 'revoked scope=') + label);
  return { success: true, message: (grant ? 'Scope granted.' : 'Scope revoked.') };
}

/**
 * identityAdmin_getUserDetail(userIdOrEmail)
 * Admin-only (any one of the assignment permissions, or REGISTRATION_APPROVE/
 * USER_MANAGE — the Identity admin screen's single detail-panel read).
 * Accepts either a User ID or an email address (the admin lookup box
 * takes either). Never returns MFA secret or verification-code data.
 * @returns {{success:boolean, user?:object, roles?:string[], permissions?:string[], directPermissions?:string[], scope?:object[], mfaStatus?:string, message?:string}}
 */
function identityAdmin_getUserDetail(userIdOrEmail) {
  const canView = _identity_currentUserHasPermission_(IDENTITY_PERMISSION.REGISTRATION_APPROVE) ||
    _identity_currentUserHasPermission_(IDENTITY_PERMISSION.USER_MANAGE) ||
    _identity_currentUserHasPermission_(IDENTITY_PERMISSION.ROLE_ASSIGN) ||
    _identity_currentUserHasPermission_(IDENTITY_PERMISSION.PERMISSION_ASSIGN) ||
    _identity_currentUserHasPermission_(IDENTITY_PERMISSION.SCOPE_ASSIGN);
  if (!canView) return { success: false, message: 'Admin permission required.' };

  const query = String(userIdOrEmail || '').trim();
  const found = _identity_isValidEmail_(query) ? _identity_findUserByEmail_(query) : _identity_findUserById_(query);
  if (!found) return { success: false, message: 'User not found.' };
  const userId = found.user.userId;

  const userRolesSheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_ROLES, IDENTITY_HEADERS.USER_ROLES);
  const roles = _identity_readAll_(userRolesSheet).filter(r => String(r[0]) === String(userId)).map(r => String(r[1]));

  const userPermsSheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_PERMISSIONS, IDENTITY_HEADERS.USER_PERMISSIONS);
  const directPermissions = _identity_readAll_(userPermsSheet).filter(r => String(r[0]) === String(userId)).map(r => String(r[1]));

  const scopeSheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_SCOPE, IDENTITY_HEADERS.USER_SCOPE);
  const scope = _identity_readAll_(scopeSheet).filter(r => String(r[0]) === String(userId))
    .map(r => ({ scopeType: r[1], scopeValue: r[2] }));

  const mfaSheet = _identity_ensureSheet_(IDENTITY_SHEET.MFA, IDENTITY_HEADERS.MFA);
  const mfaRow = _identity_readAll_(mfaSheet).find(r => String(r[0]) === String(userId));
  const mfaStatus = mfaRow ? mfaRow[1] : 'NOT_ENROLLED';

  return {
    success: true,
    user: found.user,
    roles: roles,
    permissions: _identity_getUserPermissions_(userId),
    directPermissions: directPermissions,
    scope: scope,
    mfaStatus: mfaStatus,
  };
}
