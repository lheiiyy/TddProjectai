// ============================================================
// SVMKPI_IDENTITY_CORE.gs
// Phase 1H-C — Identity/Access foundation: schema, sheet access,
// permission resolution, audit log, shared helpers.
// ------------------------------------------------------------
// See reviews/006-phase-1h-c-planning.md and DECISIONS.md D-024–D-030
// for the approved scope this implements. Pilot storage only — these
// IDENTITY_* sheets are the Sheets-as-pilot-storage analog of
// database/migrations/013_identity_extension.sql's tables (same
// Sheet-maps-to-table discipline every CONFIG_* area already follows).
//
// This is ADDITIVE to, not a replacement for, the existing guest-
// password + SETTINGS!G admin-email mechanism (SVMKPI_ACCESS.gs) — that
// mechanism keeps gating the existing pilot surface unchanged (D-025).
// This file's sl_isAdmin()-equivalent is _identity_hasPermission_(),
// used only by the NEW registration/approval/role/scope/MFA surface.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: SCHEMA
// ═══════════════════════════════════════════════════════════════

const IDENTITY_SHEET = {
  USERS:             'IDENTITY_USERS',
  VERIFICATIONS:     'IDENTITY_VERIFICATIONS',
  ROLES:             'IDENTITY_ROLES',
  PERMISSIONS:       'IDENTITY_PERMISSIONS',
  ROLE_PERMISSIONS:  'IDENTITY_ROLE_PERMISSIONS',
  USER_ROLES:        'IDENTITY_USER_ROLES',
  USER_PERMISSIONS:  'IDENTITY_USER_PERMISSIONS',
  USER_SCOPE:        'IDENTITY_USER_SCOPE',
  MFA:               'IDENTITY_MFA',
  AUDIT:             'IDENTITY_AUDIT',
};

// D-027 — the binding Phase 1H-C account lifecycle (supersedes D-019's
// illustrative 7-state list).
const IDENTITY_STATUS = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  PENDING_APPROVAL:     'PENDING_APPROVAL',
  ACTIVE:                'ACTIVE',
  SUSPENDED:             'SUSPENDED',
  DISABLED:              'DISABLED',
  REJECTED:              'REJECTED',
};

// Server-side-enforced valid transitions (never inferred client-side).
// Key = current status, value = set of statuses it may move to.
const IDENTITY_VALID_TRANSITIONS = {
  PENDING_VERIFICATION: [IDENTITY_STATUS.PENDING_APPROVAL],
  PENDING_APPROVAL:     [IDENTITY_STATUS.ACTIVE, IDENTITY_STATUS.REJECTED],
  ACTIVE:                [IDENTITY_STATUS.SUSPENDED, IDENTITY_STATUS.DISABLED],
  SUSPENDED:             [IDENTITY_STATUS.ACTIVE, IDENTITY_STATUS.DISABLED],
  DISABLED:              [], // terminal — a disabled account is not reactivated in this phase
  REJECTED:              [], // terminal
};

// D-026 — seeded once, extensible afterward without a code change.
const IDENTITY_SEED_ROLES = [
  { roleId: 'ADMIN', roleName: 'Administrator', description: 'Full identity/access administration.' },
  { roleId: 'USER',  roleName: 'User',           description: 'Standard operational access, no identity-admin capability.' },
];

const IDENTITY_PERMISSION = {
  REGISTRATION_APPROVE: 'REGISTRATION_APPROVE',
  USER_MANAGE:           'USER_MANAGE',
  ROLE_ASSIGN:            'ROLE_ASSIGN',
  PERMISSION_ASSIGN:      'PERMISSION_ASSIGN',
  SCOPE_ASSIGN:            'SCOPE_ASSIGN',
  IDENTITY_AUDIT_VIEW:     'IDENTITY_AUDIT_VIEW',
};

