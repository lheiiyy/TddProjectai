// ============================================================
// SVMKPI_REPORT_SNAPSHOT.gs
// Store Visit Monitoring KPI — Historical Report Snapshots +
// Per-Year Report Sheets (Phase 1E)
// ------------------------------------------------------------
// Contains:
//   1. Constants + sheet schema (REPORT_SNAPSHOTS)
//   2. Sheet access / row (de)serialization helpers
//   3. Calculation capture (draft calculation — reuses the existing
//      canonical engines untouched)
//   4. Configuration provenance capture
//   5. Finalization (finalizeReport)
//   6. Correction / supersession (supersedeReportSnapshot)
//   7. Retrieval APIs (getReportSnapshot / ...ByVersion / latest / list)
//   8. Draft report API (getDraftReport)
//   9. Per-year report sheet (regenerateReportSheet)
// ------------------------------------------------------------
// CORE RULE THIS FILE EXISTS TO ENFORCE:
// A finalized historical report must never silently change because
// configuration or source data changes later. A DRAFT (getDraftReport())
// is always a fresh, dynamic calculation. A FINALIZED snapshot is a
// persisted, immutable result — retrieving it NEVER recalculates it.
//
// WHAT "THE EXISTING REPORT ENGINE" MEANS HERE (inspected before writing
// any of this file):
//   - Store-level + risk results: _computeStoreRisk(data, evaluationDate,
//     year) (SVMKPI_RISK.gs) is a PURE function (no sheet writes) that
//     already takes an explicit evaluation date — called DIRECTLY here,
//     never through populateRiskEngine()/refreshRiskEngine() (which
//     hardcode `new Date()` and write to the live STORE HEALTH sheet).
//     Calling it directly means finalizing a report has zero side effects
//     on the live STORE HEALTH sheet, and can use a genuinely historical
//     evaluation date that "now" never could.
//   - Compliance results: sl_getComplianceGaps(null, null, year,
//     evaluationDateStr) (SVMKPI_STORE_LOOKUP.gs) is already a pure,
//     read-only, evaluation-date-aware reader (Phase 1D) — called as-is.
//   - Executive Summary / KPI 2026: these have NO pure-calculation
//     equivalent — SVMKPI_LAYOUT.gs/SVMKPI_KPI_REBUILD.gs write native
//     Sheets formulas into the ONE shared EXECUTIVE SUMMARY / "KPI <year>"
//     sheet, and SVMKPI_REPORTS.gs's getExecutiveSummaryReport()/
//     getKPI2026Report() read whatever those formulas currently show. A
//     finalized snapshot must be COMPLETE and self-contained (it must
//     never depend on whether a presentation sheet happened to already
//     exist), so _snap_captureCalculatedResult() ALWAYS calls
//     buildExecutiveSummaryLayout(year) before reading it — "EXECUTIVE
//     SUMMARY" is the ONE shared sheet across every year, and
//     getExecutiveSummaryReport() has no way to verify which year it
//     currently represents, so "build only if missing" could silently
//     freeze a DIFFERENT year's numbers into the snapshot. "KPI <year>"
//     IS already year-scoped by its own sheet name (Phase 1C), so it is
//     only built when that exact sheet doesn't exist yet (checked via a
//     direct sheet lookup, never inferred from a caught exception). This
//     is a real, deliberate, documented side effect: finalizing or
//     superseding a report mutates the live, shared "EXECUTIVE SUMMARY"
//     tab every time, and may create a "KPI <year>" tab the first time —
//     see DEPLOY.md's Phase 1E section. It is NOT transactionally atomic
//     with the REPORT_SNAPSHOTS write that follows it: if either builder
//     or reader throws, _snap_captureCalculatedResult() throws too, and
//     finalizeReport()/supersedeReportSnapshot()'s existing "calculation
//     failed" handling ensures NO snapshot and NO audit-success entry are
//     ever created from a partial capture — but a builder call that
//     partially wrote to the shared sheet before throwing is not rolled
//     back (no new rollback mechanism for presentation-sheet mutations
//     is introduced here). Neither builder gains evaluationDate-clipping
//     — both remain full-calendar-year calculations for `year`, exactly
//     as they already are; this is an inherited limitation of Executive
//     Summary/KPI, not something this file changes or claims to fix.
//
// STORAGE MODEL: one dedicated REPORT_SNAPSHOTS sheet, independent of any
// per-year presentation sheet — never treats REPORT_<year> as the
// database. Every column is a stable, explicit, typed field EXCEPT the
// frozen calculated result itself (Result JSON) and the narrow, per-
// category compliance-provenance list (Compliance Config Versions JSON):
// a deeply nested, arbitrarily-shaped CALCULATED REPORT OUTPUT is exactly
// the kind of value a future PostgreSQL migration would store in a jsonb
// column — this is not the "opaque JSON configuration blob" Phase 1D
// explicitly rejected for CONFIG_* (which are typed, editable business
// rules); it is a computed, read-only artifact, the same category of
// value CONFIG_AUDIT's own Previous/New Value columns already store as
// compact serialized text (this project's own established precedent for
// exactly this situation).
//
// WHY THIS DOES NOT REUSE cfg_createConfiguration() (SVMKPI_CONFIG.gs):
// that function models CONFIGURATION effective-dating (when a business
// rule starts applying) and an ACTIVE/INACTIVE envelope status — neither
// fits a report snapshot, whose "evaluation date" is a different concept
// from "effective from", whose status model is DRAFT/FINALIZED/
// SUPERSEDED, and whose core invariant (at most one FINALIZED snapshot
// per reporting year at any time) cfg_createConfiguration() has no
// mechanism to enforce. Reusing it would mean overloading its parameters
// to mean something else, which is worse than a small, dedicated,
// purpose-built persistence routine that borrows its NAMING CONVENTION
// (AREA-ENTITY-vN), its AUDIT sheet/writer, and its admin gate exactly.
//
// Reuses (read-only — never redeclared here):
//   SVMKPI_CORE.gs:            SHEET, _getSheet(), _getData(), _parseDateCell()
//   SVMKPI_ACCESS.gs:          sl_isAdmin(), sl_getCurrentUser()
//   SVMKPI_REPORTING_YEAR.gs:  normalizeReportingYear(), validateReportingYear()
//   SVMKPI_CONFIG.gs:          CFG_AREA.REPORT, CFG_ACTION.FINALIZE/SUPERSEDE,
//                              _cfg_writeAudit(), cfg_getAuditLog()
//   SVMKPI_RISK.gs:            _computeStoreRisk(), RISK_HEADERS, RISK_COL
//   SVMKPI_STORE_LOOKUP.gs:    sl_getComplianceGaps()
//   SVMKPI_RISK_CONFIG.gs:     resolveRiskConfigurationAsOf() (optional/soft)
//   SVMKPI_COMPLIANCE_CONFIG.gs: _cmp_resolveByCategory() (optional/soft)
//   SVMKPI_LAYOUT.gs:          buildExecutiveSummaryLayout() (hard — a completeness requirement)
//   SVMKPI_KPI_REBUILD.gs:     buildKPI2026(), _kpiSheetName() (hard — a completeness requirement)
//   SVMKPI_REPORTS.gs:         getExecutiveSummaryReport(), getKPI2026Report() (hard — a completeness requirement)
//
// Does NOT contain:
//   - Any new risk/compliance/KPI business rule or scoring formula.
//   - A generic updateSnapshot()/mutateSnapshot() — the only supported
//     state transition after finalization is supersession (item 18).
//   - A System Tools / snapshot-management UI (Phase 1F).
//   - clasp push / any live-spreadsheet mutation (all NO LIVE DATA rules
//     from every prior phase still apply; this file's own tests use
//     mocks/fixtures exactly like every other *.test.js in this project).
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS + SHEET SCHEMA
// ═══════════════════════════════════════════════════════════════

