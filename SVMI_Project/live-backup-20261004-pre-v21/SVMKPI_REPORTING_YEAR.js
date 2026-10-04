// ============================================================
// SVMKPI_REPORTING_YEAR.gs
// Store Visit Monitoring KPI — Reporting Year Service (Phase 1C)
// ------------------------------------------------------------
// Contains:
//   1. Constants
//   2. Year discovery (MASTER_LOG -> available reporting years)
//   3. Year validation/normalization
//   4. Default reporting year
// ------------------------------------------------------------
// ONE centralized place for "which reporting years exist" and "is this a
// valid reporting year" — every other module (SVMKPI_RISK.gs,
// SVMKPI_STORE_LOOKUP.gs, SVMKPI_KPI_REBUILD.gs, SVMKPI_REPORTS.gs,
// SVMKPI_LAYOUT.gs) calls into THIS file instead of re-deriving/parsing
// years on its own. Never duplicate this logic elsewhere.
//
// Reporting Year vs Event Date vs Configuration Version vs Report
// Snapshot Version — see DEPLOY.md's Phase 1C section for the full
// definitions. In short: a reporting year is a CALENDAR YEAR selected for
// a report/query; for this phase it is always derived directly from an
// event's own Date Visited (no fiscal-year logic, no cadence redesign).
//
// Reuses from SVMKPI_CORE.gs (read-only — never redeclared here):
//   SHEET.MASTER_LOG, COL.DATE, _getSheet(), _parseDateCell()
//
// Does NOT contain:
//   - Any KPI/risk/compliance calculation — those stay in their own
//     files and simply accept a `year` parameter now (see
//     _computeStoreRisk(), sl_getComplianceGaps(), buildKPI2026(),
//     getKPI2026Report(), buildExecutiveSummaryLayout()).
//   - Configuration-version selection (Phase 1D+) or report snapshots
//     (Phase 1E+) — explicitly out of scope for this phase.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Sanity bounds for a "reasonable" calendar year — rejects nonsense like
// 0, 99999, or a negative number without pretending to know the real
// bounds of the business (nothing in this project needs data before 1900
// or after 2999; this is a guardrail against garbage input, not a
// business rule).
const RY_MIN_YEAR = 1900;
const RY_MAX_YEAR = 2999;


// ═══════════════════════════════════════════════════════════════
// SECTION 2: YEAR DISCOVERY
// ═══════════════════════════════════════════════════════════════

/**
 * _ry_extractYearsFromLog(masterLog)
 * Scans every MASTER_LOG row's Date Visited column and returns the
 * distinct calendar years found among the VALID, parseable dates —
 * malformed/blank dates are silently skipped (never invented, never
 * thrown on). Reads the whole sheet via getLastRow()/getRange() every
 * time, with no fixed row-range ceiling (see MASTER_LOG_MAX_ROW's own
 * history in SVMKPI_CORE.gs for why that matters at scale).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} masterLog
 * @returns {number[]} unique years, ascending
 */
function _ry_extractYearsFromLog(masterLog) {
  if (!masterLog) return [];
  const lastRow = masterLog.getLastRow();
  if (lastRow < 2) return [];

  const raw = masterLog.getRange(2, COL.DATE, lastRow - 1, 1).getValues();
  const seen = {};
  for (let i = 0; i < raw.length; i++) {
    const d = _parseDateCell(raw[i][0]);
    if (!d) continue; // malformed/unparseable — skip, never invent
    seen[d.getFullYear()] = true;
  }

  return Object.keys(seen).map(Number).sort((a, b) => a - b);
}

/**
 * getAvailableReportingYears()
 * Client-callable. The single source of truth for "which reporting years
 * exist" — derived ENTIRELY from years actually present in MASTER_LOG's
 * Date Visited column. Never returns a year with no data just because it
 * falls between two years that do have data (e.g. MASTER_LOG with only
 * 2026 and 2029 rows returns exactly [2026, 2029], never inventing 2027
 * or 2028), and never maintains a hardcoded list.
 *
 * Ordering: ascending (oldest first) — e.g. [2026, 2027, 2029]. A caller
 * building a "latest first" UI dropdown should reverse this array itself
 * (`.slice().reverse()`); this function's own contract stays a single,
 * predictable ascending sort. See DEPLOY.md's Phase 1C section.
 *
 * Safe on an empty/missing MASTER_LOG — returns [] rather than throwing
 * or fabricating a year (Phase 1C spec §15).
 * @returns {number[]}
 */
function getAvailableReportingYears() {
  try {
    const masterLog = _getSheet(SHEET.MASTER_LOG);
    return _ry_extractYearsFromLog(masterLog);
  } catch (e) {
    return [];
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: YEAR VALIDATION / NORMALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * normalizeReportingYear(year)
 * Accepts a numeric year (2026) or an equivalent numeric string ("2026")
 * and returns a plain integer. Anything else — null, undefined, "hello",
 * "20XX", a decimal ("2026.5"), an out-of-range value — returns null
 * rather than silently coercing to something unrelated (Phase 1C spec
 * §4: "Do not silently convert unrelated values into a year").
 * @param {*} year
 * @returns {number|null}
 */
function normalizeReportingYear(year) {
  if (year == null) return null;
  if (typeof year !== 'number' && typeof year !== 'string') return null;

  const s = String(year).trim();
  if (!s) return null;
  // Integers only (optionally signed) — rejects decimals ("2026.5"),
  // non-numeric strings ("hello", "20XX"), and whitespace-only input.
  if (!/^-?\d+$/.test(s)) return null;

  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  if (n < RY_MIN_YEAR || n > RY_MAX_YEAR) return null;

  return n;
}

/**
 * validateReportingYear(year)
 * @param {*} year
 * @returns {boolean} true iff normalizeReportingYear(year) would succeed
 */
function validateReportingYear(year) {
  return normalizeReportingYear(year) !== null;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: DEFAULT REPORTING YEAR
// ═══════════════════════════════════════════════════════════════

/**
 * getDefaultReportingYear()
 * The reporting year used whenever a caller omits one explicitly.
 * Policy (documented — see DEPLOY.md's Phase 1C section, spec §13):
 *   1. The LATEST year actually present in MASTER_LOG, if any.
 *   2. Otherwise, today's real calendar year (never a fabricated
 *      MASTER_LOG year — an empty log has no "latest year" to report on
 *      at all, and falling back to "now" is the least surprising choice
 *      the Phase 1C spec's own acceptable-defaults list allows).
 * This is intentionally NOT the old DATA_YEAR constant: DATA_YEAR was a
 * static literal that would keep meaning "2026" forever unless a human
 * remembered to bump it. This function re-derives the answer from live
 * data every time it's called, so it never "secretly" keeps meaning last
 * year's constant once new data exists.
 * @returns {number}
 */
function getDefaultReportingYear() {
  const years = getAvailableReportingYears();
  if (years.length > 0) return years[years.length - 1];
  return new Date().getFullYear();
}