const IDENTITY_SEED_PERMISSIONS = [
  { key: IDENTITY_PERMISSION.REGISTRATION_APPROVE, description: 'Approve or reject a pending registration.' },
  { key: IDENTITY_PERMISSION.USER_MANAGE,           description: 'Suspend, reactivate, or disable an existing account.' },
  { key: IDENTITY_PERMISSION.ROLE_ASSIGN,            description: 'Grant or revoke a role on a user.' },
  { key: IDENTITY_PERMISSION.PERMISSION_ASSIGN,      description: 'Grant or revoke a direct permission on a user.' },
  { key: IDENTITY_PERMISSION.SCOPE_ASSIGN,            description: 'Grant or revoke a system/region/store access scope on a user.' },
  { key: IDENTITY_PERMISSION.IDENTITY_AUDIT_VIEW,     description: 'View the identity/access audit log.' },
];

const IDENTITY_AUDIT_EVENT = {
  REGISTRATION_SUBMITTED: 'REGISTRATION_SUBMITTED',
  EMAIL_VERIFIED:          'EMAIL_VERIFIED',
  REGISTRATION_APPROVED:   'REGISTRATION_APPROVED',
  REGISTRATION_REJECTED:   'REGISTRATION_REJECTED',
  ACCOUNT_ACTIVATED:       'ACCOUNT_ACTIVATED',
  ACCOUNT_SUSPENDED:       'ACCOUNT_SUSPENDED',
  ACCOUNT_REACTIVATED:     'ACCOUNT_REACTIVATED',
  ACCOUNT_DISABLED:        'ACCOUNT_DISABLED',
  ROLE_CHANGED:            'ROLE_CHANGED',
  PERMISSION_CHANGED:      'PERMISSION_CHANGED',
  SCOPE_CHANGED:           'SCOPE_CHANGED',
  MFA_ENROLLED:            'MFA_ENROLLED',
  MFA_RESET:               'MFA_RESET',
  MFA_VERIFY_FAILED:       'MFA_VERIFY_FAILED',
};

const IDENTITY_SCOPE_TYPE = { SYSTEM: 'SYSTEM', REGION: 'REGION', STORE: 'STORE' };


// ═══════════════════════════════════════════════════════════════
// SECTION 2: SHEET ACCESS — get-or-create, headers, seeding
// (same convention as SVMKPI_CONFIG.gs's _cfg_ensureSheet())
// ═══════════════════════════════════════════════════════════════

const IDENTITY_HEADERS = {
  USERS:             ['User ID', 'Full Name', 'Email', 'Department', 'Account Status', 'Auth Provider', 'Auth Subject', 'Email Verified At', 'Created At', 'Last Seen At', 'Status Changed At', 'Status Changed By'],
  VERIFICATIONS:     ['User ID', 'Code Hash', 'Expires At', 'Attempts'],
  ROLES:             ['Role ID', 'Role Name', 'Description'],
  PERMISSIONS:       ['Permission Key', 'Description'],
  ROLE_PERMISSIONS:  ['Role ID', 'Permission Key'],
  USER_ROLES:        ['User ID', 'Role ID', 'Granted At', 'Granted By'],
  USER_PERMISSIONS:  ['User ID', 'Permission Key', 'Granted At', 'Granted By'],
  USER_SCOPE:        ['User ID', 'Scope Type', 'Scope Value', 'Granted At', 'Granted By'],
  MFA:               ['User ID', 'Status', 'Method', 'Secret', 'Enrolled At', 'Last Verified At'],
  AUDIT:             ['Audit ID', 'Timestamp', 'Event Type', 'Actor User ID', 'Target User ID', 'Details'],
};

function _identity_ensureSheet_(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sheet;
}

/**
 * _identity_ensureSeeds_()
 * Idempotent — only fills in rows that don't already exist, same
 * "safe to re-run, never overwrites" convention as
 * menuSetupAccessControl() (SVMKPI_ACCESS.gs).
 */