const REPORT_SNAPSHOT_SHEET = 'REPORT_SNAPSHOTS';

const REPORT_SNAPSHOT_STATUS = {
  // FINALIZED/SUPERSEDED are the only statuses any function in this file
  // ever WRITES. DRAFT exists in the enum for schema completeness/future
  // extensibility (item 7 explicitly makes a persisted draft optional,
  // "do not build unnecessary workflow complexity") — a draft calculation
  // is always the dynamic getDraftReport() path, never persisted as a
  // REPORT_SNAPSHOTS row, so no production code path ever writes this
  // value. getLatestFinalizedReportSnapshot()'s selection logic is still
  // written to never treat "highest version number" as "latest finalized"
  // even if a DRAFT-status row existed — see report-snapshot.test.js's
  // dedicated synthetic-row test for exactly this scenario (spec item 15).
  DRAFT:      'DRAFT',
  FINALIZED:  'FINALIZED',
  SUPERSEDED: 'SUPERSEDED',
};

// 1-based columns, explicit header row — never depends on row position,
// formatting, or a hidden/formula-derived value for identity (item 35).
const REPORT_SNAPSHOT_COL = {
  SNAPSHOT_ID:              1,
  REPORTING_YEAR:           2,
  SNAPSHOT_VERSION:         3,
  STATUS:                   4,
  CREATED_AT:               5,
  CREATED_BY:               6,
  FINALIZED_AT:             7,
  FINALIZED_BY:             8,
  EVALUATION_DATE:          9,
  REASON:                   10,
  SUPERSEDES_SNAPSHOT_ID:   11,
  CALCULATION_TIMESTAMP:    12,
  RISK_CONFIG_VERSION_ID:   13,
  RISK_CONFIG_SOURCE:       14,
  COMPLIANCE_CONFIG_VERSIONS_JSON: 15,
  KPI_CONFIG_NOTE:          16,
  PURPOSE_STORE_CONFIG_NOTE: 17,
  RESULT_JSON:              18,
};
const REPORT_SNAPSHOT_COL_COUNT = 18;

const REPORT_SNAPSHOT_HEADERS = [
  'Snapshot ID', 'Reporting Year', 'Snapshot Version', 'Status',
  'Created At', 'Created By', 'Finalized At', 'Finalized By',
  'Evaluation Date', 'Reason', 'Supersedes Snapshot ID',
  'Calculation Timestamp', 'Risk Config Version ID', 'Risk Config Source',
  'Compliance Config Versions (JSON)', 'KPI Config Note',
  'Purpose/Store Config Note', 'Result (JSON)',
];


