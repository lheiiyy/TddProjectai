// database/dryrun/dryrun.test.js
// Unit tests for the Phase 2 (Real-Data Migration Dry Run) analysis
// modules. These are pure-function tests against small synthetic inputs
// — proving the LOGIC is correct — not a substitute for running the
// pipeline against the real export (see database/docs/07-phase2-*.md
// once that run happens).

const { QuarantineCollector, RESOLUTION_CATEGORY } = require('./quarantine');
const { parseDateCell, toIsoDateString } = require('./date_parse');
const { analyzeMasterLog } = require('./masterlog_integrity');
const { reconcileStores } = require('./reconcile_stores');
const { reconcileVisitors } = require('./reconcile_visitors');
const { reconcilePurposes } = require('./reconcile_purposes');
const { checkConfigOverlaps } = require('./config_overlap_check');
const { validateSnapshots } = require('./snapshot_validation');
const { extractYearsFromMasterLog, compareReportingYears } = require('./reporting_year_check');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); fail++; }
}

// ── date_parse ──────────────────────────────────────────────────
check('parseDateCell: valid ISO string', !!parseDateCell('2026-01-05'));
check('parseDateCell: malformed string returns null', parseDateCell('not-a-date') === null);
check('parseDateCell: blank returns null', parseDateCell('') === null);
check('parseDateCell: null returns null', parseDateCell(null) === null);
check('parseDateCell: Date instance', toIsoDateString(parseDateCell(new Date(2026, 0, 5))) === '2026-01-05');
check('parseDateCell: decimal-like garbage rejected', parseDateCell('2026-01') === null);

// ── quarantine ──────────────────────────────────────────────────
{
  const q = new QuarantineCollector();
  q.add({ sourceSheet: 'MASTER_LOG', sourceRowRef: 'A5', problemType: 'BLANK_STORE_ID', originalValue: '', explanation: 'no Store ID', proposedResolutionCategory: RESOLUTION_CATEGORY.NEEDS_HUMAN_RECONCILIATION });
  check('quarantine: records an entry', q.entries.length === 1);
  check('quarantine: rejects invalid category', (() => {
    try { q.add({ sourceSheet: 'x', sourceRowRef: 'x', problemType: 'x', originalValue: 'x', explanation: 'x', proposedResolutionCategory: 'NOT_REAL' }); return false; }
    catch (e) { return true; }
  })());
  const artifact = q.toArtifact('run-1');
  check('quarantine: artifact carries runId + counts', artifact.runId === 'run-1' && artifact.totalQuarantined === 1);
}

// ── masterlog_integrity ─────────────────────────────────────────
{
  const rows = [
    { rowRef: 'r1', timestamp: '2026-01-05T10:00:00Z', dateVisited: '2026-01-05', store: 'STORE A', brand: 'B', region: 'R', visitedBy: 'LEO | YANA', purpose: 'STORE VISIT', remarks: '', storeId: 'STR-0001' },
    { rowRef: 'r2', timestamp: '2026-01-05T10:00:00Z', dateVisited: 'garbage', store: 'STORE A', brand: 'B', region: 'R', visitedBy: 'LEO', purpose: 'STORE VISIT', remarks: '', storeId: 'STR-0001' },
    { rowRef: 'r3', timestamp: '', dateVisited: '', store: '', brand: '', region: '', visitedBy: '', purpose: '', remarks: '', storeId: '' },
    { rowRef: 'r4', timestamp: '2026-02-01T10:00:00Z', dateVisited: '2026-02-01', store: 'UNKNOWN STORE', brand: 'B', region: 'R', visitedBy: 'LEO', purpose: 'TLTC', remarks: '', storeId: '' },
    // exact duplicate of r1
    { rowRef: 'r5', timestamp: '2026-01-05T10:00:00Z', dateVisited: '2026-01-05', store: 'STORE A', brand: 'B', region: 'R', visitedBy: 'LEO | YANA', purpose: 'STORE VISIT', remarks: '', storeId: 'STR-0001' },
  ];
  const report = analyzeMasterLog(rows, { knownStoreIds: new Set(['STR-0001']), knownVisitorIds: new Set(['LEO', 'YANA']), knownPurposeIds: new Set(['STORE VISIT', 'TLTC']) });
  check('masterlog_integrity: total rows', report.totalSourceRows === 5);
  check('masterlog_integrity: blank rows', report.blankRows === 1, report.blankRows);
  check('masterlog_integrity: malformed dates skipped, not counted valid', report.malformedDates.length === 1 && report.validEventRows === 3, { malformed: report.malformedDates.length, valid: report.validEventRows });
  check('masterlog_integrity: blank store id count', report.rowsWithBlankStoreId === 1);
  check('masterlog_integrity: reporting years discovered, no invented gaps', JSON.stringify(report.reportingYears) === JSON.stringify([2026]));
  check('masterlog_integrity: exact duplicate candidate found (r1/r5)', report.exactDuplicateCandidates.some((d) => d.rowRefs.includes('r1') && d.rowRefs.includes('r5')));
  check('masterlog_integrity: multi-visitor submission counted (r1 and its exact-duplicate r5)', report.multiVisitorSubmissionCount === 2, report.multiVisitorSubmissionCount);
}

