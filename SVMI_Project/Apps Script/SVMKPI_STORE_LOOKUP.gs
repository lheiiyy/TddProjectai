// ============================================================
// SVMKPI_STORE_LOOKUP.gs
// Store Visit Monitoring KPI — Store Intelligence Module
// Version: 1.0.0  |  Release: STORE_INTELLIGENCE_MODULE_v1.0
// Source of truth: STORE_VISIT_MONITORING_KPI_BIBLE_v1.0
// ------------------------------------------------------------
// Contains:
//   1. Constants
//   2. Store List Provider
//   3. Store Lookup Engine
//   4. Insight Generator
//   5. Brand List + Monthly Coverage
//   6. Compliance Gaps
// ------------------------------------------------------------
// v1.2: Removed openStoreLookupSidebar() — dead "sidebar era" code.
//       It was never called by SVMKPI_ADMIN.gs's onOpen() menu and
//       pointed at a 'StoreLookup' HTML file this project doesn't
//       ship. The Store Insights tab in SVMI_PORTAL.html calls the
//       sl_* functions below directly via google.script.run.
// ------------------------------------------------------------
// Read-only module. Never writes to any sheet.
// Completely independent from SVMKPI_CORE / LAYOUT / ADMIN.
// Reads from: MASTER_LOG (cols A–H), SETTINGS (cols A–C)
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS
// ═══════════════════════════════════════════════════════════════

// ── Sheet references ──────────────────────────────────────────
const SL_SHEET = {
  MASTER_LOG: 'MASTER_LOG',
  SETTINGS:   'SETTINGS',
};

// ── MASTER_LOG column indices (0-based, for array access) ─────
const SL_COL = {
  TIMESTAMP: 0,  // A
  DATE:      1,  // B
  STORE:     2,  // C
  BRAND:     3,  // D
  REGION:    4,  // E
  VISITOR:   5,  // F
  PURPOSE:   6,  // G
  REMARKS:   7,  // H
};

// ── SETTINGS column indices (0-based) ─────────────────────────
const SL_SETTINGS_COL = {
  STORE:  0,  // A
  BRAND:  1,  // B
  REGION: 2,  // C
};

// Approved purposes come directly from APPROVED_PURPOSES (SVMKPI_CORE.gs) —
// previously duplicated here as a local SL_PURPOSES list, which could drift
// out of sync with the shared one.

// ── Risk Score thresholds ─────────────────────────────────────
const SL_RISK = {
  HIGH_THRESHOLD:   8,
  MEDIUM_THRESHOLD: 4,
  FAILED_WEIGHT:    3,   // Failed QA/MS × 3
  DAYS_DIVISOR:     30,  // Days since last visit ÷ 30
  LOW_VISIT_LIMIT:  3,   // Total visits < 3 → +5 penalty
  LOW_VISIT_BONUS:  5,
};

// ── Recent visits to display ──────────────────────────────────
const SL_RECENT_LIMIT = 10;

// ── Top visitors to display ───────────────────────────────────
const SL_TOP_VISITOR_LIMIT = 10;


// ═══════════════════════════════════════════════════════════════
// SECTION 2: STORE LIST PROVIDER
// ═══════════════════════════════════════════════════════════════

/**
 * sl_getStoreList()
 * Returns all stores from SETTINGS col A (rows 2+) with their
 * brand (col B) and region (col C).
 * Deduplicates by store name. Sorts alphabetically.
 * Called by the sidebar HTML via google.script.run.
 *
 * @returns {{ name: string, brand: string, region: string }[]}
 */
