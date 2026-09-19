// ============================================================
// SVMKPI_REPORTS.gs
// Store Visit Monitoring KPI — Read-Only Report Readers
// ------------------------------------------------------------
// Reads the already-computed EXECUTIVE SUMMARY, KPI 2026, and STORE
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
 * getExecutiveSummaryReport()
 * @returns {{
 *   kpi: {label:string, value:string}[],
 *   monthly: {month:string, byBrand:string[], total:string}[],
 *   monthlyTotal: {byBrand:string[], total:string},
 *   region: {name:string, visits:string, pct:string}[],
 *   regionTotal: {visits:string, pct:string},
 *   purpose: {name:string, count:string, pct:string}[],
 *   purposeTotal: {count:string, pct:string},
 *   topStores: {rank:string, name:string, visits:string}[],
 *   leaderboard: {rank:string, name:string, visits:string}[],
 *   brandPerformance: {brand:string, total:string, pct:string, peakMonth:string, peakCount:string}[],
 *   brandTotal: {total:string, pct:string, peakMonth:string, peakCount:string}
 * }}
 */
function getExecutiveSummaryReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET.SUMMARY);
  if (!sheet) throw new Error('EXECUTIVE SUMMARY sheet not found. Run "Rebuild Executive Summary" first.');

  const kpiLabels = ['Total Visits', 'Store Visits', 'TLTC', 'Failed QA/MS', 'Curing/Support', 'NCR', 'Provincial'];
  const kpiVals = sheet.getRange(7, 3, 1, 7).getDisplayValues()[0];
  const kpi = kpiLabels.map((label, i) => ({ label, value: kpiVals[i] }));

  // Read the actual column headers off row 10 rather than assuming
  // APPROVED_BRANDS' current order — exact match to what the sheet shows,
  // and still correct if the brand list ever changes without a rebuild.
  const monthBrandLabels = sheet.getRange(10, 4, 1, 5).getDisplayValues()[0];

  const monthlyRows = sheet.getRange(CELL.MONTHLY_DATA_ROW, 3, 12, 7).getDisplayValues();
  const monthly = monthlyRows.map(row => ({
    month: row[0],
    byBrand: row.slice(1, 6),
    total: row[6],
  }));
  const mt = sheet.getRange(CELL.MONTHLY_GT_ROW, 3, 1, 7).getDisplayValues()[0];
  const monthlyTotal = { byBrand: mt.slice(1, 6), total: mt[6] };

  const regionRows = sheet.getRange(CELL.REGION_START_ROW, 3, 3, 3).getDisplayValues();
  const region = regionRows.map(row => ({ name: row[0], visits: row[1], pct: row[2] }));
  const rt = sheet.getRange(CELL.REGION_TOTAL_ROW, 4, 1, 2).getDisplayValues()[0];
  const regionTotal = { visits: rt[0], pct: rt[1] };

  // Purpose Breakdown (must show EVERY recognized/configured purpose —
  // no fixed row count, per this phase's business decision). Scanned
  // dynamically downward from CELL.PURPOSE_START_ROW until the literal
  // "TOTAL" marker _totalRow() (SVMKPI_LAYOUT.gs) always writes at the
  // end of that block — never assumes a fixed 4-row window. Every
  // section below Purpose Breakdown (Top Stores/Leaderboard/Brand
  // Performance) shifts by the exact same `offset` the writer used,
  // derived here purely by OBSERVING where the sheet's own TOTAL row
  // actually landed — no dependency on SVMKPI_LAYOUT.gs's internal
  // discovery function, and no hardcoded purpose-name list or count.
  const purpose = [];
  let purposeTotalRowFound = CELL.PURPOSE_TOTAL_ROW;
  for (let r = CELL.PURPOSE_START_ROW; r <= CELL.PURPOSE_START_ROW + 500; r++) {
    const rowVals = sheet.getRange(r, 7, 1, 3).getDisplayValues()[0];
    if (String(rowVals[0]).trim().toUpperCase() === 'TOTAL') { purposeTotalRowFound = r; break; }
    purpose.push({ name: rowVals[0], count: rowVals[1], pct: rowVals[2] });
  }
  const offset = purposeTotalRowFound - CELL.PURPOSE_TOTAL_ROW;
  const pt = sheet.getRange(purposeTotalRowFound, 8, 1, 2).getDisplayValues()[0];
  const purposeTotal = { count: pt[0], pct: pt[1] };

  const topStoreRows = sheet.getRange(CELL.STORES_START_ROW + offset, 3, CELL.STORES_LIMIT, 3).getDisplayValues();
  const topStores = topStoreRows
    .filter(row => String(row[1] || '').trim())
    .map(row => ({ rank: row[0], name: row[1], visits: row[2] }));

  const leaderRows = sheet.getRange(CELL.LEADER_START_ROW + offset, 7, CELL.LEADER_LIMIT, 3).getDisplayValues();
  const leaderboard = leaderRows
    .filter(row => String(row[1] || '').trim())
    .map(row => ({ rank: row[0], name: row[1], visits: row[2] }));

  const brandRows = sheet.getRange(CELL.BRAND_START_ROW + offset, 3, APPROVED_BRANDS.length, 5).getDisplayValues();
  const brandPerformance = brandRows.map(row => ({
    brand: row[0], total: row[1], pct: row[2], peakMonth: row[3], peakCount: row[4],
  }));
  const bt = sheet.getRange(CELL.BRAND_TOTAL_ROW + offset, 4, 1, 4).getDisplayValues()[0];
  const brandTotal = { total: bt[0], pct: bt[1], peakMonth: bt[2], peakCount: bt[3] };

  return { kpi, monthBrandLabels, monthly, monthlyTotal, region, regionTotal, purpose, purposeTotal, topStores, leaderboard, brandPerformance, brandTotal };
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
function getKPI2026Report(year) {
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

  // One getDisplayValues() call per row (instead of one per cell — a cell
  // read per week/month/quarter column would be 60+ calls per row) —
  // read the whole data span once (name column included), then slice out
  // what's needed by index. Walking rows off the sheet itself (rather than
  // re-deriving the visitor list from SETTINGS!F, as this used to) means a
  // roster change can never desync this reader from what buildKPI2026()
  // actually wrote — including the historical-only rows it now appends for
  // anyone removed from the roster who still has real visit history.
  const rowStartCol = KPI_NAME_COL;
  const rowWidth     = KPI_YTD_COL - KPI_NAME_COL + 1;

  const readRow = (row) => {
    const vals = sheet.getRange(row, rowStartCol, 1, rowWidth).getDisplayValues()[0];
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
  for (let row = DATA_ROW_START; row <= lastRow; row++) {
    const r = readRow(row);
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
function getStoreHealthReport() {
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
