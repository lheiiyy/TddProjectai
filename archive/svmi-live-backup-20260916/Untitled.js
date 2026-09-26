// // ============================================================
// // SVMKPI_RISK.gs
// // Store Visit Monitoring KPI — Store Health v3.0.0
// // Pilot module: STORE VISIT MONITORING INITIATIVE (SVMI)
// // Source of truth: SVMI Project Handoff — Store Health v1 (approved)
// // Scoring revision: Purpose Score + Cadence Compliance Score
// // ------------------------------------------------------------
// // Contains:
// //   1. Constants (Store Health only — no overlap with CORE.gs)
// //   2. Risk Computation
// //   3. Sheet Build + Populate (presentation delegated to RISK_LAYOUT.gs)
// //   4. Orchestrator
// //   5. Compliance Utilities
// // ------------------------------------------------------------
// // Reuses from SVMKPI_CORE.gs (read-only — never redeclared here):
// //   SHEET.MASTER_LOG, COL, _getSheet(), _getData(),
// //   _normalizeEnum(), APPROVED_PURPOSES, DATA_YEAR, _log()
// // Reuses from SVMKPI_RISK_LAYOUT.gs (read-only — never redeclared here):
// //   RISK_ROW, buildRiskEngineLayout(), applyRiskLastRefreshed(),
// //   applyRiskKPICards(), applyRiskExecutiveFocus(), applyRiskTableFormatting()
// //
// // Does NOT contain:
// //   - Menus / triggers           → SVMKPI_ADMIN.gs (menu patch only)
// //   - Executive Summary logic    → SVMKPI_CORE.gs / SVMKPI_LAYOUT.gs (untouched)
// //   - Presentation / formatting  → SVMKPI_RISK_LAYOUT.gs
// // ============================================================

// // ═══════════════════════════════════════════════════════════════
// // SECTION 1: CONSTANTS
// // ═══════════════════════════════════════════════════════════════

// const RISK_SHEET_NAME = 'STORE HEALTH';

// // Fallbacks in case core constants are unavailable in a test context
// const SL_DATA_YEAR = (typeof DATA_YEAR !== 'undefined')
//   ? DATA_YEAR
//   : new Date().getFullYear();

// const SL_MASTER_LOG_NAME = (typeof SHEET !== 'undefined' && SHEET && SHEET.MASTER_LOG)
//   ? SHEET.MASTER_LOG
//   : 'MASTER_LOG';

// // Output column layout (1-based) — owned exclusively by this file
// const RISK_COL = {
//   STORE:            1,  // A
//   BRAND:            2,  // B
//   REGION:           3,  // C
//   LAST_DATE:        4,  // D
//   LAST_PURPOSE:     5,  // E
//   DAYS_SINCE:       6,  // F
//   TOTAL_YTD:        7,  // G
//   STORE_YTD:        8,  // H
//   FAILED_COUNT:     9,  // I
//   CURING_COUNT:    10,  // J
//   RISK_SCORE:      11,  // K
//   RISK_TIER:       12,  // L
//   ACTION:          13,  // M
//   ATTENTION_REASON: 14,  // N
// };

// const RISK_HEADERS = [
//   'Store Name', 'Brand', 'Region', 'Last Visit Date', 'Last Visit Purpose',
//   'Days Since Visit', 'Total Visits YTD', 'Store Visits YTD',
//   'Failed QA/MS Count', 'Curing/Support Count',
//   'Risk Score', 'Risk Tier', 'Recommended Action', 'Attention Reason',
// ];

// // Approved last-visit-purpose tiebreaker (highest priority first)
// const RISK_PURPOSE_PRIORITY = ['FAILED QA/MS', 'CURING/SUPPORT', 'TLTC', 'STORE VISIT'];

// // Approved risk tiers
// const RISK_TIER_LABEL = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };

// // Approved recommended actions
// const RISK_ACTION_LABEL = {
//   LOW:    'Monitor',
//   MEDIUM: 'Planned Follow-up',
//   HIGH:   'Immediate Intervention',
// };

// // Purpose scoring model
// const RISK_PURPOSE_SCORE = {
//   'FAILED QA/MS':    5,
//   'STORE VISIT':    -2,
//   'CURING/SUPPORT': -4,
//   'TLTC':           -1,
// };

// // Cadence rules by category
// const RISK_CADENCE = {
//   MONTHLY: 31,
//   QUARTERLY: 92,
//   SEMI_ANNUAL: 183,
// };