function _identity_ensureSeeds_() {
  const rolesSheet = _identity_ensureSheet_(IDENTITY_SHEET.ROLES, IDENTITY_HEADERS.ROLES);
  const existingRoleIds = _identity_readAll_(rolesSheet).map(r => String(r[0] || '').toUpperCase());
  IDENTITY_SEED_ROLES.forEach(r => {
    if (existingRoleIds.indexOf(r.roleId) === -1) {
      rolesSheet.appendRow([r.roleId, r.roleName, r.description]);
    }
  });

  const permSheet = _identity_ensureSheet_(IDENTITY_SHEET.PERMISSIONS, IDENTITY_HEADERS.PERMISSIONS);
  const existingPermKeys = _identity_readAll_(permSheet).map(r => String(r[0] || '').toUpperCase());
  IDENTITY_SEED_PERMISSIONS.forEach(p => {
    if (existingPermKeys.indexOf(p.key) === -1) {
      permSheet.appendRow([p.key, p.description]);
    }
  });

  // ADMIN gets every currently-defined permission; USER gets none by
  // default (D-026) — additive rows only, never overwritten.
  const rpSheet = _identity_ensureSheet_(IDENTITY_SHEET.ROLE_PERMISSIONS, IDENTITY_HEADERS.ROLE_PERMISSIONS);
  const existingGrants = _identity_readAll_(rpSheet).map(r => String(r[0] || '').toUpperCase() + '|' + String(r[1] || '').toUpperCase());
  IDENTITY_SEED_PERMISSIONS.forEach(p => {
    const key = 'ADMIN|' + p.key;
    if (existingGrants.indexOf(key) === -1) {
      rpSheet.appendRow(['ADMIN', p.key]);
    }
  });

  [IDENTITY_SHEET.USERS, IDENTITY_SHEET.VERIFICATIONS, IDENTITY_SHEET.USER_ROLES,
   IDENTITY_SHEET.USER_PERMISSIONS, IDENTITY_SHEET.USER_SCOPE, IDENTITY_SHEET.MFA, IDENTITY_SHEET.AUDIT]
    .forEach(name => _identity_ensureSheet_(name, IDENTITY_HEADERS[_identity_headerKeyFor_(name)]));
}

function _identity_headerKeyFor_(sheetName) {
  return Object.keys(IDENTITY_SHEET).find(k => IDENTITY_SHEET[k] === sheetName);
}

function _identity_readAll_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: SHARED HELPERS
// ═══════════════════════════════════════════════════════════════

function _identity_newUserId_() {
  return 'USR-' + Utilities.getUuid();
}

function _identity_normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * _identity_isValidEmail_(email)
 * Deliberately permissive syntax check (D-024: any valid email address
 * may register, not restricted to any provider/domain) — not a
 * deliverability check.
 */
function _identity_isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

/**
 * _identity_hash_(value)
 * SHA-256 hex digest — used so verification codes and (see
 * SVMKPI_IDENTITY_MFA.gs) nothing else are ever compared or stored in
 * plaintext where a hash suffices. Not used for the TOTP secret itself,
 * which must stay round-trippable (see D-028).
 */
