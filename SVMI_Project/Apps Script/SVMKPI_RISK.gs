// ============================================================
// SVMKPI_RISK.gs
// Store Visit Monitoring KPI — Store Health v1
// Pilot module: STORE VISIT MONITORING INITIATIVE (SVMI)
// Source of truth: SVMI Project Handoff — Store Health v1 (approved)
// ------------------------------------------------------------
// Contains:
//   1. Constants (Store Health only — no overlap with CORE.gs)
//   2. Risk Computation
//   3. Sheet Build + Populate (presentation delegated to RISK_LAYOUT.gs)
//   4. Orchestrator
// ------------------------------------------------------------
// Reuses from SVMKPI_CORE.gs (read-only — never redeclared here):
//   SHEET.MASTER_LOG, COL, _getSheet(), _getData(),
//   _normalizeEnum(), APPROVED_PURPOSES, DATA_YEAR, _log()
// Reuses from SVMKPI_RISK_LAYOUT.gs (read-only — never redeclared here):
//   RISK_ROW, buildRiskEngineLayout(), applyRiskLastRefreshed(),
//   applyRiskKPICards(), applyRiskExecutiveFocus(), applyRiskTableFormatting()
//
// Does NOT contain:
//   - Menus / triggers           → SVMKPI_ADMIN.gs (menu patch only)
//   - Executive Summary logic    → SVMKPI_CORE.gs / SVMKPI_LAYOUT.gs (untouched)
//   - Presentation / formatting  → SVMKPI_RISK_LAYOUT.gs
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS
// ═══════════════════════════════════════════════════════════════

const RISK_SHEET_NAME = 'STORE HEALTH';

// Output column layout (1-based) — owned exclusively by this file
const RISK_COL = {
  STORE:        1,  // A
  BRAND:        2,  // B
  REGION:       3,  // C
  LAST_DATE:    4,  // D
  LAST_PURPOSE: 5,  // E
  DAYS_SINCE:   6,  // F
  TOTAL_YTD:    7,  // G
  STORE_YTD:    8,  // H
  FAILED_COUNT: 9,  // I
  CURING_COUNT: 10, // J
  RISK_SCORE:   11, // K
  RISK_TIER:    12, // L
  ACTION:       13, // M
  ATTENTION_REASON: 14, // N
};

const RISK_HEADERS = [
  'Store Name', 'Brand', 'Region', 'Last Visit Date', 'Last Visit Purpose',
  'Days Since Visit', 'Total Visits YTD', 'Store Visits YTD',
  'Failed QA/MS Count', 'Curing/Support Count',
  'Risk Score', 'Risk Tier', 'Recommended Action', 'Attention Reason',
];

// Approved last-visit-purpose tiebreaker (highest priority first)
const RISK_PURPOSE_PRIORITY = ['FAILED QA/MS', 'CURING/SUPPORT', 'TLTC', 'STORE VISIT'];

// Approved risk tiers
const RISK_TIER_LABEL = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };

// Approved recommended actions
const RISK_ACTION_LABEL = {
  LOW:    'Monitor',
  MEDIUM: 'Planned Follow-up',
  HIGH:   'Immediate Intervention',
};


// ═══════════════════════════════════════════════════════════════
// SECTION 2: RISK COMPUTATION
// ═══════════════════════════════════════════════════════════════

/**
 * _computeStoreRisk(data, today)
 * Groups MASTER_LOG data (from CORE.gs _getData()) by store and
 * computes the approved Store Health v1 metrics for each store.
 * @param {object} data  - Parsed data object from CORE.gs _getData()
 * @param {Date}   today - Reference date for "days since visit"
 * @returns {object[]} One row object per store, unsorted
 */
