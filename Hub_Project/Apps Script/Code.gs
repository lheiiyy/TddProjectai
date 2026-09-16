// ============================================================
// Code.gs — Training & Development Hub
// ------------------------------------------------------------
// Standalone Web App (not bound to any Spreadsheet) that acts as the
// front door for Figaro Coffee Group Training & Development's tools.
// It gates entry with a shared password, then serves a landing page
// with cards linking out to each sub-system's own, separately
// deployed Web App:
//   - SVMI Command Center (SVMI_Project)  — store visit monitoring
//   - TL Tracker (TLM_Project)            — team leader monitoring
// This project owns none of their data or logic — it only routes to
// them. Each sub-system keeps its own access control (SVMI's guest
// password + admin list, TLM's PIN) on top of whatever gate this
// Hub applies, so removing/rotating the Hub password never loosens
// either sub-system's own protection.
//
// Two independent layers protect this Hub, same shape as SVMI's:
//   - Google sign-in (appsscript.json access:"ANYONE") — real identity,
//     required by Google before any of this code even runs.
//   - The Hub password below — a shared secret, stored in this
//     project's Script Properties (Project Settings > Script
//     Properties in the Apps Script editor) so it's editable without
//     touching code or redeploying. See DEPLOY.md for first-time setup.
// ============================================================

const HUB_PASSWORD_KEY   = 'HUB_PASSWORD';
const HUB_SVMI_URL_KEY   = 'SVMI_URL';
const HUB_TLM_URL_KEY    = 'TLM_URL';

function doGet(e) {
  return _handleHubRequest_(e);
}

function doPost(e) {
  return _handleHubRequest_(e);
}

/**
 * _handleHubRequest_(e)
 * Decides what doGet()/doPost() actually serve:
 *   - Password matches the configured HUB_PASSWORD (or none is configured
 *     yet) -> the landing page, evaluated as a template so the just-entered
 *     password can be written into localStorage (so a returning visitor
 *     isn't asked again — see the inline script in HUB_LANDING.html).
 *   - Otherwise -> HUB_LOGIN.html, a small password form. Its own inline
 *     script auto-resubmits whatever's saved in localStorage once, so this
 *     only shows up for a first visit or a rotated/wrong password.
 * POST (not GET) is what the login form actually submits, so the password
 * never sits in the URL or browser history.
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function _handleHubRequest_(e) {
  const pw       = String((e && e.parameter && e.parameter.pw) || '');
  const required = _getHubPassword_();

  if (!required || pw.trim() === required) {
    const tmpl = HtmlService.createTemplateFromFile('HUB_LANDING');
    tmpl.enteredPassword = pw.trim();
    tmpl.currentUser = hub_getCurrentUser();
    const urls = _getSubSystemUrls_();
    tmpl.svmiUrl = urls.svmi;
    tmpl.tlmUrl = urls.tlm;
    return tmpl.evaluate()
      .setTitle('Figaro Coffee Group — Training & Development Hub')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const lockTmpl = HtmlService.createTemplateFromFile('HUB_LOGIN');
  lockTmpl.failed    = pw.length > 0;   // only show "incorrect" after an actual attempt
  lockTmpl.actionUrl = ScriptApp.getService().getUrl();
  return lockTmpl.evaluate()
    .setTitle('Training & Development Hub — Sign In')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * hub_getCurrentUser()
 * Google account email of whoever is using the Web App right now, for the
 * "Signed in as" line on the landing page. Requires appsscript.json's
 * webapp.executeAs = "USER_ACCESSING" — without it this reliably returns ''.
 * @returns {string}
 */
function hub_getCurrentUser() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

/**
 * _getHubPassword_()
 * @returns {string} the configured Hub password (trimmed), or '' if not
 *   set up yet — treated as "no password required" so the Hub never locks
 *   itself out before setupHub_setPassword() has run.
 */
function _getHubPassword_() {
  return String(PropertiesService.getScriptProperties().getProperty(HUB_PASSWORD_KEY) || '').trim();
}

/**
 * _getSubSystemUrls_()
 * @returns {{svmi: string, tlm: string}} each sub-system's deployed Web
 *   App URL, or '' if that one hasn't been linked yet (the landing page
 *   shows an "not yet configured" card instead of a dead link in that case).
 */
function _getSubSystemUrls_() {
  const props = PropertiesService.getScriptProperties();
  return {
    svmi: String(props.getProperty(HUB_SVMI_URL_KEY) || '').trim(),
    tlm:  String(props.getProperty(HUB_TLM_URL_KEY) || '').trim(),
  };
}

// ═══════════════════════════════════════════════════════════════
// ONE-TIME SETUP — run these from the Apps Script editor's function
// picker (there's no Sheets menu here since this project isn't bound
// to a Spreadsheet). See DEPLOY.md for the full walkthrough.
// ═══════════════════════════════════════════════════════════════

/**
 * setupHub_setPassword(newPassword)
 * Sets (or rotates) the shared Hub password. Run once after deploying,
 * and again any time you want to change it — takes effect immediately,
 * no redeploy needed.
 * @param {string} newPassword
 */
function setupHub_setPassword(newPassword) {
  const pw = String(newPassword || '').trim();
  if (pw.length < 4) throw new Error('Password must be at least 4 characters.');
  PropertiesService.getScriptProperties().setProperty(HUB_PASSWORD_KEY, pw);
}

/**
 * setupHub_setSubSystemUrls(svmiUrl, tlmUrl)
 * Points the Hub's two cards at each sub-system's deployed Web App URL
 * (Deploy > Manage deployments > copy the "Web app" URL, in each of
 * SVMI_Project and TLM_Project). Pass '' (or omit) for either argument
 * to leave that one unchanged.
 * @param {string} [svmiUrl]
 * @param {string} [tlmUrl]
 */
function setupHub_setSubSystemUrls(svmiUrl, tlmUrl) {
  const props = PropertiesService.getScriptProperties();
  if (svmiUrl) props.setProperty(HUB_SVMI_URL_KEY, String(svmiUrl).trim());
  if (tlmUrl) props.setProperty(HUB_TLM_URL_KEY, String(tlmUrl).trim());
}
