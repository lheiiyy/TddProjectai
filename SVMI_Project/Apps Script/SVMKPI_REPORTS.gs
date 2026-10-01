// ============================================================
// SVMKPI_REPORTS.gs
// Store Visit Monitoring KPI — Read-Only Report Readers
// ------------------------------------------------------------
// Executive Summary: computed directly from MASTER_LOG (see below).
// KPI 2026 and Store Health: reads the already-computed KPI 2026 and STORE
// HEALTH sheets (all three are built by formulas/scripts elsewhere —
// SVMKPI_LAYOUT.gs, SVMKPI_KPI_REBUILD.gs, SVMKPI_RISK.gs — this file
// only reads their current cell values) into plain JSON for the
// portal's "📊 Reports" tab, so viewing them doesn't require opening
// the actual Spreadsheet.
//
// Every reader uses getDisplayValues() rather than getValues(): the
// sheets already carry the right number/date/percent formatting
// (e.g. "0.0%", "yyyy-mm-dd"), so reading the display string is exact
// and needs no reformatting here.
//
// Read-only module. Never writes to any sheet. Reuses CELL (Executive
// Summary cell map) from SVMKPI_CORE.gs, KPI_* constants and
// _kpiSheetName()/_weekRanges() from SVMKPI_KPI_REBUILD.gs, RISK_*
// constants from SVMKPI_RISK.gs / SVMKPI_RISK_LAYOUT.gs, and (Phase 1C)
// getDefaultReportingYear() from SVMKPI_REPORTING_YEAR.gs as
// getKPI2026Report()'s fallback when no year is supplied — never
// redeclares any of them.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// EXECUTIVE SUMMARY
// ═══════════════════════════════════════════════════════════════

/**
 * getExecutiveSummaryReport(year)
 * Computes the Executive Summary DIRECTLY from MASTER_LOG (one batch read
 * via _getData()) instead of copying fixed cells off the EXECUTIVE SUMMARY
 * sheet. Same return shape as before, so the portal renderer is unchanged.
 *
 * Mirrors the sheet formulas in _buildESFormulas() (SVMKPI_LAYOUT.gs):
 *   - KPI cards, Region, Purpose, Brand totals, Top Stores, Leaderboard:
 *     all-time counts over every MASTER_LOG row (same as the COUNTIF cells).
 *   - Monthly-by-brand and Brand peak month/count: limited to `year`.
 * Differences from the old sheet read (all intentional):
 *   - Works even if the EXECUTIVE SUMMARY tab is missing or out of date.
 *   - Follows APPROVED_BRANDS automatically (a 6th brand just appears).
 *   - Matching is trim/case/apostrophe-insensitive via _normalizeEnum().
 *   - Leaderboard order is always current (the sheet only re-sorted on rebuild).
 *
 * @param {number} [year] reporting year for the monthly section;
 *        defaults to getDefaultReportingYear().
 */
