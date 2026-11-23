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


// ═══════════════════════════════════════════════════════════════
// SECTION 3: BUSINESS CALENDAR — P#W# (v32, Leo 2026-11-23)
// ═══════════════════════════════════════════════════════════════
// W1 = Jan 1 up to the first Sunday; every later week is Monday–Sunday.
// A week never crosses into the next year (the last one stops on Dec 31),
// so most years end with a short W53.
// P = every 4 weeks: P1 = W1–W4 … P13 = W49–W52, and W53 joins P13 (P13W5).
// The label's W restarts each period: P1W1 … P1W4, P2W1 … P2W4, …

const CAL_BW_PERIODS = 13;

function _cal_day_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/** Monday of W2 for a year (the day after the first Sunday). */
function _cal_w2Start_(year) {
  const jan1 = new Date(year, 0, 1);
  const toSunday = (7 - jan1.getDay()) % 7;          // Sunday → 0
  return new Date(year, 0, 1 + toSunday + 1);
}

/** Number of business weeks in a year (52 or 53). */
function cal_businessWeekCount_(year) {
  const w2 = _cal_w2Start_(year);
  const dec31 = new Date(year, 11, 31);
  return 2 + Math.floor((dec31 - w2) / (7 * 86400000) + 1e-9);
}

/** Period (1–13) and week-in-period for a year-week number. */
function _cal_periodOf_(yearWeek) {
  const period = Math.min(CAL_BW_PERIODS, Math.ceil(yearWeek / 4));
  return { period, weekInPeriod: yearWeek - (period - 1) * 4 };
}

/** First and last day of a year-week. */
function cal_businessWeekRange_(year, yearWeek) {
  const n = cal_businessWeekCount_(year);
  const wk = Math.max(1, Math.min(n, Math.floor(Number(yearWeek) || 1)));
  if (wk === 1) {
    const w2 = _cal_w2Start_(year);
    return { start: new Date(year, 0, 1), end: new Date(w2.getFullYear(), w2.getMonth(), w2.getDate() - 1), yearWeek: 1 };
  }
  const w2 = _cal_w2Start_(year);
  const start = new Date(w2.getFullYear(), w2.getMonth(), w2.getDate() + (wk - 2) * 7);
  let end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const dec31 = new Date(year, 11, 31);
  if (end > dec31) end = dec31;
  return { start, end, yearWeek: wk };
}

function _cal_bwInfo_(year, yearWeek) {
  const r = cal_businessWeekRange_(year, yearWeek);
  const p = _cal_periodOf_(r.yearWeek);
  return {
    year: year,
    yearWeek: r.yearWeek,
    weeksInYear: cal_businessWeekCount_(year),
    period: p.period,
    weekInPeriod: p.weekInPeriod,
    label: 'P' + p.period + 'W' + p.weekInPeriod,
    start: r.start,
    end: r.end,
  };
}

/**
 * cal_businessWeek_(date) → { year, yearWeek, weeksInYear, period, weekInPeriod,
 *   label ('P12W4'), start, end } or null for a missing/invalid date.
 */
function cal_businessWeek_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    if (date && typeof date === 'object' && typeof date.getTime === 'function' && !isNaN(date.getTime())) {
      date = new Date(date.getTime());                // a Date from another realm (tests)
    } else return null;
  }
  const d = _cal_day_(date);
  const year = d.getFullYear();
  const w2 = _cal_w2Start_(year);
  const yearWeek = d < w2 ? 1 : 2 + Math.floor((d - w2) / (7 * 86400000) + 1e-9);
  return _cal_bwInfo_(year, yearWeek);
}

/** The year-weeks that make up a period (P13 includes W53 when the year has one). */
function cal_periodWeeks_(year, period) {
  const p = Math.max(1, Math.min(CAL_BW_PERIODS, Math.floor(Number(period) || 1)));
  const last = p === CAL_BW_PERIODS ? cal_businessWeekCount_(year) : p * 4;
  const out = [];
  for (let w = (p - 1) * 4 + 1; w <= last; w++) out.push(w);
  return out;
}

/**
 * cal_businessRange_(year, period, weekInPeriod) — date range for a period
 * (weekInPeriod empty/0 = the whole period) or one week of it. null if invalid.
 */
function cal_businessRange_(year, period, weekInPeriod) {
  year = Number(year); period = Number(period);
  if (!year || !period || period < 1 || period > CAL_BW_PERIODS) return null;
  const weeks = cal_periodWeeks_(year, period);
  const wip = Number(weekInPeriod) || 0;
  if (wip) {
    if (wip < 1 || wip > weeks.length) return null;
    const info = _cal_bwInfo_(year, weeks[wip - 1]);
    return { start: info.start, end: info.end, label: info.label };
  }
  const a = cal_businessWeekRange_(year, weeks[0]);
  const b = cal_businessWeekRange_(year, weeks[weeks.length - 1]);
  return { start: a.start, end: b.end, label: 'P' + period };
}

/** 'P12W4' for a date, '' when the date is missing. */
function cal_businessWeekLabel_(date) {
  const bw = cal_businessWeek_(date);
  return bw ? bw.label : '';
}