// // ═══════════════════════════════════════════════════════════════
// // SECTION 2: BASIC HELPERS
// // ═══════════════════════════════════════════════════════════════

// function _sl_isValidDate(d) {
//   return d instanceof Date && !isNaN(d.getTime());
// }

// function _sl_startOfDay(d) {
//   if (!_sl_isValidDate(d)) return null;
//   return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
// }

// function _sl_parseDate(value) {
//   if (_sl_isValidDate(value)) {
//     return _sl_startOfDay(value);
//   }
//   if (value === null || value === undefined) return null;

//   const raw = String(value).trim();
//   if (!raw) return null;

//   const native = new Date(raw);
//   if (_sl_isValidDate(native)) return _sl_startOfDay(native);

//   const m1 = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
//   if (m1) {
//     const d = new Date(
//       Number(m1[1]),
//       Number(m1[2]) - 1,
//       Number(m1[3]),
//       0, 0, 0, 0
//     );
//     return _sl_isValidDate(d) ? d : null;
//   }

//   return null;
// }

// function _sl_normalizeText(value) {
//   return String(value || '').trim().toUpperCase();
// }

// function _sl_normalizePipeList(value) {
//   return String(value || '')
//     .trim()
//     .toUpperCase()
//     .replace(/\s*\|\s*/g, '|');
// }

// function _sl_formatDate(date) {
//   const d = _sl_parseDate(date);
//   if (!d) return '—';
//   const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
//   const day = String(d.getDate()).padStart(2, '0');
//   return months[d.getMonth()] + ' ' + day + ', ' + d.getFullYear();
// }

// function _sl_getCadenceDays(category) {
//   const cat = _sl_normalizeText(category);

//   if (cat === 'NCR' || cat === 'NEAR PROVINCIAL' || cat === 'MONTHLY') {
//     return RISK_CADENCE.MONTHLY;
//   }
//   if (cat === 'FAR PROVINCIAL' || cat === 'QUARTERLY') {
//     return RISK_CADENCE.QUARTERLY;
//   }
//   if (cat === 'FLIGHT PROVINCIAL' || cat === 'SEMI-ANNUAL' || cat === 'SEMI ANNUAL') {
//     return RISK_CADENCE.SEMI_ANNUAL;
//   }

//   return 0;
// }

// function _sl_getCategoryLabel(category) {
//   const cat = _sl_normalizeText(category);

//   if (cat === 'NCR' || cat === 'NEAR PROVINCIAL' || cat === 'MONTHLY') return 'Monthly';
//   if (cat === 'FAR PROVINCIAL' || cat === 'QUARTERLY') return 'Quarterly';
//   if (cat === 'FLIGHT PROVINCIAL' || cat === 'SEMI-ANNUAL' || cat === 'SEMI ANNUAL') return 'Semi-Annual';

//   return 'Unknown';
// }

// function _sl_resolveTiebreak(purposes) {
//   if (!purposes || purposes.length === 0) return '';
//   for (const p of RISK_PURPOSE_PRIORITY) {
//     if (purposes.indexOf(p) !== -1) return p;
//   }
//   return purposes[0];
// }

// function _sl_getStoreMetaLookup() {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const settings = ss.getSheetByName('SETTINGS');
//   const lookup = {};

//   if (!settings || settings.getLastRow() < 2) return lookup;

//   const rows = settings.getRange(2, 1, settings.getLastRow() - 1, 5).getValues();
//   rows.forEach(row => {
//     const store = _sl_normalizeText(row[0]);
//     if (!store) return;

//     lookup[store] = {
//       store,
//       brand: _sl_normalizeText(row[1]) || '—',
//       region: _sl_normalizeText(row[2]) || '—',
//       category: _sl_normalizeText(row[4]) || '—',
//     };
//   });

//   return lookup;
// }

// // ═══════════════════════════════════════════════════════════════
// // SECTION 3: RISK CORE FORMULAS
// // ═══════════════════════════════════════════════════════════════

// function _sl_computePurposeScore(counts) {
//   const failedCount = counts.failedCount || 0;
//   const storeVisitCount = counts.storeVisitCount || 0;
//   const curingCount = counts.curingCount || 0;
//   const tltcCount = counts.tltcCount || 0;

//   const score =
//     (failedCount * RISK_PURPOSE_SCORE['FAILED QA/MS']) +
//     (storeVisitCount * RISK_PURPOSE_SCORE['STORE VISIT']) +
//     (curingCount * RISK_PURPOSE_SCORE['CURING/SUPPORT']) +
//     (tltcCount * RISK_PURPOSE_SCORE['TLTC']);