// ═══════════════════════════════════════════════════════════════
// SECTION 2: SHEET ACCESS / ROW (DE)SERIALIZATION
// ═══════════════════════════════════════════════════════════════

function _snap_ensureSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(REPORT_SNAPSHOT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(REPORT_SNAPSHOT_SHEET);
    sheet.getRange(1, 1, 1, REPORT_SNAPSHOT_HEADERS.length).setValues([REPORT_SNAPSHOT_HEADERS]).setFontWeight('bold');
  }
  return sheet;
}

// Reads every REPORT_SNAPSHOTS row into a plain object. `includeResult`
// controls whether the (potentially large) Result JSON column is parsed —
// listReportSnapshots() omits it (metadata-only listing); every single-
// snapshot getter includes it.
function _snap_readAll(sheet, includeResult) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const raw = sheet.getRange(2, 1, lastRow - 1, REPORT_SNAPSHOT_COL_COUNT).getValues();
  const C = REPORT_SNAPSHOT_COL;
  return raw
    .filter(row => String(row[C.SNAPSHOT_ID - 1] || '').trim())
    .map(row => {
      let complianceConfigVersions = [];
      try { complianceConfigVersions = JSON.parse(row[C.COMPLIANCE_CONFIG_VERSIONS_JSON - 1] || '[]'); } catch (e) { complianceConfigVersions = []; }
      const out = {
        snapshotId:            String(row[C.SNAPSHOT_ID - 1]),
        reportingYear:          Number(row[C.REPORTING_YEAR - 1]),
        snapshotVersion:        Number(row[C.SNAPSHOT_VERSION - 1]),
        status:                 String(row[C.STATUS - 1]),
        createdAt:              row[C.CREATED_AT - 1],
        createdBy:              String(row[C.CREATED_BY - 1] || ''),
        finalizedAt:            row[C.FINALIZED_AT - 1] || null,
        finalizedBy:            String(row[C.FINALIZED_BY - 1] || ''),
        evaluationDate:         row[C.EVALUATION_DATE - 1],
        reason:                 String(row[C.REASON - 1] || ''),
        supersedesSnapshotId:   String(row[C.SUPERSEDES_SNAPSHOT_ID - 1] || '') || null,
        calculationTimestamp:   row[C.CALCULATION_TIMESTAMP - 1],
        configurationProvenance: {
          risk: {
            versionId: String(row[C.RISK_CONFIG_VERSION_ID - 1] || '') || null,
            source:    String(row[C.RISK_CONFIG_SOURCE - 1] || ''),
          },
          compliance: { versions: complianceConfigVersions },
          kpiNote:              String(row[C.KPI_CONFIG_NOTE - 1] || ''),
          purposeStoreNote:     String(row[C.PURPOSE_STORE_CONFIG_NOTE - 1] || ''),
        },
      };
      if (includeResult) {
        try { out.result = JSON.parse(row[C.RESULT_JSON - 1] || 'null'); } catch (e) { out.result = null; }
      }
      return out;
    });
}

function _snap_appendRow(sheet, obj) {
  const C = REPORT_SNAPSHOT_COL;
  const row = new Array(REPORT_SNAPSHOT_COL_COUNT).fill('');
  row[C.SNAPSHOT_ID - 1]            = obj.snapshotId;
  row[C.REPORTING_YEAR - 1]         = obj.reportingYear;
  row[C.SNAPSHOT_VERSION - 1]       = obj.snapshotVersion;
  row[C.STATUS - 1]                 = obj.status;
  row[C.CREATED_AT - 1]             = obj.createdAt;
  row[C.CREATED_BY - 1]             = obj.createdBy;
  row[C.FINALIZED_AT - 1]           = obj.finalizedAt;
  row[C.FINALIZED_BY - 1]           = obj.finalizedBy;
  row[C.EVALUATION_DATE - 1]        = obj.evaluationDate;
  row[C.REASON - 1]                 = obj.reason;
  row[C.SUPERSEDES_SNAPSHOT_ID - 1] = obj.supersedesSnapshotId || '';
  row[C.CALCULATION_TIMESTAMP - 1]  = obj.calculationTimestamp;
  row[C.RISK_CONFIG_VERSION_ID - 1] = obj.riskConfigVersionId || '';
  row[C.RISK_CONFIG_SOURCE - 1]     = obj.riskConfigSource || '';
  row[C.COMPLIANCE_CONFIG_VERSIONS_JSON - 1] = JSON.stringify(obj.complianceConfigVersions || []);
  row[C.KPI_CONFIG_NOTE - 1]        = obj.kpiConfigNote || '';
  row[C.PURPOSE_STORE_CONFIG_NOTE - 1] = obj.purposeStoreConfigNote || '';
  row[C.RESULT_JSON - 1]            = JSON.stringify(obj.result);
  sheet.appendRow(row);
}

// Flips ONLY the Status cell of an existing row in place — the one
// exception item 18 permits (the supersession flow). Every other column,
// including Result JSON, is never touched again after creation.
function _snap_setStatusInPlace(sheet, snapshotId, newStatus) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const idCol = sheet.getRange(2, REPORT_SNAPSHOT_COL.SNAPSHOT_ID, lastRow - 1, 1).getValues();
  for (let i = 0; i < idCol.length; i++) {
    if (String(idCol[i][0]) === snapshotId) {
      sheet.getRange(i + 2, REPORT_SNAPSHOT_COL.STATUS).setValue(newStatus);
      return true;
    }
  }
  return false;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: CALCULATION CAPTURE — reuses the existing canonical