function sl_getStoreList() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const settings = ss.getSheetByName(SL_SHEET.SETTINGS);
  if (!settings) return [];

  const lastRow = settings.getLastRow();
  if (lastRow < 2) return [];

  const raw  = settings.getRange(2, 1, lastRow - 1, 3).getValues();
  const seen = new Set();
  const list = [];

  raw.forEach(row => {
    const name   = String(row[SL_SETTINGS_COL.STORE]  || '').trim().toUpperCase();
    const brand  = String(row[SL_SETTINGS_COL.BRAND]  || '').trim().toUpperCase();
    const region = String(row[SL_SETTINGS_COL.REGION] || '').trim().toUpperCase();
    if (!name || seen.has(name)) return;
    seen.add(name);
    list.push({ name, brand, region });
  });

  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: STORE LOOKUP ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * sl_getStoreData(storeName)
 * Main lookup function. Reads MASTER_LOG once, filters to the
 * requested store, and returns a complete data object for the sidebar.
 * Read-only. No sheet writes. Target: < 2 seconds.
 *
 * Returns null if the store name is empty or MASTER_LOG is absent.
 *
 * @param {string} storeName - Store name (will be normalized before match)
 * @returns {StoreResult|null}
 *
 * StoreResult shape:
 * {
 *   meta:    { name, brand, region },
 *   summary: { totalVisits, lastVisitDate, lastVisitor, lastPurpose },
 *   purposes: { label, count, pct }[],
 *   topVisitors: { name, count }[],
 *   recentVisits: { date, visitor, purpose, remarks }[],
 *   health:  { score, label, components },
 *   insight: string,
 * }
 */
function sl_getStoreData(storeName) {
  if (!storeName || !String(storeName).trim()) return null;

  const target = String(storeName).trim().toUpperCase();

  // ── Step 1: Read MASTER_LOG once ──────────────────────────
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(SL_SHEET.MASTER_LOG);
  if (!log) return null;

  const lastRow = log.getLastRow();
  if (lastRow < 2) return _sl_emptyResult(target);

  // Read cols A–H only (columns 1–8) — skip the auxiliary columns
  const raw = log.getRange(2, 1, lastRow - 1, 8).getValues();

  // ── Step 2: Filter to this store ──────────────────────────
  const rows = raw.filter(row => {
    const store = String(row[SL_COL.STORE] || '').trim().toUpperCase();
    return store === target;
  });

  if (rows.length === 0) return _sl_emptyResult(target);

  // ── Step 3: Sort filtered rows by date desc (newest first) ─
  rows.sort((a, b) => {
    const da = a[SL_COL.DATE] instanceof Date ? a[SL_COL.DATE].getTime() : 0;
    const db = b[SL_COL.DATE] instanceof Date ? b[SL_COL.DATE].getTime() : 0;
    return db - da;
  });

  // ── Step 4: Derive meta from SETTINGS ─────────────────────
  const meta = _sl_getMeta(target);

  // ── Step 5: Summary ───────────────────────────────────────
  const totalVisits  = rows.length;
  const lastRow_     = rows[0];
  const lastDate     = lastRow_[SL_COL.DATE];
  const lastVisitor  = String(lastRow_[SL_COL.VISITOR] || '').trim().toUpperCase() || '—';
  const lastPurpose  = String(lastRow_[SL_COL.PURPOSE] || '').trim().toUpperCase() || '—';
  const lastVisitStr = lastDate instanceof Date ? _sl_formatDate(lastDate) : '—';

  // ── Step 6: Purpose breakdown ─────────────────────────────
  const purposeCounts = {};
  APPROVED_PURPOSES.forEach(p => { purposeCounts[p] = 0; });
  rows.forEach(row => {
    const p = String(row[SL_COL.PURPOSE] || '').trim().toUpperCase();
    if (purposeCounts.hasOwnProperty(p)) purposeCounts[p]++;
  });
  const purposes = APPROVED_PURPOSES.map(label => {
    const count = purposeCounts[label];
    const pct   = totalVisits > 0 ? ((count / totalVisits) * 100).toFixed(1) : '0.0';
    return { label, count, pct };
  });

  // ── Step 7: Visitor activity (pipe-split aware) ───────────
  const visitorMap = {};
  rows.forEach(row => {
    const raw_v = String(row[SL_COL.VISITOR] || '').trim().toUpperCase();
    if (!raw_v) return;
    raw_v.split('|').map(v => v.trim()).filter(v => v).forEach(name => {
      visitorMap[name] = (visitorMap[name] || 0) + 1;
    });
  });
  const topVisitors = Object.entries(visitorMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, SL_TOP_VISITOR_LIMIT);

  // ── Step 8: Recent 10 visits ──────────────────────────────
  const recentVisits = rows.slice(0, SL_RECENT_LIMIT).map(row => ({
    date:    row[SL_COL.DATE] instanceof Date ? _sl_formatDate(row[SL_COL.DATE]) : '—',
    visitor: String(row[SL_COL.VISITOR] || '').trim().toUpperCase() || '—',
    purpose: String(row[SL_COL.PURPOSE] || '').trim().toUpperCase() || '—',
    remarks: String(row[SL_COL.REMARKS] || '').trim()               || '—',
  }));

  // ── Step 9: Health score ──────────────────────────────────
  const health = _sl_computeHealth(totalVisits, purposeCounts['FAILED QA/MS'], lastDate);

  // ── Step 10: AI insight ───────────────────────────────────
  const insight = _sl_generateInsight({
    meta, totalVisits, lastVisitStr, lastPurpose,
    purposes, topVisitors, health,
    failedCount: purposeCounts['FAILED QA/MS'],
  });

  return {
    meta,
    summary: { totalVisits, lastVisitDate: lastVisitStr, lastVisitor, lastPurpose },
    purposes,
    topVisitors,
    recentVisits,
    health,
    insight,
  };
}

