// ============================================================
// SVMKPI_REPORTS.gs
// Store Visit Monitoring KPI — Read-Only Report Readers
// ------------------------------------------------------------
// getKPI2026Report() and getStoreHealthReport() read the already-computed
// KPI 2026 / STORE HEALTH sheets (built elsewhere — SVMKPI_KPI_REBUILD.gs,
// SVMKPI_RISK.gs — this file only reads their current cell values) into
// plain JSON for the portal's "📊 Reports" tab.
//
// getExecutiveSummaryReport() is different (source-of-truth fix, see
// DECISIONS.md): it reads MASTER_LOG directly via the canonical _getData()
// reader (SVMKPI_CORE.gs) and computes every metric/dimension itself,
// rather than reading the EXECUTIVE SUMMARY sheet's cells. That sheet
// (SVMKPI_LAYOUT.gs's buildExecutiveSummaryLayout()) still exists and can
// still be rebuilt/viewed directly in the Spreadsheet as a presentation
// artifact — it is simply no longer this reader's authoritative source.
// Every value getExecutiveSummaryReport() returns is reproducible from
// Data Records on every call; none of it is cached or read back from a
// generated report/KPI sheet.
//
// getKPI2026Report()/getStoreHealthReport() use getDisplayValues() rather
// than getValues(): the sheets already carry the right number/date/percent
// formatting (e.g. "0.0%", "yyyy-mm-dd"), so reading the display string is
// exact and needs no reformatting here.
//
// Read-only module. Never writes to any sheet. Reuses CELL (Executive
// Summary cell map)/COL/SHEET/APPROVED_*/MONTH_NAMES/_getData()/
// _normalizeVisitors()/_aggregateList()/_aggregateVisitors() from
// SVMKPI_CORE.gs, _es_discoverReportablePurposes() from SVMKPI_LAYOUT.gs,
// KPI_* constants and _kpiSheetName()/_weekRanges() from
// SVMKPI_KPI_REBUILD.gs, RISK_* constants from SVMKPI_RISK.gs /
// SVMKPI_RISK_LAYOUT.gs, and getDefaultReportingYear()/
// getAvailableReportingYears() from SVMKPI_REPORTING_YEAR.gs — never
// redeclares any of them.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// EXECUTIVE SUMMARY
// ═══════════════════════════════════════════════════════════════

/**
 * getExecutiveSummaryReport(year)
 * Source of truth: MASTER_LOG (Data Records), read once via _getData()
 * and filtered to the selected reporting year — never the EXECUTIVE
 * SUMMARY sheet, never a KPI sheet, never another report. `year` is a
 * pure read filter: nothing here ever writes to MASTER_LOG or any other
 * sheet, so switching years cannot mutate stored data. Omit `year` for
 * getDefaultReportingYear() (SVMKPI_REPORTING_YEAR.gs) — same convention
 * as getKPI2026Report().
 *
 * `records` carries the complete relevant per-visit Data Record fields
 * forward (date, store, brand, region, visitor, purpose, plus the
 * derived `additionalPurpose` flag) — a real, filterable/groupable
 * dataset, not a display-only label set. Additional Purpose (both the
 * `kpi` card and each record's `additionalPurpose` flag) is `true`/
 * counted whenever a visit's Purpose is not one of the 4 fixed legacy
 * purposes already broken out as their own KPI cards (APPROVED_PURPOSES,
 * SVMKPI_CORE.gs) — i.e. any purpose configured/used beyond those 4,
 * discovered from the data itself, never a second hardcoded list.
 *
 * Percentage note: an empty year (0 total) reports 0.0% for every share,
 * a simpler and more intuitive convention than the EXECUTIVE SUMMARY
 * sheet's own `IFERROR(0/0, 1)` formula fallback (which showed "100.0%"
 * for a totals row's self-ratio on an empty year) — a disclosed, minor,
 * deliberate difference for a degenerate edge case, not a regression in
 * any populated year.
 * @param {number} [year]
 * @returns {{
 *   selectedYear: number,
 *   availableYears: number[],
 *   kpi: {label:string, value:string}[],
 *   monthBrandLabels: string[],
 *   monthly: {month:string, byBrand:string[], total:string}[],
 *   monthlyTotal: {byBrand:string[], total:string},
 *   region: {name:string, visits:string, pct:string}[],
 *   regionTotal: {visits:string, pct:string},
 *   purpose: {name:string, count:string, pct:string}[],
 *   purposeTotal: {count:string, pct:string},
 *   topStores: {rank:string, name:string, visits:string}[],
 *   leaderboard: {rank:string, name:string, visits:string}[],
 *   brandPerformance: {brand:string, total:string, pct:string, peakMonth:string, peakCount:string}[],
 *   brandTotal: {total:string, pct:string, peakMonth:string, peakCount:string},
 *   records: {timestamp:string, date:string, store:string, brand:string, region:string, visitor:string[], purpose:string, additionalPurpose:boolean}[]
 * }}
 */
