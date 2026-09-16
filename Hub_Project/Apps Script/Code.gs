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

// Secret shared with SVMI_Project and TLM_Project (their own
// HUB_SHARED_SECRET Script Property must hold the same value) — used to
// sign the short-lived access tokens minted below. See DEPLOY.md.
const HUB_TOKEN_SECRET_KEY = 'HUB_SHARED_SECRET';
// How long a minted token stays valid for the initial hand-off to a
// sub-system's doGet — generous enough to cover an actual click-through
// and page load, not meant to double as the "how long can I keep using
// it" window (that's each sub-system's own 2-minute idle auto-lock, and
// neither sub-system remembers a credential across a refresh/close either
// way — see their SVMI_LOCK.html / TL_LOCK.html).
const HUB_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

/**
 * hub_getAccessUrl(sub)
 * Called from HUB_LANDING.html's "Open …" buttons via google.script.run.
 * Mints a fresh, short-lived signed token and returns that sub-system's
 * URL with it attached — this is what actually gets clicked through to,
 * never the bare URL, so a visitor never even sees (let alone bookmarks)
 * a permanently-valid link. A copied/shared version of the returned URL
 * stops working once the token expires (HUB_TOKEN_TTL_MS) — the
 * sub-system's own password/PIN gate still works independently of this,
 * so this never locks anyone out who knows it directly.
 * @param {string} sub 'svmi' or 'tlm'
 * @returns {string} the sub-system's URL with a fresh ?htok= appended
 */
function hub_getAccessUrl(sub) {
  const urls = _getSubSystemUrls_();
  const base = sub === 'svmi' ? urls.svmi : sub === 'tlm' ? urls.tlm : '';
  if (!base) throw new Error('That system has not been configured yet — see DEPLOY.md.');

  const token = _issueHubToken_(hub_getCurrentUser(), sub);
  const sep = base.indexOf('?') === -1 ? '?' : '&';
  return base + sep + 'htok=' + encodeURIComponent(token);
}

/**
 * _issueHubToken_(email, sub)
 * Signs {email, sub, exp} with HUB_SHARED_SECRET (HMAC-SHA256) into a
 * compact token: base64url(JSON payload) + '.' + hex signature. Verified
 * on the other end by each sub-system's own _verifyHubToken_ (duplicated
 * there, not a shared library, so each project stays independently
 * deployable).
 * @param {string} email
 * @param {string} sub
 * @returns {string}
 */
function _issueHubToken_(email, sub) {
  const secret = String(PropertiesService.getScriptProperties().getProperty(HUB_TOKEN_SECRET_KEY) || '');
  if (!secret) throw new Error('HUB_SHARED_SECRET is not configured yet — see DEPLOY.md.');

  const payload = { email: email || '', sub: sub, exp: Date.now() + HUB_TOKEN_TTL_MS };
  const payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const signature = _hmacHex_(payloadB64, secret);
  return payloadB64 + '.' + signature;
}

/**
 * _hmacHex_(text, secret) — HMAC-SHA256 of text with secret, as lowercase hex.
 * @param {string} text
 * @param {string} secret
 * @returns {string}
 */
function _hmacHex_(text, secret) {
  const bytes = Utilities.computeHmacSha256Signature(text, secret);
  return bytes.map(function (b) {
    return ((b < 0 ? b + 256 : b)).toString(16).padStart(2, '0');
  }).join('');
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