/**
 * _sl_getMeta(storeName)
 * Looks up brand and region for a store from SETTINGS.
 * Falls back to MASTER_LOG data if SETTINGS row is absent.
 * @param {string} storeName - Already normalized (uppercase, trimmed)
 * @returns {{ name: string, brand: string, region: string }}
 */
function _sl_getMeta(storeName) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const settings = ss.getSheetByName(SL_SHEET.SETTINGS);

  if (settings && settings.getLastRow() >= 2) {
    const rows = settings.getRange(2, 1, settings.getLastRow() - 1, 3).getValues();
    for (let i = 0; i < rows.length; i++) {
      const sName = String(rows[i][SL_SETTINGS_COL.STORE] || '').trim().toUpperCase();
      if (sName === storeName) {
        return {
          name:   storeName,
          brand:  String(rows[i][SL_SETTINGS_COL.BRAND]  || '').trim().toUpperCase(),
          region: String(rows[i][SL_SETTINGS_COL.REGION] || '').trim().toUpperCase(),
        };
      }
    }
  }

  return { name: storeName, brand: '—', region: '—' };
}

/**
 * _sl_computeHealth(totalVisits, failedCount, lastDate)
 * Computes the store risk score using the Bible §6 formula.
 *
 * Risk Score =
 *   (Failed QA/MS count × 3)
 *   + (Days since last visit ÷ 30)
 *   + (Total visits < 3 ? 5 : 0)
 *
 * Thresholds:
 *   score >= 8  → HIGH
 *   score >= 4  → MEDIUM
 *   score <  4  → LOW
 *
 * @param {number} totalVisits
 * @param {number} failedCount
 * @param {Date}   lastDate
 * @returns {{ score: number, label: string, components: object }}
 */
function _sl_computeHealth(totalVisits, failedCount, lastDate) {
  const now       = new Date();
  const daysSince = lastDate instanceof Date
    ? Math.max(0, Math.floor((now - lastDate) / (1000 * 60 * 60 * 24)))
    : 999;

  const failedPart  = (failedCount || 0) * SL_RISK.FAILED_WEIGHT;
  const daysPart    = parseFloat((daysSince / SL_RISK.DAYS_DIVISOR).toFixed(2));
  const lowVisitPen = totalVisits < SL_RISK.LOW_VISIT_LIMIT ? SL_RISK.LOW_VISIT_BONUS : 0;
  const score       = parseFloat((failedPart + daysPart + lowVisitPen).toFixed(2));

  const label = score >= SL_RISK.HIGH_THRESHOLD   ? 'HIGH'
              : score >= SL_RISK.MEDIUM_THRESHOLD  ? 'MEDIUM'
              :                                      'LOW';

  return {
    score,
    label,
    components: {
      failedPart,
      daysPart,
      lowVisitPen,
      daysSince,
    },
  };
}

