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
// Reads from: MASTER_LOG (cols A–H), SETTINGS (cols A–C)
// Reuses _parseDateCell() (SVMKPI_CORE.gs, Phase 0.5) and, as of Phase 1C,
// getDefaultReportingYear() (SVMKPI_REPORTING_YEAR.gs) as
// sl_getComplianceGaps()'s fallback when no reportingYear is supplied —
// never a hardcoded year.
// Phase 1D: sl_getComplianceGaps() also reuses resolveCalendarPeriod()
// (SVMKPI_CALENDAR.gs, hard dependency) and, defensively (typeof-checked,
// falls back to the pre-Phase-1D per-category branches when absent),
// store_resolveIdByCurrentName() (SVMKPI_STORE_CONFIG.gs) and
// resolveComplianceConfigurationAsOf()/_cmp_resolveByCategory()
// (SVMKPI_COMPLIANCE_CONFIG.gs) for period-to-date, config-driven
// compliance — see that function's own docblock.
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

// Risk scoring: this module used to have its own independent "Bible §6"
// formula/thresholds (SL_RISK + _sl_computeHealth(), retired) that could
// silently disagree with Store Health's score for the same store. It now
// calls the same canonical engine Store Health uses — _computeStoreRisk()
// in SVMKPI_RISK.gs — via _sl_computeCanonicalHealth() below.

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
  if (lastRow < 2) return _sl_emptyResult(target, log);

  // Read cols A–H only (columns 1–8) — skip the auxiliary columns
  const raw = log.getRange(2, 1, lastRow - 1, 8).getValues();

  // ── Step 2: Filter to this store ──────────────────────────
  const rows = raw.filter(row => {
    const store = String(row[SL_COL.STORE] || '').trim().toUpperCase();
    return store === target;
  });

  if (rows.length === 0) return _sl_emptyResult(target, log);

  // ── Step 3: Sort filtered rows by date desc (newest first) ─
  // _parseDateCell() (SVMKPI_CORE.gs) — the same canonical parser
  // processSubmissionAsync()/checkDuplicateVisit()/_getData() use —
  // handles both a real Sheets Date object and a plain date string
  // consistently; the previous inline `instanceof Date` check silently
  // dropped any row whose cell wasn't already a Date object.
  rows.sort((a, b) => {
    const da = _parseDateCell(a[SL_COL.DATE]);
    const db = _parseDateCell(b[SL_COL.DATE]);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });

  // ── Step 4: Derive meta from SETTINGS ─────────────────────
  const meta = _sl_getMeta(target);

  // ── Step 5: Summary ───────────────────────────────────────
  const totalVisits  = rows.length;
  const lastRow_     = rows[0];
  const lastDate     = _parseDateCell(lastRow_[SL_COL.DATE]);
  const lastVisitor  = String(lastRow_[SL_COL.VISITOR] || '').trim().toUpperCase() || '—';
  const lastPurpose  = String(lastRow_[SL_COL.PURPOSE] || '').trim().toUpperCase() || '—';
  const lastVisitStr = lastDate ? _sl_formatDate(lastDate) : '—';

  // ── Step 6: Purpose breakdown (Phase 2C-continued: generic discovery) ──
  // Seeded from APPROVED_PURPOSES so the 4 legacy purposes keep appearing
  // exactly as before, even at zero — unchanged behavior. Any OTHER
  // purpose actually present on one of this store's own rows (discovered
  // from the data itself, never a hardcoded name) gets its own entry too,
  // instead of being silently folded away by the old hasOwnProperty()
  // gate, which dropped anything not already in APPROVED_PURPOSES. A
  // purpose with zero visits AT THIS STORE that isn't one of the 4
  // legacy ones is simply never added (omitted) — same convention this
  // app already uses elsewhere (e.g. KPI 2026 only lists visitors who
  // actually have history), not a newly invented presentation rule.
  const purposeCounts = {};
  APPROVED_PURPOSES.forEach(p => { purposeCounts[p] = 0; });
  rows.forEach(row => {
    const p = String(row[SL_COL.PURPOSE] || '').trim().toUpperCase();
    if (!p) return;
    purposeCounts[p] = (purposeCounts[p] || 0) + 1;
  });
  const purposes = Object.keys(purposeCounts).map(label => {
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
  const recentVisits = rows.slice(0, SL_RECENT_LIMIT).map(row => {
    const d = _parseDateCell(row[SL_COL.DATE]);
    return {
      date:    d ? _sl_formatDate(d) : '—',
      visitor: String(row[SL_COL.VISITOR] || '').trim().toUpperCase() || '—',
      purpose: String(row[SL_COL.PURPOSE] || '').trim().toUpperCase() || '—',
      remarks: String(row[SL_COL.REMARKS] || '').trim()               || '—',
    };
  });

  // ── Step 9: Health score — canonical engine, shared with Store Health ─
  const health = _sl_computeCanonicalHealth(log, target);

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
 * _sl_computeCanonicalHealth(log, storeName)
 * Looks up a single store's risk score/tier from the SAME canonical
 * engine that powers Store Health — _computeStoreRisk() in
 * SVMKPI_RISK.gs — instead of this module's own, independently-tuned
 * "Bible §6" formula (retired: it could score a store completely
 * differently here than on the Store Health sheet for the exact same
 * data, e.g. a never-visited store scored HIGH here via a days-since/30
 * penalty but only the modest "no history" +3 on Store Health).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} log - MASTER_LOG sheet
 * @param {string} storeName - Already normalized (uppercase, trimmed)
 * @returns {{ score: number, label: string, components: { daysSince: number } }}
 */
function _sl_computeCanonicalHealth(log, storeName) {
  const data = _getData(log);
  const riskRows = _computeStoreRisk(data, new Date());
  const row = riskRows.find(r => r.store === storeName);
  return {
    score: row ? row.riskScore : 0,
    label: row ? row.riskTier : 'LOW',
    components: {
      daysSince: (row && row.daysSince != null) ? row.daysSince : 999,
    },
  };
}

/**
 * _sl_emptyResult(storeName, log)
 * Returns a zeroed-out result object for a store with no MASTER_LOG history.
 * @param {string} storeName
 * @param {GoogleAppsScript.Spreadsheet.Sheet} log - MASTER_LOG sheet
 * @returns {StoreResult}
 */
function _sl_emptyResult(storeName, log) {
  const meta = _sl_getMeta(storeName);
  const health = _sl_computeCanonicalHealth(log, storeName);
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
 * sl_getStoreFormOptions()
 * Dropdown options for the System Tools "Store & Roster Manager" card's
 * store form: brands actually in use (sl_getBrandList(), same source the
 * global brand filter already uses) plus the fixed region/category enums
 * (APPROVED_REGIONS/APPROVED_CATEGORIES in SVMKPI_CORE.gs).
 * @returns {{brands:string[], regions:string[], categories:string[]}}
 */
function sl_getStoreFormOptions() {
  return {
    brands: sl_getBrandList(),
    regions: APPROVED_REGIONS.slice(),
    categories: APPROVED_CATEGORIES.slice(),
  };
}

/**
 * _slBrandAllowed(brand, brandFilter)
 * Shared brand-filter check for sl_getVisitedThisMonth() and
 * sl_getComplianceGaps(). The portal's Brand filter is multi-select, so
 * brandFilter normally arrives as an array of UPPERCASE brand names (empty
 * array = no filter, i.e. "All Brands"). The legacy single-brand string
 * ('ALL' / '' / a brand name) is still accepted for backward compatibility.
 *
 * @param {string} brand — a store's brand, already UPPERCASE
 * @param {string[]|string} brandFilter
 * @returns {boolean}
 */
function _slBrandAllowed(brand, brandFilter) {
  if (!brandFilter) return true;
  if (Array.isArray(brandFilter)) return brandFilter.length === 0 || brandFilter.indexOf(brand) !== -1;
  return brandFilter === 'ALL' || brand === brandFilter;
}

/**
 * sl_getVisitedThisMonth(brandFilter, monthNumber, reportingYear)
 * Returns stores that HAVE been visited in the requested calendar month
 * (default: the current one), optionally filtered by brand. Powers the
 * "Visited This Month" view in the Store Insights tab. (Its mirror image
 * — what's still outstanding — is the Unvisited This Month tab, served
 * by sl_getComplianceGaps().)
 *
 * Returns TWO buckets instead of a flat list. A MASTER_LOG row's Store
 * text doesn't always resolve to a CURRENT SETTINGS roster entry (the
 * store was renamed, deactivated/removed, or the text has a typo/case
 * mismatch) — Executive Summary's own Monthly-by-Brand COUNTIFS
 * (SVMKPI_LAYOUT.gs) has no such roster check, so it still counts that
 * visit. Silently dropping the row here (as this function used to)
 * undercounts relative to Executive Summary. `unmapped` surfaces exactly
 * those rows instead of dropping them, mirroring the CONFIG_UNMAPPED_
 * STORES pattern already used for Store ID identity migration
 * (SVMKPI_STORE_CONFIG.gs) — so `resolved` visits + `unmapped` visits
 * reconciles with Executive Summary's raw brand+month count.
 *
 * `unmapped` is computed against the FULL roster (every SETTINGS store,
 * any brand) regardless of `brandFilter` — an unresolved row has no
 * known brand to filter by, and Executive Summary's own count for a
 * single brand wouldn't include it either, so it's only meaningful
 * against the all-brands total. A row for a store that IS in the roster
 * but excluded by `brandFilter` is filtered out entirely, same as before
 * — it's not "unmapped," just out of scope for this call.
 *
 * @param {string[]|string} brandFilter — array of UPPERCASE brand names to
 *   keep (empty array = no filter), or the legacy single brand name / 'ALL' / ''
 * @param {number} [monthNumber] — 1-12 for a specific month, omit/0 for
 *   the current month.
 * @param {number} [reportingYear] — the calendar year monthNumber is
 *   anchored to. Omit for getDefaultReportingYear() (SVMKPI_REPORTING_YEAR.gs).
 * @returns {{
 *   resolved: {name: string, brand: string, region: string, visits: number,
 *     lastVisitDate: string, lastPurpose: string, visitors: string, daysSince: (number|null)}[],
 *   unmapped: {name: string, visits: number, lastVisitDate: string}[]
 * }} `resolved` sorted most-recently-visited first (same-day ties by
 *   name); `unmapped` sorted by visit count descending, then name.
 */
function sl_getVisitedThisMonth(brandFilter, monthNumber, reportingYear) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const now  = new Date();
  const year = (reportingYear != null && !isNaN(Number(reportingYear)))
    ? Number(reportingYear)
    : getDefaultReportingYear();
  const refMonthIdx = (monthNumber && monthNumber >= 1 && monthNumber <= 12)
    ? monthNumber - 1          // convert to 0-based
    : now.getMonth();          // current month

  // Requested-month bounds (server timezone)
  const monthStart = new Date(year, refMonthIdx, 1, 0, 0, 0, 0);
  const monthEnd   = new Date(year, refMonthIdx + 1, 0, 23, 59, 59, 999);

  // ── Store roster from SETTINGS (brand/region come from here) ──
  const settings = ss.getSheetByName(SL_SHEET.SETTINGS);
  if (!settings || settings.getLastRow() < 2) return { resolved: [], unmapped: [] };

  const settingsRows = settings.getRange(2, 1, settings.getLastRow() - 1, 3).getValues();
  const allStores     = new Map(); // name → {brand, region} — brandFilter-scoped
  const rosterNames    = new Set(); // every SETTINGS store name, ANY brand — for unmapped detection

  settingsRows.forEach(row => {
    const name   = String(row[SL_SETTINGS_COL.STORE]  || '').trim().toUpperCase();
    const brand  = String(row[SL_SETTINGS_COL.BRAND]  || '').trim().toUpperCase();
    const region = String(row[SL_SETTINGS_COL.REGION] || '').trim().toUpperCase();
    if (!name) return;
    rosterNames.add(name);
    if (allStores.has(name)) return;
    if (!_slBrandAllowed(brand, brandFilter)) return;
    allStores.set(name, { brand, region });
  });

  // ── Scan MASTER_LOG once, accumulating this month's visits ───
  const log = ss.getSheetByName(SL_SHEET.MASTER_LOG);
  if (!log || log.getLastRow() < 2) return { resolved: [], unmapped: [] };

  const logData     = log.getRange(2, 1, log.getLastRow() - 1, 8).getValues();
  const acc          = new Map(); // name → {visits, lastDate, lastPurpose, visitors:Set}
  const unmappedAcc  = new Map(); // raw store text → {visits, lastDate}

  logData.forEach(row => {
    const store = String(row[SL_COL.STORE] || '').trim().toUpperCase();
    if (!store) return;

    const date = _parseDateCell(row[SL_COL.DATE]);
    if (!date || date < monthStart || date > monthEnd) return;

    if (!rosterNames.has(store)) {
      // Doesn't resolve to ANY current SETTINGS entry — surface it
      // instead of silently dropping it (see docblock above).
      let u = unmappedAcc.get(store);
      if (!u) { u = { visits: 0, lastDate: null }; unmappedAcc.set(store, u); }
      u.visits++;
      if (!u.lastDate || date > u.lastDate) u.lastDate = date;
      return;
    }
    if (!allStores.has(store)) return; // in roster, just excluded by brandFilter

    let a = acc.get(store);
    if (!a) { a = { visits: 0, lastDate: null, lastPurpose: '', visitors: [] }; acc.set(store, a); }

    a.visits++;
    if (!a.lastDate || date > a.lastDate) {
      a.lastDate    = date;
      a.lastPurpose = String(row[SL_COL.PURPOSE] || '').trim().toUpperCase();
    }
    // Col F is pipe-delimited for multi-visitor rows (Bible §3.4)
    String(row[SL_COL.VISITOR] || '').toUpperCase().split('|')
      .map(v => v.trim()).filter(Boolean)
      .forEach(v => { if (a.visitors.indexOf(v) === -1) a.visitors.push(v); });
  });

  // ── Shape the resolved result ─────────────────────────────────
  // daysSince is carried alongside the formatted date so the portal can sort
  // "Last Visit" chronologically — the display string ("Aug 31, 2026") would
  // otherwise only sort alphabetically.
  const resolved = [];
  acc.forEach((a, name) => {
    const info = allStores.get(name);
    resolved.push({
      name,
      brand:         info.brand,
      region:        info.region,
      visits:        a.visits,
      lastVisitDate: a.lastDate ? _sl_formatDate(a.lastDate) : '—',
      lastPurpose:   a.lastPurpose || '—',
      visitors:      a.visitors.sort().join(', '),
      daysSince:     a.lastDate ? Math.floor((now - a.lastDate) / 86400000) : null,
    });
  });

  // Most recently visited first; same-day ties by store name.
  resolved.sort((a, b) => (a.daysSince - b.daysSince) || a.name.localeCompare(b.name));

  // ── Shape the unmapped result ──────────────────────────────────
  const unmapped = [];
  unmappedAcc.forEach((u, name) => {
    unmapped.push({
      name,
      visits:        u.visits,
      lastVisitDate: u.lastDate ? _sl_formatDate(u.lastDate) : '—',
    });
  });
  unmapped.sort((a, b) => (b.visits - a.visits) || a.name.localeCompare(b.name));

  return { resolved, unmapped };
}

/**
 * sl_getUnvisitedThisMonth(brandFilter)
 * Returns stores from SETTINGS that have NO visit in the current
 * calendar month, optionally filtered by brand.
 *
 * NOTE: no longer wired to the portal UI — the Unvisited This Month tab
 * uses sl_getComplianceGaps() instead, which applies each store's own
 * category window (monthly / quarterly / semi-annual) rather than a flat
 * calendar month. Kept as a straight calendar-month view for callers that
 * want exactly that.
 *
 * @param {string[]|string} brandFilter — array of UPPERCASE brand names to
 *   keep (empty array = no filter), or the legacy single brand name / 'ALL' / ''
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
    if (!_slBrandAllowed(brand, brandFilter)) return;
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
    const store = String(row[SL_COL.STORE] || '').trim().toUpperCase();
    if (!store) return;

    const date = _parseDateCell(row[SL_COL.DATE]);

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
 * @param {string[]|string} brandFilter — array of UPPERCASE brand names, or the legacy brand name / 'ALL' / ''
 * @returns {{ store, brand, region, category, lastVisitDate, daysSince, windowLabel }[]}
 */
/**
 * sl_getComplianceGaps(brandFilter, monthNumber, reportingYear, evaluationDateStr)
 * Returns stores that have NOT met their category's PERIOD-TO-DATE visit
 * requirement for the given month (or current month if monthNumber is
 * 0/null).
 *
 * Phase 1D: this is now the calendar-period-to-date compliance model
 * (business decision — calendar periods, never a rolling-N-day window):
 * for the calendar period (month/quarter/semi-annual, via
 * resolveCalendarPeriod(), SVMKPI_CALENDAR.gs) containing the reference
 * month, qualifying activity is counted from the period's START through
 * the EVALUATION DATE (never past it) — an event dated after the
 * evaluation date, even if still inside the same period, does not count.
 * The required visit COUNT per period and the calendar-period family are
 * both configuration-driven via CONFIG_COMPLIANCE, resolved through the
 * store's Store ID (Phase 1B — never Store Name) as of the evaluation
 * date, falling back to the pre-Phase-1D hardcoded per-category rule
 * (CMP_DEFAULT_RULES, SVMKPI_COMPLIANCE_CONFIG.gs) when no CONFIG_
 * COMPLIANCE version exists yet or the store's ID doesn't resolve —
 * zero behavior change pre-migration. The previous "Flight Provincial"
 * window was a ROLLING 6 calendar months ending at the reference month;
 * it is now the calendar half-year (Jan–Jun / Jul–Dec) containing it,
 * per the Phase 1D calendar-period business decision (no existing test
 * asserted the old rolling window, so this is a safe, deliberate change
 * — see DEPLOY.md).
 *
 * @param {string[]|string} brandFilter  — array of UPPERCASE brand names to keep
 *   (empty array = no filter), or the legacy single brand name / 'ALL' / ''
 * @param {number} monthNumber  — 1-12 for specific month, 0/null for current
 * @param {number} [reportingYear] — Phase 1C: the calendar year the month/
 *   quarter/half-year windows are anchored to. Omit for
 *   getDefaultReportingYear() (SVMKPI_REPORTING_YEAR.gs).
 * @param {string} [evaluationDateStr] — Phase 1D: the explicit evaluation
 *   date ('YYYY-MM-DD') period-to-date counting is clipped to, and
 *   configuration is resolved as of. Omit and a specific month/year WAS
 *   requested → defaults to that period's own end (evaluates the period
 *   as fully elapsed, matching pre-Phase-1D behavior exactly). Omit with
 *   NO month/year requested either (a genuinely "right now" query) →
 *   defaults to today. Never silently substitutes today for an
 *   explicitly historical evaluation.
 * @returns {object[]} sorted A-Z by store name
 */
function sl_getComplianceGaps(brandFilter, monthNumber, reportingYear, evaluationDateStr) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const now      = new Date();
  const year     = (reportingYear != null && !isNaN(Number(reportingYear)))
    ? Number(reportingYear)
    : getDefaultReportingYear();

  // ── Determine reference month ─────────────────────────────
  const specificPeriodRequested = !!(monthNumber || reportingYear != null);
  const refMonthIdx = (monthNumber && monthNumber >= 1 && monthNumber <= 12)
    ? monthNumber - 1          // convert to 0-based
    : now.getMonth();          // current month
  const periodRefDate = new Date(year, refMonthIdx, 1);

  // ── Calendar-period boundaries (SVMKPI_CALENDAR.gs) ───────
  const monthPeriod   = resolveCalendarPeriod(periodRefDate, CAL_PERIOD_FAMILY.MONTH);
  const quarterPeriod = resolveCalendarPeriod(periodRefDate, CAL_PERIOD_FAMILY.QUARTER);
  const semiPeriod    = resolveCalendarPeriod(periodRefDate, CAL_PERIOD_FAMILY.SEMI_ANNUAL);

  // ── Evaluation date: explicit > (a specific period was requested ->
  //    that period's own end, i.e. evaluate it as fully elapsed) > now ──
  let evaluationDate;
  if (evaluationDateStr) {
    evaluationDate = _parseDateCell(evaluationDateStr) || now;
  } else if (specificPeriodRequested) {
    evaluationDate = monthPeriod.periodEnd;
  } else {
    evaluationDate = now;
  }

  // Period-to-date: never count activity after the evaluation date, even
  // if still inside the same period.
  const clip = (periodEnd) => (periodEnd.getTime() < evaluationDate.getTime() ? periodEnd : evaluationDate);
  const monthStart   = monthPeriod.periodStart,   monthEnd   = clip(monthPeriod.periodEnd);
  const qStart       = quarterPeriod.periodStart, qEnd       = clip(quarterPeriod.periodEnd);
  const semiStart    = semiPeriod.periodStart,    semiEnd    = clip(semiPeriod.periodEnd);

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
    if (!_slBrandAllowed(brand, brandFilter)) return;
    allStores.set(store, { brand, region, category });
  });

  // ── Scan MASTER_LOG once — build all needed maps ──────────
  const log = ss.getSheetByName('MASTER_LOG');

  // Maps: visit COUNT within each period-to-date window (not just a
  // boolean "any visit" — Phase 1D's requiredCount can be > 1)
  const countInMonth    = new Map();
  const countInQuarter  = new Map();
  const countInSemi     = new Map();

  // Maps: last visit date and YTD count per store
  const lastVisitByStore = new Map();
  const ytdByStore       = new Map();

  if (log && log.getLastRow() >= 2) {
    const logData = log.getRange(2, 1, log.getLastRow() - 1, 8).getValues();

    logData.forEach(row => {
      const store = String(row[2] || '').trim().toUpperCase();
      if (!store || !allStores.has(store)) return;

      const date = _parseDateCell(row[1]);
      if (!date) return;

      // YTD: count all visits in the requested reporting year
      if (date.getFullYear() === year) {
        ytdByStore.set(store, (ytdByStore.get(store) || 0) + 1);
      }

      // Last visit ever (any year)
      const existing = lastVisitByStore.get(store);
      if (!existing || date > existing) lastVisitByStore.set(store, date);

      // Period-to-date window membership — counted, not just boolean
      const bump = (map) => map.set(store, (map.get(store) || 0) + 1);
      if (date >= monthStart && date <= monthEnd) bump(countInMonth);
      if (date >= qStart     && date <= qEnd)     bump(countInQuarter);
      if (date >= semiStart  && date <= semiEnd)  bump(countInSemi);
    });
  }

  // ── Check compliance per store ────────────────────────────
  const gaps = [];

  allStores.forEach(({ brand, region, category }, store) => {
    const last      = lastVisitByStore.get(store) || null;
    const daysSince = last ? Math.floor((evaluationDate - last) / 86400000) : null;
    const ytd       = ytdByStore.get(store) || 0;

    // Store ID (Phase 1B) is the configuration-resolution entry point;
    // falls back to the raw SETTINGS category when Store ID isn't
    // available/migrated yet — the same graceful-degradation Phase 1B
    // established elsewhere.
    let rule = null;
    if (typeof store_resolveIdByCurrentName === 'function' && typeof resolveComplianceConfigurationAsOf === 'function') {
      const storeId = store_resolveIdByCurrentName(store);
      if (storeId) rule = resolveComplianceConfigurationAsOf(storeId, evaluationDate);
    }
    if (!rule && typeof _cmp_resolveByCategory === 'function') {
      rule = _cmp_resolveByCategory(category, evaluationDate);
    }

    let compliant, windowLabel, requiredCount, actualCount;

    if (rule) {
      requiredCount = rule.requiredCount || 1;
      const family = rule.periodDefinition;
      if (family === CAL_PERIOD_FAMILY.MONTH) { windowLabel = 'Monthly'; actualCount = countInMonth.get(store) || 0; }
      else if (family === CAL_PERIOD_FAMILY.QUARTER) { windowLabel = 'Quarterly'; actualCount = countInQuarter.get(store) || 0; }
      else if (family === CAL_PERIOD_FAMILY.SEMI_ANNUAL) { windowLabel = 'Semi-Annual'; actualCount = countInSemi.get(store) || 0; }
      else return; // resolved rule with an unrecognized period family — skip rather than guess
      compliant = actualCount >= requiredCount;
    } else {
      return; // unknown category, no config, no hardcoded default — skip (matches pre-Phase-1D behavior)
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
        requiredCount,
        actualCount,
      });
    }
  });

  // Sort A-Z by store name
  gaps.sort((a, b) => a.store.localeCompare(b.store));
  return gaps;
}
