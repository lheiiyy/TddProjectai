// ============================================================
// SVMKPI_ADMIN.gs  v2.2.0
// Store Visit Monitoring KPI — Admin / Menu / Trigger Layer
// ------------------------------------------------------------
// Single master onOpen() for entire project.
// All menus unified here. Unified portal replaces sidebar.
// v2.1.0: Added doGet() so this project can also be deployed as a
//         standalone Web App (Deploy > New deployment > Web app),
//         serving SVMI_PORTAL.html at a public URL instead of only
//         inside a Sheets dialog. Same HTML file, same backend
//         functions, same google.script.run bridge — no other
//         code changes required. See README.txt for deployment steps.
// v2.2.0: Web App now runs "Execute as: User accessing the web app"
//         (see appsscript.json) so every request runs with the
//         visiting Google account's own identity — needed for
//         sl_getCurrentUser() below to reliably know who's using it,
//         and for a real per-person audit trail instead of everyone
//         being attributed to whoever deployed the script. Each user
//         now needs their own Viewer/Editor access on this Spreadsheet
//         (Share button, or a Google Group) — see DEPLOY.md.
// ============================================================

// ═══════════════════════════════════════════════════════════════
// SECTION 1: MENU
// ═══════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('STORE VISIT KPI')
    .addItem('Open Command Center', 'openUnifiedPortal')
    .addSeparator()
    .addItem('🔐 Set Up Access Control', 'menuSetupAccessControl')
    .addToUi();
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: UNIFIED PORTAL ENTRY POINT
// ═══════════════════════════════════════════════════════════════

/**
 * openUnifiedPortal()
 * Opens SVMI_PORTAL.html as a modeless dialog (1100×700px).
 * Contains 4 tabs: Input Portal | Store Insights |
 *                  Visits This Month | System Tools
 */
function openUnifiedPortal() {
  // SVMI_PORTAL.html now has a template scriptlet (the "remember the
  // guest password" line near the top of <body>), so this must go through
  // createTemplateFromFile()/evaluate() like doGet()/doPost() do — plain
  // createHtmlOutputFromFile() would leave that tag as literal broken JS.
  // This dialog only opens from inside the Sheet itself (already
  // collaborator-gated), so there's no password to remember here.
  const tmpl = HtmlService.createTemplateFromFile('SVMI_PORTAL');
  tmpl.enteredPassword = '';
  const html = tmpl.evaluate()
    .setWidth(1100)
    .setHeight(700);
  SpreadsheetApp.getUi().showModelessDialog(html, 'SVMI Command Center');
}

/**
 * doGet(e) / doPost(e)
 * Web App entry points. Lets this project be opened as a standalone
 * page at its deployment URL (Deploy > New deployment > Web app),
 * instead of only via the in-Sheet "Open Command Center" menu item.
 *
 * Both funnel through _handleWebAppRequest_() in SVMKPI_ACCESS.gs, which
 * enforces the guest password (SETTINGS!I2) BEFORE serving SVMI_PORTAL.html
 * — a wrong or missing password gets the lock screen (SVMI_LOCK.html)
 * instead, so the portal's code (and everything it can call via
 * google.script.run) is never sent to a browser that hasn't unlocked it.
 * doPost exists so the lock screen's form can submit the password without
 * putting it in the URL/browser history.
 *
 * Serves the exact same SVMI_PORTAL.html used by openUnifiedPortal() —
 * all tabs and every google.script.run call work identically, since
 * this is a container-bound script: SpreadsheetApp.getActiveSpreadsheet()
 * still resolves to the Sheet this script is attached to, however the
 * script was invoked (menu, trigger, or web app request).
 *
 * @param {GoogleAppsScript.Events.DoGet} e  e.parameter.pw carries the
 *        guest password, from either the URL (GET) or the lock form (POST).
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  return _handleWebAppRequest_(e);
}

function doPost(e) {
  return _handleWebAppRequest_(e);
}

// sl_getCurrentUser(), sl_isAdmin(), and the guest-password gate all live
// in SVMKPI_ACCESS.gs now — kept together since they're one concern.


// ═══════════════════════════════════════════════════════════════
// SECTION 3: MENU HANDLERS
// ═══════════════════════════════════════════════════════════════

function menuRebuildDashboard() {
  const ui = SpreadsheetApp.getUi();
  try {
    buildExecutiveSummaryLayout();
    ui.alert('Done', 'Executive Summary rebuilt with live formulas.', ui.ButtonSet.OK);
  } catch (e) { _adminError('menuRebuildDashboard', e); }
}

function menuRefreshStoreHealth() {
  const ui = SpreadsheetApp.getUi();
  try {
    refreshRiskEngine();
    ui.alert('Done', 'Store Health sheet refreshed.', ui.ButtonSet.OK);
  } catch (e) { _adminError('menuRefreshStoreHealth', e); }
}

function menuRebuildKPI2026() {
  const ui = SpreadsheetApp.getUi();
  try {
    buildKPI2026();
    ui.alert('Done', 'KPI 2026 rebuilt with SUMPRODUCT formulas.', ui.ButtonSet.OK);
  } catch (e) { _adminError('menuRebuildKPI2026', e); }
}

function menuRebuildDataHeaders() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = rebuildDataSheetHeaders();
    const msg = result.results.map(r =>
      (r.success ? '✅' : '❌') + ' ' + r.sheet + (r.error ? ': ' + r.error : '')
    ).join('\n');
    ui.alert('Data Sheet Headers', msg, ui.ButtonSet.OK);
  } catch (e) { _adminError('menuRebuildDataHeaders', e); }
}

function menuValidateMasterLog() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = validateMasterLog();
    let message = result.summary;
    if (!result.valid) {
      const preview = result.errors.slice(0, 10)
        .map(e => 'Row ' + e.row + ' [' + e.col + '] ' + e.field + ': ' + e.message)
        .join('\n');
      message += '\n\n' + preview;
      if (result.errors.length > 10) message += '\n... and ' + (result.errors.length - 10) + ' more.';
    }
    ui.alert(result.valid ? 'Validation Passed' : 'Validation Failed', message, ui.ButtonSet.OK);
  } catch (e) { _adminError('menuValidateMasterLog', e); }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: PORTAL BACKEND — callable from SVMI_PORTAL.html
// ═══════════════════════════════════════════════════════════════

/**
 * portal_rebuildExecutiveSummary()
 * Called by System Tools tab in the portal. Admin-only (see
 * SVMKPI_ACCESS.gs) — the client already hides this button for
 * non-admins, this is the check that actually matters since a client
 * check alone can't stop someone calling the function directly.
 */