function getExecutiveSummaryReport(year) {
  const t0 = Date.now();
  const reportYear = (year != null && !isNaN(Number(year))) ? Number(year) : getDefaultReportingYear();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(SHEET.MASTER_LOG);
  if (!log) throw new Error('MASTER_LOG sheet not found.');
  const data = _getData(log);

  const n = v => String(v);
  const pct = (part, whole, dp) => (whole ? (part / whole * 100) : 0).toFixed(dp) + '%';
  const brands   = APPROVED_BRANDS;
  const regions  = APPROVED_REGIONS;
  const purposes = APPROVED_PURPOSES;

  // ── single pass over MASTER_LOG ──
  const purposeCount = {}, regionCount = {}, brandCount = {}, storeCount = {};
  const monthBrand = Array.from({ length: 12 }, () => brands.map(() => 0));
  let totalVisits = 0;
  for (let i = 0; i < data.totalRows; i++) {
    const store = data.stores[i];
    if (store) {
      totalVisits++;                                   // = COUNTA(C:C)-1
      storeCount[store] = (storeCount[store] || 0) + 1;
    }
    purposeCount[data.purposes[i]] = (purposeCount[data.purposes[i]] || 0) + 1;
    regionCount[data.regions[i]]   = (regionCount[data.regions[i]]   || 0) + 1;
    brandCount[data.brands[i]]     = (brandCount[data.brands[i]]     || 0) + 1;
    const d = data.dates[i];
    const bi = brands.indexOf(data.brands[i]);
    if (d && bi !== -1 && d.getFullYear() === reportYear) monthBrand[d.getMonth()][bi]++;
  }
  const pc = p => purposeCount[p] || 0;
  const rc = r => regionCount[r]  || 0;
  const bc = b => brandCount[b]   || 0;

  // ── KPI cards ──
  const kpi = [
    { label: 'Total Visits',   value: n(totalVisits) },
    { label: 'Store Visits',   value: n(pc('STORE VISIT')) },
    { label: 'TLTC',           value: n(pc('TLTC')) },
    { label: 'Failed QA/MS',   value: n(pc('FAILED QA/MS')) },
    { label: 'Curing/Support', value: n(pc('CURING/SUPPORT')) },
    { label: 'NCR',            value: n(rc('NCR')) },
    { label: 'Provincial',     value: n(rc('PROVINCIAL')) },
  ];

  // ── Monthly by brand (reportYear) ──
  const monthBrandLabels = brands.slice();
  const monthly = MONTH_NAMES.map((month, m) => {
    const row = monthBrand[m];
    return { month, byBrand: row.map(n), total: n(row.reduce((a, b) => a + b, 0)) };
  });
  const colTotals = brands.map((_, bi) => monthBrand.reduce((a, row) => a + row[bi], 0));
  const monthlyTotal = { byBrand: colTotals.map(n), total: n(colTotals.reduce((a, b) => a + b, 0)) };

  // ── Region ──
  const regionSum = regions.reduce((a, r) => a + rc(r), 0);
  const region = regions.map(r => ({ name: r, visits: n(rc(r)), pct: pct(rc(r), regionSum, 1) }));
  const regionTotal = { visits: n(regionSum), pct: pct(regionSum, regionSum, 1) };

  // ── Purpose ──
  const purposeSum = purposes.reduce((a, p) => a + pc(p), 0);
  const purpose = purposes.map(p => ({ name: p, count: n(pc(p)), pct: pct(pc(p), purposeSum, 1) }));
  const purposeTotal = { count: n(purposeSum), pct: pct(purposeSum, purposeSum, 1) };

  // ── Top stores (count desc, then name for a stable order) ──
  const topStores = Object.keys(storeCount)
    .sort((a, b) => (storeCount[b] - storeCount[a]) || a.localeCompare(b))
    .slice(0, CELL.STORES_LIMIT)
    .map((name, i) => ({ rank: n(i + 1), name, visits: n(storeCount[name]) }));

  // ── Visitor leaderboard (SETTINGS!F roster; a visitor counts once per row) ──
  const leaderboard = _es_leaderboard(ss, data)
    .slice(0, CELL.LEADER_LIMIT)
    .map((v, i) => ({ rank: n(i + 1), name: v.name, visits: n(v.count) }));

  // ── Brand performance ──
  const brandSum = brands.reduce((a, b) => a + bc(b), 0);
  const brandPerformance = brands.map((brand, bi) => {
    const counts = monthBrand.map(row => row[bi]);
    const peak = Math.max.apply(null, counts);
    return {
      brand, total: n(bc(brand)), pct: pct(bc(brand), brandSum, 2),
      peakMonth: MONTH_NAMES[counts.indexOf(peak)], peakCount: n(peak),
    };
  });
  const brandTotal = { total: n(brandSum), pct: pct(brandSum, brandSum, 2), peakMonth: '', peakCount: '' };

  _perfLog('getExecutiveSummaryReport', t0, data.totalRows + ' rows');
  return { year: reportYear, kpi, monthBrandLabels, monthly, monthlyTotal, region, regionTotal, purpose, purposeTotal, topStores, leaderboard, brandPerformance, brandTotal };
}

/** Roster from SETTINGS!F with all-time visit counts, sorted desc. */
function _es_leaderboard(ss, data) {
  const settings = ss.getSheetByName(SHEET.SETTINGS);
  if (!settings || settings.getLastRow() < 2) return [];
  const seen = {};
  const roster = settings.getRange(2, 6, settings.getLastRow() - 1, 1).getValues()
    .map(r => _normalizeEnum(r[0]))
    .filter(name => name && !seen[name] && (seen[name] = true));
  const counts = {};
  roster.forEach(name => { counts[name] = 0; });
  data.rawVisitors.forEach(cell => {
    const unique = {};
    _normalizeVisitors(cell).forEach(name => { unique[name] = true; });
    Object.keys(unique).forEach(name => { if (name in counts) counts[name]++; });
  });
  return roster
    .map((name, i) => ({ name, count: counts[name], order: i }))
    .sort((a, b) => (b.count - a.count) || (a.order - b.order));
}

/**
 * _perfLog(fnName, t0, detail)
 * One timing line per server call — visible in Apps Script → Executions
 * (and Logs). Lets you measure live load times without changing behavior.
 */
function _perfLog(fnName, t0, detail) {
  try { console.log('[SVMI PERF] ' + fnName + ' ' + (Date.now() - t0) + ' ms' + (detail ? ' · ' + detail : '')); } catch (e) {}
}