function _identity_hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value));
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function _identity_generateVerificationCode_() {
  // 6-digit numeric, matches what a typical email-OTP UI expects. Never
  // logged, never stored except as a hash (_identity_hash_()).
  let code = '';
  for (let i = 0; i < 6; i++) code += Math.floor(Math.random() * 10);
  return code;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: USER LOOKUP / READ
// ═══════════════════════════════════════════════════════════════

const IDENTITY_USERS_COL = {
  USER_ID: 1, FULL_NAME: 2, EMAIL: 3, DEPARTMENT: 4, ACCOUNT_STATUS: 5,
  AUTH_PROVIDER: 6, AUTH_SUBJECT: 7, EMAIL_VERIFIED_AT: 8, CREATED_AT: 9,
  LAST_SEEN_AT: 10, STATUS_CHANGED_AT: 11, STATUS_CHANGED_BY: 12,
};

function _identity_rowToUser_(row, rowIndex) {
  if (!row) return null;
  return {
    rowIndex: rowIndex,
    userId: row[IDENTITY_USERS_COL.USER_ID - 1],
    fullName: row[IDENTITY_USERS_COL.FULL_NAME - 1],
    email: row[IDENTITY_USERS_COL.EMAIL - 1],
    department: row[IDENTITY_USERS_COL.DEPARTMENT - 1],
    accountStatus: row[IDENTITY_USERS_COL.ACCOUNT_STATUS - 1],
    authProvider: row[IDENTITY_USERS_COL.AUTH_PROVIDER - 1],
    authSubject: row[IDENTITY_USERS_COL.AUTH_SUBJECT - 1],
    emailVerifiedAt: row[IDENTITY_USERS_COL.EMAIL_VERIFIED_AT - 1],
    createdAt: row[IDENTITY_USERS_COL.CREATED_AT - 1],
    lastSeenAt: row[IDENTITY_USERS_COL.LAST_SEEN_AT - 1],
  };
}

/** @returns {{sheet, rowNum, user}|null} rowNum is 1-based sheet row (incl. header) */
function _identity_findUserByEmail_(email) {
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.USERS, IDENTITY_HEADERS.USERS);
  const normalized = _identity_normalizeEmail_(email);
  const rows = _identity_readAll_(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (_identity_normalizeEmail_(rows[i][IDENTITY_USERS_COL.EMAIL - 1]) === normalized) {
      return { sheet: sheet, rowNum: i + 2, user: _identity_rowToUser_(rows[i]) };
    }
  }
  return null;
}

function _identity_findUserById_(userId) {
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.USERS, IDENTITY_HEADERS.USERS);
  const rows = _identity_readAll_(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][IDENTITY_USERS_COL.USER_ID - 1]) === String(userId)) {
      return { sheet: sheet, rowNum: i + 2, user: _identity_rowToUser_(rows[i]) };
    }
  }
  return null;
}

/**
 * _identity_currentUserRecord_()
 * D-025's disclosed hosting-layer correlation: resolves the IDENTITY_USERS
 * row for the Google account that reached this deployment. Returns null
 * if that Google account's email has no matching SVMI registration.
 */