function _computeStoreRisk(data, today) {
  const byStore = {};
  const quarter = _getCurrentQuarterRange(today);

  for (let i = 0; i < data.stores.length; i++) {
    const store = data.stores[i];
    if (!store) continue;

    const date    = data.dates[i];
    const purpose = data.purposes[i];
    const isYTD   = (date instanceof Date) && !isNaN(date) && date.getFullYear() === DATA_YEAR;
    const isValidDate = (date instanceof Date) && !isNaN(date);
    const isQualifying = APPROVED_PURPOSES.indexOf(purpose) !== -1;
    const inCurrentQuarter = isValidDate && isQualifying &&
      date >= quarter.start && date <= quarter.end;

    if (!byStore[store]) {
      byStore[store] = {
        store, brand: data.brands[i], region: data.regions[i],
        lastDate: null, lastPurposes: [],
        totalYTD: 0, storeYTD: 0, failedCount: 0, curingCount: 0,
        hasQuarterVisit: false,
      };
    }
    const s = byStore[store];

    // Keep most recent brand/region seen (current state)
    s.brand  = data.brands[i]  || s.brand;
    s.region = data.regions[i] || s.region;

    if (isValidDate) {
      if (!s.lastDate || date > s.lastDate) {
        s.lastDate     = date;
        s.lastPurposes = [purpose];
      } else if (date.getTime() === s.lastDate.getTime()) {
        s.lastPurposes.push(purpose);
      }
    }

    if (inCurrentQuarter) s.hasQuarterVisit = true;

    if (isYTD) {
      s.totalYTD++;
      if (purpose === 'STORE VISIT')    s.storeYTD++;
      if (purpose === 'FAILED QA/MS')   s.failedCount++;
      if (purpose === 'CURING/SUPPORT') s.curingCount++;
    }
  }

  return Object.values(byStore).map(s => {
    const lastPurpose = _resolveTiebreak(s.lastPurposes);
    const daysSince    = s.lastDate
      ? Math.floor((today - s.lastDate) / 86400000)
      : null;

    const score = _riskScore(s.failedCount, daysSince, s.hasQuarterVisit);
    const tier  = _riskTier(score);
    const reason = _attentionReason(s.failedCount, s.hasQuarterVisit, daysSince);

    return {
      store: s.store, brand: s.brand, region: s.region,
      lastDate: s.lastDate, lastPurpose,
      daysSince, totalYTD: s.totalYTD, storeYTD: s.storeYTD,
      failedCount: s.failedCount, curingCount: s.curingCount,
      hasQuarterVisit: s.hasQuarterVisit,
      riskScore: score, riskTier: tier,
      action: RISK_ACTION_LABEL[tier],
      attentionReason: reason,
    };
  });
}

/**
 * _getCurrentQuarterRange(today)
 * Returns the start/end Date bounds of today's calendar quarter.
 * @param {Date} today
 * @returns {{ start: Date, end: Date }}
 */
function _getCurrentQuarterRange(today) {
  const year = today.getFullYear();
  const q    = Math.floor(today.getMonth() / 3);  // 0-3
  const start = new Date(year, q * 3, 1, 0, 0, 0, 0);
  const end   = new Date(year, q * 3 + 3, 0, 23, 59, 59, 999);  // last day of quarter
  return { start, end };
}

/**
 * _resolveTiebreak(purposes)
 * Picks the highest-priority purpose among same-day visits.
 * Approved order: FAILED QA/MS → CURING/SUPPORT → TLTC → STORE VISIT.
 * @param {string[]} purposes
 * @returns {string}
 */
function _resolveTiebreak(purposes) {
  if (!purposes || purposes.length === 0) return '';
  for (const p of RISK_PURPOSE_PRIORITY) {
    if (purposes.indexOf(p) !== -1) return p;
  }
  return purposes[0];
}

/**
 * _riskScore(failedCount, daysSince, hasQuarterVisit)
 * Final approved Risk Scoring model:
 *   FAILED QA/MS                = +5 each
 *   No current-quarter visit    = +3
 *   Recency: 0-14 days  = +0
 *            15-30 days = +1
 *            31-90 days = +2
 *            91+ days   = +4
 *   Never visited treated as 91+ recency bucket.
 *   CURING/SUPPORT = informational only (no score impact)
 *
 * Guarantees:
 *   - Max score with zero Failed QA/MS history = 3 + 4 = 7 (MEDIUM ceiling)
 *     → coverage/recency alone can never reach HIGH.
 *   - Repeated Failed QA/MS remains the only path to HIGH.
 * @returns {number}
 */
function _riskScore(failedCount, daysSince, hasQuarterVisit) {
  let score = failedCount * 5;

  if (!hasQuarterVisit) score += 3;

  if (daysSince === null) {
    score += 4;                      // never visited — most severe recency bucket
  } else if (daysSince >= 91) {
    score += 4;
  } else if (daysSince >= 31) {
    score += 2;
  } else if (daysSince >= 15) {
    score += 1;
  }

  return score;
}

/**
 * _attentionReason(failedCount, hasQuarterVisit, daysSince)
 * Returns the single most important reason a store needs attention,
 * using the approved priority order:
 *   1. Repeated QA/MS Interventions (failedCount >= 2)
 *   2. QA/MS Intervention (failedCount === 1)
 *   3. No Visit This Quarter (!hasQuarterVisit)
 *   4. Long Recency Gap — 91+ Days (daysSince >= 91, or never visited)
 *   5. No Risk Factors
 * @returns {string}
 */