// ── reconcile_stores ────────────────────────────────────────────
{
  const configStoreVersions = [
    { entityId: 'STR-0001', versionNum: 1, effectiveFrom: '2025-01-01', effectiveTo: null, envelopeStatus: 'ACTIVE', storeName: 'STORE A', status: 'ACTIVE' },
    { entityId: 'STR-0002', versionNum: 1, effectiveFrom: '2025-01-01', effectiveTo: null, envelopeStatus: 'ACTIVE', storeName: 'STORE B', status: 'INACTIVE' },
  ];
  const settingsRows = [{ store: 'STORE A' }, { store: 'STORE C (UNKNOWN)' }];
  const masterLogRows = [
    { rowRef: 'r1', store: 'STORE A', storeId: 'STR-0001' },
    { rowRef: 'r2', store: 'STORE B', storeId: 'STR-0002' }, // inactive store with history
    { rowRef: 'r3', store: 'MYSTERY STORE', storeId: '' },
  ];
  const report = reconcileStores({ configStoreVersions, settingsRows, masterLogRows });
  check('reconcile_stores: source/destination counts match entity count', report.sourceStoreCount === 2 && report.destinationStoreCount === 2);
  check('reconcile_stores: active/inactive split', report.activeStoreCount === 1 && report.inactiveStoreCount === 1);
  check('reconcile_stores: historical-only (inactive with history) detected', report.historicalOnlyStores.includes('STR-0002'));
  check('reconcile_stores: unmapped store captured, name preserved verbatim', report.unmappedStores.some((u) => u.originalStoreName === 'MYSTERY STORE'));
  check('reconcile_stores: SETTINGS exact match counted', report.exactMatches === 1);
  check('reconcile_stores: unresolved SETTINGS name reported, not guessed', report.unresolvedNames.some((u) => u.name === 'STORE C (UNKNOWN)'));
}

// ── reconcile_visitors ──────────────────────────────────────────
{
  const configVisitorVersions = [{ entityId: 'LEO' }, { entityId: 'YANA' }];
  const masterLogRows = [
    { rowRef: 'r1', visitedBy: 'LEO | YANA' },
    { rowRef: 'r2', visitedBy: 'MYSTERY VISITOR' },
    { rowRef: 'r3', visitedBy: '' },
  ];
  const report = reconcileVisitors({ configVisitorVersions, masterLogRows });
  check('reconcile_visitors: unique identities counted', report.uniqueVisitorIdentities === 2);
  check('reconcile_visitors: unknown visitor reported, never merged', report.unknownVisitorReferences.some((u) => u.name === 'MYSTERY VISITOR'));
  check('reconcile_visitors: missing-value row flagged', report.missingVisitorValueRows.some((r) => r.rowRef === 'r3'));
}