//   return {
//     score: parseFloat(score.toFixed(2)),
//     failedCount,
//     storeVisitCount,
//     curingCount,
//     tltcCount,
//   };
// }

// function _sl_computeComplianceScore(lastDate, category, today) {
//   const cadenceDays = _sl_getCadenceDays(category);
//   const categoryLabel = _sl_getCategoryLabel(category);

//   if (!cadenceDays) {
//     return {
//       score: 0,
//       status: 'UNKNOWN',
//       cadenceDays: 0,
//       daysSince: null,
//       label: categoryLabel,
//     };
//   }

//   const d = _sl_parseDate(lastDate);
//   if (!d) {
//     return {
//       score: 0,
//       status: 'NO HISTORY',
//       cadenceDays,
//       daysSince: null,
//       label: categoryLabel,
//     };
//   }

//   const ref = _sl_startOfDay(today) || new Date();
//   const daysSince = Math.max(0, Math.floor((ref - d) / 86400000));
//   const withinTimeFrame = daysSince <= cadenceDays;

//   return {
//     score: withinTimeFrame ? -3 : 3,
//     status: withinTimeFrame ? 'WITHIN TIME FRAME' : 'OVERDUE',
//     cadenceDays,
//     daysSince,
//     label: categoryLabel,
//   };
// }

// function _sl_riskScore(purposeScore, complianceScore) {
//   const raw = Number(purposeScore || 0) + Number(complianceScore || 0);
//   return Math.max(0, parseFloat(raw.toFixed(2)));
// }

// function _sl_riskTier(score) {
//   if (score >= 10) return RISK_TIER_LABEL.HIGH;
//   if (score >= 5) return RISK_TIER_LABEL.MEDIUM;
//   return RISK_TIER_LABEL.LOW;
// }

// function _sl_attentionReason(failedCount, complianceStatus, daysSince, categoryLabel) {
//   if (failedCount >= 2) return failedCount + ' QA/MS Interventions';
//   if (failedCount === 1) return 'QA/MS Intervention';
//   if (complianceStatus === 'OVERDUE') return categoryLabel + ' Visit Overdue';
//   if (complianceStatus === 'NO HISTORY') return 'No Visit History';
//   return 'No Risk Factors';
// }

// // ═══════════════════════════════════════════════════════════════
// // SECTION 4: RISK COMPUTATION
// // ═══════════════════════════════════════════════════════════════

// /**
//  * _computeStoreRisk(data, today)
//  * Groups MASTER_LOG data (from CORE.gs _getData()) by store and
//  * computes the approved Store Health v3 metrics for each store.
//  *
//  * Purpose score uses YTD rows only.
//  * Compliance score uses the latest visit date and store cadence category.
//  *
//  * @param {object} data  - Parsed data object from CORE.gs _getData()
//  * @param {Date}   today - Reference date for "days since visit"
//  * @returns {object[]} One row object per store, unsorted
//  */
// function _computeStoreRisk(data, today) {
//   const byStore = {};
//   const metaLookup = _sl_getStoreMetaLookup();

//   for (let i = 0; i < data.stores.length; i++) {
//     const store = _sl_normalizeText(data.stores[i]);
//     if (!store) continue;

//     const date = _sl_parseDate(data.dates[i]);
//     const purpose = _sl_normalizeText(data.purposes[i]);
//     const brand = _sl_normalizeText(data.brands[i]) || '—';
//     const region = _sl_normalizeText(data.regions[i]) || '—';
//     const meta = metaLookup[store] || { store, brand: '—', region: '—', category: '—' };

//     if (!byStore[store]) {
//       byStore[store] = {
//         store,
//         brand: meta.brand !== '—' ? meta.brand : brand,
//         region: meta.region !== '—' ? meta.region : region,
//         category: meta.category || '—',
//         lastDate: null,
//         lastPurposes: [],
//         totalYTD: 0,
//         storeYTD: 0,
//         failedCount: 0,
//         curingCount: 0,
//         tltcCount: 0,
//         storeVisitCount: 0,
//         purposeScore: 0,
//         hasHistory: false,
//       };
//     }

//     const s = byStore[store];

//     // Keep most recent brand/region seen (current state)
//     s.brand = meta.brand !== '—' ? meta.brand : (brand || s.brand);
//     s.region = meta.region !== '—' ? meta.region : (region || s.region);
//     s.category = meta.category || s.category;

//     if (_sl_isValidDate(date)) {
//       s.hasHistory = true;