function _identity_currentUserRecord_() {
  const email = sl_getCurrentUser();
  if (!email) return null;
  const found = _identity_findUserByEmail_(email);
  return found ? found.user : null;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: STATUS TRANSITIONS — server-side enforced (D-027)
// ═══════════════════════════════════════════════════════════════

/**
 * _identity_transitionStatus_(userId, toStatus, actorUserId, reason)
 * Fails closed: refuses any transition not explicitly listed in
 * IDENTITY_VALID_TRANSITIONS, regardless of caller.
 * @returns {{success:boolean, message?:string, fromStatus?:string}}
 */
function _identity_transitionStatus_(userId, toStatus, actorUserId, reason) {
  const found = _identity_findUserById_(userId);
  if (!found) return { success: false, message: 'User not found.' };

  const from = found.user.accountStatus;
  const allowed = IDENTITY_VALID_TRANSITIONS[from] || [];
  if (allowed.indexOf(toStatus) === -1) {
    return { success: false, message: 'Invalid status transition: ' + from + ' -> ' + toStatus + '.' };
  }

  const now = new Date();
  found.sheet.getRange(found.rowNum, IDENTITY_USERS_COL.ACCOUNT_STATUS).setValue(toStatus);
  found.sheet.getRange(found.rowNum, IDENTITY_USERS_COL.STATUS_CHANGED_AT).setValue(now);
  found.sheet.getRange(found.rowNum, IDENTITY_USERS_COL.STATUS_CHANGED_BY).setValue(actorUserId || '');
  SpreadsheetApp.flush();
  return { success: true, fromStatus: from };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6: PERMISSION RESOLUTION — never trust a client-supplied value
// ═══════════════════════════════════════════════════════════════

/**
 * _identity_getUserPermissions_(userId)
 * Effective permission set = union of every role's permissions
 * (IDENTITY_USER_ROLES -> IDENTITY_ROLE_PERMISSIONS) plus any direct
 * grant (IDENTITY_USER_PERMISSIONS). Always re-read from the sheets —
 * never cached across calls, never accepted as a parameter.
 * @returns {string[]}
 */
function _identity_getUserPermissions_(userId) {
  const userRolesSheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_ROLES, IDENTITY_HEADERS.USER_ROLES);
  const roleIds = _identity_readAll_(userRolesSheet)
    .filter(r => String(r[0]) === String(userId))
    .map(r => String(r[1]).toUpperCase());

  const rolePermsSheet = _identity_ensureSheet_(IDENTITY_SHEET.ROLE_PERMISSIONS, IDENTITY_HEADERS.ROLE_PERMISSIONS);
  const fromRoles = _identity_readAll_(rolePermsSheet)
    .filter(r => roleIds.indexOf(String(r[0]).toUpperCase()) !== -1)
    .map(r => String(r[1]).toUpperCase());

  const userPermsSheet = _identity_ensureSheet_(IDENTITY_SHEET.USER_PERMISSIONS, IDENTITY_HEADERS.USER_PERMISSIONS);
  const direct = _identity_readAll_(userPermsSheet)
    .filter(r => String(r[0]) === String(userId))
    .map(r => String(r[1]).toUpperCase());

  const set = {};
  fromRoles.concat(direct).forEach(p => { set[p] = true; });
  return Object.keys(set);
}

/**
 * _identity_hasPermission_(userId, permissionKey)
 * Fails closed: no user record, no roles, or no matching grant -> false.
 */
function _identity_hasPermission_(userId, permissionKey) {
  if (!userId) return false;
  return _identity_getUserPermissions_(userId).indexOf(permissionKey) !== -1;
}

/**
 * _identity_currentUserHasPermission_(permissionKey)
 * The only permission check any exposed identity-admin function should
 * use — always resolves the ACTOR from the server-verified Google
 * identity (D-025), never from a client-supplied "actorUserId" argument.
 */
function _identity_currentUserHasPermission_(permissionKey) {
  const current = _identity_currentUserRecord_();
  if (!current || current.accountStatus !== IDENTITY_STATUS.ACTIVE) return false;
  return _identity_hasPermission_(current.userId, permissionKey);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 7: AUDIT LOG (D-023/D-029) — append-only, never a secret value
// ═══════════════════════════════════════════════════════════════

/**
 * _identity_writeAudit_(eventType, actorUserId, targetUserId, details)
 * `details` must never contain a verification code, MFA secret, or any
 * other secret value — callers pass only non-secret summaries (e.g.
 * "role=ADMIN granted").
 */
function _identity_writeAudit_(eventType, actorUserId, targetUserId, details) {
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.AUDIT, IDENTITY_HEADERS.AUDIT);
  const auditId = 'IDAUD-' + eventType + '-' + new Date().getTime();
  sheet.appendRow([auditId, new Date(), eventType, actorUserId || '', targetUserId || '', details || '']);
  SpreadsheetApp.flush();
}

/**
 * identityAudit_list()
 * Admin-only (IDENTITY_AUDIT_VIEW). Read-only, for the Admin > Identity
 * audit view. Never returns a secret — no secret is ever written here.
 * @returns {{success:boolean, entries?:object[], message?:string}}
 */
function identityAudit_list() {
  if (!_identity_currentUserHasPermission_(IDENTITY_PERMISSION.IDENTITY_AUDIT_VIEW)) {
    return { success: false, message: 'Permission required: IDENTITY_AUDIT_VIEW.' };
  }
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.AUDIT, IDENTITY_HEADERS.AUDIT);
  const rows = _identity_readAll_(sheet);
  const entries = rows.map(r => ({
    auditId: r[0], timestamp: r[1], eventType: r[2], actorUserId: r[3], targetUserId: r[4], details: r[5],
  })).reverse(); // most recent first
  return { success: true, entries: entries };
}