/**
 * _sl_emptyResult(storeName)
 * Returns a zeroed-out result object for a store with no MASTER_LOG history.
 * @param {string} storeName
 * @returns {StoreResult}
 */
function _sl_emptyResult(storeName) {
  const meta = _sl_getMeta(storeName);
  const health = _sl_computeHealth(0, 0, null);
  return {
    meta,
    summary:      { totalVisits: 0, lastVisitDate: '—', lastVisitor: '—', lastPurpose: '—' },
    purposes:     APPROVED_PURPOSES.map(label => ({ label, count: 0, pct: '0.0' })),
    topVisitors:  [],
    recentVisits: [],
    health,
    insight:      'No visit records found for ' + storeName + '. Schedule an initial store visit.',
  };
}

/**
 * _sl_formatDate(date)
 * Formats a JS Date as "MMM DD, YYYY" (e.g. "Jan 05, 2026").
 * @param {Date} date
 * @returns {string}
 */
function _sl_formatDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = String(date.getDate()).padStart(2, '0');
  return months[date.getMonth()] + ' ' + d + ', ' + date.getFullYear();
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: INSIGHT GENERATOR
// ═══════════════════════════════════════════════════════════════

/**
 * _sl_generateInsight(params)
 * Generates a rule-based plain-text store summary.
 * No external AI calls. Pure rule evaluation.
 *
 * Logic tiers:
 *   1. Total visit volume assessment
 *   2. Dominant purpose identification
 *   3. Failed QA/MS flag (count-based severity)
 *   4. Most active visitor callout
 *   5. Days-since-last-visit flag
 *   6. Health-based recommendation
 *
 * @param {object} params
 * @returns {string} 4–6 sentence summary
 */
function _sl_generateInsight(params) {
  const {
    meta, totalVisits, lastVisitStr, purposes,
    topVisitors, health, failedCount,
  } = params;

  const lines = [];

  // 1. Visit volume
  if (totalVisits === 0) {
    return 'No visit records found for ' + meta.name + '. Schedule an initial store visit to establish baseline data.';
  } else if (totalVisits >= 20) {
    lines.push(meta.name + ' has ' + totalVisits + ' visits on record — well-monitored store.');
  } else if (totalVisits >= 10) {
    lines.push(meta.name + ' has ' + totalVisits + ' visits on record — moderate monitoring coverage.');
  } else if (totalVisits >= 3) {
    lines.push(meta.name + ' has ' + totalVisits + ' visits on record — monitoring is active but limited.');
  } else {
    lines.push(meta.name + ' has only ' + totalVisits + ' visit(s) on record — insufficient monitoring coverage.');
  }

  // 2. Dominant purpose
  const sorted = [...purposes].sort((a, b) => b.count - a.count);
  const top    = sorted[0];
  if (top && top.count > 0) {
    lines.push('Most common activity is ' + _sl_titleCase(top.label) + ' (' + top.count + ' occurrence' + (top.count > 1 ? 's' : '') + ', ' + top.pct + '% of visits).');
  }

  // 3. Failed QA/MS
  if (failedCount === 0) {
    lines.push('No Failed QA/MS visits recorded — store is currently compliant.');
  } else if (failedCount === 1) {
    lines.push('1 Failed QA/MS visit recorded. Monitor closely for recurrence.');
  } else if (failedCount <= 3) {
    lines.push(failedCount + ' Failed QA/MS visits recorded. Coaching intervention is recommended.');
  } else {
    lines.push(failedCount + ' Failed QA/MS visits recorded — this store requires immediate coaching attention.');
  }

  // 4. Top visitor
  if (topVisitors.length > 0) {
    const v = topVisitors[0];
    lines.push('Most active visitor is ' + v.name + ' with ' + v.count + ' visit' + (v.count > 1 ? 's' : '') + '.');
  }

  // 5. Recency flag
  const daysSince = health.components.daysSince;
  if (daysSince === 999) {
    lines.push('Last visit date is unavailable.');
  } else if (daysSince === 0) {
    lines.push('Last visit was today.');
  } else if (daysSince <= 7) {
    lines.push('Last visit was ' + daysSince + ' day' + (daysSince > 1 ? 's' : '') + ' ago — recently monitored.');
  } else if (daysSince <= 30) {
    lines.push('Last visit was ' + daysSince + ' days ago — within normal monitoring cycle.');
  } else if (daysSince <= 60) {
    lines.push('Last visit was ' + daysSince + ' days ago — approaching overdue status.');
  } else {
    lines.push('Last visit was ' + daysSince + ' days ago — store is overdue for a visit.');
  }

  // 6. Health-based recommendation
  if (health.label === 'HIGH') {
    lines.push('Risk level is HIGH. Prioritize this store for immediate visit and coaching.');
  } else if (health.label === 'MEDIUM') {
    lines.push('Risk level is MEDIUM. Schedule a visit within the next two weeks.');
  } else {
    lines.push('Risk level is LOW. Maintain current monitoring frequency.');
  }

  return lines.join(' ');
}

