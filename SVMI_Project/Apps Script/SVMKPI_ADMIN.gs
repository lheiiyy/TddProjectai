// ============================================================
// SVMKPI_ADMIN.gs  v2.1.0
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
// ============================================================

// ═══════════════════════════════════════════════════════════════
// SECTION 1: MENU
// ═══════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('STORE VISIT KPI')
    .addItem('Open Command Center', 'openUnifiedPortal')
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
  const html = HtmlService
    .createHtmlOutputFromFile('SVMI_PORTAL')
    .setWidth(1100)
    .setHeight(700);
  SpreadsheetApp.getUi().showModelessDialog(html, 'SVMI Command Center');
}

/**
 * doGet(e)
 * Web App entry point. Lets this project be opened as a standalone
 * page at its deployment URL (Deploy > New deployment > Web app),
 * instead of only via the in-Sheet "Open Command Center" menu item.
 *
 * Serves the exact same SVMI_PORTAL.html used by openUnifiedPortal() —
 * all 4 tabs and every google.script.run call work identically, since
 * this is a container-bound script: SpreadsheetApp.getActiveSpreadsheet()
 * still resolves to the Sheet this script is attached to, however the
 * script was invoked (menu, trigger, or web app request).
 *
 * @param {GoogleAppsScript.Events.DoGet} e  Unused — no query-param
 *        routing yet. Reserved for a future "?tab=" deep link.
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  return HtmlService
    .createHtmlOutputFromFile('SVMI_PORTAL')
    .setTitle('SVMI Command Center')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


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
 * Called by System Tools tab in the portal.
 */
function portal_rebuildExecutiveSummary() {
  try {
    buildExecutiveSummaryLayout();
    return { success: true, message: 'Executive Summary rebuilt with live formulas.' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_rebuildStoreHealth()
 */
function portal_rebuildStoreHealth() {
  try {
    const result = refreshRiskEngine();
    return { success: result.success, message: 'Store Health sheet refreshed. ' + result.rows + ' MASTER_LOG rows scanned.' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_rebuildKPI2026()
 */
function portal_rebuildKPI2026() {
  try {
    const result = buildKPI2026();
    return { success: result.success, message: 'KPI 2026 rebuilt. ' + result.visitors + ' visitors, SUMPRODUCT formulas written.' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_rebuildDataHeaders()
 */
function portal_rebuildDataHeaders() {
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
 */
function portal_rebuildStoreMaster() {
  try {
    const result = rebuildStoreMasterInsight();
    return { success: result.success, message: result.message };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * portal_validateMasterLog()
 */
function portal_validateMasterLog() {
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