function _getExecutiveSummaryReport_impl(year) {
  const reportYear = (year != null && !isNaN(Number(year))) ? Number(year) : getDefaultReportingYear();
  const log  = _getSheet(SHEET.MASTER_LOG);
  const data = _getData(log); // the ONE read this function performs against MASTER_LOG

  // Index every row belonging to the selected reporting year, once —
  // every section below reads through this index rather than re-scanning
  // data.dates itself.
  const idx = [];
  for (let i = 0; i < data.totalRows; i++) {
    const d = data.dates[i];
    if (d instanceof Date && !isNaN(d.getTime()) && d.getFullYear() === reportYear) idx.push(i);
  }

  const countWhere = (pred) => {
    let n = 0;
    for (let k = 0; k < idx.length; k++) if (pred(idx[k])) n++;
    return n;
  };
  const pct  = (n, total) => total ? (n / total * 100).toFixed(1) + '%'  : '0.0%';
  const pct2 = (n, total) => total ? (n / total * 100).toFixed(2) + '%' : '0.00%';
  const isLegacyPurpose = (p) => APPROVED_PURPOSES.indexOf(p) !== -1;

  const totalVisits = idx.length;

  // ── KPI cards ────────────────────────────────────────────────
  const kpi = [
    { label: 'Total Visits',       value: String(totalVisits) },
    { label: 'Store Visits',       value: String(countWhere(i => data.purposes[i] === 'STORE VISIT')) },
    { label: 'TLTC',               value: String(countWhere(i => data.purposes[i] === 'TLTC')) },
    { label: 'Failed QA/MS',       value: String(countWhere(i => data.purposes[i] === 'FAILED QA/MS')) },
    { label: 'Curing/Support',     value: String(countWhere(i => data.purposes[i] === 'CURING/SUPPORT')) },
    { label: 'NCR',                value: String(countWhere(i => data.regions[i] === 'NCR')) },
    { label: 'Provincial',         value: String(countWhere(i => data.regions[i] === 'PROVINCIAL')) },
    { label: 'Additional Purpose', value: String(countWhere(i => !isLegacyPurpose(data.purposes[i]))) },
  ];

  // ── Monthly by Brand ─────────────────────────────────────────
  const monthBrandLabels = APPROVED_BRANDS.slice(); // single source of truth — SVMKPI_CORE.gs
  const monthlyBrandTotals = APPROVED_BRANDS.map(() => 0);
  let grandTotal = 0;
  const monthly = MONTH_NAMES.map((month, m) => {
    const counts = APPROVED_BRANDS.map(brand =>
      countWhere(i => data.dates[i].getMonth() === m && data.brands[i] === brand));
    const tot = counts.reduce((a, b) => a + b, 0);
    counts.forEach((c, bi) => { monthlyBrandTotals[bi] += c; });
    grandTotal += tot;
    return { month, byBrand: counts.map(String), total: String(tot) };
  });
  const monthlyTotal = { byBrand: monthlyBrandTotals.map(String), total: String(grandTotal) };

  // ── Visits by Region ─────────────────────────────────────────
  const region = APPROVED_REGIONS.map(name => {
    const v = countWhere(i => data.regions[i] === name);
    return { name, visits: String(v), pct: pct(v, totalVisits) };
  });
  const regionTotal = { visits: String(totalVisits), pct: pct(totalVisits, totalVisits) };

  // ── Visit Purpose Breakdown — reuses the SAME discovery function
  // SVMKPI_LAYOUT.gs's sheet-writer already uses (legacy ∪ configured ∪
  // actually-in-MASTER_LOG-this-year, SVMKPI_LAYOUT.gs's own
  // _es_discoverReportablePurposes()), so the two never disagree on which
  // purposes are reportable for a year, and no second implementation of
  // that (nontrivial) business rule is created here. Already year-scoped
  // and already reads MASTER_LOG directly, never a report sheet.
  const purposeList = (typeof _es_discoverReportablePurposes === 'function')
    ? _es_discoverReportablePurposes(reportYear, data)
    : []; // defensive fallback — same soft-dependency convention used throughout this project
  const purposeGrandTotal = purposeList.reduce((sum, p) => sum + p.count, 0);
  const purpose = purposeList.map(p => ({ name: p.name, count: String(p.count), pct: pct(p.count, purposeGrandTotal) }));
  const purposeTotal = { count: String(purposeGrandTotal), pct: pct(purposeGrandTotal, purposeGrandTotal) };

  // ── Top 10 Most Visited Stores ───────────────────────────────
  const topStores = _aggregateList(idx.map(i => data.stores[i]))
    .slice(0, 10)
    .map((r, i) => ({ rank: String(i + 1), name: r.name, visits: String(r.total) }));

  // ── Visitor Leaderboard — discovered from this year's actual visit
  // records (never SETTINGS!F, unlike the sheet-formula version), via the
  // same _aggregateVisitors() rule every other visitor count in this app
  // already uses (Bible §3.4/§6.4).
  const leaderboard = _aggregateVisitors(idx.map(i => data.rawVisitors[i]))
    .slice(0, 12)
    .map((r, i) => ({ rank: String(i + 1), name: r.name, visits: String(r.total) }));

  // ── Brand Performance ────────────────────────────────────────
  const brandPerformance = APPROVED_BRANDS.map(brand => {
    const brandIdx = idx.filter(i => data.brands[i] === brand);
    let peakMonth = '', peakCount = 0;
    for (let m = 0; m < 12; m++) {
      const c = brandIdx.reduce((n, i) => n + (data.dates[i].getMonth() === m ? 1 : 0), 0);
      if (c > peakCount) { peakCount = c; peakMonth = MONTH_NAMES[m]; }
    }
    return {
      brand, total: String(brandIdx.length), pct: pct2(brandIdx.length, totalVisits),
      peakMonth, peakCount: String(peakCount),
    };
  });
  const brandGrandTotal = brandPerformance.reduce((sum, b) => sum + Number(b.total), 0);
  const brandTotal = { total: String(brandGrandTotal), pct: pct2(brandGrandTotal, totalVisits), peakMonth: '', peakCount: '' };

  // ── Records — the complete relevant Data Record set for this year.
  // Required dimensions (Additional Purpose/Visitor/Brand/Store) are real
  // fields here, not UI-only labels: available for display, filtering,
  // grouping, and future report expansion, and reproducible from
  // MASTER_LOG on every call.
  const tz = Session.getScriptTimeZone();
  const records = idx.map(i => ({
    timestamp:         data.timestamps[i] != null ? String(data.timestamps[i]) : '',
    date:              Utilities.formatDate(data.dates[i], tz, 'yyyy-MM-dd'),
    store:             data.stores[i],
    brand:             data.brands[i],
    region:            data.regions[i],
    visitor:           _normalizeVisitors(data.rawVisitors[i]),
    purpose:           data.purposes[i],
    additionalPurpose: !isLegacyPurpose(data.purposes[i]),
  }));

  return {
    selectedYear: reportYear,
    // Same rule as getAvailableReportingYears() (every parseable year in
    // MASTER_LOG), computed from the rows already read — no second read.
    availableYears: Object.keys(data.dates.reduce((seen, d) => { if (d) seen[d.getFullYear()] = true; return seen; }, {}))
      .map(Number).sort((a, b) => a - b),
    kpi, monthBrandLabels, monthly, monthlyTotal, region, regionTotal,
    purpose, purposeTotal, topStores, leaderboard, brandPerformance, brandTotal,
    records,
  };
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
  // this previously did — see SVMI_Project/reviews/REVIEW-003.md on main:
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
  // D.4 (v26): with reports on the visit tables, Store Health is computed live
  // by Store ID — the same visits Store Insights / Visited / Unvisited show —
  // instead of the sheet snapshot from the last rebuild (by name, MASTER_LOG).
  if (typeof svd_useTables_ === 'function' && svd_useTables_()) {
    const live = svd_storeHealthReport_();
    if (live) return live;
  }
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


// #7 timing wrapper — logs "[SVMI PERF] getExecutiveSummaryReport N ms" to Apps Script → Executions.
function getExecutiveSummaryReport() {
  const t0 = Date.now();
  try { return _getExecutiveSummaryReport_impl.apply(this, arguments); }
  finally { if (typeof _perfLog === 'function') _perfLog('getExecutiveSummaryReport', t0); }
}