// ── reconcile_purposes ──────────────────────────────────────────
{
  const legacyPurposeIds = ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'];
  const configPurposeVersions = [{ entityId: 'NEW PURPOSE', effectiveFrom: '2026-06-01', envelopeStatus: 'ACTIVE', riskWeight: 3 }];
  const masterLogRows = [
    { rowRef: 'r1', purpose: 'STORE VISIT', dateVisited: '2026-01-01' },
    { rowRef: 'r2', purpose: 'NEW PURPOSE', dateVisited: '2026-01-01' }, // predates its own configuration
    { rowRef: 'r3', purpose: 'TOTALLY UNKNOWN', dateVisited: '2026-01-01' },
  ];
  const report = reconcilePurposes({ legacyPurposeIds, configPurposeVersions, kpiConfigurationVersions: [], masterLogRows });
  check('reconcile_purposes: legacy purpose classified', report.legacy.includes('STORE VISIT'));
  check('reconcile_purposes: configured purpose classified', report.withConfiguration.includes('NEW PURPOSE'));
  check('reconcile_purposes: unknown purpose classified, not auto-configured', report.unknown.includes('TOTALLY UNKNOWN'));
  check('reconcile_purposes: pre-configuration historical usage detected', report.preConfigurationHistoricalUsage.some((f) => f.rowRef === 'r2'));
}

// ── config_overlap_check ────────────────────────────────────────
{
  const versions = [
    { entityId: 'GLOBAL', versionNum: 1, effectiveFrom: '2025-01-01', effectiveTo: '2026-06-01', envelopeStatus: 'ACTIVE' },
    { entityId: 'GLOBAL', versionNum: 2, effectiveFrom: '2026-01-01', effectiveTo: null, envelopeStatus: 'ACTIVE' }, // overlaps v1
  ];
  const findings = checkConfigOverlaps(versions, { areaName: 'RISK' });
  check('config_overlap_check: overlap detected, not silently resolved', findings.some((f) => f.type === 'OVERLAPPING_EFFECTIVE_RANGES'));

  const invalidRange = [{ entityId: 'X', versionNum: 1, effectiveFrom: '2026-06-01', effectiveTo: '2026-01-01', envelopeStatus: 'ACTIVE' }];
  check('config_overlap_check: invalid range detected', checkConfigOverlaps(invalidRange, { areaName: 'X' }).some((f) => f.type === 'INVALID_EFFECTIVE_RANGE'));

  const badStatus = [{ entityId: 'X', versionNum: 1, effectiveFrom: '2026-01-01', effectiveTo: null, envelopeStatus: 'SUPERSEDED' }];
  check('config_overlap_check: invalid envelope status detected', checkConfigOverlaps(badStatus, { areaName: 'X' }).some((f) => f.type === 'INVALID_ENVELOPE_STATUS'));
}

// ── snapshot_validation ─────────────────────────────────────────
{
  const snapshots = [
    { reportingYear: 2026, versionNum: 1, status: 'SUPERSEDED', resultJson: { a: 1 } },
    { reportingYear: 2026, versionNum: 2, status: 'FINALIZED', resultJson: { a: 2 }, supersedesVersion: 1 },
    { reportingYear: 2025, versionNum: 1, status: 'FINALIZED', resultJson: { a: 3 } },
  ];
  const findings = validateSnapshots(snapshots);
  check('snapshot_validation: valid chain produces no findings', findings.length === 0, findings);

  const broken = [
    { reportingYear: 2026, versionNum: 1, status: 'FINALIZED', resultJson: { a: 1 } },
    { reportingYear: 2026, versionNum: 2, status: 'FINALIZED', resultJson: { a: 2 } }, // two FINALIZED same year
  ];
  check('snapshot_validation: multiple FINALIZED same year flagged', validateSnapshots(broken).some((f) => f.type === 'MULTIPLE_FINALIZED_SAME_YEAR'));

  const missingResult = [{ reportingYear: 2026, versionNum: 1, status: 'FINALIZED', resultJson: null }];
  check('snapshot_validation: FINALIZED with no frozen result flagged', validateSnapshots(missingResult).some((f) => f.type === 'FINALIZED_MISSING_FROZEN_RESULT'));
}

// ── reporting_year_check ────────────────────────────────────────
{
  const rows = [{ dateVisited: '2026-01-01' }, { dateVisited: '2029-01-01' }, { dateVisited: 'bad' }];
  const years = extractYearsFromMasterLog(rows);
  check('reporting_year_check: no invented gap year (2027/2028 absent)', JSON.stringify(years) === JSON.stringify([2026, 2029]));

  const cmp = compareReportingYears([2026, 2029], [2026]);
  check('reporting_year_check: mismatch reported exactly', !cmp.match && cmp.onlyInSource.includes(2029));
}

console.log('\n' + '═'.repeat(34));
console.log(`  PASS ${pass}   FAIL ${fail}`);
console.log('═'.repeat(34));
process.exit(fail > 0 ? 1 : 0);