//       if (!s.lastDate || date > s.lastDate) {
//         s.lastDate = date;
//         s.lastPurposes = [purpose];
//       } else if (s.lastDate && date.getTime() === s.lastDate.getTime()) {
//         s.lastPurposes.push(purpose);
//       }
//     }

//     const isYTD = _sl_isValidDate(date) && date.getFullYear() === SL_DATA_YEAR;
//     if (isYTD) {
//       s.totalYTD++;

//       if (purpose === 'STORE VISIT') {
//         s.storeYTD++;
//         s.storeVisitCount++;
//       }
//       if (purpose === 'FAILED QA/MS') {
//         s.failedCount++;
//       }
//       if (purpose === 'CURING/SUPPORT') {
//         s.curingCount++;
//       }
//       if (purpose === 'TLTC') {
//         s.tltcCount++;
//       }

//       if (Object.prototype.hasOwnProperty.call(RISK_PURPOSE_SCORE, purpose)) {
//         s.purposeScore += RISK_PURPOSE_SCORE[purpose];
//       }
//     }
//   }

//   return Object.values(byStore).map(s => {
//     const lastPurpose = _sl_resolveTiebreak(s.lastPurposes);
//     const compliance = _sl_computeComplianceScore(s.lastDate, s.category, today);
//     const totalScore = _sl_riskScore(s.purposeScore, compliance.score);
//     const tier = _sl_riskTier(totalScore);
//     const reason = _sl_attentionReason(s.failedCount, compliance.status, compliance.daysSince, compliance.label);

//     return {
//       store: s.store,
//       brand: s.brand,
//       region: s.region,
//       category: s.category,
//       lastDate: s.lastDate,
//       lastPurpose,
//       daysSince: compliance.daysSince,
//       totalYTD: s.totalYTD,
//       storeYTD: s.storeYTD,
//       failedCount: s.failedCount,
//       curingCount: s.curingCount,
//       tltcCount: s.tltcCount,
//       storeVisitCount: s.storeVisitCount,
//       purposeScore: s.purposeScore,
//       complianceScore: compliance.score,
//       complianceStatus: compliance.status,
//       complianceLabel: compliance.label,
//       cadenceDays: compliance.cadenceDays,
//       hasHistory: s.hasHistory,
//       riskScore: totalScore,
//       riskTier: tier,
//       action: RISK_ACTION_LABEL[tier],
//       attentionReason: reason,
//     };
//   });
// }

// // ═══════════════════════════════════════════════════════════════
// // SECTION 5: SHEET BUILD + POPULATE
// // ═══════════════════════════════════════════════════════════════

// /**
//  * buildRiskEngineSheet()
//  * Creates the STORE HEALTH sheet if missing, clears it otherwise,
//  * and delegates all visual presentation to SVMKPI_RISK_LAYOUT.gs.
//  * This file only ensures the sheet exists — no scoring, sorting,
//  * or display logic is implemented here.
//  * @returns {GoogleAppsScript.Spreadsheet.Sheet}
//  */
// function buildRiskEngineSheet() {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   let sheet = ss.getSheetByName(RISK_SHEET_NAME);

//   if (!sheet) {
//     sheet = ss.insertSheet(RISK_SHEET_NAME);
//   } else {
//     sheet.clear();
//   }

//   buildRiskEngineLayout(sheet);  // SVMKPI_RISK_LAYOUT.gs — presentation only
//   return sheet;
// }

// /**
//  * populateRiskEngine(sheet, data)
//  * Computes per-store risk rows and writes them to the STORE HEALTH
//  * sheet, sorted by Risk Score descending (highest risk first).
//  *
//  * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - STORE HEALTH sheet
//  * @param {object} data - Parsed data object from CORE.gs _getData()
//  */
// function populateRiskEngine(sheet, data) {
//   const today = new Date();
//   const rows = _computeStoreRisk(data, today)
//     .sort((a, b) => b.riskScore - a.riskScore || a.store.localeCompare(b.store));

//   if (rows.length === 0) return;

//   const values = rows.map(r => [
//     r.store,
//     r.brand,
//     r.region,
//     r.lastDate || '',
//     r.lastPurpose,
//     r.daysSince === null ? 'NEVER VISITED' : r.daysSince,
//     r.totalYTD,
//     r.storeYTD,
//     r.failedCount,
//     r.curingCount,
//     r.riskScore,
//     r.riskTier,
//     r.action,
//     r.attentionReason,
//   ]);