// ═══════════════════════════════════════════════════════════════
// KPI 2026
// ═══════════════════════════════════════════════════════════════

/**
 * getKPI2026Report(year)
 * Each visitor's monthly TOTAL column, Q1–Q4/YTD summary, AND a per-week
 * breakdown labeled "P{period}W{week}" — period = calendar month (P1 =
 * January), week = a continuous count across the whole year (P1W1 is the
 * year's first week, not "January's first week" restarting every month;
 * so e.g. if January has 5 weeks, February's first real week is P2W6).
 * Reuses the same Sun–Sat week boundaries the sheet's own W1–W5 columns
 * are built from (_weekRanges(), SVMKPI_KPI_REBUILD.gs) — a short
 * month's unused W5 slot (a disabled, static 0 in the sheet, not a real
 * formula) is skipped rather than given a fake label.
 *
 * Phase 1C: `year` selects which "KPI <year>" sheet to read (SAME
 * implementation for any year, historically-named function kept for
 * compatibility — see DEPLOY.md). Omit for getDefaultReportingYear()
 * (SVMKPI_REPORTING_YEAR.gs), never a hardcoded literal. Throws if that
 * year's sheet hasn't been built yet (this reader never builds one).
 * @param {number} [year]
 * @returns {{
 *   year: number, months: string[], weekLabels: string[],
 *   visitors: {name:string, monthly:string[], weekly:string[], q1:string, q2:string, q3:string, q4:string, ytd:string}[],
 *   team: {monthly:string[], weekly:string[], q1:string, q2:string, q3:string, q4:string, ytd:string}
 * }}
 */
function _getKPI2026Report_impl(year) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reportYear = (year != null && !isNaN(Number(year))) ? Number(year) : getDefaultReportingYear();
  const sheet = ss.getSheetByName(_kpiSheetName(reportYear));
  if (!sheet) throw new Error('"' + _kpiSheetName(reportYear) + '" sheet not found. Run "Rebuild KPI 2026" first.');

  const DATA_ROW_START = 6; // matches buildKPI2026() in SVMKPI_KPI_REBUILD.gs
  const monthTotCols = KPI_MONTHS.map((_, mi) => KPI_MON_START + mi * KPI_BLOCK + 5); // W1-W5,TOT,spacer — offset 5 = TOT

  // Period/Week columns — see the "P{period}W{week}" note above.
  const weekCols = []; // { col, label }
  let weekCounter = 0;
  for (let mi = 0; mi < 12; mi++) {
    const month = mi + 1;
    const weeks = _weekRanges(reportYear, month);
    const sc = KPI_MON_START + mi * KPI_BLOCK;
    weeks.forEach((_, wi) => {
      weekCounter++;
      weekCols.push({ col: sc + wi, label: 'P' + month + 'W' + weekCounter });
    });
  }

  // ONE getDisplayValues() call for the whole potential data block
  // (instead of one call per cell, AND instead of one call PER ROW as
  // this previously did — see SVMI_Project/reviews/REVIEW-003.md:
  // a report with V visitor rows was V separate round-trips to the
  // Sheets backend just for this loop) — read the whole data span once
  // (name column included), then slice out what's needed by index from
  // the in-memory array. Walking rows off the sheet itself (rather than
  // re-deriving the visitor list from SETTINGS!F, as this used to) means a
  // roster change can never desync this reader from what buildKPI2026()
  // actually wrote — including the historical-only rows it now appends for
  // anyone removed from the roster who still has real visit history.
  const rowStartCol = KPI_NAME_COL;
  const rowWidth     = KPI_YTD_COL - KPI_NAME_COL + 1;

  const readRow = (vals) => {
    const at = (col) => vals[col - rowStartCol];
    return {
      name: String(vals[0] || '').trim(),
      monthly: monthTotCols.map(at),
      weekly:  weekCols.map(w => at(w.col)),
      q1: at(SUMCOLS[0]), q2: at(SUMCOLS[1]), q3: at(SUMCOLS[2]), q4: at(SUMCOLS[3]), ytd: at(SUMCOLS[4]),
    };
  };

  const visitors = [];
  let team = {};
  const lastRow = sheet.getLastRow();
  const blockRows = lastRow - DATA_ROW_START + 1;
  // Same early-termination contract as before: a blank-name row or
  // "TEAM TOTAL" ends the scan, whether reached via a live per-row read
  // or (now) an index into this one pre-fetched block.
  const block = blockRows > 0
    ? sheet.getRange(DATA_ROW_START, rowStartCol, blockRows, rowWidth).getDisplayValues()
    : [];
  for (let i = 0; i < block.length; i++) {
    const r = readRow(block[i]);
    if (!r.name) break;               // ran past the last written row
    if (r.name === 'TEAM TOTAL') { team = r; break; }
    visitors.push(r);
  }

  return { year: reportYear, months: KPI_MONTHS, weekLabels: weekCols.map(w => w.label), visitors, team };
}