function portal_rebuildExecutiveSummary() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    buildExecutiveSummaryLayout();
    return { success: true, message: 'Executive Summary rebuilt with live formulas.' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_rebuildStoreHealth()
 * Admin-only — see portal_rebuildExecutiveSummary() above. All six
 * System Tools are now admin-only, not just the three destructive ones.
 */
function portal_rebuildStoreHealth() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    const result = refreshRiskEngine();
    return { success: result.success, message: 'Store Health sheet refreshed. ' + result.rows + ' MASTER_LOG rows scanned.' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_rebuildKPI2026()
 * Admin-only — see portal_rebuildExecutiveSummary() above.
 */
function portal_rebuildKPI2026() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    const result = buildKPI2026();
    return { success: result.success, message: 'KPI 2026 rebuilt. ' + result.visitors + ' visitors, SUMPRODUCT formulas written.' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_rebuildDataHeaders()
 * Admin-only — see portal_rebuildExecutiveSummary() above.
 */
function portal_rebuildDataHeaders() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    const result = rebuildDataSheetHeaders();
    const msg = result.results.map(r =>
      (r.success ? '✅' : '❌') + ' ' + r.sheet + (r.error ? ': ' + r.error : '')
    ).join('  |  ');
    return { success: result.success, message: msg };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_rebuildStoreMaster()
 * Admin-only — see portal_rebuildExecutiveSummary() above.
 */
function portal_rebuildStoreMaster() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  try {
    const result = rebuildStoreMasterInsight();
    return { success: result.success, message: result.message };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_validateMasterLog()
 * Admin-only — see portal_rebuildExecutiveSummary() above. Read-only
 * itself, but every System Tool is locked down the same way now.
 */
function portal_validateMasterLog() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.', errors: [] };
  try {
    const result = validateMasterLog();
    return { success: result.valid, message: result.summary, errors: result.errors ? result.errors.slice(0,20) : [] };
  } catch (e) {
    return { success: false, message: e.message, errors: [] };
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: TRIGGER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

const TRIGGER_FN_NAME = 'triggerRefreshDashboard';

function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger(TRIGGER_FN_NAME)
    .timeBased().everyDays(1).atHour(6).create();
  Logger.log('[SVMKPI] Trigger installed: ' + TRIGGER_FN_NAME + ' (daily ~06:00).');
}

function removeTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === TRIGGER_FN_NAME) {
      ScriptApp.deleteTrigger(t); removed++;
    }
  });
  Logger.log('[SVMKPI] Triggers removed: ' + removed);
}

function triggerRefreshDashboard() {
  try {
    const result = refreshRiskEngine();
    Logger.log('[SVMKPI] Triggered refresh ' +
      (result.success ? 'succeeded.' : 'failed: ' + result.failed));
  } catch (e) {
    Logger.log('[SVMKPI] Triggered refresh error: ' + e.message);
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6: INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════

function _adminError(context, error) {
  Logger.log('[ADMIN ERROR] ' + context + ': ' + error.message);
  SpreadsheetApp.getUi().alert('Error in ' + context, error.message, SpreadsheetApp.getUi().ButtonSet.OK);
}