//   sheet.getRange(RISK_ROW.DATA_START, 1, values.length, RISK_HEADERS.length).setValues(values);
//   sheet.getRange(RISK_ROW.DATA_START, RISK_COL.LAST_DATE, values.length, 1).setNumberFormat('yyyy-mm-dd');

//   // KPI tallies — pure counts of already-computed tiers, no extra scoring
//   const kpis = {
//     total: rows.length,
//     high: rows.filter(r => r.riskTier === 'HIGH').length,
//     medium: rows.filter(r => r.riskTier === 'MEDIUM').length,
//     low: rows.filter(r => r.riskTier === 'LOW').length,
//     coverageGap: rows.filter(r => r.complianceStatus === 'OVERDUE' || r.complianceStatus === 'NO HISTORY').length,
//   };

//   const top5 = rows.slice(0, 5).map(r => ({
//     store: r.store,
//     region: r.region,
//     tier: r.riskTier,
//     reason: r.attentionReason,
//     action: r.action,
//   }));

//   applyRiskLastRefreshed(sheet, today);          // SVMKPI_RISK_LAYOUT.gs
//   applyRiskKPICards(sheet, kpis);                // SVMKPI_RISK_LAYOUT.gs
//   applyRiskExecutiveFocus(sheet, top5);          // SVMKPI_RISK_LAYOUT.gs
//   applyRiskTableFormatting(sheet, rows.length);  // SVMKPI_RISK_LAYOUT.gs
// }

// // ═══════════════════════════════════════════════════════════════
// // SECTION 6: ORCHESTRATOR
// // ═══════════════════════════════════════════════════════════════

// /**
//  * refreshRiskEngine()
//  * Sole externally-called entry point. Builds the sheet (if needed)
//  * and repopulates it from MASTER_LOG via CORE.gs's _getData().
//  *
//  * @returns {{ success: boolean, rows: number }}
//  */
// function refreshRiskEngine() {
//   const masterLog = _getSheet(SL_MASTER_LOG_NAME);
//   const data = _getData(masterLog);
//   const sheet = buildRiskEngineSheet();

//   populateRiskEngine(sheet, data);
//   SpreadsheetApp.flush();

//   const scannedRows = (data && typeof data.totalRows === 'number')
//     ? data.totalRows
//     : (data && Array.isArray(data.stores) ? data.stores.length : 0);

//   _log('Store Health refreshed. ' + scannedRows + ' rows scanned.');
//   return { success: true, rows: scannedRows };
// }

// // ═══════════════════════════════════════════════════════════════
// // SECTION 7: COMPLIANCE UTILITIES
// // ═══════════════════════════════════════════════════════════════

// /**
//  * sl_getUnvisitedThisMonth(brandFilter)
//  * Returns stores from SETTINGS that have NO visit in the current calendar month.
//  */
// function sl_getUnvisitedThisMonth(brandFilter) {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const now = new Date();

//   const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
//   const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

//   const settings = ss.getSheetByName('SETTINGS');
//   if (!settings || settings.getLastRow() < 2) return [];

//   const settingsRows = settings.getRange(2, 1, settings.getLastRow() - 1, 5).getValues();
//   const allStores = new Map();

//   settingsRows.forEach(row => {
//     const name = _sl_normalizeText(row[0]);
//     const brand = _sl_normalizeText(row[1]);
//     const region = _sl_normalizeText(row[2]);
//     const category = _sl_normalizeText(row[4]);

//     if (!name || allStores.has(name)) return;
//     if (brandFilter && brandFilter !== 'ALL' && _sl_normalizeText(brandFilter) !== brand) return;

//     allStores.set(name, { brand, region, category });
//   });

//   const log = ss.getSheetByName(SL_MASTER_LOG_NAME);
//   if (!log || log.getLastRow() < 2) {
//     return Array.from(allStores.entries())
//       .map(([name, info]) => ({
//         name,
//         brand: info.brand,
//         region: info.region,
//         lastVisitDate: '—',
//         daysSince: null,
//       }))
//       .sort((a, b) => a.name.localeCompare(b.name));
//   }

//   const logData = log.getRange(2, 1, log.getLastRow() - 1, 8).getValues();
//   const visitedThisMonth = new Set();
//   const lastVisitByStore = new Map();

//   logData.forEach(row => {
//     const store = _sl_normalizeText(row[SL_COL.STORE]);
//     const date = _sl_parseDate(row[SL_COL.DATE]);
//     if (!store) return;

//     if (date && date >= monthStart && date <= monthEnd) {
//       visitedThisMonth.add(store);
//     }

