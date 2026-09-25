// ============================================================
// SVMKPI_ACCESS.gs
// Store Visit Monitoring KPI — Web App Access Control
// ------------------------------------------------------------
// Contains:
//   1. Config readers (admin list + guest password, both live in
//      SETTINGS so they're editable without touching code/redeploying)
//   2. Current-user / admin-check RPCs, callable from SVMI_PORTAL.html
//   3. The guest-password gate shared by doGet()/doPost() (SVMKPI_ADMIN.gs)
//   4. One-time setup menu item that bootstraps the two SETTINGS columns
//   5. Security Fix R2 (D-032): the legacy-admin MFA bridge — makes
//      sl_isAdmin() itself (the single choke point all 45+ pre-existing
//      SETTINGS!G-gated functions already call) require a satisfied MFA
//      credential too, closing the dual-authorization-path gap Security
//      Fix R1 left open. See SECTION 5 below and
//      reviews/009-phase-1h-c-security-fix-r2.md.
// ------------------------------------------------------------
// Two independent layers protect this Web App:
//   - Google sign-in (appsscript.json access:"ANYONE") — real identity,
//     required by Google before any of this code even runs.
//   - The guest password below — a shared secret anyone who should use
//     the app is given, kept in the Spreadsheet so it's easy to rotate.
//     It gates which HTML gets served (see _handleWebAppRequest_), not
//     individual google.script.run calls — so a browser that never
//     receives the real portal page has no client code that could call
//     them anyway.
// Neither layer replaces the other: sign-in identifies WHO you are
// (used for the admin check and the audit-trail email), the password
// controls WHETHER you get in at all.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CONFIG (read from SETTINGS — see menuSetupAccessControl)
// ═══════════════════════════════════════════════════════════════

// SETTINGS column layout for access control (1-based). Columns A–F are
// already used (Store/Brand/Region/validation formula/Category/Visitors,
// see SVMKPI_STORE_LOOKUP.gs's SL_SETTINGS_COL) — G and I are free.
const ACCESS_COL = {
  ADMIN_EMAILS:    7,  // G — one admin email per row, from G2 down
  GUEST_PASSWORD:  9,  // I — single value in I2
};

// ── Phase 1H-B.1 (Required finding 1, reviews/003 §H) ──────────────────
// _getAdminEmails()/_getGuestPassword() used to be top-level functions.
// google.script.run exposes EVERY top-level function in an Apps Script
// project by name, regardless of underscore-prefix convention — so any
// signed-in user who had loaded the real portal page could call either
// directly and receive the raw admin email list or the guest password,
// bypassing sl_isAdmin() entirely (neither function has, or can safely
// have, its own sl_isAdmin() check — sl_isAdmin() itself depends on
// reading the admin list, and _getGuestPassword() must be readable
// BEFORE a visitor has proven anything, since it IS the password check).
// The fix: these two now live as properties of a plain object instead of
// top-level function declarations. google.script.run's RPC bridge can
// only dispatch to top-level functions, so `_SL_SECRET_.adminEmails()`/
// `_SL_SECRET_.guestPassword()` are no longer callable from any client —
// they remain reachable only by ordinary in-script function calls from
// sl_isAdmin() and _handleWebAppRequest_() below, exactly as before.
// No shipped UI ever called `_getAdminEmails`/`_getGuestPassword` via
// google.script.run (confirmed in reviews/003) — RPC access to the raw
// values was never a legitimate use case, so removing it costs nothing.
var _SL_SECRET_ = {
  /** @returns {string[]} lowercased, trimmed admin emails from SETTINGS!G2:G */
  adminEmails: function () {
    const settings = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SETTINGS');
    if (!settings || settings.getLastRow() < 2) return [];
    const values = settings.getRange(2, ACCESS_COL.ADMIN_EMAILS, settings.getLastRow() - 1, 1).getValues();
    return values
      .map(row => String(row[0] || '').trim().toLowerCase())
      .filter(Boolean);
  },

  /**
   * @returns {string} the configured password (trimmed), or '' if not set
   *   up yet — treated as "no password required" so the app never locks
   *   itself out before menuSetupAccessControl() has run.
   */
  guestPassword: function () {
    const settings = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SETTINGS');
    if (!settings) return '';
    return String(settings.getRange(2, ACCESS_COL.GUEST_PASSWORD).getValue() || '').trim();
  },
};


// ═══════════════════════════════════════════════════════════════
// SECTION 2: CURRENT USER / ADMIN CHECK — callable from the portal
// ═══════════════════════════════════════════════════════════════

