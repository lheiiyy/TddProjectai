// database/dryrun/date_parse.js
//
// A faithful JS port of the application's OWN `_parseDateCell()`
// (SVMKPI_CORE.gs) — the phase's rule #10/#5 requires using "the
// application's date parsing rules," never a reimagined/looser one.
// Same behavior: malformed input returns null (skip, never invent);
// never throws.
//
// The script's timeZone is `Asia/Manila` (appsscript.json) — fixed
// UTC+08:00, no DST — so formatting a JS Date to 'yyyy-MM-dd' in that
// zone is a safe, exact fixed-offset conversion (matches
// Utilities.formatDate(date, 'Asia/Manila', 'yyyy-MM-dd') for any real
// calendar date).

const SCRIPT_TZ_OFFSET_MINUTES = 8 * 60; // Asia/Manila, UTC+08:00, no DST

function formatDateManila(date) {
  const shifted = new Date(date.getTime() + SCRIPT_TZ_OFFSET_MINUTES * 60000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * parseDateCell(value) — mirrors _parseDateCell(value) exactly.
 * @param {Date|string|number|null|undefined} value
 * @returns {Date|null} a local-time Date at midnight for the parsed
 *   calendar date, or null if unparseable/malformed.
 */
function parseDateCell(value) {
  let s;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    s = formatDateManila(value);
  } else {
    s = String(value == null ? '' : value).trim().substring(0, 10);
  }
  const parts = s.split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!y || !m || !d) return null;
  const result = new Date(y, m - 1, d);
  return isNaN(result.getTime()) ? null : result;
}

function toIsoDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = { parseDateCell, toIsoDateString, formatDateManila };