//     if (date) {
//       const existing = lastVisitByStore.get(store);
//       if (!existing || date > existing.date) {
//         lastVisitByStore.set(store, {
//           date,
//           daysSince: Math.floor((now - date) / 86400000),
//         });
//       }
//     }
//   });

//   const result = [];
//   allStores.forEach((info, name) => {
//     if (visitedThisMonth.has(name)) return;
//     const lv = lastVisitByStore.get(name);
//     result.push({
//       name,
//       brand: info.brand,
//       region: info.region,
//       lastVisitDate: lv ? _sl_formatDate(lv.date) : '—',
//       daysSince: lv ? lv.daysSince : null,
//     });
//   });

//   result.sort((a, b) => {
//     const aDays = a.daysSince === null ? -1 : a.daysSince;
//     const bDays = b.daysSince === null ? -1 : b.daysSince;
//     if (bDays !== aDays) return bDays - aDays;
//     return a.name.localeCompare(b.name);
//   });

//   return result;
// }

// /**
//  * sl_getComplianceGaps(brandFilter, monthNumber)
//  * Returns stores that have NOT met their category-based visit frequency.
//  *
//  * Category thresholds:
//  *   NCR + NEAR PROVINCIAL  → Monthly
//  *   FAR PROVINCIAL         → Quarterly
//  *   FLIGHT PROVINCIAL      → Semi-Annual
//  */
// function sl_getComplianceGaps(brandFilter, monthNumber) {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const now = new Date();

//   const refMonthIdx = (monthNumber && monthNumber >= 1 && monthNumber <= 12)
//     ? monthNumber - 1
//     : now.getMonth();

//   const refDate = (monthNumber && monthNumber >= 1 && monthNumber <= 12)
//     ? new Date(SL_DATA_YEAR, refMonthIdx + 1, 0, 23, 59, 59, 999)
//     : now;

//   const settings = ss.getSheetByName('SETTINGS');
//   if (!settings || settings.getLastRow() < 2) return [];

//   const settingsRows = settings.getRange(2, 1, settings.getLastRow() - 1, 5).getValues();
//   const allStores = new Map();

//   settingsRows.forEach(row => {
//     const store = _sl_normalizeText(row[0]);
//     const brand = _sl_normalizeText(row[1]);
//     const region = _sl_normalizeText(row[2]);
//     const category = _sl_normalizeText(row[4]);

//     if (!store) return;
//     if (brandFilter && brandFilter !== 'ALL' && _sl_normalizeText(brandFilter) !== brand) return;

//     allStores.set(store, { brand, region, category });
//   });

//   const log = ss.getSheetByName(SL_MASTER_LOG_NAME);
//   const lastVisitByStore = new Map();
//   const ytdByStore = new Map();

//   if (log && log.getLastRow() >= 2) {
//     const logData = log.getRange(2, 1, log.getLastRow() - 1, 8).getValues();

//     logData.forEach(row => {
//       const store = _sl_normalizeText(row[SL_COL.STORE]);
//       const date = _sl_parseDate(row[SL_COL.DATE]);
//       if (!store || !allStores.has(store) || !date) return;

//       if (date.getFullYear() === SL_DATA_YEAR) {
//         ytdByStore.set(store, (ytdByStore.get(store) || 0) + 1);
//       }

//       if (date > refDate) return;

//       const existing = lastVisitByStore.get(store);
//       if (!existing || date > existing) lastVisitByStore.set(store, date);
//     });
//   }

//   const gaps = [];
//   allStores.forEach(({ brand, region, category }, store) => {
//     const cadenceDays = _sl_getCadenceDays(category);
//     const last = lastVisitByStore.get(store) || null;
//     const daysSince = last ? Math.floor((refDate - last) / 86400000) : null;
//     const ytd = ytdByStore.get(store) || 0;

//     let compliant = true;
//     let windowLabel = _sl_getCategoryLabel(category);

//     if (cadenceDays > 0) {
//       compliant = last ? daysSince <= cadenceDays : false;
//     }

//     if (!compliant) {
//       gaps.push({
//         store,
//         brand,
//         region,
//         category,
//         lastVisitDate: last ? _sl_formatDate(last) : '—',
//         daysSince,
//         windowLabel,
//         ytdVisits: ytd,
//       });
//     }
//   });

//   gaps.sort((a, b) => a.store.localeCompare(b.store));
//   return gaps;
// }

// // ═══════════════════════════════════════════════════════════════
// // END
// // ═══════════════════════════════════════════════════════════════