/**
 * sl_getCurrentUser()
 * Returns the Google account email of whoever is using the Web App right
 * now, for the "Signed in as" line in the top bar. Requires appsscript.json's
 * webapp.executeAs = "USER_ACCESSING" (each request runs as that person,
 * not as whoever deployed the script) — without it this reliably returns ''.
 *
 * A user with no email visible here (empty string) is signed in with Google
 * (access:"ANYONE" already requires that) but hasn't been individually
 * granted Viewer/Editor on this Spreadsheet, so their data calls will fail
 * with a permission error — see the "Access control" section in DEPLOY.md.
 *
 * @returns {string} email address, or '' if unavailable
 */
function sl_getCurrentUser() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

/**
 * _isOnLegacyAdminList_(email)
 * The ORIGINAL sl_isAdmin() check, pre-Security-Fix-R2: whether `email`
 * is on the SETTINGS!G admin list, with no MFA requirement. Kept as its
 * own function for two reasons: (1) sl_isAdmin() itself now layers an
 * MFA requirement on top of this (see below); (2) enrollAdminMfa()/
 * verifyAdminMfa() (SECTION 5) must gate on list-membership ALONE, not
 * on sl_isAdmin() — gating self-enrollment on "already MFA-satisfied"
 * would make it impossible for any admin to ever complete their first
 * enrollment (a circular bootstrap trap).
 * Fails closed: no email visible ⇒ not an admin, never the reverse.
 * @returns {boolean}
 */
function _isOnLegacyAdminList_(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return _SL_SECRET_.adminEmails().indexOf(normalized) !== -1;
}

/**
 * sl_isAdmin()
 * Whether the current Google account is on the SETTINGS!G admin list
 * AND has a currently-satisfied MFA credential (Security Fix R2,
 * DECISIONS.md D-032). Called by the portal to hide/disable the
 * destructive System Tools (Executive Summary, KPI 2026, Data Headers)
 * for non-admins — but that's a convenience, not the real gate: each
 * portal_rebuild*() handler for those three tools calls this again
 * itself before doing anything, since a client-side check alone can't
 * stop a direct call to the function. This is the SAME single function
 * all 45+ existing SETTINGS!G-gated call sites already call, so
 * strengthening it here closes the MFA gap for all of them without
 * editing any of those call sites (mirrors how Security Fix R1
 * strengthened _identity_currentUserHasPermission_() for the new
 * identity surface).
 * Fails closed: no email visible, not on the admin list, or MFA not
 * satisfied ⇒ not an admin, never the reverse. The MFA check is
 * typeof-guarded so a test sandbox that never loads
 * SVMKPI_IDENTITY_CORE.gs (this file's MFA dependency) degrades to the
 * pre-R2 admin-list-only check instead of throwing — in the real
 * deployed app all files share one project, so
 * _identity_hasSatisfiedMfa_ is always present and this check always
 * applies (same established precedent as the `typeof sl_isAdmin ===
 * 'function'` guards elsewhere in this codebase, e.g. SVMKPI_LAYOUT.gs).
 * @returns {boolean}
 */