// engines untouched; this is the ONLY place a snapshot's numbers
// ever get computed (once, at finalize/supersede/draft time).
// ═══════════════════════════════════════════════════════════════

/**
 * _snap_captureCalculatedResult(year, evaluationDate)
 * Captures a COMPLETE, self-contained report result — storeRisk,
 * complianceGaps, totals, executiveSummary, and kpi are all required to
 * be non-null for a snapshot to count as successfully captured (a
 * finalized snapshot must never be a self-contained "mostly" frozen
 * report — see DEPLOY.md's Phase 1E section). Any failure anywhere in
 * this function throws and is caught by the caller
 * (finalizeReport()/supersedeReportSnapshot()'s existing "Report
 * calculation failed" handling) — it never returns a partial result
 * dressed up as success.
 *
 * Executive Summary vs. KPI are handled asymmetrically on purpose:
 *   - EXECUTIVE SUMMARY is the ONE shared sheet across every reporting
 *     year, and getExecutiveSummaryReport() has no way to tell which
 *     year it currently represents. So this function ALWAYS calls
 *     buildExecutiveSummaryLayout(year) first, unconditionally, even if
 *     the sheet already exists — "build only if missing" could silently
 *     freeze a DIFFERENT year's numbers into this snapshot. This is a
 *     real, documented side effect: finalizing/superseding a report
 *     mutates the live, shared "EXECUTIVE SUMMARY" tab every time.
 *   - "KPI <year>" IS already year-scoped by its own sheet name (Phase
 *     1C's _kpiSheetName()), so there is no cross-year risk — it is only
 *     built when that EXACT sheet doesn't exist yet (checked via a
 *     direct sheet lookup, never inferred from a caught exception's
 *     message, so a genuinely different failure from getKPI2026Report()
 *     is never misreported as "just needed building" — it propagates).
 *
 * Neither builder is modified, and neither gains evaluationDate-clipping
 * here: both remain full-calendar-year calculations for `year`, exactly
 * as they already are — an inherited limitation, not something this
 * function changes (see DEPLOY.md).
 * @param {number} year
 * @param {Date} evaluationDate
 * @returns {{storeRisk:object[], complianceGaps:object[], executiveSummary:(object|null), kpi:(object|null), totals:object}}
 */