/**
 * _sl_titleCase(str)
 * Converts "FAILED QA/MS" → "Failed QA/MS" for readable display.
 * @param {string} str
 * @returns {string}
 */
function _sl_titleCase(str) {
  return str.toLowerCase().replace(/\b(\w)/g, c => c.toUpperCase());
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: BRAND LIST + MONTHLY COVERAGE (new — v1.1)
// ═══════════════════════════════════════════════════════════════

/**
 * sl_getBrandList()
 * Returns all distinct brand names from SETTINGS col B, sorted A→Z.
 * Used to populate the brand filter dropdown in the window.
 * @returns {string[]}
 */
function sl_getBrandList() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const settings = ss.getSheetByName(SL_SHEET.SETTINGS);
  if (!settings || settings.getLastRow() < 2) return [];

  const data   = settings.getRange(2, SL_SETTINGS_COL.BRAND + 1, settings.getLastRow() - 1, 1).getValues();
  const brands = new Set();
  data.forEach(row => {
    const b = String(row[0] || '').trim().toUpperCase();
    if (b) brands.add(b);
  });
  return Array.from(brands).sort();
}

/**
 * sl_getUnvisitedThisMonth(brandFilter)
 * Returns stores from SETTINGS that have NO visit in the current
 * calendar month, optionally filtered by brand.
 *
 * @param {string} brandFilter — brand name (UPPERCASE) or 'ALL' / '' for no filter
 * @returns {{
 *   name: string, brand: string, region: string,
 *   lastVisitDate: string, daysSince: number|null
 * }[]}  Sorted by daysSince desc (most overdue first); never-visited last.
 */