function sl_isAdmin() {
  const email = sl_getCurrentUser();
  if (!_isOnLegacyAdminList_(email)) return false;
  if (typeof _identity_hasSatisfiedMfa_ === 'function' &&
      !_identity_hasSatisfiedMfa_(_legacyAdminMfaKey_(email))) {
    return false;
  }
  return true;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: GUEST-PASSWORD GATE — shared by doGet()/doPost()
// ═══════════════════════════════════════════════════════════════

/**
 * _handleWebAppRequest_(e)
 * Decides what doGet()/doPost() (SVMKPI_ADMIN.gs) actually serve:
 *   - Password matches SETTINGS!I2 (or none is configured yet) → the real
 *     portal, evaluated as a template so the just-entered password can be
 *     written into localStorage (so a returning visitor isn't asked again
 *     — see the inline script near the top of SVMI_PORTAL.html's <body>).
 *   - Otherwise → SVMI_LOCK.html, a small password form. Its own inline
 *     script auto-resubmits whatever's saved in localStorage once, so
 *     this only shows up for a first visit or a rotated/wrong password.
 * POST (not GET) is what the lock form actually submits, so the password
 * never sits in the URL or browser history.
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function _handleWebAppRequest_(e) {
  const pw       = String((e && e.parameter && e.parameter.pw) || '');
  const required = _SL_SECRET_.guestPassword();

  if (!required || pw.trim() === required) {
    const tmpl = HtmlService.createTemplateFromFile('SVMI_PORTAL');
    tmpl.enteredPassword = pw.trim();
    return tmpl.evaluate()
      .setTitle('SVMI Command Center')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const lockTmpl = HtmlService.createTemplateFromFile('SVMI_LOCK');
  lockTmpl.failed    = pw.length > 0;   // only show "incorrect" after an actual attempt
  lockTmpl.actionUrl = ScriptApp.getService().getUrl();
  return lockTmpl.evaluate()
    .setTitle('SVMI Command Center — Sign In')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: ONE-TIME SETUP (Sheets menu → 🔐 Set Up Access Control)
// ═══════════════════════════════════════════════════════════════

/**
 * menuSetupAccessControl()
 * Bootstraps the two SETTINGS columns this file reads, without ever
 * overwriting values that are already there:
 *   - G1/G2: ADMIN_EMAILS header + seeds the CURRENT user (whoever runs
 *     this from the Sheets menu) as the first admin, so there's always
 *     at least one before anyone locks themselves out of critical tools.
 *   - I1/I2: GUEST_PASSWORD header + a freshly generated random password,
 *     shown once in the confirmation dialog — this is the only place it's
 *     ever surfaced, so copy it down before closing the dialog.
 * Safe to re-run any time: it only fills in blanks, never replaces an
 * existing admin list or password.
 */
function menuSetupAccessControl() {
  const ui = SpreadsheetApp.getUi();
  try {
    const settings = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SETTINGS');
    if (!settings) throw new Error('SETTINGS sheet not found.');

    const notes = [];

    // ADMIN_EMAILS
    const adminHeader = settings.getRange(1, ACCESS_COL.ADMIN_EMAILS);
    if (!String(adminHeader.getValue() || '').trim()) {
      adminHeader.setValue('ADMIN_EMAILS').setFontWeight('bold');
    }
    const firstAdminCell = settings.getRange(2, ACCESS_COL.ADMIN_EMAILS);
    if (!String(firstAdminCell.getValue() || '').trim()) {
      const me = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || '';
      if (me) {
        firstAdminCell.setValue(me);
        notes.push('Added ' + me + ' as the first admin (SETTINGS!G2).');
      } else {
        notes.push('Could not detect your email to seed as admin — add it to SETTINGS!G2 yourself.');
      }
    } else {
      notes.push('Admin list already has entries — left it alone.');
    }

    // GUEST_PASSWORD
    const pwHeader = settings.getRange(1, ACCESS_COL.GUEST_PASSWORD);
    if (!String(pwHeader.getValue() || '').trim()) {
      pwHeader.setValue('GUEST_PASSWORD').setFontWeight('bold');
    }
    const pwCell = settings.getRange(2, ACCESS_COL.GUEST_PASSWORD);
    if (!String(pwCell.getValue() || '').trim()) {
      const generated = _generatePassword_();
      pwCell.setValue(generated);
      notes.push('Generated a guest password: ' + generated + '  (SETTINGS!I2 — change it any time by editing that cell; this is the only place it is ever shown).');
    } else {
      notes.push('A guest password is already set — left it alone.');
    }

    ui.alert('Access Control', notes.join('\n\n'), ui.ButtonSet.OK);
  } catch (e) {
    _adminError('menuSetupAccessControl', e);
  }
}

function _generatePassword_() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids look-alikes
  let out = '';
  for (let i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: LEGACY ADMIN MFA BRIDGE (Security Fix R2, D-032)
// ------------------------------------------------------------
// Phase 1H-C Security Fix R1 made MFA an enforced, server-authoritative
// access requirement for the NEW identity/permission surface
// (SVMKPI_IDENTITY_CORE.gs's _identity_authorizeCurrentUser_()). A
// follow-up review found that left a second, independent authorization
// path unaffected: sl_isAdmin() (the SETTINGS!G admin-email mechanism,
// still the gate on 45+ pre-existing functions) could still be satisfied
// with no MFA at all. This section closes that gap.
//
// Deliberately NOT unified with the new identity system's ACTIVE-status/
// IDENTITY_USERS-based MFA gate: a SETTINGS!G admin is not necessarily
// registered there, and no bootstrap path exists yet to create the very
// first ACTIVE + role=ADMIN + MFA-satisfied identity in that system (its
// own approveRegistration() itself requires an already-ACTIVE, already-
// MFA-satisfied approver — see DECISIONS.md D-032 for the full
// analysis). Gating sl_isAdmin() on that system instead of this bridge
// would have risked permanently locking out every legacy admin with no
// way back in — the opposite of a safe, minimal fix.
//
// Instead this reuses the SAME generic, provider-neutral primitives
// Security Fix R1 already built — TOTP (SVMKPI_IDENTITY_MFA.gs) and the
// PropertiesService-backed satisfaction gate
// (SVMKPI_IDENTITY_CORE.gs §6.5) — under a distinct key namespace
// ('LEGACY_ADMIN:<email>', see _legacyAdminMfaKey_() below) and reuses
// the existing IDENTITY_MFA sheet (no new sheet needed) for secret
// storage, with rows keyed by that same synthetic string instead of a
// real IDENTITY_USERS 'USR-<uuid>' User ID — the two can never collide.
// A legacy admin's MFA standing is therefore entirely independent of
// whether that email has ever registered in the new identity system.
//
// Self-service only, exactly like enrollMfa()/verifyMfa(): always acts
// on the calling browser's own linked Google identity, never a client-
// supplied email. enrollAdminMfa()/verifyAdminMfa() gate on
// _isOnLegacyAdminList_() (admin-list membership ALONE), never on
// sl_isAdmin() itself — see _isOnLegacyAdminList_()'s own comment for
// why that avoids a circular bootstrap trap.
// ═══════════════════════════════════════════════════════════════

/**
 * _legacyAdminMfaKey_(email)
 * The PropertiesService/IDENTITY_MFA-sheet key for a legacy admin's MFA
 * standing — distinct from any real IDENTITY_USERS 'USR-<uuid>' User ID
 * by construction (the 'LEGACY_ADMIN:' prefix can never be produced by
 * _identity_newUserId_()).
 */
function _legacyAdminMfaKey_(email) {
  return 'LEGACY_ADMIN:' + String(email || '').trim().toLowerCase();
}

/**
 * _legacyAdminMfaRow_(email)
 * Reuses the IDENTITY_MFA sheet/schema (SVMKPI_IDENTITY_CORE.gs /
 * SVMKPI_IDENTITY_MFA.gs) rather than adding a new sheet.
 * @returns {{sheet:object, rowNum:number, record:Array|null}} rowNum is
 *   -1 (not yet enrolled) or the 1-based sheet row (incl. header).
 */
function _legacyAdminMfaRow_(email) {
  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.MFA, IDENTITY_HEADERS.MFA);
  const key = _legacyAdminMfaKey_(email);
  const rows = _identity_readAll_(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][IDENTITY_MFA_COL.USER_ID - 1]) === key) {
      return { sheet: sheet, rowNum: i + 2, record: rows[i] };
    }
  }
  return { sheet: sheet, rowNum: -1, record: null };
}

