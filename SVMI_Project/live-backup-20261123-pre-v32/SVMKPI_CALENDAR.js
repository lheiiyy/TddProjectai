// ============================================================
// SVMKPI_CALENDAR.gs
// Store Visit Monitoring KPI — Calendar Period Resolution (Phase 1D)
// ------------------------------------------------------------
// Contains:
//   1. Period family constants
//   2. resolveCalendarPeriod() — the one centralized boundary resolver
// ------------------------------------------------------------
// SVMI uses CALENDAR periods (month/quarter/semi-annual), not a rolling
// N-day window, as the compliance cadence model (Phase 1D business
// decision). This file is the single place calendar-period boundaries
// are computed — every other module (SVMKPI_COMPLIANCE_CONFIG.gs,
// SVMKPI_STORE_LOOKUP.gs's sl_getComplianceGaps()) calls into it rather
// than re-deriving month/quarter/half-year math independently.
//
// Only the THREE period families the existing app's compliance cadence
// already uses (MONTH/QUARTER/SEMI_ANNUAL — matching CONFIG_COMPLIANCE's
// pre-existing cadenceType enum MONTHLY/QUARTERLY/SEMI_ANNUAL) are
// implemented. No YEAR or custom period family is added merely for
// theoretical flexibility — nothing in SVMI's documented business
// behavior needs one yet.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: PERIOD FAMILY CONSTANTS
// ═══════════════════════════════════════════════════════════════

const CAL_PERIOD_FAMILY = {
  MONTH:       'MONTH',
  QUARTER:     'QUARTER',
  SEMI_ANNUAL: 'SEMI_ANNUAL',
};

const CAL_PERIOD_FAMILIES = Object.values(CAL_PERIOD_FAMILY);

/**
 * _cal_familyFromCadenceType(cadenceType)
 * CONFIG_COMPLIANCE's pre-existing `cadenceType` field (MONTHLY|QUARTERLY|
 * SEMI_ANNUAL — the same enum SVMKPI_CONFIG.gs already validates) maps
 * directly, 1:1, to a calendar-period family. This is the "explicit
 * period-definition model" the Phase 1D spec asks CONFIG_COMPLIANCE to
 * populate instead of leaving `periodDefinition` an unused placeholder —
 * see SVMKPI_COMPLIANCE_CONFIG.gs, which writes this derived value into
 * that column at create/update time so it's a real, populated field, not
 * independently hand-edited (avoiding configuration drift between the
 * two columns).
 * @param {string} cadenceType
 * @returns {string|null} a CAL_PERIOD_FAMILY value, or null if unrecognized
 */
function _cal_familyFromCadenceType(cadenceType) {
  const t = String(cadenceType || '').trim().toUpperCase();
  if (t === 'MONTHLY') return CAL_PERIOD_FAMILY.MONTH;
  if (t === 'QUARTERLY') return CAL_PERIOD_FAMILY.QUARTER;
  if (t === 'SEMI_ANNUAL') return CAL_PERIOD_FAMILY.SEMI_ANNUAL;
  return null;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: THE CENTRALIZED RESOLVER
// ═══════════════════════════════════════════════════════════════

/**
 * resolveCalendarPeriod(date, periodFamily)
 * Deterministic, configuration-driven calendar-period boundary resolver.
 * Never duplicate this math elsewhere.
 * @param {Date} date - any date; the calendar period CONTAINING this date
 *   is resolved (does not need to be a period boundary itself)
 * @param {string} periodFamily - one of CAL_PERIOD_FAMILY's values
 * @returns {{periodId:string, periodStart:Date, periodEnd:Date, year:number}|null}
 *   periodStart/periodEnd are local-midnight-anchored Dates (periodEnd is
 *   the LAST calendar day of the period, at local midnight — callers
 *   needing an inclusive end-of-day comparison should compare by date,
 *   the same convention _parseDateCell() already establishes project-wide).
 *   Returns null for an invalid date or an unrecognized periodFamily —
 *   never silently guesses a family or invents a boundary.
 */
function resolveCalendarPeriod(date, periodFamily) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  const family = String(periodFamily || '').trim().toUpperCase();
  if (CAL_PERIOD_FAMILIES.indexOf(family) === -1) return null;

  const y = date.getFullYear();
  const m = date.getMonth(); // 0-based

  if (family === CAL_PERIOD_FAMILY.MONTH) {
    return {
      periodId: y + '-' + String(m + 1).padStart(2, '0'),
      periodStart: new Date(y, m, 1),
      periodEnd: new Date(y, m + 1, 0),
      year: y,
    };
  }

  if (family === CAL_PERIOD_FAMILY.QUARTER) {
    const q = Math.floor(m / 3); // 0-3
    return {
      periodId: y + '-Q' + (q + 1),
      periodStart: new Date(y, q * 3, 1),
      periodEnd: new Date(y, q * 3 + 3, 0),
      year: y,
    };
  }

  // SEMI_ANNUAL
  const half = m < 6 ? 0 : 1; // 0 = Jan-Jun, 1 = Jul-Dec
  return {
    periodId: y + '-H' + (half + 1),
    periodStart: new Date(y, half * 6, 1),
    periodEnd: new Date(y, half * 6 + 6, 0),
    year: y,
  };
}