function sl_getUnvisitedThisMonth(brandFilter) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();

  // Current month bounds (server timezone)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // ── Read all stores from SETTINGS ───────────────────────────
  const settings = ss.getSheetByName(SL_SHEET.SETTINGS);
  if (!settings || settings.getLastRow() < 2) return [];

  const settingsRows = settings.getRange(2, 1, settings.getLastRow() - 1, 3).getValues();
  const allStores    = new Map(); // name → {brand, region}

  settingsRows.forEach(row => {
    const name   = String(row[SL_SETTINGS_COL.STORE]  || '').trim().toUpperCase();
    const brand  = String(row[SL_SETTINGS_COL.BRAND]  || '').trim().toUpperCase();
    const region = String(row[SL_SETTINGS_COL.REGION] || '').trim().toUpperCase();
    if (!name || allStores.has(name)) return;
    if (brandFilter && brandFilter !== 'ALL' && brand !== brandFilter) return;
    allStores.set(name, { brand, region });
  });

  // ── Scan MASTER_LOG ──────────────────────────────────────────
  const log = ss.getSheetByName(SL_SHEET.MASTER_LOG);
  if (!log || log.getLastRow() < 2) {
    // No visits at all — every store is unvisited
    return Array.from(allStores.entries())
      .map(([name, info]) => ({
        name, brand: info.brand, region: info.region,
        lastVisitDate: '—', daysSince: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const logData          = log.getRange(2, 1, log.getLastRow() - 1, 8).getValues();
  const visitedThisMonth = new Set();
  const lastVisitByStore = new Map(); // name → {date, daysSince}

  logData.forEach(row => {
    const store   = String(row[SL_COL.STORE] || '').trim().toUpperCase();
    const dateRaw = row[SL_COL.DATE];
    if (!store) return;

    const date = dateRaw instanceof Date && !isNaN(dateRaw) ? dateRaw : null;

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

  // ── Build result — stores in SETTINGS with no current-month visit ─
  const result = [];
  allStores.forEach((info, name) => {
    if (visitedThisMonth.has(name)) return;
    const lv = lastVisitByStore.get(name);
    result.push({
      name,
      brand:         info.brand,
      region:        info.region,
      lastVisitDate: lv ? _sl_formatDate(lv.date) : '—',
      daysSince:     lv ? lv.daysSince : null,
    });
  });

  // Most overdue first; never-visited (null daysSince) grouped last
  result.sort((a, b) => {
    const aDays = a.daysSince === null ? -1 : a.daysSince;
    const bDays = b.daysSince === null ? -1 : b.daysSince;
    if (bDays !== aDays) return bDays - aDays;
    return a.name.localeCompare(b.name);
  });

  return result;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6: COMPLIANCE GAPS (Visits This Month tab)
// ═══════════════════════════════════════════════════════════════

/**
 * sl_getComplianceGaps(brandFilter)
 * Returns stores that have NOT met their category-based visit frequency.
 * Category thresholds:
 *   NCR + NEAR PROVINCIAL  → at least 1 visit in current calendar month
 *   FAR PROVINCIAL         → at least 1 visit in current calendar quarter
 *   FLIGHT PROVINCIAL      → at least 1 visit in last 6 months
 * @param {string} brandFilter — brand name or 'ALL' / ''
 * @returns {{ store, brand, region, category, lastVisitDate, daysSince, windowLabel }[]}
 */
/**
 * sl_getComplianceGaps(brandFilter, monthNumber)
 * Returns stores that have NOT met their category visit frequency
 * for the given month (or current month if monthNumber is 0/null).
 *
 * Uses a set-based scan of ALL MASTER_LOG rows so historical
 * months are checked correctly (not just last-visit comparison).
 *
 * @param {string} brandFilter  — brand name or 'ALL' / ''
 * @param {number} monthNumber  — 1-12 for specific month, 0/null for current
 * @returns {object[]} sorted A-Z by store name
 */
function sl_getComplianceGaps(brandFilter, monthNumber) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const now      = new Date();
  // DATA_YEAR comes from SVMKPI_CORE.gs (single source of truth for the
  // reporting year) — previously redeclared locally here, which shadowed
  // the shared constant and could silently drift out of sync with it.

  // ── Determine reference month ─────────────────────────────
  const refMonthIdx = (monthNumber && monthNumber >= 1 && monthNumber <= 12)
    ? monthNumber - 1          // convert to 0-based
    : now.getMonth();          // current month

  // ── Window boundaries anchored to reference month ─────────
  const monthStart   = new Date(DATA_YEAR, refMonthIdx, 1);
  const monthEnd     = new Date(DATA_YEAR, refMonthIdx + 1, 0, 23, 59, 59, 999);
  const qStart       = new Date(DATA_YEAR, Math.floor(refMonthIdx / 3) * 3, 1);
  const qEnd         = new Date(DATA_YEAR, Math.floor(refMonthIdx / 3) * 3 + 3, 0, 23, 59, 59, 999);
  const sixMonthsAgo = new Date(DATA_YEAR, refMonthIdx - 5, 1); // 6-month window ending last day of ref month

  // ── Read SETTINGS ─────────────────────────────────────────
  const settings = ss.getSheetByName('SETTINGS');
  if (!settings || settings.getLastRow() < 2) return [];

  const settingsRows = settings.getRange(2, 1, settings.getLastRow() - 1, 5).getValues();
  const allStores    = new Map();

  settingsRows.forEach(row => {
    const store    = String(row[0] || '').trim().toUpperCase();
    const brand    = String(row[1] || '').trim().toUpperCase();
    const region   = String(row[2] || '').trim().toUpperCase();
    const category = String(row[4] || '').trim().toUpperCase();
    if (!store) return;
    if (brandFilter && brandFilter !== 'ALL' && brand !== brandFilter) return;
    allStores.set(store, { brand, region, category });
  });

  // ── Scan MASTER_LOG once — build all needed maps ──────────
  const log = ss.getSheetByName('MASTER_LOG');

  // Sets: stores visited within each window type
  const visitedInMonth    = new Set();
  const visitedInQuarter  = new Set();
  const visitedInSixMonths = new Set();

  // Maps: last visit date and YTD count per store
  const lastVisitByStore = new Map();
  const ytdByStore       = new Map();

  if (log && log.getLastRow() >= 2) {
    const logData = log.getRange(2, 1, log.getLastRow() - 1, 8).getValues();

    logData.forEach(row => {
      const store   = String(row[2] || '').trim().toUpperCase();
      const dateRaw = row[1];
      if (!store || !allStores.has(store)) return;

      const date = dateRaw instanceof Date && !isNaN(dateRaw) ? dateRaw : null;
      if (!date) return;

      // YTD: count all visits in DATA_YEAR
      if (date.getFullYear() === DATA_YEAR) {
        ytdByStore.set(store, (ytdByStore.get(store) || 0) + 1);
      }

      // Last visit ever (any year)
      const existing = lastVisitByStore.get(store);
      if (!existing || date > existing) lastVisitByStore.set(store, date);

      // Window membership — set-based, covers any visit in the window
      if (date >= monthStart    && date <= monthEnd) visitedInMonth.add(store);
      if (date >= qStart        && date <= qEnd)     visitedInQuarter.add(store);
      if (date >= sixMonthsAgo  && date <= monthEnd) visitedInSixMonths.add(store);
    });
  }

  // ── Check compliance per store ────────────────────────────
  const gaps = [];

  allStores.forEach(({ brand, region, category }, store) => {
    const last      = lastVisitByStore.get(store) || null;
    const daysSince = last ? Math.floor((now - last) / 86400000) : null;
    const ytd       = ytdByStore.get(store) || 0;

    let compliant   = false;
    let windowLabel = '';

    if (category === 'NCR' || category === 'NEAR PROVINCIAL') {
      windowLabel = 'Monthly';
      compliant   = visitedInMonth.has(store);
    } else if (category === 'FAR PROVINCIAL') {
      windowLabel = 'Quarterly';
      compliant   = visitedInQuarter.has(store);
    } else if (category === 'FLIGHT PROVINCIAL') {
      windowLabel = 'Semi-Annual';
      compliant   = visitedInSixMonths.has(store);
    } else {
      return; // unknown category — skip
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

  // Sort A-Z by store name
  gaps.sort((a, b) => a.store.localeCompare(b.store));
  return gaps;
}