/**
 * enrollAdminMfa()
 * Self-service legacy-admin equivalent of enrollMfa() (SVMKPI_IDENTITY_MFA.gs).
 * Gated on SETTINGS!G list membership alone (_isOnLegacyAdminList_), NOT
 * on sl_isAdmin() — see SECTION 5's header comment. Returns the shared
 * secret ONCE, exactly like enrollMfa(); no read function ever returns
 * it afterward.
 * @returns {{success:boolean, message:string, secret?:string, otpauthUri?:string}}
 */
function enrollAdminMfa() {
  const email = sl_getCurrentUser();
  if (!_isOnLegacyAdminList_(email)) {
    return { success: false, message: 'Admin access required.' };
  }

  const key = _legacyAdminMfaKey_(email);
  const found = _legacyAdminMfaRow_(email);
  const wasEnrolled = !!(found.record && found.record[IDENTITY_MFA_COL.STATUS - 1] === 'ENROLLED');

  const secret = _identity_generateTotpSecret_();
  if (found.rowNum === -1) {
    found.sheet.appendRow([key, 'NOT_ENROLLED', 'TOTP', secret, '', '', '']);
  } else {
    found.sheet.getRange(found.rowNum, IDENTITY_MFA_COL.STATUS).setValue('NOT_ENROLLED');
    found.sheet.getRange(found.rowNum, IDENTITY_MFA_COL.SECRET).setValue(secret);
    found.sheet.getRange(found.rowNum, IDENTITY_MFA_COL.ENROLLED_AT).setValue('');
    // A new secret has its own independent step-space (same anti-replay
    // reasoning as enrollMfa()).
    found.sheet.getRange(found.rowNum, IDENTITY_MFA_COL.LAST_USED_STEP).setValue('');
  }
  SpreadsheetApp.flush();

  // A new/reset secret invalidates any standing satisfaction.
  _identity_clearMfaSatisfaction_(key);

  if (wasEnrolled) {
    _identity_writeAudit_(IDENTITY_AUDIT_EVENT.MFA_RESET, key, key, 'legacy admin MFA re-enrollment started');
  }

  const otpauthUri = 'otpauth://totp/SVMI:' + encodeURIComponent(email) +
    '?secret=' + secret + '&issuer=SVMI-Admin&digits=' + IDENTITY_TOTP_DIGITS + '&period=' + IDENTITY_TOTP_STEP_SECONDS;

  return {
    success: true,
    message: 'Scan this into your authenticator app, then confirm with verifyAdminMfa().',
    secret: secret,
    otpauthUri: otpauthUri,
  };
}

