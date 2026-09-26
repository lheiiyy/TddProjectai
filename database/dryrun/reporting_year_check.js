// database/dryrun/reporting_year_check.js
//
// Reporting-year validation (Phase 2 rule #10). Mirrors
// _ry_extractYearsFromLog()/getAvailableReportingYears() EXACTLY: parse
// with the application's own date rules, collect valid years, unique,
// sort ascending, never invent a missing year, skip malformed dates.
// Then compares against whatever PostgreSQL's `reporting_periods` view
// reports after loading, and reports any difference exactly (never
// silently reconciled).

const { parseDateCell } = require('./date_parse');

/**
 * Reproduces _ry_extractYearsFromLog(masterLog) against raw rows.
 */
function extractYearsFromMasterLog(rows) {
  const seen = new Set();
  for (const row of rows) {
    const d = parseDateCell(row.dateVisited);
    if (!d) continue; // malformed/unparseable — skip, never invent
    seen.add(d.getFullYear());
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Compares the spreadsheet-discovered years (source of truth) against
 * PostgreSQL's reporting_periods view result (an array of integers).
 */
function compareReportingYears(sourceYears, postgresYears) {
  const sourceSet = new Set(sourceYears);
  const pgSet = new Set(postgresYears);
  const onlyInSource = sourceYears.filter((y) => !pgSet.has(y));
  const onlyInPostgres = postgresYears.filter((y) => !sourceSet.has(y));
  return {
    sourceYears,
    postgresYears,
    match: onlyInSource.length === 0 && onlyInPostgres.length === 0,
    onlyInSource,
    onlyInPostgres,
  };
}

module.exports = { extractYearsFromMasterLog, compareReportingYears };
