// ============================================================
// SVMKPI_RISK.gs
// Store Visit Monitoring KPI — Store Health v2.0.0
// Pilot module: STORE VISIT MONITORING INITIATIVE (SVMI)
// Source of truth: SVMI Project Handoff — Store Health v1 (approved)
// Scoring revision v2.0.0: cadence-based compliance (per-category visit
// window, replacing the old flat day-buckets) + monthly Failed QA/MS
// decay (a failure's +5 penalty fades by 1 point per clean month that
// follows — 5 clean months to fully decay one failure — replacing a
// flat, permanent +5/failure).
// ------------------------------------------------------------
// Contains:
//   1. Constants (Store Health only — no overlap with CORE.gs)
//   2. Helpers
//   3. Risk Core Formulas
//   4. Risk Computation
//   5. Sheet Build + Populate (presentation delegated to RISK_LAYOUT.gs)
//   6. Orchestrator
// ------------------------------------------------------------
// Reuses from SVMKPI_CORE.gs (read-only — never redeclared here):
//   SHEET.MASTER_LOG, SHEET.SETTINGS, COL, _getSheet(), _getData(),
//   _normalizeEnum(), APPROVED_PURPOSES, _log()
// Reuses from SVMKPI_REPORTING_YEAR.gs (read-only — never redeclared
// here): getDefaultReportingYear() — Phase 1C. _computeStoreRisk()'s
// evaluation year is now an explicit parameter (never the old DATA_YEAR
// literal); this is the fallback ONLY when the caller omits it.
// Reuses from SVMKPI_RISK_CONFIG.gs / SVMKPI_COMPLIANCE_CONFIG.gs
// (read-only — never redeclared here, and never a hard dependency: every
// call site falls back to this file's own pre-Phase-1D hardcoded
// constants when those files aren't loaded): resolveRiskConfigurationAsOf(),
// risk_resolvePurposeWeight(), cmp_getCadenceDays() — Phase 1D. The
// canonical scoring ALGORITHM in this file is unchanged; only the
// threshold/weight/cadence NUMBERS it reads are now configuration-driven.
// Reuses from SVMKPI_RISK_LAYOUT.gs (read-only — never redeclared here):
//   RISK_ROW, RISK_KPI_CARDS, buildRiskEngineLayout(),
//   applyRiskLastRefreshed(), applyRiskKPICards(),
//   applyRiskExecutiveFocus(), applyRiskTableFormatting()
// Reuses from SVMKPI_STORE_LOOKUP.gs (read-only — never redeclared here):
//   _sl_formatDate() — NOT redeclared here even though this file's
//   helpers otherwise use an _sl_ prefix, since a second same-named
//   function in a different file would silently shadow one or the
//   other depending on load order (see DEPLOY.md / past incidents:
//   RISK_COL_WIDTHS, KPI_YEAR). One shared copy, reused.
//
// Does NOT contain:
//   - Menus / triggers           → SVMKPI_ADMIN.gs (menu patch only)
//   - Executive Summary logic    → SVMKPI_CORE.gs / SVMKPI_LAYOUT.gs (untouched)
//   - Presentation / formatting  → SVMKPI_RISK_LAYOUT.gs
//   - Compliance-gap windows     → SVMKPI_STORE_LOOKUP.gs's
//     sl_getComplianceGaps()/sl_getUnvisitedThisMonth() (untouched) —
//     those already exist there with the calendar-month-aligned window
//     this project standardized on; not duplicated here with a
//     different cadence-day-threshold definition.
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

// Approved risk tiers — cutoffs unchanged from v1; only what feeds them changed
const RISK_TIER_LABEL = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };

// Approved recommended actions
const RISK_ACTION_LABEL = {
  LOW:    'Monitor',
  MEDIUM: 'Planned Follow-up',
  HIGH:   'Immediate Intervention',
};

