// ============================================================
// SVMKPI_RISK.gs
// Store Visit Monitoring KPI — Store Health v4.0.0
// Pilot module: STORE VISIT MONITORING INITIATIVE (SVMI)
// Source of truth: SVMI Project Handoff — Store Health v1 (approved)
// Scoring revision: monthly FAILED QA/MS decay + cadence compliance
// ------------------------------------------------------------
// Contains:
//   1. Constants (Store Health only — no overlap with CORE.gs)
//   2. Risk Computation
//   3. Sheet Build + Populate (presentation delegated to RISK_LAYOUT.gs)
//   4. Orchestrator
//   5. Compliance Utilities
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

const RISK_SHEET_NAME = 'STORE HEALTH';

const SL_DATA_YEAR = (typeof DATA_YEAR !== 'undefined')
  ? DATA_YEAR
  : new Date().getFullYear();

const SL_MASTER_LOG_NAME = (typeof SHEET !== 'undefined' && SHEET && SHEET.MASTER_LOG)
  ? SHEET.MASTER_LOG
  : 'MASTER_LOG';

const RISK_COL = {
  STORE:            1,
  BRAND:            2,
  REGION:           3,
  LAST_DATE:        4,
  LAST_PURPOSE:     5,
  DAYS_SINCE:       6,
  TOTAL_YTD:        7,
  STORE_YTD:        8,
  FAILED_COUNT:     9,
  CURING_COUNT:    10,
  RISK_SCORE:      11,
  RISK_TIER:       12,
  ACTION:          13,
  ATTENTION_REASON: 14,
};

const RISK_HEADERS = [
  'Store Name', 'Brand', 'Region', 'Last Visit Date', 'Last Visit Purpose',
  'Days Since Visit', 'Total Visits YTD', 'Store Visits YTD',
  'Failed QA/MS Count', 'Curing/Support Count',
  'Risk Score', 'Risk Tier', 'Recommended Action', 'Attention Reason',
];

const RISK_PURPOSE_PRIORITY = ['FAILED QA/MS', 'CURING/SUPPORT', 'TLTC', 'STORE VISIT'];

const RISK_TIER_LABEL = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };

const RISK_ACTION_LABEL = {
  LOW:    'Monitor',
  MEDIUM: 'Planned Follow-up',
  HIGH:   'Immediate Intervention',
};

const RISK_PURPOSE_SCORE = {
  'FAILED QA/MS':    5,
  'STORE VISIT':    -2,
  'CURING/SUPPORT': -4,
  'TLTC':           -1,
};

const RISK_CADENCE = {
  MONTHLY: 31,
  QUARTERLY: 92,
  SEMI_ANNUAL: 183,
};

// ═══════════════════════════════════════════════════════════════
// SECTION 2: BASIC HELPERS
// ═══════════════════════════════════════════════════════════════

function _sl_isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

function _sl_startOfDay(d) {
  if (!_sl_isValidDate(d)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function _sl_parseDate(value) {
  if (_sl_isValidDate(value)) return _sl_startOfDay(value);
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const native = new Date(raw);
  if (_sl_isValidDate(native)) return _sl_startOfDay(native);

  const m1 = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m1) {
    const d = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]), 0, 0, 0, 0);
    return _sl_isValidDate(d) ? d : null;
  }

  return null;
}

function _sl_normalizeText(value) {
  return String(value || '').trim().toUpperCase();
}

function _sl_normalizePipeList(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s*\|\s*/g, '|');
}

function _sl_formatDate(date) {
  const d = _sl_parseDate(date);
  if (!d) return '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  return months[d.getMonth()] + ' ' + day + ', ' + d.getFullYear();
}