function _attentionReason(failedCount, hasQuarterVisit, daysSince) {
  if (failedCount >= 2) return failedCount + ' QA/MS Interventions';
  if (failedCount === 1) return 'QA/MS Intervention';
  if (!hasQuarterVisit) return 'No Visit This Quarter';
  if (daysSince !== null && daysSince >= 91) return daysSince + ' Days Since Last Visit';
  return 'No Risk Factors';
}

/**
 * _riskTier(score)
 * Approved Risk Tier: 0-4 LOW, 5-9 MEDIUM, 10+ HIGH.
 * @returns {string}
 */
function _riskTier(score) {
  if (score >= 10) return RISK_TIER_LABEL.HIGH;
  if (score >= 5)  return RISK_TIER_LABEL.MEDIUM;
  return RISK_TIER_LABEL.LOW;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: SHEET BUILD + POPULATE
// ═══════════════════════════════════════════════════════════════

/**
 * buildRiskEngineSheet()
 * Creates the STORE HEALTH sheet if missing, clears it otherwise,
 * and writes the approved header row. Layout is owned by this file
 * only — does not touch SVMKPI_LAYOUT.gs or EXECUTIVE SUMMARY.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
/**
 * buildRiskEngineSheet()
 * Creates the STORE HEALTH sheet if missing, clears it otherwise,
 * and delegates all visual presentation (title, KPI cards, header
 * styling) to SVMKPI_RISK_LAYOUT.gs. This file only ensures the
 * sheet exists — no scoring, sorting, or data logic here.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function buildRiskEngineSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RISK_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(RISK_SHEET_NAME);
  } else {
    sheet.clear();
  }

  buildRiskEngineLayout(sheet);  // SVMKPI_RISK_LAYOUT.gs — presentation only

  return sheet;
}

/**
 * populateRiskEngine(sheet, data)
 * Computes per-store risk rows and writes them to the STORE HEALTH
 * sheet, sorted by Risk Score descending (highest risk first).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - STORE HEALTH sheet
 * @param {object} data - Parsed data object from CORE.gs _getData()
 */
function populateRiskEngine(sheet, data) {
  const today = new Date();
  const rows  = _computeStoreRisk(data, today)
    .sort((a, b) => b.riskScore - a.riskScore || a.store.localeCompare(b.store));

  if (rows.length === 0) return;

  const values = rows.map(r => [
    r.store,
    r.brand,
    r.region,
    r.lastDate || '',
    r.lastPurpose,
    r.daysSince === null ? 'NEVER VISITED' : r.daysSince,
    r.totalYTD,
    r.storeYTD,
    r.failedCount,
    r.curingCount,
    r.riskScore,
    r.riskTier,
    r.action,
    r.attentionReason,
  ]);

  sheet.getRange(RISK_ROW.DATA_START, 1, values.length, RISK_HEADERS.length).setValues(values);
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.LAST_DATE, values.length, 1).setNumberFormat('yyyy-mm-dd');

  // KPI tallies — pure counts of already-computed tiers, no new scoring
  const kpis = {
    total:       rows.length,
    high:        rows.filter(r => r.riskTier === 'HIGH').length,
    medium:      rows.filter(r => r.riskTier === 'MEDIUM').length,
    low:         rows.filter(r => r.riskTier === 'LOW').length,
    coverageGap: rows.filter(r => !r.hasQuarterVisit).length,
  };

  // Top 5 — same already-sorted array, no duplicate computation
  const top5 = rows.slice(0, 5).map(r => ({
    store:  r.store,
    region: r.region,
    tier:   r.riskTier,
    reason: r.attentionReason,
    action: r.action,
  }));

  applyRiskLastRefreshed(sheet, today);          // SVMKPI_RISK_LAYOUT.gs
  applyRiskKPICards(sheet, kpis);                // SVMKPI_RISK_LAYOUT.gs
  applyRiskExecutiveFocus(sheet, top5);          // SVMKPI_RISK_LAYOUT.gs
  applyRiskTableFormatting(sheet, rows.length);  // SVMKPI_RISK_LAYOUT.gs
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

/**
 * refreshRiskEngine()
 * Sole externally-called entry point. Builds the sheet (if needed)
 * and repopulates it from MASTER_LOG via CORE.gs's _getData().
 * @returns {{ success: boolean, rows: number }}
 */
function refreshRiskEngine() {
  const masterLog = _getSheet(SHEET.MASTER_LOG);
  const data      = _getData(masterLog);
  const sheet     = buildRiskEngineSheet();

  populateRiskEngine(sheet, data);
  SpreadsheetApp.flush();

  _log('Store Health refreshed. ' + Object.keys(data.stores).length + ' rows scanned.');
  return { success: true, rows: data.totalRows };
}