function _snap_captureCalculatedResult(year, evaluationDate) {
  const masterLog = _getSheet(SHEET.MASTER_LOG);
  const data = _getData(masterLog);
  const storeRisk = _computeStoreRisk(data, evaluationDate, year);

  // Empty-year short-circuit: the caller (finalizeReport()/
  // supersedeReportSnapshot()) rejects an empty storeRisk result before
  // ever persisting anything (item 34's safeguard) — so a genuinely
  // empty year should never trigger the Executive Summary/KPI builders'
  // side effects on shared sheets for a report that's about to be
  // rejected anyway.
  if (!storeRisk || storeRisk.length === 0) {
    return {
      storeRisk: storeRisk || [], complianceGaps: [], executiveSummary: null, kpi: null,
      totals: { storeCount: 0, highRiskCount: 0, mediumRiskCount: 0, lowRiskCount: 0, complianceGapCount: 0 },
    };
  }

  const tz = (typeof Session !== 'undefined' && Session.getScriptTimeZone) ? Session.getScriptTimeZone() : 'UTC';
  const evalDateStr = Utilities.formatDate(evaluationDate, tz, 'yyyy-MM-dd');
  const complianceGaps = (typeof sl_getComplianceGaps === 'function')
    ? sl_getComplianceGaps(null, null, year, evalDateStr)
    : [];

  if (typeof buildExecutiveSummaryLayout !== 'function' || typeof getExecutiveSummaryReport !== 'function') {
    throw new Error('Executive Summary engine (SVMKPI_LAYOUT.gs / SVMKPI_REPORTS.gs) is not loaded — cannot capture a complete report.');
  }
  buildExecutiveSummaryLayout(year);
  const executiveSummary = getExecutiveSummaryReport();

  if (typeof getKPI2026Report !== 'function') {
    throw new Error('KPI report engine (SVMKPI_KPI_REBUILD.gs / SVMKPI_REPORTS.gs) is not loaded — cannot capture a complete report.');
  }
  const kpiSheetName = (typeof _kpiSheetName === 'function') ? _kpiSheetName(year) : ('KPI ' + year);
  const kpiSheetExists = !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(kpiSheetName);
  if (!kpiSheetExists) {
    if (typeof buildKPI2026 !== 'function') {
      throw new Error('KPI build engine (SVMKPI_KPI_REBUILD.gs) is not loaded — cannot create the missing "' + kpiSheetName + '" sheet.');
    }
    buildKPI2026(year);
  }
  const kpi = getKPI2026Report(year);

  const totals = {
    storeCount: storeRisk.length,
    highRiskCount: storeRisk.filter(s => s.riskTier === 'HIGH').length,
    mediumRiskCount: storeRisk.filter(s => s.riskTier === 'MEDIUM').length,
    lowRiskCount: storeRisk.filter(s => s.riskTier === 'LOW').length,
    complianceGapCount: complianceGaps.length,
  };

  return { storeRisk, complianceGaps, executiveSummary, kpi, totals };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: CONFIGURATION PROVENANCE — explanatory metadata only;
// NEVER the source of truth for the frozen result above. Deliberately
// does NOT assume one configuration version applies to a whole
// reporting year (Phase 1D's own explicit warning) — compliance is
// recorded per CATEGORY, exactly reflecting how it's actually resolved.
// ═══════════════════════════════════════════════════════════════

function _snap_captureComplianceProvenance(evaluationDate) {
  if (typeof _cmp_resolveByCategory !== 'function') {
    return { versions: [], note: 'Compliance configuration engine (SVMKPI_COMPLIANCE_CONFIG.gs) not loaded.' };
  }
  const settings = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SETTINGS');
  const categories = {};
  if (settings && settings.getLastRow() >= 2) {
    settings.getRange(2, 5, settings.getLastRow() - 1, 1).getValues().forEach(r => {
      const c = String(r[0] || '').trim().toUpperCase();
      if (c) categories[c] = true;
    });
  }
  const versions = Object.keys(categories).sort().map(category => {
    const rule = _cmp_resolveByCategory(category, evaluationDate);
    return {
      category,
      versionId: (rule && rule.versionId) || null,
      source: (rule && rule.source) || 'NONE',
    };
  });
  return { versions };
}

/**
 * _snap_captureProvenance(evaluationDate)
 * Typed where the existing architecture can provide a single answer
 * (risk — a global singleton); a narrow, purpose-built list where it
 * genuinely resolves multiple versions (compliance — per category); a
 * documented textual note where no consuming calculation exists at all
 * (KPI — Phase 1D's own documented gap) or where "one version for the
 * whole report" isn't a meaningful concept (Purpose/Store — each has
 * independent, per-entity version history, not one report-wide version).
 */
function _snap_captureProvenance(evaluationDate) {
  const risk = (typeof resolveRiskConfigurationAsOf === 'function')
    ? resolveRiskConfigurationAsOf(evaluationDate)
    : { versionId: null, source: 'RISK_CONFIG_ENGINE_NOT_LOADED' };

  const compliance = _snap_captureComplianceProvenance(evaluationDate);

  const kpiConfigNote = 'CONFIG_KPI is infrastructure-only as of Phase 1D — no KPI scoring algorithm exists yet to consume a weight/target, so KPI report numbers above are raw MASTER_LOG counts, unaffected by any CONFIG_KPI version.';
  const purposeStoreConfigNote = 'Store and Purpose configuration are resolved per-entity (each Store ID / Purpose has its own independent effective-dated version history) at calculation time via Phase 1B/1D\'s resolvers — not represented as one report-wide version ID, since no single version could honestly describe every store/purpose at once.';

  return {
    riskConfigVersionId: risk ? risk.versionId : null,
    riskConfigSource: risk ? risk.source : 'NONE',
    complianceConfigVersions: compliance.versions,
    kpiConfigNote,
    purposeStoreConfigNote,
  };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: FINALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * finalizeReport(year, evaluationDateStr, reason, options)
 * Creates the FIRST finalized snapshot for a reporting year. Rejects if
 * one already exists — use supersedeReportSnapshot() for a correction
 * (never a second independent "finalize" for the same year).
 * @param {number|string} year
 * @param {string} [evaluationDateStr] - 'YYYY-MM-DD', default: today
 * @param {string} reason - mandatory; why this report is being finalized
 * @param {object} [options] - reserved for future use
 * @returns {{success:boolean, message?:string, snapshotId?:string, reportingYear?:number, snapshotVersion?:number, status?:string, evaluationDate?:Date, finalizedAt?:Date, finalizedBy?:string}}
 */
function finalizeReport(year, evaluationDateStr, reason, options) {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

    const y = normalizeReportingYear(year);
    if (y === null) return { success: false, message: 'Invalid reporting year: ' + year };

    const evaluationDate = evaluationDateStr ? _parseDateCell(evaluationDateStr) : new Date();
    if (!evaluationDate) return { success: false, message: 'Invalid evaluation date: ' + evaluationDateStr };

    if (!reason || !String(reason).trim()) {
      return { success: false, message: 'A reason is required to finalize a report.' };
    }

    // Calculate BEFORE locking — the calculation itself doesn't depend on
    // snapshot storage state, only on MASTER_LOG/CONFIG/SETTINGS as of
    // evaluationDate. If calculation throws, NO snapshot is created.
    let result;
    try {
      result = _snap_captureCalculatedResult(y, evaluationDate);
    } catch (e) {
      logError('finalizeReport:calculate', e);
      return { success: false, message: 'Report calculation failed: ' + e.message };
    }

    // Empty-year safeguard (item 34): never fabricate a finalized report
    // for a year with no stores and no visit history at all. A store with
    // zero visits but a SETTINGS row is still legitimate, reportable data
    // (Store Health already treats "never visited" as a real result, not
    // a fabrication) — only a genuinely empty result set is rejected.
    if (!result.storeRisk || result.storeRisk.length === 0) {
      return { success: false, message: 'Cannot finalize reporting year ' + y + ': no stores or visit history found. Nothing to report.' };
    }

    const provenance = _snap_captureProvenance(evaluationDate);

    const lock = LockService.getScriptLock();
    let gotLock = false;
    try {
      gotLock = lock.tryLock(10000);
      if (!gotLock) {
        return { success: false, message: 'Server is busy processing another report operation — please try again in a moment.' };
      }

      const sheet = _snap_ensureSheet();
      const existing = _snap_readAll(sheet, false).filter(s => s.reportingYear === y);

      const alreadyFinalized = existing.filter(s => s.status === REPORT_SNAPSHOT_STATUS.FINALIZED)[0];
      if (alreadyFinalized) {
        return {
          success: false,
          message: 'Reporting year ' + y + ' already has a finalized snapshot (' + alreadyFinalized.snapshotId + '). Use supersedeReportSnapshot() to create a correction.',
        };
      }

      const nextVersion = existing.reduce((max, s) => Math.max(max, s.snapshotVersion), 0) + 1;
      const snapshotId = 'REPORT-' + y + '-v' + nextVersion;
      const now = new Date();
      const actor = sl_getCurrentUser();

      _snap_appendRow(sheet, {
        snapshotId, reportingYear: y, snapshotVersion: nextVersion,
        status: REPORT_SNAPSHOT_STATUS.FINALIZED,
        createdAt: now, createdBy: actor,
        finalizedAt: now, finalizedBy: actor,
        evaluationDate, reason: String(reason).trim(),
        supersedesSnapshotId: null,
        calculationTimestamp: now,
        riskConfigVersionId: provenance.riskConfigVersionId,
        riskConfigSource: provenance.riskConfigSource,
        complianceConfigVersions: provenance.complianceConfigVersions,
        kpiConfigNote: provenance.kpiConfigNote,
        purposeStoreConfigNote: provenance.purposeStoreConfigNote,
        result,
      });
      SpreadsheetApp.flush();

      _cfg_writeAudit(CFG_AREA.REPORT, String(y), CFG_ACTION.FINALIZE,
        '(none)', snapshotId, evaluationDate, null, String(reason).trim(), nextVersion, actor);

      try { regenerateReportSheet(y); } catch (e) { /* best-effort presentation artifact — the logical snapshot above is already durable */ }

      return {
        success: true, snapshotId, reportingYear: y, snapshotVersion: nextVersion,
        status: REPORT_SNAPSHOT_STATUS.FINALIZED, evaluationDate, finalizedAt: now, finalizedBy: actor,
      };
    } finally {
      if (gotLock) lock.releaseLock();
    }
  } catch (e) {
    logError('finalizeReport', e);
    return { success: false, message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6: CORRECTION / SUPERSESSION
// ═══════════════════════════════════════════════════════════════

/**
 * supersedeReportSnapshot(year, previousSnapshotId, evaluationDateStr, reason, options)
 * Creates a NEW finalized version replacing a previously finalized one.
 * The previous snapshot's Result JSON is never touched — only its Status
 * cell flips to SUPERSEDED (see _snap_setStatusInPlace()).
 * @param {number|string} year
 * @param {string} previousSnapshotId
 * @param {string} [evaluationDateStr]
 * @param {string} reason - mandatory correction reason
 * @param {object} [options]
 * @returns {{success:boolean, message?:string, previousSnapshotId?:string, snapshotId?:string, reportingYear?:number, snapshotVersion?:number, status?:string}}
 */
function supersedeReportSnapshot(year, previousSnapshotId, evaluationDateStr, reason, options) {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

    const y = normalizeReportingYear(year);
    if (y === null) return { success: false, message: 'Invalid reporting year: ' + year };

    if (!previousSnapshotId) return { success: false, message: 'previousSnapshotId is required.' };

    if (!reason || !String(reason).trim()) {
      return { success: false, message: 'A correction reason is required to supersede a report snapshot.' };
    }

    const evaluationDate = evaluationDateStr ? _parseDateCell(evaluationDateStr) : new Date();
    if (!evaluationDate) return { success: false, message: 'Invalid evaluation date: ' + evaluationDateStr };

    let result;
    try {
      result = _snap_captureCalculatedResult(y, evaluationDate);
    } catch (e) {
      logError('supersedeReportSnapshot:calculate', e);
      return { success: false, message: 'Report calculation failed: ' + e.message };
    }

    if (!result.storeRisk || result.storeRisk.length === 0) {
      return { success: false, message: 'Cannot create a corrected snapshot for reporting year ' + y + ': no stores or visit history found. Nothing to report.' };
    }

    const provenance = _snap_captureProvenance(evaluationDate);

    const lock = LockService.getScriptLock();
    let gotLock = false;
    try {
      gotLock = lock.tryLock(10000);
      if (!gotLock) {
        return { success: false, message: 'Server is busy processing another report operation — please try again in a moment.' };
      }

      const sheet = _snap_ensureSheet();
      const existing = _snap_readAll(sheet, false).filter(s => s.reportingYear === y);

      // Re-verified INSIDE the lock, from a fresh read — this is what
      // makes two concurrent supersede attempts against the same previous
      // snapshot concurrency-safe: whichever call wins the lock flips the
      // previous snapshot's status first, so the second call's fresh read
      // sees it already SUPERSEDED and correctly rejects.
      const previous = existing.filter(s => s.snapshotId === previousSnapshotId)[0];
      if (!previous) return { success: false, message: 'Previous snapshot not found: ' + previousSnapshotId };
      if (previous.status !== REPORT_SNAPSHOT_STATUS.FINALIZED) {
        return { success: false, message: 'Previous snapshot ' + previousSnapshotId + ' is not currently finalized (status: ' + previous.status + ') — only a finalized snapshot can be superseded.' };
      }

      const nextVersion = existing.reduce((max, s) => Math.max(max, s.snapshotVersion), 0) + 1;
      const snapshotId = 'REPORT-' + y + '-v' + nextVersion;
      const now = new Date();
      const actor = sl_getCurrentUser();

      _snap_appendRow(sheet, {
        snapshotId, reportingYear: y, snapshotVersion: nextVersion,
        status: REPORT_SNAPSHOT_STATUS.FINALIZED,
        createdAt: now, createdBy: actor,
        finalizedAt: now, finalizedBy: actor,
        evaluationDate, reason: String(reason).trim(),
        supersedesSnapshotId: previousSnapshotId,
        calculationTimestamp: now,
        riskConfigVersionId: provenance.riskConfigVersionId,
        riskConfigSource: provenance.riskConfigSource,
        complianceConfigVersions: provenance.complianceConfigVersions,
        kpiConfigNote: provenance.kpiConfigNote,
        purposeStoreConfigNote: provenance.purposeStoreConfigNote,
        result,
      });

      _snap_setStatusInPlace(sheet, previousSnapshotId, REPORT_SNAPSHOT_STATUS.SUPERSEDED);
      SpreadsheetApp.flush();

      _cfg_writeAudit(CFG_AREA.REPORT, String(y), CFG_ACTION.SUPERSEDE,
        previousSnapshotId, snapshotId, evaluationDate, null, String(reason).trim(), nextVersion, actor);

      try { regenerateReportSheet(y); } catch (e) { /* best-effort presentation artifact */ }

      return {
        success: true, previousSnapshotId, snapshotId, reportingYear: y,
        snapshotVersion: nextVersion, status: REPORT_SNAPSHOT_STATUS.FINALIZED,
      };
    } finally {
      if (gotLock) lock.releaseLock();
    }
  } catch (e) {
    logError('supersedeReportSnapshot', e);
    return { success: false, message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 7: RETRIEVAL — never recalculates; always reads the
// persisted, frozen row(s) exactly as stored.
// ═══════════════════════════════════════════════════════════════

/** getReportSnapshot(snapshotId) — full snapshot (incl. frozen result), or null. */
function getReportSnapshot(snapshotId) {
  if (!snapshotId) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REPORT_SNAPSHOT_SHEET);
  if (!sheet) return null;
  return _snap_readAll(sheet, true).filter(s => s.snapshotId === snapshotId)[0] || null;
}

/** getReportSnapshotByVersion(year, version) — full snapshot, or null. */
function getReportSnapshotByVersion(year, version) {
  const y = normalizeReportingYear(year);
  const v = Number(version);
  if (y === null || !Number.isFinite(v)) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REPORT_SNAPSHOT_SHEET);
  if (!sheet) return null;
  return _snap_readAll(sheet, true).filter(s => s.reportingYear === y && s.snapshotVersion === v)[0] || null;
}

/**
 * getLatestFinalizedReportSnapshot(year)
 * The current FINALIZED snapshot for a year — NEVER simply the highest
 * version number (a superseded or, hypothetically, draft version can be
 * numerically higher without being the answer). Returns null if the year
 * has never been finalized.
 */
function getLatestFinalizedReportSnapshot(year) {
  const y = normalizeReportingYear(year);
  if (y === null) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REPORT_SNAPSHOT_SHEET);
  if (!sheet) return null;
  const finalized = _snap_readAll(sheet, true)
    .filter(s => s.reportingYear === y && s.status === REPORT_SNAPSHOT_STATUS.FINALIZED)
    .sort((a, b) => b.snapshotVersion - a.snapshotVersion);
  return finalized[0] || null;
}

/**
 * listReportSnapshots(year)
 * Every version for a year, ascending, metadata only (no Result JSON —
 * fetch a specific version's full result via getReportSnapshot()/
 * getReportSnapshotByVersion()).
 */
function listReportSnapshots(year) {
  const y = normalizeReportingYear(year);
  if (y === null) return [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REPORT_SNAPSHOT_SHEET);
  if (!sheet) return [];
  return _snap_readAll(sheet, false)
    .filter(s => s.reportingYear === y)
    .sort((a, b) => a.snapshotVersion - b.snapshotVersion);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 8: DRAFT REPORT — always dynamic; never persisted; viewing
// this NEVER finalizes anything.
// ═══════════════════════════════════════════════════════════════

/**
 * getDraftReport(year, evaluationDateStr)
 * Fresh calculation every call, using whatever configuration/data is
 * applicable as of evaluationDate right now. Distinct on purpose from
 * getLatestFinalizedReportSnapshot() — see DEPLOY.md's Phase 1E section.
 * @returns {{mode:'DRAFT', reportingYear:number, evaluationDate:Date, calculatedAt:Date, result:object}|null}
 */
function getDraftReport(year, evaluationDateStr) {
  const y = normalizeReportingYear(year);
  if (y === null) return null;
  const evaluationDate = evaluationDateStr ? _parseDateCell(evaluationDateStr) : new Date();
  if (!evaluationDate) return null;

  const result = _snap_captureCalculatedResult(y, evaluationDate);
  return { mode: 'DRAFT', reportingYear: y, evaluationDate, calculatedAt: new Date(), result };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 9: PER-YEAR REPORT SHEET — a presentation artifact
// regenerated FROM a stored snapshot, never recalculated live.
// ═══════════════════════════════════════════════════════════════

// Same convention as _kpiSheetName() (SVMKPI_KPI_REBUILD.gs) — the year
// parameter drives the SAME implementation for any year; never a
// buildReport2026()/buildReport2027() per-year function.
function _report_sheetName(year) {
  return 'REPORT_' + year;
}

/**
 * regenerateReportSheet(year)
 * Rebuilds the REPORT_<year> presentation sheet ENTIRELY from
 * getLatestFinalizedReportSnapshot(year)'s stored, frozen result — never
 * from live MASTER_LOG/CONFIG/store attributes (item 22's explicit proof
 * that snapshot storage, not the sheet, is the canonical frozen artifact).
 * Deliberately simple/values-only formatting — this phase is backend/
 * report-artifact infrastructure, not a dashboard redesign (item 38).
 * Represents the LATEST finalized snapshot only; every historical
 * version remains fully preserved and independently retrievable via
 * REPORT_SNAPSHOTS / getReportSnapshotByVersion() regardless of what this
 * sheet currently shows (item 23's documented single-sheet convention,
 * matching EXECUTIVE SUMMARY/STORE HEALTH's existing one-sheet-per-concept
 * pattern rather than inventing per-version sheet names).
 * @returns {{success:boolean, message?:string, sheetName?:string, snapshotId?:string, snapshotVersion?:number}}
 */
function regenerateReportSheet(year) {
  const y = normalizeReportingYear(year);
  if (y === null) return { success: false, message: 'Invalid reporting year: ' + year };

  const snap = getLatestFinalizedReportSnapshot(y);
  if (!snap) return { success: false, message: 'No finalized snapshot exists for ' + y + ' to regenerate from.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = _report_sheetName(y);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName); else sheet.clear();

  let row = 1;
  const writeRow = (values) => { sheet.getRange(row, 1, 1, values.length).setValues([values]); row++; };
  const bold = (r) => sheet.getRange(r, 1).setFontWeight('bold');

  writeRow(['STORE VISIT PROGRAM — FINALIZED REPORT ' + y]); bold(row - 1);
  writeRow(['Snapshot ID', snap.snapshotId]);
  writeRow(['Snapshot Version', snap.snapshotVersion]);
  writeRow(['Status', snap.status]);
  writeRow(['Evaluation Date', snap.evaluationDate]);
  writeRow(['Finalized At', snap.finalizedAt]);
  writeRow(['Finalized By', snap.finalizedBy]);
  writeRow(['Reason', snap.reason]);
  if (snap.supersedesSnapshotId) writeRow(['Supersedes', snap.supersedesSnapshotId]);
  row++; // blank separator

  const result = snap.result || {};

  if (result.executiveSummary) {
    writeRow(['EXECUTIVE SUMMARY — KEY PERFORMANCE INDICATORS']); bold(row - 1);
    (result.executiveSummary.kpi || []).forEach(k => writeRow([k.label, k.value]));
    row++;
  } else if (result.executiveSummaryNote) {
    writeRow(['Executive Summary', result.executiveSummaryNote]);
    row++;
  }

  if (result.kpi && result.kpi.team) {
    writeRow(['KPI ' + y + ' — TEAM TOTAL']); bold(row - 1);
    writeRow(['Q1', 'Q2', 'Q3', 'Q4', 'YTD']);
    writeRow([result.kpi.team.q1, result.kpi.team.q2, result.kpi.team.q3, result.kpi.team.q4, result.kpi.team.ytd]);
    row++;
  } else if (result.kpiNote) {
    writeRow(['KPI Report', result.kpiNote]);
    row++;
  }

  writeRow(['STORE HEALTH / RISK']); bold(row - 1);
  writeRow(RISK_HEADERS.slice());
  (result.storeRisk || []).forEach(s => writeRow([
    s.store, s.brand, s.region, s.lastDate || '', s.lastPurpose,
    s.daysSince === null ? 'NEVER VISITED' : s.daysSince,
    s.totalYTD, s.storeYTD, s.failedCount, s.curingCount,
    s.riskScore, s.riskTier, s.action, s.attentionReason,
  ]));
  row++;

  writeRow(['COMPLIANCE GAPS']); bold(row - 1);
  writeRow(['Store', 'Brand', 'Region', 'Category', 'Last Visit', 'Days Since', 'Window', 'YTD Visits', 'Required', 'Actual']);
  (result.complianceGaps || []).forEach(g => writeRow([
    g.store, g.brand, g.region, g.category, g.lastVisitDate, g.daysSince,
    g.windowLabel, g.ytdVisits, g.requiredCount, g.actualCount,
  ]));

  SpreadsheetApp.flush();
  return { success: true, sheetName, snapshotId: snap.snapshotId, snapshotVersion: snap.snapshotVersion };
}