function _sl_getCadenceDays(category) {
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

function _sl_resolveTiebreak(purposes) {
  if (!purposes || purposes.length === 0) return '';
  for (const p of RISK_PURPOSE_PRIORITY) {
    if (purposes.indexOf(p) !== -1) return p;
  }
  return purposes[0];
}

function _sl_getStoreMetaLookup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = ss.getSheetByName('SETTINGS');
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

function _sl_computeComplianceScore(lastDate, category, today) {
  const cadenceDays = _sl_getCadenceDays(category);
  const categoryLabel = _sl_getCategoryLabel(category);

  if (!cadenceDays) {
    return {
      score: 0,
      status: 'UNKNOWN',
      cadenceDays: 0,
      daysSince: null,
      label: categoryLabel,
    };
  }

  const d = _sl_parseDate(lastDate);
  if (!d) {
    return {
      score: 0,
      status: 'NO HISTORY',
      cadenceDays,
      daysSince: null,
      label: categoryLabel,
    };
  }

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

function _sl_riskTier(score) {
  if (score >= 10) return RISK_TIER_LABEL.HIGH;
  if (score >= 5) return RISK_TIER_LABEL.MEDIUM;
  return RISK_TIER_LABEL.LOW;
}

function _sl_attentionReason(activeFailedPenalty, complianceStatus, categoryLabel, hasHistory) {
  if (activeFailedPenalty >= 10) return 'Repeated QA/MS Interventions';
  if (activeFailedPenalty > 0) return 'QA/MS Intervention';
  if (complianceStatus === 'OVERDUE') return categoryLabel + ' Visit Overdue';
  if (complianceStatus === 'NO HISTORY' && !hasHistory) return 'No Visit History';
  return 'No Risk Factors';
}

function _sl_computeMonthlyPurposeScores(monthBuckets, monthLimit) {
  let activeFailedPenalty = 0;
  let basePurposeScore = 0;

  for (let m = 0; m <= monthLimit; m++) {
    const b = monthBuckets[m];
    if (!b) continue;

    basePurposeScore += (b.storeVisitCount * RISK_PURPOSE_SCORE['STORE VISIT']);
    basePurposeScore += (b.curingCount * RISK_PURPOSE_SCORE['CURING/SUPPORT']);
    basePurposeScore += (b.tltcCount * RISK_PURPOSE_SCORE['TLTC']);

    if (b.failedCount > 0) {
      activeFailedPenalty += (b.failedCount * RISK_PURPOSE_SCORE['FAILED QA/MS']);
    } else if (activeFailedPenalty > 0) {
      activeFailedPenalty = Math.max(0, activeFailedPenalty - 5);
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

function _computeStoreRisk(data, today) {
  const byStore = {};
  const metaLookup = _sl_getStoreMetaLookup();
  const evaluationYear = SL_DATA_YEAR;
  const monthLimit = (today.getFullYear && today.getFullYear() === evaluationYear)
    ? today.getMonth()
    : 11;

  for (let i = 0; i < data.stores.length; i++) {
    const store = _sl_normalizeText(data.stores[i]);
    if (!store) continue;

    const date = _sl_parseDate(data.dates[i]);
    const purpose = _sl_normalizeText(data.purposes[i]);
    const brand = _sl_normalizeText(data.brands[i]) || '—';
    const region = _sl_normalizeText(data.regions[i]) || '—';
    const meta = metaLookup[store] || { store, brand: '—', region: '—', category: '—' };

    if (!byStore[store]) {
      byStore[store] = {
        store,
        brand: meta.brand !== '—' ? meta.brand : brand,
        region: meta.region !== '—' ? meta.region : region,
        category: meta.category || '—',
        lastDate: null,
        lastPurposes: [],
        totalYTD: 0,
        storeYTD: 0,
        failedCount: 0,
        curingCount: 0,
        tltcCount: 0,
        storeVisitCount: 0,
        monthlyBuckets: Array.from({ length: 12 }, () => ({
          failedCount: 0,
          storeVisitCount: 0,
          curingCount: 0,
          tltcCount: 0,
        })),
        hasHistory: false,
      };
    }

    const s = byStore[store];
    s.brand = meta.brand !== '—' ? meta.brand : (brand || s.brand);
    s.region = meta.region !== '—' ? meta.region : (region || s.region);
    s.category = meta.category || s.category;

    if (_sl_isValidDate(date)) {
      s.hasHistory = true;

      if (!s.lastDate || date > s.lastDate) {
        s.lastDate = date;
        s.lastPurposes = [purpose];
      } else if (s.lastDate && date.getTime() === s.lastDate.getTime()) {
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
    const monthlyScore = _sl_computeMonthlyPurposeScores(s.monthlyBuckets, monthLimit);
    const compliance = _sl_computeComplianceScore(s.lastDate, s.category, today);

    const rawScore = monthlyScore.totalPurposeScore + compliance.score;
    const totalScore = Math.max(0, parseFloat(rawScore.toFixed(2)));
    const tier = _sl_riskTier(totalScore);
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

function buildRiskEngineSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RISK_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(RISK_SHEET_NAME);
  } else {
    sheet.clear();
  }

  buildRiskEngineLayout(sheet);
  return sheet;
}

function populateRiskEngine(sheet, data) {
  const today = new Date();
  const rows = _computeStoreRisk(data, today)
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

  const kpis = {
    total: rows.length,
    high: rows.filter(r => r.riskTier === 'HIGH').length,
    medium: rows.filter(r => r.riskTier === 'MEDIUM').length,
    low: rows.filter(r => r.riskTier === 'LOW').length,
    coverageGap: rows.filter(r => r.complianceStatus === 'OVERDUE' || r.complianceStatus === 'NO HISTORY').length,
  };

  const top5 = rows.slice(0, 5).map(r => ({
    store: r.store,
    region: r.region,
    tier: r.riskTier,
    reason: r.attentionReason,
    action: r.action,
  }));

  applyRiskLastRefreshed(sheet, today);
  applyRiskKPICards(sheet, kpis);
  applyRiskExecutiveFocus(sheet, top5);
  applyRiskTableFormatting(sheet, rows.length);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 6: ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

function refreshRiskEngine() {
  const masterLog = _getSheet(SL_MASTER_LOG_NAME);
  const data = _getData(masterLog);
  const sheet = buildRiskEngineSheet();

  populateRiskEngine(sheet, data);
  SpreadsheetApp.flush();

  const scannedRows = (data && typeof data.totalRows === 'number')
    ? data.totalRows
    : (data && Array.isArray(data.stores) ? data.stores.length : 0);

  _log('Store Health refreshed. ' + scannedRows + ' rows scanned.');
  return { success: true, rows: scannedRows };
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7: COMPLIANCE UTILITIES
// ═══════════════════════════════════════════════════════════════

function sl_getUnvisitedThisMonth(brandFilter) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const settings = ss.getSheetByName('SETTINGS');
  if (!settings || settings.getLastRow() < 2) return [];

  const settingsRows = settings.getRange(2, 1, settings.getLastRow() - 1, 5).getValues();
  const allStores = new Map();

  settingsRows.forEach(row => {
    const name = _sl_normalizeText(row[0]);
    const brand = _sl_normalizeText(row[1]);
    const region = _sl_normalizeText(row[2]);
    const category = _sl_normalizeText(row[4]);

    if (!name || allStores.has(name)) return;
    if (brandFilter && brandFilter !== 'ALL' && _sl_normalizeText(brandFilter) !== brand) return;

    allStores.set(name, { brand, region, category });
  });

  const log = ss.getSheetByName(SL_MASTER_LOG_NAME);
  if (!log || log.getLastRow() < 2) {
    return Array.from(allStores.entries())
      .map(([name, info]) => ({
        name,
        brand: info.brand,
        region: info.region,
        lastVisitDate: '—',
        daysSince: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const logData = log.getRange(2, 1, log.getLastRow() - 1, 8).getValues();
  const visitedThisMonth = new Set();
  const lastVisitByStore = new Map();

  logData.forEach(row => {
    const store = _sl_normalizeText(row[SL_COL.STORE]);
    const date = _sl_parseDate(row[SL_COL.DATE]);
    if (!store) return;

    if (date && date >= monthStart && date <= monthEnd) {
      visitedThisMonth.add(store);
    }

    if (date) {
      const existing = lastVisitByStore.get(store);
      if (!existing || date > existing.date) {
        lastVisitByStore.set(store, {
          date,
          daysSince: Math.floor((now - date) / 86400000),
        });
      }
    }
  });

  const result = [];
  allStores.forEach((info, name) => {
    if (visitedThisMonth.has(name)) return;
    const lv = lastVisitByStore.get(name);
    result.push({
      name,
      brand: info.brand,
      region: info.region,
      lastVisitDate: lv ? _sl_formatDate(lv.date) : '—',
      daysSince: lv ? lv.daysSince : null,
    });
  });

  result.sort((a, b) => {
    const aDays = a.daysSince === null ? -1 : a.daysSince;
    const bDays = b.daysSince === null ? -1 : b.daysSince;
    if (bDays !== aDays) return bDays - aDays;
    return a.name.localeCompare(b.name);
  });

  return result;
}

function sl_getComplianceGaps(brandFilter, monthNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();

  const refMonthIdx = (monthNumber && monthNumber >= 1 && monthNumber <= 12)
    ? monthNumber - 1
    : now.getMonth();

  const refDate = (monthNumber && monthNumber >= 1 && monthNumber <= 12)
    ? new Date(SL_DATA_YEAR, refMonthIdx + 1, 0, 23, 59, 59, 999)
    : now;

  const settings = ss.getSheetByName('SETTINGS');
  if (!settings || settings.getLastRow() < 2) return [];

  const settingsRows = settings.getRange(2, 1, settings.getLastRow() - 1, 5).getValues();
  const allStores = new Map();

  settingsRows.forEach(row => {
    const store = _sl_normalizeText(row[0]);
    const brand = _sl_normalizeText(row[1]);
    const region = _sl_normalizeText(row[2]);
    const category = _sl_normalizeText(row[4]);

    if (!store) return;
    if (brandFilter && brandFilter !== 'ALL' && _sl_normalizeText(brandFilter) !== brand) return;

    allStores.set(store, { brand, region, category });
  });

  const log = ss.getSheetByName(SL_MASTER_LOG_NAME);
  const lastVisitByStore = new Map();
  const ytdByStore = new Map();

  if (log && log.getLastRow() >= 2) {
    const logData = log.getRange(2, 1, log.getLastRow() - 1, 8).getValues();

    logData.forEach(row => {
      const store = _sl_normalizeText(row[SL_COL.STORE]);
      const date = _sl_parseDate(row[SL_COL.DATE]);
      if (!store || !allStores.has(store) || !date) return;

      if (date.getFullYear() === SL_DATA_YEAR) {
        ytdByStore.set(store, (ytdByStore.get(store) || 0) + 1);
      }

      if (date > refDate) return;

      const existing = lastVisitByStore.get(store);
      if (!existing || date > existing) lastVisitByStore.set(store, date);
    });
  }

  const gaps = [];
  allStores.forEach(({ brand, region, category }, store) => {
    const cadenceDays = _sl_getCadenceDays(category);
    const last = lastVisitByStore.get(store) || null;
    const daysSince = last ? Math.floor((refDate - last) / 86400000) : null;
    const ytd = ytdByStore.get(store) || 0;

    let compliant = true;
    let windowLabel = _sl_getCategoryLabel(category);

    if (cadenceDays > 0) {
      compliant = last ? daysSince <= cadenceDays : false;
    }

    if (!compliant) {
      gaps.push({
        store,
        brand,
        region,
        category,
        lastVisitDate: last ? _sl_formatDate(last) : '—',
        daysSince,
        windowLabel,
        ytdVisits: ytd,
      });
    }
  });

  gaps.sort((a, b) => a.store.localeCompare(b.store));
  return gaps;
}

// ═══════════════════════════════════════════════════════════════
// END
// ═══════════════════════════════════════════════════════════════