// ═══════════════════════════════════════════════════════════════
// STORE HEALTH
// ═══════════════════════════════════════════════════════════════

/**
 * getStoreHealthReport()
 * Numeric fields (daysSince, totalYtd, storeYtd, failedCount, curingCount,
 * riskScore) come back as actual numbers (daysSince is null for a
 * never-visited store, matching the same null-means-blank convention the
 * Unvisited This Month table's daysSince already uses) rather than
 * display strings — the Reports tab's Store Health table sorts/filters
 * this data through the same FT engine those tables use, which needs
 * real numbers to sort and filter correctly, not "—" or "NEVER VISITED".
 * @returns {{
 *   kpis: {label:string, value:string}[],
 *   headers: string[],
 *   rows: {store:string, brand:string, region:string, lastVisitDate:string,
 *          lastPurpose:string, daysSince:(number|null), totalYtd:number, storeYtd:number,
 *          failedCount:number, curingCount:number, riskScore:number, riskTier:string,
 *          action:string, attentionReason:string}[]
 * }}
 */
function _getStoreHealthReport_impl() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RISK_SHEET_NAME);
  if (!sheet) throw new Error('STORE HEALTH sheet not found. Run "Rebuild Store Health" first.');

  const kpis = RISK_KPI_CARDS.map(card => ({
    label: card.label,
    value: sheet.getRange(RISK_ROW.KPI_VALUE, card.colStart).getDisplayValue(),
  }));

  // Numeric columns read via getValues() (real numbers) rather than
  // getDisplayValues() — DAYS_SINCE holds the literal string 'NEVER
  // VISITED' for a never-visited store (see populateRiskEngine()), so
  // that one column gets a null instead.
  const numToNull = (v) => (typeof v === 'number' ? v : null);

  const lastRow = sheet.getLastRow();
  const rows = [];
  if (lastRow >= RISK_ROW.DATA_START) {
    const numRows = lastRow - RISK_ROW.DATA_START + 1;
    const display = sheet.getRange(RISK_ROW.DATA_START, 1, numRows, RISK_HEADERS.length).getDisplayValues();
    const values  = sheet.getRange(RISK_ROW.DATA_START, 1, numRows, RISK_HEADERS.length).getValues();
    display.forEach((r, i) => {
      if (!String(r[RISK_COL.STORE - 1] || '').trim()) return; // skip blank trailing rows
      const v = values[i];
      rows.push({
        store:           r[RISK_COL.STORE - 1],
        brand:           r[RISK_COL.BRAND - 1],
        region:          r[RISK_COL.REGION - 1],
        lastVisitDate:   r[RISK_COL.LAST_DATE - 1],
        lastPurpose:     r[RISK_COL.LAST_PURPOSE - 1],
        daysSince:       numToNull(v[RISK_COL.DAYS_SINCE - 1]),
        totalYtd:        Number(v[RISK_COL.TOTAL_YTD - 1])    || 0,
        storeYtd:        Number(v[RISK_COL.STORE_YTD - 1])    || 0,
        failedCount:     Number(v[RISK_COL.FAILED_COUNT - 1]) || 0,
        curingCount:     Number(v[RISK_COL.CURING_COUNT - 1]) || 0,
        riskScore:       Number(v[RISK_COL.RISK_SCORE - 1])   || 0,
        riskTier:        r[RISK_COL.RISK_TIER - 1],
        action:          r[RISK_COL.ACTION - 1],
        attentionReason: r[RISK_COL.ATTENTION_REASON - 1],
      });
    });
  }

  return { kpis, headers: RISK_HEADERS, rows };
}


// #7 timing wrapper — logs "[SVMI PERF] getStoreHealthReport N ms" to Apps Script → Executions.
function getStoreHealthReport() {
  const t0 = Date.now();
  try { return _getStoreHealthReport_impl.apply(this, arguments); }
  finally { if (typeof _perfLog === 'function') _perfLog('getStoreHealthReport', t0); }
}


// #7 timing wrapper — logs "[SVMI PERF] getKPI2026Report N ms" to Apps Script → Executions.
function getKPI2026Report() {
  const t0 = Date.now();
  try { return _getKPI2026Report_impl.apply(this, arguments); }
  finally { if (typeof _perfLog === 'function') _perfLog('getKPI2026Report', t0); }
}