// Per-visit-purpose score, applied every month Jan through the current
// month. STORE VISIT/CURING/TLTC actively lower risk (real coverage
// happened); FAILED QA/MS raises it, but decays — see
// _sl_computeMonthlyPurposeScores().
const RISK_PURPOSE_SCORE = {
  'FAILED QA/MS':    5,
  'STORE VISIT':    -2,
  'CURING/SUPPORT': -4,
  'TLTC':           -1,
};

// Required visit cadence per store category, in days.
const RISK_CADENCE = {
  MONTHLY: 31,
  QUARTERLY: 92,
  SEMI_ANNUAL: 183,
};


// ═══════════════════════════════════════════════════════════════
// SECTION 2: HELPERS
// ═══════════════════════════════════════════════════════════════

function _sl_isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

function _sl_startOfDay(d) {
  if (!_sl_isValidDate(d)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function _sl_normalizeText(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * _sl_getCadenceDays(category, dateRef)
 * Phase 1D: resolves via cmp_getCadenceDays() (SVMKPI_COMPLIANCE_CONFIG.gs)
 * — CONFIG_COMPLIANCE as of `dateRef`, itself falling back to these exact
 * hardcoded values when no version exists — when that file is loaded.
 * Falls back to the hardcoded RISK_CADENCE map directly (unchanged
 * pre-Phase-1D behavior) when it isn't, so this file still works
 * standalone (existing tests that load only SVMKPI_RISK.gs are
 * unaffected).
 * @param {string} category — SETTINGS category (NCR, NEAR PROVINCIAL,
 *   FAR PROVINCIAL, FLIGHT PROVINCIAL — or already-normalized MONTHLY/
 *   QUARTERLY/SEMI-ANNUAL)
 * @param {Date} [dateRef] - resolution date; omit for today
 * @returns {number} required days between visits, or 0 if unrecognized
 */
function _sl_getCadenceDays(category, dateRef) {
  if (typeof cmp_getCadenceDays === 'function') {
    return cmp_getCadenceDays(category, dateRef);
  }
  const cat = _sl_normalizeText(category);
  if (cat === 'NCR' || cat === 'NEAR PROVINCIAL' || cat === 'MONTHLY') return RISK_CADENCE.MONTHLY;
  if (cat === 'FAR PROVINCIAL' || cat === 'QUARTERLY') return RISK_CADENCE.QUARTERLY;
  if (cat === 'FLIGHT PROVINCIAL' || cat === 'SEMI-ANNUAL' || cat === 'SEMI ANNUAL') return RISK_CADENCE.SEMI_ANNUAL;
  return 0;
}

function _sl_getCategoryLabel(category) {
  const cat = _sl_normalizeText(category);
  if (cat === 'NCR' || cat === 'NEAR PROVINCIAL' || cat === 'MONTHLY') return 'Monthly';
  if (cat === 'FAR PROVINCIAL' || cat === 'QUARTERLY') return 'Quarterly';
  if (cat === 'FLIGHT PROVINCIAL' || cat === 'SEMI-ANNUAL' || cat === 'SEMI ANNUAL') return 'Semi-Annual';
  return 'Unknown';
}

/**
 * _sl_resolveTiebreak(purposes)
 * Picks the highest-priority purpose among same-day visits.
 * Approved order: FAILED QA/MS → CURING/SUPPORT → TLTC → STORE VISIT.
 * @param {string[]} purposes
 * @returns {string}
 */
function _sl_resolveTiebreak(purposes) {
  if (!purposes || purposes.length === 0) return '';
  for (const p of RISK_PURPOSE_PRIORITY) {
    if (purposes.indexOf(p) !== -1) return p;
  }
  return purposes[0];
}

/**
 * _sl_getStoreMetaLookup()
 * @returns {object} store name (uppercase) -> {store, brand, region, category}
 */
function _sl_getStoreMetaLookup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = ss.getSheetByName(SHEET.SETTINGS);
  const lookup = {};

  if (!settings || settings.getLastRow() < 2) return lookup;

  const rows = settings.getRange(2, 1, settings.getLastRow() - 1, 5).getValues();
  rows.forEach(row => {
    const store = _sl_normalizeText(row[0]);
    if (!store) return;
    lookup[store] = {
      store,
      brand: _sl_normalizeText(row[1]) || '—',
      region: _sl_normalizeText(row[2]) || '—',
      category: _sl_normalizeText(row[4]) || '—',
    };
  });

  return lookup;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: RISK CORE FORMULAS
// ═══════════════════════════════════════════════════════════════

/**
 * _sl_computeComplianceScore(lastDate, category, today)
 * Compares the store's last visit against its category's required
 * cadence. A store with NO visit history at all scores the same as one
 * that's OVERDUE (+3) — never visited is not better than merely late;
 * v1 of this model scored "no history" as 0 (neutral), which ranked a
 * never-visited store as less urgent than one just past its window.
 * @returns {{score:number, status:string, cadenceDays:number, daysSince:(number|null), label:string}}
 */
function _sl_computeComplianceScore(lastDate, category, today) {
  const cadenceDays = _sl_getCadenceDays(category, today);
  const categoryLabel = _sl_getCategoryLabel(category);

  if (!cadenceDays) {
    return { score: 0, status: 'UNKNOWN', cadenceDays: 0, daysSince: null, label: categoryLabel };
  }

  if (!_sl_isValidDate(lastDate)) {
    return { score: 3, status: 'NO HISTORY', cadenceDays, daysSince: null, label: categoryLabel };
  }

  const d = _sl_startOfDay(lastDate);
  const ref = _sl_startOfDay(today) || new Date();
  const daysSince = Math.max(0, Math.floor((ref - d) / 86400000));
  const withinTimeFrame = daysSince <= cadenceDays;

  return {
    score: withinTimeFrame ? -3 : 3,
    status: withinTimeFrame ? 'WITHIN TIME FRAME' : 'OVERDUE',
    cadenceDays,
    daysSince,
    label: categoryLabel,
  };
}

/**
 * _sl_riskTier(score, dateRef)
 * Approved Risk Tier: LOW/MEDIUM/HIGH by threshold. Phase 1D: cutoffs
 * resolve via resolveRiskConfigurationAsOf() (SVMKPI_RISK_CONFIG.gs) as
 * of `dateRef` when that file is loaded — same 5/10 defaults as v1
 * (RISK_CFG_DEFAULT_THRESHOLDS) when no CONFIG_RISK version exists yet.
 * Falls back to the literal 5/10 cutoffs directly (unchanged pre-Phase-1D
 * behavior) when the config file isn't loaded at all.
 * @param {number} score
 * @param {Date} [dateRef] - resolution date; omit for today
 * @returns {string}
 */
function _sl_riskTier(score, dateRef) {
  const t = (typeof resolveRiskConfigurationAsOf === 'function')
    ? resolveRiskConfigurationAsOf(dateRef)
    : { mediumThreshold: 5, highThreshold: 10 };
  if (score >= t.highThreshold) return RISK_TIER_LABEL.HIGH;
  if (score >= t.mediumThreshold) return RISK_TIER_LABEL.MEDIUM;
  return RISK_TIER_LABEL.LOW;
}

/**
 * _sl_attentionReason(activeFailedPenalty, complianceStatus, categoryLabel, hasHistory)
 * Single most important reason a store needs attention, in priority order:
 *   1. Repeated QA/MS Interventions (undecayed penalty >= 10, i.e. 2+ live failures)
 *   2. QA/MS Intervention (some undecayed penalty)
 *   3. {Category} Visit Overdue (past its cadence window)
 *   4. No Visit History (never visited)
 *   5. No Risk Factors
 * @returns {string}
 */
function _sl_attentionReason(activeFailedPenalty, complianceStatus, categoryLabel, hasHistory) {
  if (activeFailedPenalty >= 10) return 'Repeated QA/MS Interventions';
  if (activeFailedPenalty > 0) return 'QA/MS Intervention';
  if (complianceStatus === 'OVERDUE') return categoryLabel + ' Visit Overdue';
  if (complianceStatus === 'NO HISTORY' && !hasHistory) return 'No Visit History';
  return 'No Risk Factors';
}

/**
 * _sl_computeMonthlyPurposeScores(monthBuckets, monthLimit)
 * Walks January through the reference month, summing RISK_PURPOSE_SCORE
 * for every visit (basePurposeScore — permanent, no decay: more good
 * visits over the year keeps lowering it). Failed QA/MS is tracked
 * separately as activeFailedPenalty: +5 per failure in a month that had
 * one, but any month with ZERO failures decays the running penalty by
 * just 1 point (floored at 0) — a single failure (+5) takes 5 clean
 * months to fully decay, not one; repeated failing months never get the
 * chance to decay at all.
 * Phase 1D: each purpose's weight resolves via risk_resolvePurposeWeight()
 * (SVMKPI_RISK_CONFIG.gs) as of `dateRef` when that file is loaded —
 * falling back to RISK_PURPOSE_SCORE directly (unchanged pre-Phase-1D
 * behavior) when it isn't. Resolved ONCE per call (as of the overall
 * evaluation date), not re-resolved per historical month within the
 * same YTD roll-up — the existing monthBuckets aggregation already
 * collapses events to per-month counts before this function ever sees
 * them, so per-EVENT historical weight resolution isn't achievable
 * without restructuring that aggregation itself, which is out of this
 * phase's scope (documented in DEPLOY.md).
 * @param {object[]} monthBuckets — 12 entries: {failedCount, storeVisitCount, curingCount, tltcCount}
 * @param {number} monthLimit — 0-based index of the last month to include
 * @param {Date} [dateRef] - weight-resolution date; omit for today
 * @returns {{basePurposeScore:number, activeFailedPenalty:number, totalPurposeScore:number}}
 */
function _sl_computeMonthlyPurposeScores(monthBuckets, monthLimit, dateRef) {
  const _weightOf = (purpose) => {
    if (typeof risk_resolvePurposeWeight === 'function') {
      const r = risk_resolvePurposeWeight(purpose, dateRef);
      if (r) return r.weight;
    }
    return RISK_PURPOSE_SCORE[purpose];
  };
  const wStoreVisit = _weightOf('STORE VISIT');
  const wCuring = _weightOf('CURING/SUPPORT');
  const wTltc = _weightOf('TLTC');
  const wFailed = _weightOf('FAILED QA/MS');

  let activeFailedPenalty = 0;
  let basePurposeScore = 0;

  for (let m = 0; m <= monthLimit; m++) {
    const b = monthBuckets[m];
    if (!b) continue;

    basePurposeScore += (b.storeVisitCount * wStoreVisit);
    basePurposeScore += (b.curingCount * wCuring);
    basePurposeScore += (b.tltcCount * wTltc);

    if (b.failedCount > 0) {
      activeFailedPenalty += (b.failedCount * wFailed);
    } else if (activeFailedPenalty > 0) {
      activeFailedPenalty = Math.max(0, activeFailedPenalty - 1);
    }
  }

  return {
    basePurposeScore: parseFloat(basePurposeScore.toFixed(2)),
    activeFailedPenalty: parseFloat(activeFailedPenalty.toFixed(2)),
    totalPurposeScore: parseFloat((basePurposeScore + activeFailedPenalty).toFixed(2)),
  };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: RISK COMPUTATION
// ═══════════════════════════════════════════════════════════════

/**
 * _computeStoreRisk(data, today, year)
 * Groups MASTER_LOG data (from CORE.gs _getData()) by store and
 * computes the v2.0.0 Store Health metrics for each store.
 *
 * `year` (Phase 1C) is the reporting year the YTD/monthly-purpose scoring
 * is evaluated against — the SAME implementation runs for any year; only
 * the event population it counts changes. Compliance (days-since-last-
 * visit vs. cadence) was always year-independent and is untouched. When
 * omitted, defaults to getDefaultReportingYear() (SVMKPI_REPORTING_YEAR.gs)
 * — never a hardcoded literal, so this never silently keeps meaning one
 * fixed year forever.
 * @param {object} data  - Parsed data object from CORE.gs _getData()
 * @param {Date}   today - Reference date for "days since visit"
 * @param {number} [year] - Reporting year for YTD/monthly scoring
 * @returns {object[]} One row object per store, unsorted
 */
function _computeStoreRisk(data, today, year) {
  const byStore = {};
  const metaLookup = _sl_getStoreMetaLookup();
  const evaluationYear = (year != null && !isNaN(Number(year))) ? Number(year) : getDefaultReportingYear();
  const monthLimit = (today.getFullYear && today.getFullYear() === evaluationYear)
    ? today.getMonth()
    : 11;

  const freshBucket = () => ({ failedCount: 0, storeVisitCount: 0, curingCount: 0, tltcCount: 0 });
  const freshStore = (name, meta) => ({
    store: name,
    brand: (meta && meta.brand !== '—') ? meta.brand : '—',
    region: (meta && meta.region !== '—') ? meta.region : '—',
    category: (meta && meta.category) || '—',
    lastDate: null,
    lastPurposes: [],
    totalYTD: 0,
    storeYTD: 0,
    failedCount: 0,
    curingCount: 0,
    tltcCount: 0,
    storeVisitCount: 0,
    monthlyBuckets: Array.from({ length: 12 }, freshBucket),
    hasHistory: false,
  });

  // Seed every store from SETTINGS first, not just ones with a MASTER_LOG
  // row: a store with zero visits ever previously got no entry at all
  // here, silently missing from Store Health entirely — exactly the
  // store this model should flag first. sl_getComplianceGaps() and
  // rebuildStoreMasterInsight() already seed from SETTINGS the same way.
  Object.keys(metaLookup).forEach(name => {
    if (!byStore[name]) byStore[name] = freshStore(name, metaLookup[name]);
  });

  for (let i = 0; i < data.stores.length; i++) {
    const store = _sl_normalizeText(data.stores[i]);
    if (!store) continue;

    const date = data.dates[i];
    const purpose = _sl_normalizeText(data.purposes[i]);
    const brand = _sl_normalizeText(data.brands[i]) || '—';
    const region = _sl_normalizeText(data.regions[i]) || '—';
    const meta = metaLookup[store];

    if (!byStore[store]) byStore[store] = freshStore(store, meta);
    const s = byStore[store];
    if (meta) {
      s.brand = meta.brand !== '—' ? meta.brand : (brand || s.brand);
      s.region = meta.region !== '—' ? meta.region : (region || s.region);
      s.category = meta.category || s.category;
    } else {
      s.brand = brand || s.brand;
      s.region = region || s.region;
    }

    if (_sl_isValidDate(date)) {
      s.hasHistory = true;
      if (!s.lastDate || date > s.lastDate) {
        s.lastDate = date;
        s.lastPurposes = [purpose];
      } else if (date.getTime() === s.lastDate.getTime()) {
        s.lastPurposes.push(purpose);
      }
    }

    const isYTD = _sl_isValidDate(date) && date.getFullYear() === evaluationYear && date.getMonth() <= monthLimit;
    if (isYTD) {
      const monthIdx = date.getMonth();
      s.totalYTD++;

      if (purpose === 'STORE VISIT') {
        s.storeYTD++;
        s.storeVisitCount++;
        s.monthlyBuckets[monthIdx].storeVisitCount++;
      }
      if (purpose === 'FAILED QA/MS') {
        s.failedCount++;
        s.monthlyBuckets[monthIdx].failedCount++;
      }
      if (purpose === 'CURING/SUPPORT') {
        s.curingCount++;
        s.monthlyBuckets[monthIdx].curingCount++;
      }
      if (purpose === 'TLTC') {
        s.tltcCount++;
        s.monthlyBuckets[monthIdx].tltcCount++;
      }
    }
  }

  return Object.values(byStore).map(s => {
    const lastPurpose = _sl_resolveTiebreak(s.lastPurposes);
    const monthlyScore = _sl_computeMonthlyPurposeScores(s.monthlyBuckets, monthLimit, today);
    const compliance = _sl_computeComplianceScore(s.lastDate, s.category, today);

    const rawScore = monthlyScore.totalPurposeScore + compliance.score;
    const totalScore = Math.max(0, parseFloat(rawScore.toFixed(2)));
    const tier = _sl_riskTier(totalScore, today);
    const reason = _sl_attentionReason(
      monthlyScore.activeFailedPenalty,
      compliance.status,
      compliance.label,
      s.hasHistory
    );

    return {
      store: s.store,
      brand: s.brand,
      region: s.region,
      category: s.category,
      lastDate: s.lastDate,
      lastPurpose,
      daysSince: compliance.daysSince,
      totalYTD: s.totalYTD,
      storeYTD: s.storeYTD,
      failedCount: s.failedCount,
      curingCount: s.curingCount,
      tltcCount: s.tltcCount,
      storeVisitCount: s.storeVisitCount,
      purposeScore: monthlyScore.totalPurposeScore,
      activeFailedPenalty: monthlyScore.activeFailedPenalty,
      basePurposeScore: monthlyScore.basePurposeScore,
      complianceScore: compliance.score,
      complianceStatus: compliance.status,
      complianceLabel: compliance.label,
      cadenceDays: compliance.cadenceDays,
      hasHistory: s.hasHistory,
      riskScore: totalScore,
      riskTier: tier,
      action: RISK_ACTION_LABEL[tier],
      attentionReason: reason,
    };
  });
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: SHEET BUILD + POPULATE
// ═══════════════════════════════════════════════════════════════

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
 * populateRiskEngine(sheet, data, year)
 * Computes per-store risk rows and writes them to the STORE HEALTH
 * sheet, sorted by Risk Score descending (highest risk first).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - STORE HEALTH sheet
 * @param {object} data - Parsed data object from CORE.gs _getData()
 * @param {number} [year] - Reporting year (Phase 1C); see _computeStoreRisk()
 */
function populateRiskEngine(sheet, data, year) {
  const today = new Date();
  const rows  = _computeStoreRisk(data, today, year)
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

  // KPI tallies — pure counts of already-computed tiers/status, no new scoring
  const kpis = {
    total:       rows.length,
    high:        rows.filter(r => r.riskTier === 'HIGH').length,
    medium:      rows.filter(r => r.riskTier === 'MEDIUM').length,
    low:         rows.filter(r => r.riskTier === 'LOW').length,
    coverageGap: rows.filter(r => r.complianceStatus === 'OVERDUE' || r.complianceStatus === 'NO HISTORY').length,
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
// SECTION 6: ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

/**
 * refreshRiskEngine(year)
 * Sole externally-called entry point. Builds the sheet (if needed)
 * and repopulates it from MASTER_LOG via CORE.gs's _getData().
 * @param {number} [year] - Reporting year (Phase 1C); omit for
 *   getDefaultReportingYear() (SVMKPI_REPORTING_YEAR.gs) — the latest
 *   year actually present in MASTER_LOG, never a hardcoded literal.
 * @returns {{ success: boolean, rows: number }}
 */
function refreshRiskEngine(year) {
  const masterLog = _getSheet(SHEET.MASTER_LOG);
  const data      = _getData(masterLog);
  const sheet     = buildRiskEngineSheet();

  populateRiskEngine(sheet, data, year);
  SpreadsheetApp.flush();

  const scannedRows = (data && typeof data.totalRows === 'number')
    ? data.totalRows
    : (data && Array.isArray(data.stores) ? data.stores.length : 0);

  _log('Store Health refreshed. ' + scannedRows + ' rows scanned.');
  return { success: true, rows: scannedRows };
}
