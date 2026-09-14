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

/**
 * _getAdminEmails()
 * @returns {string[]} lowercased, trimmed admin emails from SETTINGS!G2:G
 */
function _getAdminEmails() {
  const settings = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SETTINGS');
  if (!settings || settings.getLastRow() < 2) return [];
  const values = settings.getRange(2, ACCESS_COL.ADMIN_EMAILS, settings.getLastRow() - 1, 1).getValues();
  return values
    .map(row => String(row[0] || '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * _getGuestPassword()
 * @returns {string} the configured password (trimmed), or '' if not set up
 *   yet — treated as "no password required" so the app never locks itself
 *   out before menuSetupAccessControl() has run.
 */
function _getGuestPassword() {
  const settings = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SETTINGS');
  if (!settings) return '';
  return String(settings.getRange(2, ACCESS_COL.GUEST_PASSWORD).getValue() || '').trim();
}


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
 * sl_isAdmin()
 * Whether the current Google account is on the SETTINGS!G admin list.
 * Called by the portal to hide/disable the destructive System Tools
 * (Executive Summary, KPI 2026, Data Headers) for non-admins — but that's
 * a convenience, not the real gate: each portal_rebuild*() handler for
 * those three tools calls this again itself before doing anything, since
 * a client-side check alone can't stop a direct call to the function.
 * Fails closed: no email visible ⇒ not an admin, never the reverse.
 * @returns {boolean}
 */
function sl_isAdmin() {
  const email = String(sl_getCurrentUser() || '').trim().toLowerCase();
  if (!email) return false;
  return _getAdminEmails().indexOf(email) !== -1;
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
  const required = _getGuestPassword();

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
