// database/dryrun/masterlog_integrity.js
//
// The MASTER_LOG integrity report required by Phase 2 rule #9. Pure
// analysis — never mutates, never deletes duplicate-looking rows, never
// reinterprets old rows using today's submission-time duplicate logic
// (that logic runs at WRITE time in the live app; historical rows are
// preserved exactly as stored — see rule #9's own closing paragraph).
//
// Input: an array of raw MASTER_LOG row objects, each shaped like a
// direct column read (no interpretation yet):
//   { rowRef, timestamp, dateVisited, store, brand, region, visitedBy,
//     purpose, remarks, storeId }
// `rowRef` is a traceable pointer back to the source (e.g. "MASTER_LOG!A42").

const { parseDateCell, toIsoDateString } = require('./date_parse');

function isBlankRow(row) {
  return ['timestamp', 'dateVisited', 'store', 'brand', 'region', 'visitedBy', 'purpose', 'remarks', 'storeId']
    .every((k) => row[k] == null || String(row[k]).trim() === '');
}

function splitVisitedBy(str) {
  return String(str || '').split('|').map((v) => v.trim()).filter(Boolean);
}

function analyzeMasterLog(rows, { knownStoreIds = new Set(), knownVisitorIds = new Set(), knownPurposeIds = new Set() } = {}) {
  const report = {
    totalSourceRows: rows.length,
    blankRows: 0,
    validEventRows: 0,
    malformedDates: [],
    earliestEventDate: null,
    latestEventDate: null,
    reportingYears: [],
    rowsPerReportingYear: {},
    rowsWithBlankStoreId: 0,
    rowsWithUnknownStoreId: 0,
    rowsWithHistoricalStoreNameOnly: 0, // blank/unknown Store ID but a non-blank Store name
    visitorIdentityProblems: [],
    purposeDistribution: {},
    unknownPurposes: {},
    duplicateCandidates: [], // same store+visitor+date, historical value only, never auto-resolved
    exactDuplicateCandidates: [], // every column identical
    multiVisitorSubmissionCount: 0,
    singleVisitorSubmissionCount: 0,
    possibleAnomalies: [],
  };

  const yearSet = new Set();
  const dateKeyMap = new Map(); // "storeId|visitorId|isoDate" -> [rowRef,...]
  const exactRowMap = new Map(); // JSON of full row -> [rowRef,...]

  for (const row of rows) {
    if (isBlankRow(row)) {
      report.blankRows += 1;
      continue;
    }

    const parsedDate = parseDateCell(row.dateVisited);
    if (!parsedDate) {
      report.malformedDates.push({ rowRef: row.rowRef, originalValue: row.dateVisited });
      continue; // cannot classify further without a valid date — skip, never invent one
    }

    report.validEventRows += 1;
    const iso = toIsoDateString(parsedDate);
    if (!report.earliestEventDate || iso < report.earliestEventDate) report.earliestEventDate = iso;
    if (!report.latestEventDate || iso > report.latestEventDate) report.latestEventDate = iso;
    const year = parsedDate.getFullYear();
    yearSet.add(year);
    report.rowsPerReportingYear[year] = (report.rowsPerReportingYear[year] || 0) + 1;

    const storeId = String(row.storeId || '').trim();
    const storeName = String(row.store || '').trim();
    if (!storeId) {
      report.rowsWithBlankStoreId += 1;
      if (storeName) report.rowsWithHistoricalStoreNameOnly += 1;
    } else if (!knownStoreIds.has(storeId)) {
      report.rowsWithUnknownStoreId += 1;
    }

    const visitors = splitVisitedBy(row.visitedBy);
    if (visitors.length === 0) {
      report.visitorIdentityProblems.push({ rowRef: row.rowRef, problem: 'NO_VISITOR_LISTED', originalValue: row.visitedBy });
    } else {
      for (const v of visitors) {
        if (knownVisitorIds.size && !knownVisitorIds.has(v)) {
          report.visitorIdentityProblems.push({ rowRef: row.rowRef, problem: 'UNKNOWN_VISITOR', originalValue: v });
        }
      }
      if (visitors.length > 1) report.multiVisitorSubmissionCount += 1;
      else report.singleVisitorSubmissionCount += 1;
    }

    const purpose = String(row.purpose || '').trim();
    report.purposeDistribution[purpose] = (report.purposeDistribution[purpose] || 0) + 1;
    if (purpose && knownPurposeIds.size && !knownPurposeIds.has(purpose)) {
      report.unknownPurposes[purpose] = (report.unknownPurposes[purpose] || 0) + 1;
    }

    // Duplicate CANDIDATES only — same store + same visitor + same
    // calendar date, using the row's OWN historical Store ID (or, absent
    // one, the historical Store Name) as the identity key. Reported, not
    // resolved: today's submission-time partial-accept logic must not be
    // retroactively applied to historical rows (rule #9).
    const storeKey = storeId || `NAME:${storeName}`;
    for (const v of visitors) {
      const key = `${storeKey}|${v}|${iso}`;
      if (!dateKeyMap.has(key)) dateKeyMap.set(key, []);
      dateKeyMap.get(key).push(row.rowRef);
    }

    const exactKey = JSON.stringify([row.dateVisited, storeName, row.brand, row.region, row.visitedBy, purpose, row.remarks, storeId]);
    if (!exactRowMap.has(exactKey)) exactRowMap.set(exactKey, []);
    exactRowMap.get(exactKey).push(row.rowRef);
  }

  for (const [key, refs] of dateKeyMap) {
    if (refs.length > 1) {
      const [storeKey, visitor, isoDate] = key.split('|');
      report.duplicateCandidates.push({ storeKey, visitor, date: isoDate, rowRefs: refs });
    }
  }
  for (const [, refs] of exactRowMap) {
    if (refs.length > 1) report.exactDuplicateCandidates.push({ rowRefs: refs });
  }

  report.reportingYears = Array.from(yearSet).sort((a, b) => a - b);

  if (report.malformedDates.length > 0) {
    report.possibleAnomalies.push(`${report.malformedDates.length} row(s) have an unparseable Date Visited value — excluded from year/date analysis, never defaulted.`);
  }
  if (report.rowsWithBlankStoreId > 0) {
    report.possibleAnomalies.push(`${report.rowsWithBlankStoreId} row(s) have a blank Store ID (pre-Phase-1B-migration legacy rows expected) — see reconcile_stores.js for quarantine handling.`);
  }

  return report;
}

module.exports = { analyzeMasterLog, splitVisitedBy, isBlankRow };