/**
 * verifyAdminMfa(code)
 * Self-service legacy-admin equivalent of verifyMfa()
 * (SVMKPI_IDENTITY_MFA.gs) — same RFC 6238 anti-replay behavior (a given
 * TOTP time-step satisfies at most one call). On success, marks the
 * server-side satisfaction credential sl_isAdmin() requires from here on.
 * Never reveals the correct code or the stored secret.
 * @returns {{success:boolean, message:string}}
 */
function verifyAdminMfa(code) {
  const email = sl_getCurrentUser();
  if (!_isOnLegacyAdminList_(email)) {
    return { success: false, message: 'Admin access required.' };
  }

  const key = _legacyAdminMfaKey_(email);
  const found = _legacyAdminMfaRow_(email);
  const secret = found.record ? found.record[IDENTITY_MFA_COL.SECRET - 1] : '';
  if (!found.record || !secret) {
    return { success: false, message: 'MFA not enrolled — call enrollAdminMfa() first.' };
  }

  const matchedStep = _identity_matchTotpStep_(secret, code, IDENTITY_TOTP_WINDOW_STEPS);
  if (matchedStep === null) {
    _identity_writeAudit_(IDENTITY_AUDIT_EVENT.MFA_VERIFY_FAILED, key, key, 'legacy admin: incorrect code');
    return { success: false, message: 'Incorrect code.' };
  }

  const lastUsedStepRaw = found.record[IDENTITY_MFA_COL.LAST_USED_STEP - 1];
  const lastUsedStep = lastUsedStepRaw === '' || lastUsedStepRaw == null ? null : Number(lastUsedStepRaw);
  if (lastUsedStep !== null && matchedStep <= lastUsedStep) {
    // Anti-replay — same reasoning as verifyMfa().
    _identity_writeAudit_(IDENTITY_AUDIT_EVENT.MFA_VERIFY_FAILED, key, key, 'legacy admin: replayed code rejected');
    return { success: false, message: 'This code has already been used. Wait for a new code.' };
  }

  const wasEnrolled = found.record[IDENTITY_MFA_COL.STATUS - 1] === 'ENROLLED';
  const now = new Date();
  found.sheet.getRange(found.rowNum, IDENTITY_MFA_COL.STATUS).setValue('ENROLLED');
  if (!wasEnrolled) found.sheet.getRange(found.rowNum, IDENTITY_MFA_COL.ENROLLED_AT).setValue(now);
  found.sheet.getRange(found.rowNum, IDENTITY_MFA_COL.LAST_VERIFIED_AT).setValue(now);
  found.sheet.getRange(found.rowNum, IDENTITY_MFA_COL.LAST_USED_STEP).setValue(matchedStep);
  SpreadsheetApp.flush();

  _identity_markMfaSatisfied_(key);

  if (!wasEnrolled) {
    _identity_writeAudit_(IDENTITY_AUDIT_EVENT.MFA_ENROLLED, key, key, 'legacy admin');
  }
  return { success: true, message: 'Verified.' };
}

/**
 * sl_getAdminMfaStatus()
 * Read-only, for the portal's admin-MFA banner (SVMI_PORTAL.html).
 * Reveals only the CALLER's own standing — never another user's, and
 * never the underlying SETTINGS!G list itself (that stays unreachable
 * via google.script.run, per Phase 1H-B.1). Safe to call whether or not
 * the caller is on the admin list.
 * @returns {{onAdminList:boolean, mfaEnrolled:boolean, mfaSatisfied:boolean}}
 */
function sl_getAdminMfaStatus() {
  const email = sl_getCurrentUser();
  const onAdminList = _isOnLegacyAdminList_(email);
  if (!onAdminList) return { onAdminList: false, mfaEnrolled: false, mfaSatisfied: false };

  const found = _legacyAdminMfaRow_(email);
  const mfaEnrolled = !!(found.record && found.record[IDENTITY_MFA_COL.STATUS - 1] === 'ENROLLED');
  const mfaSatisfied = typeof _identity_hasSatisfiedMfa_ === 'function' &&
    _identity_hasSatisfiedMfa_(_legacyAdminMfaKey_(email));
  return { onAdminList: true, mfaEnrolled: mfaEnrolled, mfaSatisfied: mfaSatisfied };
}
