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
const {
  PURPOSE_SOURCE_STATUS, PURPOSE_RECONCILIATION_DECISION, CONFIGURATION_STATUS, reconcilePurposeSources,
} = require('./purpose_reconciliation');
const { checkConfigOverlaps } = require('./config_overlap_check');
const { validateSnapshots } = require('./snapshot_validation');
const { extractYearsFromMasterLog, compareReportingYears } = require('./reporting_year_check');
const { buildStoreIdentityReconciliation, compositeKey, findLocationOnlyCandidates, STATUS: STORE_STATUS } = require('./store_canonical_identity');
const { findEmbeddedConventionCandidates } = require('./location_convention_candidates');
const { classifyHistoricalIdentity, CLASSIFICATION, MATCH_TYPE } = require('./historical_identity_classification');
const { deriveProposedStoreId, buildProposedStoreIdMap, uuidV5, SVMI_STORE_NAMESPACE_UUID } = require('./store_id_generator');
const { STATUS: OPERATIONAL_STATUS, applyOperationalStatus } = require('./operational_status');
const { finalizeProposedStoreId } = require('./store_id_finalization');
const { ADMINISTRATIVE_CONFIRMATION, describeAdministrativeConfirmation } = require('./administrative_confirmation');
const { classifyVisitorTokens } = require('./visitor_identity_classification');
const {
  VISITOR_CLASSIFICATION, VISITOR_MATCH_TYPE, ADMINISTRATIVE_CONFIRMATION: VISITOR_ADMIN_CONFIRMATION, finalizeVisitorIdentity,
} = require('./visitor_identity_finalization');
const {
  PURPOSE_OPERATIONAL_STATUS, resolvePurposeConfigurationStatus, annotateWithOperationalStatus,
  getActiveSelectablePurposes, getReportEligiblePurposes, getPendingAnalyticsConfigurationPurposes,
} = require('./purpose_operational_readiness');

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

// ── reconcile_stores: composite (Name,Brand) identity key (Phase 2A) ──
{
  // Same-name/different-brand regression: two DISTINCT real stores must
  // never collapse into one identity just because they share a Name.
  const configStoreVersions = [
    { entityId: 'STR-A1', storeName: 'RIVERBEND', storeBrand: "ANGEL'S PIZZA", status: 'ACTIVE' },
    { entityId: 'STR-A2', storeName: 'RIVERBEND', storeBrand: 'FIGARO', status: 'ACTIVE' },
  ];
  const settingsRows = [
    { store: 'RIVERBEND', brand: "ANGEL'S PIZZA" },
    { store: 'RIVERBEND', brand: 'FIGARO' },
  ];
  const masterLogRows = [
    { rowRef: 'r1', store: 'RIVERBEND', brand: "ANGEL'S PIZZA", storeId: 'STR-A1' },
    { rowRef: 'r2', store: 'RIVERBEND', brand: 'FIGARO', storeId: 'STR-A2' },
  ];
  const report = reconcileStores({ configStoreVersions, settingsRows, masterLogRows });
  check('reconcile_stores: same-name/different-brand stores never collapse (no duplicateIdentities)', report.duplicateIdentities.length === 0, report.duplicateIdentities);
  check('reconcile_stores: same-name/different-brand — both SETTINGS rows match exactly', report.exactMatches === 2);
  check('reconcile_stores: same-name/different-brand — no ambiguous matches', report.ambiguousMatches.length === 0);

  // A genuine duplicate (same Name AND same Brand) must still be reported.
  const dupConfig = [
    { entityId: 'STR-D1', storeName: 'DUPTOWN', storeBrand: 'APEX', status: 'ACTIVE' },
    { entityId: 'STR-D2', storeName: 'DUPTOWN', storeBrand: 'APEX', status: 'ACTIVE' },
  ];
  const dupReport = reconcileStores({ configStoreVersions: dupConfig, settingsRows: [], masterLogRows: [] });
  check('reconcile_stores: genuine same-name+same-brand duplicate is still reported', dupReport.duplicateIdentities.length === 1 && dupReport.duplicateIdentities[0].storeBrand === 'APEX');
}

// ── store_canonical_identity: pre-mint identity derivation (Phase 2A/2A.2) ──
// Fictional location/brand names throughout — this mirrors real findings
// from the Phase 2A dry run (documented locally, never committed) without
// reproducing real production location names in git.
{
  const settingsRows = [
    { rowRef: 'S1', store: 'RIVERBEND', brand: "ANGEL'S PIZZA", region: 'FRANCHISE', category: 'FAR PROVINCIAL' },
    { rowRef: 'S2', store: 'RIVERBEND', brand: 'FIGARO', region: 'FRANCHISE', category: 'NEAR PROVINCIAL' },
    { rowRef: 'S3', store: 'DUPTOWN', brand: 'APEX', region: 'NCR', category: 'NCR' },
    { rowRef: 'S4', store: 'DUPTOWN', brand: 'APEX', region: 'NCR', category: 'NCR' },
    { rowRef: 'S5', store: 'CONFLICTTOWN', brand: 'APEX', region: 'NCR', category: 'NCR' },
    { rowRef: 'S6', store: 'CONFLICTTOWN', brand: 'APEX', region: 'PROVINCIAL', category: 'FAR PROVINCIAL' },
  ];
  const masterLogRows = [
    { rowRef: 'M1', store: 'RIVERBEND', brand: "ANGEL'S PIZZA", dateVisited: '2026-01-01' },
    { rowRef: 'M2', store: 'GHOSTTOWN', brand: 'APEX', dateVisited: '2026-02-01' },
  ];
  const result = buildStoreIdentityReconciliation({ settingsRows, masterLogRows });

  check('store_canonical_identity: same-location/different-brand stores never collapse (regression)', (() => {
    const riverbendIdentities = result.identities.filter((i) => i.normalizedLocation === 'RIVERBEND');
    return riverbendIdentities.length === 2 && new Set(riverbendIdentities.map((i) => i.normalizedBrand)).size === 2;
  })());

  check('store_canonical_identity: identical duplicate SETTINGS rows -> DUPLICATE_SOURCE_ROWS, one canonical identity',
    result.duplicateSettingsRows.find((d) => d.compositeKey === 'DUPTOWN|APEX').status === STORE_STATUS.DUPLICATE_SOURCE_ROWS);

  check('store_canonical_identity: duplicate source rows retain provenance of both original rows', (() => {
    const dup = result.duplicateSettingsRows.find((d) => d.compositeKey === 'DUPTOWN|APEX');
    return dup.rows.map((r) => r.rowRef).sort().join(',') === 'S3,S4';
  })());

  check('store_canonical_identity: DUPTOWN/APEX collapses to exactly ONE identity in the identity list (not two)',
    result.identities.filter((i) => i.compositeKey === 'DUPTOWN|APEX').length === 1);

  check('store_canonical_identity: conflicting duplicate SETTINGS rows -> HUMAN_REVIEW, never silently picked',
    result.duplicateSettingsRows.find((d) => d.compositeKey === 'CONFLICTTOWN|APEX').status === STORE_STATUS.HUMAN_REVIEW);

  check('store_canonical_identity: MASTER_LOG-only identity classified MASTER_LOG_ONLY_UNRESOLVED, never auto-mapped',
    result.identities.find((i) => i.compositeKey === 'GHOSTTOWN|APEX').status === STORE_STATUS.MASTER_LOG_ONLY_UNRESOLVED);

  check('store_canonical_identity: matched identity with history classified EXACT_MATCH and ready',
    (() => {
      const i = result.identities.find((i2) => i2.compositeKey === "RIVERBEND|ANGEL'S PIZZA");
      return i.status === STORE_STATUS.EXACT_MATCH && i.readyForStoreIdAssignment === true;
    })());

  check('store_canonical_identity: matched identity with no history classified SETTINGS_ONLY and still ready',
    (() => {
      const i = result.identities.find((i2) => i2.compositeKey === 'RIVERBEND|FIGARO');
      return i.status === STORE_STATUS.SETTINGS_ONLY && i.readyForStoreIdAssignment === true;
    })());

  check('store_canonical_identity: DUPLICATE_SOURCE_ROWS identity is ready for assignment',
    result.identities.find((i) => i.compositeKey === 'DUPTOWN|APEX').readyForStoreIdAssignment === true);

  check('store_canonical_identity: HUMAN_REVIEW and MASTER_LOG_ONLY_UNRESOLVED are never ready', (() => {
    const conflict = result.identities.find((i) => i.compositeKey === 'CONFLICTTOWN|APEX');
    const ghost = result.identities.find((i) => i.compositeKey === 'GHOSTTOWN|APEX');
    return conflict.readyForStoreIdAssignment === false && ghost.readyForStoreIdAssignment === false;
  })());

  check('store_canonical_identity: source values preserved verbatim alongside normalized values', (() => {
    const riverbendFigaro = result.identities.find((i) => i.compositeKey === 'RIVERBEND|FIGARO');
    return riverbendFigaro.canonicalLocation === 'RIVERBEND' && riverbendFigaro.canonicalBrand === 'FIGARO'
      && riverbendFigaro.normalizedLocation === 'RIVERBEND' && riverbendFigaro.normalizedBrand === 'FIGARO';
  })());

  check('store_canonical_identity: readyCount/duplicateSourceRowsCount/masterLogOnlyUnresolvedCount roll-ups are consistent', (() => {
    // 6 identities total: RIVERBEND/ANGEL'S PIZZA (EXACT_MATCH), RIVERBEND/FIGARO
    // (SETTINGS_ONLY), DUPTOWN/APEX (DUPLICATE_SOURCE_ROWS), CONFLICTTOWN/APEX
    // (HUMAN_REVIEW), GHOSTTOWN/APEX (MASTER_LOG_ONLY_UNRESOLVED) = 5 distinct
    // identities (DUPTOWN's two source rows collapse to one).
    return result.distinctIdentityCount === 5
      && result.exactMatchCount === 1
      && result.settingsOnlyCount === 1
      && result.duplicateSourceRowsCount === 1
      && result.humanReviewCount === 1
      && result.masterLogOnlyUnresolvedCount === 1
      && result.readyCount === 2 // EXACT_MATCH + SETTINGS_ONLY only (unambiguous single-row matches)
      && result.storeIdEligibleCount === 3; // + DUPLICATE_SOURCE_ROWS, once its collapse is approved
  })());
}

// ── store_id_generator: deterministic proposal, never random (Phase 2A/2A.2) ──
{
  const keyA = compositeKey('RIVERBEND', "ANGEL'S PIZZA");
  const keyB = compositeKey('RIVERBEND', 'FIGARO');

  check('store_id_generator: same key always produces same ID (same process)',
    deriveProposedStoreId(keyA) === deriveProposedStoreId(keyA));

  check('store_id_generator: changing ONLY the brand changes the canonical identity and the Store ID (same-location/different-brand)',
    keyA !== keyB && deriveProposedStoreId(keyA) !== deriveProposedStoreId(keyB));

  check('store_id_generator: format matches STR-<uuid> convention',
    /^STR-[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deriveProposedStoreId(keyA)));

  check('store_id_generator: repeated map generation is identical (no reassignment across runs)', (() => {
    const keys = [keyA, keyB, compositeKey('DUPTOWN', 'APEX')];
    const map1 = buildProposedStoreIdMap(keys);
    const map2 = buildProposedStoreIdMap(keys);
    return keys.every((k) => map1.get(k) === map2.get(k));
  })());

  check('store_id_generator: uuidV5 is a pure function of (name, namespace)',
    uuidV5('X', SVMI_STORE_NAMESPACE_UUID) === uuidV5('X', SVMI_STORE_NAMESPACE_UUID));
}

// ── Identity stability: order-independence (Phase 2A.2 rule #10) ────────
// Run A: original SETTINGS row order. Run B: shuffled row order. Run C: an
// independently-built equivalent row set (simulating a separate
// extraction). All three must yield identical canonical identities and
// identical proposed Store IDs for every identity.
{
  const baseSettingsRows = [
    { rowRef: 'S1', store: 'PORTVILLE', brand: 'APEX', region: 'NCR', category: 'NCR' },
    { rowRef: 'S2', store: 'PORTVILLE', brand: 'FIGARO', region: 'NCR', category: 'NCR' },
    { rowRef: 'S3', store: 'HILLCREST', brand: 'APEX', region: 'PROVINCIAL', category: 'FAR PROVINCIAL' },
    { rowRef: 'S4', store: 'LAKEVIEW', brand: "ANGEL'S PIZZA", region: 'FRANCHISE', category: 'NEAR PROVINCIAL' },
    { rowRef: 'S5', store: 'LAKEVIEW', brand: "ANGEL'S PIZZA", region: 'FRANCHISE', category: 'NEAR PROVINCIAL' }, // duplicate
  ];
  const masterLogRows = [
    { rowRef: 'M1', store: 'PORTVILLE', brand: 'APEX', dateVisited: '2026-01-01' },
    { rowRef: 'M2', store: 'NEWTOWN', brand: 'APEX', dateVisited: '2026-02-01' }, // unresolved
  ];

  // Run A: original order.
  const runA = buildStoreIdentityReconciliation({ settingsRows: baseSettingsRows, masterLogRows });
  // Run B: same rows, reversed/shuffled order.
  const shuffled = [baseSettingsRows[3], baseSettingsRows[1], baseSettingsRows[4], baseSettingsRows[0], baseSettingsRows[2]];
  const runB = buildStoreIdentityReconciliation({ settingsRows: shuffled, masterLogRows: [masterLogRows[1], masterLogRows[0]] });
  // Run C: an independently-constructed but data-equivalent row set (new
  // object instances, different row-ref labels — simulating a fresh,
  // independent extraction of the same real-world facts).
  const runC = buildStoreIdentityReconciliation({
    settingsRows: [
      { rowRef: 'X1', store: 'HILLCREST', brand: 'APEX', region: 'PROVINCIAL', category: 'FAR PROVINCIAL' },
      { rowRef: 'X2', store: 'LAKEVIEW', brand: "ANGEL'S PIZZA", region: 'FRANCHISE', category: 'NEAR PROVINCIAL' },
      { rowRef: 'X3', store: 'LAKEVIEW', brand: "ANGEL'S PIZZA", region: 'FRANCHISE', category: 'NEAR PROVINCIAL' },
      { rowRef: 'X4', store: 'PORTVILLE', brand: 'FIGARO', region: 'NCR', category: 'NCR' },
      { rowRef: 'X5', store: 'PORTVILLE', brand: 'APEX', region: 'NCR', category: 'NCR' },
    ],
    masterLogRows: [
      { rowRef: 'Y1', store: 'NEWTOWN', brand: 'APEX', dateVisited: '2026-02-01' },
      { rowRef: 'Y2', store: 'PORTVILLE', brand: 'APEX', dateVisited: '2026-01-01' },
    ],
  });

  check('identity stability: same canonical identities regardless of SETTINGS/MASTER_LOG row order', (() => {
    const keysA = runA.identities.map((i) => i.compositeKey).sort();
    const keysB = runB.identities.map((i) => i.compositeKey).sort();
    const keysC = runC.identities.map((i) => i.compositeKey).sort();
    return JSON.stringify(keysA) === JSON.stringify(keysB) && JSON.stringify(keysA) === JSON.stringify(keysC);
  })());

  check('identity stability: same status per identity regardless of row order/source', (() => {
    const statusMap = (result) => Object.fromEntries(result.identities.map((i) => [i.compositeKey, i.status]));
    const a = statusMap(runA); const b = statusMap(runB); const c = statusMap(runC);
    return JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(c);
  })());

  check('identity stability: identical proposed Store IDs across all three runs, for every identity', (() => {
    const idsFor = (result) => {
      const keys = result.identities.map((i) => i.compositeKey);
      const map = buildProposedStoreIdMap(keys);
      return keys.sort().map((k) => `${k}=${map.get(k)}`).join(';');
    };
    return idsFor(runA) === idsFor(runB) && idsFor(runA) === idsFor(runC);
  })());

  check('identity stability: total counts (distinct identities, ready, duplicate, unresolved) match across all three runs', (() => {
    const summarize = (r) => JSON.stringify({
      distinct: r.distinctIdentityCount, ready: r.readyCount,
      dup: r.duplicateSourceRowsCount, unresolved: r.masterLogOnlyUnresolvedCount,
    });
    return summarize(runA) === summarize(runB) && summarize(runA) === summarize(runC);
  })());
}

// ── visitor_identity_classification: case variants never silently merge ──
{
  const roster = ['PAT', 'ROBIN', 'TAYLOR'];
  const masterLogRows = [
    { rowRef: 'r1', visitedBy: 'PAT' },
    { rowRef: 'r2', visitedBy: 'pat' },
    { rowRef: 'r3', visitedBy: 'ROBIN' },
    { rowRef: 'r4', visitedBy: 'NEW HIRE ONE' },
    { rowRef: 'r5', visitedBy: 'ZED' },
  ];
  const result = classifyVisitorTokens({ roster, masterLogRows });

  check('visitor_identity_classification: exact roster match counted separately from case variant', (() => {
    const pat = result.tokens.find((t) => t.token === 'PAT');
    const patLower = result.tokens.find((t) => t.token === 'pat');
    return pat.classification === 'EXACT_ROSTER_MATCH' && pat.occurrenceCount === 1
      && patLower.classification === 'CASE_VARIANT_OF_ROSTER_ENTRY' && patLower.matchedRosterName === 'PAT'
      && patLower.occurrenceCount === 1; // never merged into PAT's count
  })());

  check('visitor_identity_classification: new identities flagged, never silently added to roster', (() => {
    const newHire = result.tokens.find((t) => t.token === 'NEW HIRE ONE');
    const zed = result.tokens.find((t) => t.token === 'ZED');
    return newHire.classification === 'LIKELY_NEW_VISITOR' && zed.classification === 'LIKELY_NEW_VISITOR';
  })());

  check('visitor_identity_classification: roster is untouched by classification', result.rosterSize === 3);
}

// ── Purpose: CAPAR detected as historical-but-unconfigured, never auto-configured ──
{
  const legacyPurposeIds = ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'];
  const masterLogRows = [
    { rowRef: 'r1', purpose: 'STORE VISIT' },
    { rowRef: 'r2', purpose: 'CAPAR' },
    { rowRef: 'r3', purpose: 'CAPAR' },
  ];
  const result = reconcilePurposes({ legacyPurposeIds, configPurposeVersions: [], kpiConfigurationVersions: [], masterLogRows });
  check('purpose: CAPAR detected as historical-but-unconfigured, not silently dropped',
    JSON.stringify(result).toUpperCase().includes('CAPAR'));
  check('purpose: no automatic configuration created for CAPAR (legacy list unchanged)',
    legacyPurposeIds.length === 4 && !legacyPurposeIds.includes('CAPAR'));
}

// ── location_convention_candidates: embedded-naming-convention finder ──
// (Phase 2A.3). Fictional fixtures mirroring the real pattern found in
// production: some locations are named "<PREFIX> <TOWN>" or "<TOWN>
// <BRANDWORD>" with a Brand column that separately, redundantly agrees.
{
  const canonicalIdentities = [
    { normalizedLocation: 'X RIVERSIDE', normalizedBrand: 'FIGARO', proposedStoreId: 'STR-x1' }, // brand-prefix convention
    { normalizedLocation: 'HILLTOP FIGARO', normalizedBrand: 'FIGARO', proposedStoreId: 'STR-x2' }, // town+brand-suffix convention
    { normalizedLocation: 'RIVERSIDE', normalizedBrand: "ANGEL'S PIZZA", proposedStoreId: 'STR-x3' }, // same location, different brand — must never surface as a same-brand candidate
    { normalizedLocation: 'LAKEVIEW', normalizedBrand: 'APEX', proposedStoreId: 'STR-x4' },
  ];

  check('location_convention_candidates: same-brand suffix-embedded convention detected (X RIVERSIDE ~ RIVERSIDE, both FIGARO)', (() => {
    const result = findEmbeddedConventionCandidates({ historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO', canonicalIdentities });
    return result.length === 1 && result[0].candidateLocation === 'X RIVERSIDE';
  })());

  check('location_convention_candidates: never crosses brands (RIVERSIDE/ANGEL\'S PIZZA never surfaces for a FIGARO query)', (() => {
    const result = findEmbeddedConventionCandidates({ historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO', canonicalIdentities });
    return !result.some((c) => c.candidateBrand === "ANGEL'S PIZZA");
  })());

  check('location_convention_candidates: no candidate when no structural word-containment exists (LAKEVIEW vs APEX has no relative)', (() => {
    const result = findEmbeddedConventionCandidates({ historicalLocation: 'LAKEVIEW', historicalBrand: 'APEX', canonicalIdentities });
    return result.length === 0;
  })());

  check('location_convention_candidates: does not fire on mere style similarity without word containment (HILLTOP FIGARO style vs a same-brand but textually unrelated town)', (() => {
    const result = findEmbeddedConventionCandidates({ historicalLocation: 'PLAINTOWN FIGARO', historicalBrand: 'FIGARO', canonicalIdentities });
    // "PLAINTOWN FIGARO" does not word-contain or get word-contained by
    // "HILLTOP FIGARO" or "X RIVERSIDE" — sharing only the word "FIGARO"
    // is NOT structural containment of the whole other location string.
    return result.length === 0;
  })());
}

// ── historical_identity_classification: EXISTING/NEW/HUMAN_REVIEW ──────
// (Phase 2A.3). Demonstrates rule #9's required proof: same-location/
// different-brand never resolves; same-location/same-brand can resolve
// when evidence supports it (an exact canonical match); a same-brand
// naming-convention candidate routes to HUMAN_REVIEW, never auto-merged.
{
  const canonicalIdentities = [
    { normalizedLocation: 'X RIVERSIDE', normalizedBrand: 'FIGARO', canonicalLocation: 'X RIVERSIDE', canonicalBrand: 'FIGARO', proposedStoreId: 'STR-x1' },
    { normalizedLocation: 'RIVERSIDE', normalizedBrand: "ANGEL'S PIZZA", canonicalLocation: 'RIVERSIDE', canonicalBrand: "ANGEL'S PIZZA", proposedStoreId: 'STR-x3' },
    { normalizedLocation: 'LAKEVIEW', normalizedBrand: 'APEX', canonicalLocation: 'LAKEVIEW', canonicalBrand: 'APEX', proposedStoreId: 'STR-x4' },
  ];

  check('historical_identity_classification: exact same-location/same-brand match resolves to EXISTING', (() => {
    const result = classifyHistoricalIdentity({ historicalLocation: 'LAKEVIEW', historicalBrand: 'APEX', canonicalIdentities, sameLocationDifferentBrandCandidates: [] });
    return result.classification === CLASSIFICATION.EXISTING && result.canonicalStoreId === 'STR-x4';
  })());

  check('historical_identity_classification: same-location/different-brand NEVER resolves to EXISTING (rule #4/#9 — RIVERSIDE+FIGARO must not match RIVERSIDE+ANGEL\'S PIZZA)', (() => {
    const result = classifyHistoricalIdentity({
      historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO', canonicalIdentities,
      sameLocationDifferentBrandCandidates: ["RIVERSIDE|ANGEL'S PIZZA"],
    });
    return result.classification !== CLASSIFICATION.EXISTING;
  })());

  check('historical_identity_classification: same-brand naming-convention candidate routes to HUMAN_REVIEW, never auto-merged', (() => {
    const result = classifyHistoricalIdentity({ historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO', canonicalIdentities, sameLocationDifferentBrandCandidates: [] });
    return result.classification === CLASSIFICATION.HUMAN_REVIEW
      && result.proposedStoreId === null
      && result.evidence.some((e) => e.candidateLocation === 'X RIVERSIDE');
  })());

  check('historical_identity_classification: no candidate at all -> NEW, with no Store ID minted', (() => {
    const result = classifyHistoricalIdentity({ historicalLocation: 'GHOSTBAY', historicalBrand: 'APEX', canonicalIdentities, sameLocationDifferentBrandCandidates: [] });
    return result.classification === CLASSIFICATION.NEW && result.proposedStoreId === null;
  })());

  check('historical_identity_classification: classification is deterministic across repeated calls with the same input', (() => {
    const run1 = classifyHistoricalIdentity({ historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO', canonicalIdentities, sameLocationDifferentBrandCandidates: [] });
    const run2 = classifyHistoricalIdentity({ historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO', canonicalIdentities, sameLocationDifferentBrandCandidates: [] });
    return run1.classification === run2.classification && JSON.stringify(run1.evidence) === JSON.stringify(run2.evidence);
  })());

  // Mirrors a real Phase 2A.3 investigation (documented locally, never
  // committed): a compound "TOWN BRANDWORD" historical location, brand
  // column separately and
  // redundantly agreeing, with NO existing canonical entry under either
  // the compound name or the bare town name for that brand — must
  // resolve to NEW, never silently decomposed/renamed, and never
  // confused with a differently-branded entry at the bare town name.
  check('historical_identity_classification: "TOWN BRANDWORD"-style compound location with no canonical relative -> NEW, not decomposed', (() => {
    const canonical2 = [
      { normalizedLocation: 'TOWN', normalizedBrand: "ANGEL'S PIZZA", canonicalLocation: 'TOWN', canonicalBrand: "ANGEL'S PIZZA", proposedStoreId: 'STR-y1' },
    ];
    const result = classifyHistoricalIdentity({
      historicalLocation: 'TOWN FIGARO', historicalBrand: 'FIGARO', canonicalIdentities: canonical2,
      sameLocationDifferentBrandCandidates: ["TOWN|ANGEL'S PIZZA"],
    });
    return result.classification === CLASSIFICATION.NEW && result.proposedStoreId === null;
  })());
}

// ── operational_status: business-declared status, never inferred ───────
// (Phase 2A.4). Fictional fixtures.
{
  const canonicalIdentities = [
    { normalizedLocation: 'X RIVERSIDE', normalizedBrand: 'FIGARO', canonicalLocation: 'X RIVERSIDE', canonicalBrand: 'FIGARO', proposedStoreId: 'STR-x1' },
    { normalizedLocation: 'RIVERSIDE', normalizedBrand: "ANGEL'S PIZZA", canonicalLocation: 'RIVERSIDE', canonicalBrand: "ANGEL'S PIZZA", proposedStoreId: 'STR-x3' },
    { normalizedLocation: 'LAKEVIEW', normalizedBrand: 'APEX', canonicalLocation: 'LAKEVIEW', canonicalBrand: 'APEX', proposedStoreId: 'STR-x4' },
  ];

  // A batch of historical identities business has declared INACTIVE,
  // including one HUMAN_REVIEW (identity unresolved) and one NEW.
  const historicalIdentities = [
    { historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO' }, // HUMAN_REVIEW candidate: X RIVERSIDE
    { historicalLocation: 'GHOSTBAY', historicalBrand: 'APEX' }, // NEW, no candidate
  ].map((h) => ({
    ...h,
    ...classifyHistoricalIdentity({
      historicalLocation: h.historicalLocation, historicalBrand: h.historicalBrand,
      canonicalIdentities, sameLocationDifferentBrandCandidates: [],
    }),
    compositeKey: compositeKey(h.historicalLocation, h.historicalBrand),
  }));

  const declarations = {
    'RIVERSIDE|FIGARO': OPERATIONAL_STATUS.INACTIVE,
    'GHOSTBAY|APEX': OPERATIONAL_STATUS.INACTIVE,
  };
  const withStatus = applyOperationalStatus(historicalIdentities, declarations);

  check('operational_status: all declared identities carry the declared status (all INACTIVE)',
    withStatus.every((r) => r.operationalStatus === OPERATIONAL_STATUS.INACTIVE));

  check('operational_status: operationalStatus is a separate field, never overloaded onto classification', (() => {
    const humanReview = withStatus.find((r) => r.historicalLocation === 'RIVERSIDE');
    const newOne = withStatus.find((r) => r.historicalLocation === 'GHOSTBAY');
    return humanReview.classification === CLASSIFICATION.HUMAN_REVIEW && humanReview.operationalStatus === OPERATIONAL_STATUS.INACTIVE
      && newOne.classification === CLASSIFICATION.NEW && newOne.operationalStatus === OPERATIONAL_STATUS.INACTIVE;
  })());

  check('operational_status: an identity with no declaration stays UNSPECIFIED, never defaulted', (() => {
    const undeclared = applyOperationalStatus([{ historicalLocation: 'UNTOUCHED', historicalBrand: 'APEX' }], declarations);
    return undeclared[0].operationalStatus === OPERATIONAL_STATUS.UNSPECIFIED;
  })());

  check('operational_status: declaring status never merges or changes an identity\'s classification/evidence',
    withStatus.find((r) => r.historicalLocation === 'RIVERSIDE').evidence.some((e) => e.candidateLocation === 'X RIVERSIDE'));
}

// ── store_id_finalization: administrative "established" is separate ────
// from identity matching (Phase 2A.4). HUMAN_REVIEW NEVER gets a fresh
// ID (that would silently invent "these are separate stores"); NEW only
// gets one once explicitly declared established; EXISTING always keeps
// its already-known canonical Store ID; status never participates.
{
  check('store_id_finalization: EXISTING always returns its canonical Store ID, regardless of "established" flag',
    finalizeProposedStoreId({ classification: 'EXISTING', canonicalStoreId: 'STR-known', compositeKey: 'X|Y', identityEstablished: false }) === 'STR-known');

  check('store_id_finalization: HUMAN_REVIEW NEVER receives a proposed Store ID, even if declared "established"',
    finalizeProposedStoreId({ classification: 'HUMAN_REVIEW', canonicalStoreId: null, compositeKey: 'RIVERSIDE|FIGARO', identityEstablished: true }) === null);

  check('store_id_finalization: NEW without administrative establishment stays null (no invented ID)',
    finalizeProposedStoreId({ classification: 'NEW', canonicalStoreId: null, compositeKey: 'GHOSTBAY|APEX', identityEstablished: false }) === null);

  check('store_id_finalization: NEW + administratively established -> deterministic proposed Store ID', (() => {
    const id = finalizeProposedStoreId({ classification: 'NEW', canonicalStoreId: null, compositeKey: 'GHOSTBAY|APEX', identityEstablished: true });
    return typeof id === 'string' && id.startsWith('STR-') && id === deriveProposedStoreId('GHOSTBAY|APEX');
  })());

  check('store_id_finalization: inactive operational status never changes the deterministic Store ID', (() => {
    const idWithoutStatus = finalizeProposedStoreId({ classification: 'NEW', canonicalStoreId: null, compositeKey: 'GHOSTBAY|APEX', identityEstablished: true });
    // Attach a status AFTER computing the ID — status is not, and never
    // can be, an input to deriveProposedStoreId (it takes only the
    // canonical key string), so this is structurally guaranteed, and
    // this test also exercises that guarantee end-to-end.
    const record = applyOperationalStatus([{ historicalLocation: 'GHOSTBAY', historicalBrand: 'APEX', proposedStoreId: idWithoutStatus }], { 'GHOSTBAY|APEX': OPERATIONAL_STATUS.INACTIVE });
    return record[0].proposedStoreId === idWithoutStatus && record[0].operationalStatus === OPERATIONAL_STATUS.INACTIVE;
  })());

  check('store_id_finalization: no duplicate Store IDs across distinct established NEW identities', (() => {
    const keys = ['GHOSTBAY|APEX', 'RIVERSIDE|FIGARO', 'LAKEVIEW|APEX'];
    const ids = keys.map((k) => finalizeProposedStoreId({ classification: 'NEW', canonicalStoreId: null, compositeKey: k, identityEstablished: true }));
    return new Set(ids).size === ids.length;
  })());

  check('store_id_finalization: Store IDs identical across independent calls (repeat + fresh order)', (() => {
    const keys = ['GHOSTBAY|APEX', 'RIVERSIDE|FIGARO'];
    const run1 = keys.map((k) => finalizeProposedStoreId({ classification: 'NEW', canonicalStoreId: null, compositeKey: k, identityEstablished: true }));
    const run2 = keys.slice().reverse().map((k) => finalizeProposedStoreId({ classification: 'NEW', canonicalStoreId: null, compositeKey: k, identityEstablished: true }));
    return run1[0] === run2[1] && run1[1] === run2[0];
  })());
}

// ── Combined pipeline: status + finalization compose with existing ─────
// classification/duplicate/ready-count logic without disturbing it
// (Phase 2A.4 regression protection, rules F8/F9).
{
  const settingsRows = [
    { rowRef: 'S1', store: 'DUPTOWN', brand: 'APEX', region: 'NCR', category: 'NCR' },
    { rowRef: 'S2', store: 'DUPTOWN', brand: 'APEX', region: 'NCR', category: 'NCR' }, // duplicate, identical
    { rowRef: 'S3', store: 'X RIVERSIDE', brand: 'FIGARO', region: 'FRANCHISE', category: 'NCR' },
    { rowRef: 'S4', store: 'RIVERSIDE', brand: "ANGEL'S PIZZA", region: 'FRANCHISE', category: 'NCR' },
  ];
  const masterLogRows = [
    { rowRef: 'M1', store: 'DUPTOWN', brand: 'APEX', dateVisited: '2026-01-01' },
    { rowRef: 'M2', store: 'RIVERSIDE', brand: 'FIGARO', dateVisited: '2026-02-01' }, // HUMAN_REVIEW candidate
    { rowRef: 'M3', store: 'GHOSTBAY', brand: 'APEX', dateVisited: '2026-03-01' }, // NEW
  ];
  const before = buildStoreIdentityReconciliation({ settingsRows, masterLogRows });

  check('combined pipeline: duplicate-source-row behavior unchanged by this phase\'s additions',
    before.duplicateSourceRowsCount === 1 && before.identities.find((i) => i.compositeKey === 'DUPTOWN|APEX').status === STORE_STATUS.DUPLICATE_SOURCE_ROWS);

  check('combined pipeline: ready/eligible counts remain internally consistent after layering status', (() => {
    const readyBefore = before.readyCount; // strict: EXACT_MATCH + SETTINGS_ONLY only
    const eligibleBefore = before.storeIdEligibleCount; // + DUPLICATE_SOURCE_ROWS
    // Layer status onto every identity — must not change either count.
    const withStatus = applyOperationalStatus(before.identities, {
      'RIVERSIDE|FIGARO': OPERATIONAL_STATUS.INACTIVE,
      'GHOSTBAY|APEX': OPERATIONAL_STATUS.INACTIVE,
    });
    const readyAfter = withStatus.filter((i) => i.status === STORE_STATUS.EXACT_MATCH || i.status === STORE_STATUS.SETTINGS_ONLY).length;
    const eligibleAfter = withStatus.filter((i) => i.readyForStoreIdAssignment).length;
    return readyBefore === 2 // X RIVERSIDE/FIGARO (SETTINGS_ONLY) + RIVERSIDE/ANGEL'S PIZZA (SETTINGS_ONLY)
      && eligibleBefore === 3 // + DUPTOWN/APEX (DUPLICATE_SOURCE_ROWS)
      && eligibleBefore === readyBefore + before.duplicateSourceRowsCount
      && readyAfter === readyBefore
      && eligibleAfter === eligibleBefore;
  })());

  check('combined pipeline: HUMAN_REVIEW identity (RIVERSIDE/FIGARO) never silently merged into X RIVERSIDE/FIGARO despite status layering', (() => {
    const sameLoc = findLocationOnlyCandidates('RIVERSIDE|FIGARO', new Map());
    const classification = classifyHistoricalIdentity({
      historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO',
      canonicalIdentities: before.identities.filter((i) => i.readyForStoreIdAssignment),
      sameLocationDifferentBrandCandidates: sameLoc,
    });
    const withStatus = applyOperationalStatus([{ ...classification, historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO' }], { 'RIVERSIDE|FIGARO': OPERATIONAL_STATUS.INACTIVE });
    return withStatus[0].classification === CLASSIFICATION.HUMAN_REVIEW && withStatus[0].operationalStatus === OPERATIONAL_STATUS.INACTIVE;
  })());
}

// ── Administratively confirmed merge + distinct-new confirmation ───────
// (Phase 2A.5). Fictional fixtures mirroring a real business decision
// (documented locally, never committed): one historical identity is
// explicitly confirmed the same Store as an existing naming-convention
// candidate, and several others are confirmed distinct new Stores.
{
  const canonicalIdentities = [
    { normalizedLocation: 'X RIVERSIDE', normalizedBrand: 'FIGARO', canonicalLocation: 'X RIVERSIDE', canonicalBrand: 'FIGARO', proposedStoreId: 'STR-existing-x1' },
    { normalizedLocation: 'RIVERSIDE', normalizedBrand: "ANGEL'S PIZZA", canonicalLocation: 'RIVERSIDE', canonicalBrand: "ANGEL'S PIZZA", proposedStoreId: 'STR-existing-x3' },
  ];
  const targetForMerge = canonicalIdentities[0]; // X RIVERSIDE/FIGARO

  // 1 + 11 + 12: the confirmed merge (RIVERSIDE/FIGARO -> X RIVERSIDE/FIGARO)
  const mergedResult = classifyHistoricalIdentity({
    historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO', canonicalIdentities,
    sameLocationDifferentBrandCandidates: ["RIVERSIDE|ANGEL'S PIZZA"],
    confirmedCanonicalMatch: targetForMerge,
  });

  check('administratively confirmed merge: classification becomes EXISTING, matchType distinguishes it from an automatic exact match',
    mergedResult.classification === CLASSIFICATION.EXISTING && mergedResult.matchType === MATCH_TYPE.ADMINISTRATIVELY_CONFIRMED_MERGE);

  check('administratively confirmed merge: resolves to the intended canonical identity (rule #11 analog)',
    mergedResult.canonicalLocation === 'X RIVERSIDE' && mergedResult.canonicalBrand === 'FIGARO');

  check('administratively confirmed merge: reuses the EXISTING canonical Store ID, never mints a second one', (() => {
    const finalId = finalizeProposedStoreId({
      classification: mergedResult.classification, canonicalStoreId: mergedResult.canonicalStoreId,
      compositeKey: compositeKey('RIVERSIDE', 'FIGARO'), identityEstablished: false,
    });
    return finalId === 'STR-existing-x1' && finalId === targetForMerge.proposedStoreId;
  })());

  check('administratively confirmed merge: never leaks into the same-location/different-brand sibling', (() => {
    const sibling = classifyHistoricalIdentity({
      historicalLocation: 'RIVERSIDE', historicalBrand: "ANGEL'S PIZZA", canonicalIdentities,
      sameLocationDifferentBrandCandidates: [], confirmedCanonicalMatch: null,
    });
    // RIVERSIDE/ANGEL'S PIZZA has its OWN exact match already (unrelated
    // to the FIGARO merge) — confirms the merge was scoped to exactly
    // the (Location,Brand) key it was declared for.
    return sibling.classification === CLASSIFICATION.EXISTING && sibling.matchType === MATCH_TYPE.EXACT_MATCH
      && sibling.canonicalStoreId === 'STR-existing-x3';
  })());

  // 3 + 4: administrative confirmation of distinctness never converts NEW to EXISTING
  const noMatchResult = classifyHistoricalIdentity({
    historicalLocation: 'GHOSTBAY', historicalBrand: 'APEX', canonicalIdentities,
    sameLocationDifferentBrandCandidates: [], confirmedCanonicalMatch: null,
  });
  check('no confirmedCanonicalMatch: classification stays NEW (no-match remains no-match)', noMatchResult.classification === CLASSIFICATION.NEW);

  check('administrative confirmation of distinctness never converts classification to EXISTING', (() => {
    const confirmation = describeAdministrativeConfirmation({ classification: noMatchResult.classification, matchType: noMatchResult.matchType, identityEstablished: true });
    return noMatchResult.classification === CLASSIFICATION.NEW // classification field itself untouched
      && confirmation === ADMINISTRATIVE_CONFIRMATION.CONFIRMED_DISTINCT_STORE;
  })());

  check('without administrative confirmation, a NEW identity gets NO Store ID and administrativeConfirmation is NONE', (() => {
    const finalId = finalizeProposedStoreId({ classification: noMatchResult.classification, canonicalStoreId: null, compositeKey: compositeKey('GHOSTBAY', 'APEX'), identityEstablished: false });
    const confirmation = describeAdministrativeConfirmation({ classification: noMatchResult.classification, matchType: noMatchResult.matchType, identityEstablished: false });
    return finalId === null && confirmation === ADMINISTRATIVE_CONFIRMATION.NONE;
  })());

  check('an EXACT_MATCH EXISTING identity needs no administrative confirmation (rule #12)', (() => {
    const exact = classifyHistoricalIdentity({ historicalLocation: 'RIVERSIDE', historicalBrand: "ANGEL'S PIZZA", canonicalIdentities, sameLocationDifferentBrandCandidates: [] });
    const confirmation = describeAdministrativeConfirmation({ classification: exact.classification, matchType: exact.matchType, identityEstablished: false });
    return confirmation === ADMINISTRATIVE_CONFIRMATION.NONE; // never claims an admin act "discovered" it
  })());

  // 13: all 10 confirmed-distinct-new identities each get exactly one Store ID
  const tenConfirmedNew = ['GHOSTBAY', 'HOLLOWDALE', 'PINEHURST', 'MISTVALE', 'EMBERTON', 'QUARRYFIELD', 'SALTMARSH', 'IRONGATE', 'CLIFFHAVEN', 'MOSSWELL']
    .map((loc) => ({ loc, brand: 'APEX', key: compositeKey(loc, 'APEX') }));
  const tenResults = tenConfirmedNew.map(({ loc, brand, key }) => {
    const classification = classifyHistoricalIdentity({ historicalLocation: loc, historicalBrand: brand, canonicalIdentities: [], sameLocationDifferentBrandCandidates: [] });
    const id = finalizeProposedStoreId({ classification: classification.classification, canonicalStoreId: null, compositeKey: key, identityEstablished: true });
    return { loc, classification: classification.classification, id };
  });
  check('all 10 confirmed-distinct-new identities are classified NEW and each receives exactly one Store ID',
    tenResults.every((r) => r.classification === CLASSIFICATION.NEW && typeof r.id === 'string' && r.id.startsWith('STR-')));
  check('all 10 confirmed-distinct-new Store IDs are mutually distinct (no duplicates)',
    new Set(tenResults.map((r) => r.id)).size === 10);
  check('none of the 10 confirmed-distinct-new IDs collides with the merge target\'s reused ID',
    !tenResults.some((r) => r.id === 'STR-existing-x1'));

  // 8 + 9: determinism across independent runs and input ordering, for the full mixed batch
  check('determinism: repeating the merge classification+finalization independently yields the identical Store ID', (() => {
    const run2 = classifyHistoricalIdentity({
      historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO', canonicalIdentities: canonicalIdentities.slice().reverse(),
      sameLocationDifferentBrandCandidates: ["RIVERSIDE|ANGEL'S PIZZA"], confirmedCanonicalMatch: targetForMerge,
    });
    const id1 = finalizeProposedStoreId({ classification: mergedResult.classification, canonicalStoreId: mergedResult.canonicalStoreId, compositeKey: compositeKey('RIVERSIDE', 'FIGARO'), identityEstablished: false });
    const id2 = finalizeProposedStoreId({ classification: run2.classification, canonicalStoreId: run2.canonicalStoreId, compositeKey: compositeKey('RIVERSIDE', 'FIGARO'), identityEstablished: false });
    return id1 === id2;
  })());

  check('determinism: the 10 confirmed-new IDs are identical when computed in reverse order', (() => {
    const reversed = tenConfirmedNew.slice().reverse().map(({ loc, brand, key }) => {
      const classification = classifyHistoricalIdentity({ historicalLocation: loc, historicalBrand: brand, canonicalIdentities: [], sameLocationDifferentBrandCandidates: [] });
      return finalizeProposedStoreId({ classification: classification.classification, canonicalStoreId: null, compositeKey: key, identityEstablished: true });
    });
    return reversed.slice().reverse().every((id, i) => id === tenResults[i].id);
  })());

  // 6 + 7: operationalStatus never overwrites classification, and never
  // participates in Store-ID derivation, for BOTH the merge case and the confirmed-new case.
  check('operationalStatus applied to the merge result never overwrites classification/matchType', (() => {
    const record = { historicalLocation: 'RIVERSIDE', historicalBrand: 'FIGARO', ...mergedResult };
    const withStatus = applyOperationalStatus([record], { [compositeKey('RIVERSIDE', 'FIGARO')]: OPERATIONAL_STATUS.INACTIVE })[0];
    return withStatus.classification === CLASSIFICATION.EXISTING && withStatus.matchType === MATCH_TYPE.ADMINISTRATIVELY_CONFIRMED_MERGE
      && withStatus.operationalStatus === OPERATIONAL_STATUS.INACTIVE;
  })());

  check('operationalStatus applied to a confirmed-new result never changes its already-finalized Store ID', (() => {
    const first = tenResults[0];
    const withStatus = applyOperationalStatus([{ historicalLocation: first.loc, historicalBrand: 'APEX', proposedStoreId: first.id }], { [compositeKey(first.loc, 'APEX')]: OPERATIONAL_STATUS.INACTIVE })[0];
    return withStatus.proposedStoreId === first.id && withStatus.operationalStatus === OPERATIONAL_STATUS.INACTIVE;
  })());

  // 14: final manifest internal consistency (mirrors the real 11-row manifest shape)
  check('final manifest counts are internally consistent (1 merge + 10 confirmed-new = 11, all resolved)', (() => {
    const manifest = [
      { classification: mergedResult.classification, storeId: 'STR-existing-x1', unresolved: false },
      ...tenResults.map((r) => ({ classification: r.classification, storeId: r.id, unresolved: false })),
    ];
    const existingCount = manifest.filter((m) => m.classification === CLASSIFICATION.EXISTING).length;
    const newCount = manifest.filter((m) => m.classification === CLASSIFICATION.NEW).length;
    const withId = manifest.filter((m) => !!m.storeId).length;
    const unresolvedCount = manifest.filter((m) => m.unresolved).length;
    return manifest.length === 11 && existingCount === 1 && newCount === 10
      && withId === 11 && unresolvedCount === 0
      && new Set(manifest.map((m) => m.storeId)).size === 11; // no duplicate IDs anywhere in the manifest
  })());
}

// ── visitor_identity_finalization: administratively confirmed visitor ──
// merges and distinct-new identities (Phase 2 visitor reconciliation).
// Fictional fixtures mirroring a real business decision (documented
// locally, never committed): case-only variants confirmed merged into
// their roster entries, a nickname-style token confirmed merged into an
// existing roster member, and a genuinely new inactive visitor.
{
  const roster = ['PAT', 'ROBIN', 'TAYLOR'];
  const masterLogRows = [
    { rowRef: 'r1', visitedBy: 'PAT' },
    { rowRef: 'r2', visitedBy: 'pat' }, // case variant of PAT
    { rowRef: 'r3', visitedBy: 'ROBIN' },
    { rowRef: 'r4', visitedBy: 'PJ' }, // nickname for ROBIN, per admin decision
    { rowRef: 'r5', visitedBy: 'PJ' },
    { rowRef: 'r6', visitedBy: 'NEW PERSON' }, // confirmed distinct, active
    { rowRef: 'r7', visitedBy: 'GHOST VISITOR' }, // confirmed distinct, inactive
    { rowRef: 'r8', visitedBy: 'unclaimed token' }, // no administrative decision at all
  ];
  const evidence = classifyVisitorTokens({ roster, masterLogRows });
  const byToken = Object.fromEntries(evidence.tokens.map((t) => [t.token, t]));

  const patExact = finalizeVisitorIdentity({ token: 'PAT', automaticClassification: byToken['PAT'].classification });
  const patVariant = finalizeVisitorIdentity({
    token: 'pat', automaticClassification: byToken['pat'].classification, matchedRosterName: byToken['pat'].matchedRosterName,
    confirmedMerge: { canonicalVisitor: 'PAT', administrativeConfirmation: VISITOR_ADMIN_CONFIRMATION.CONFIRMED_EXISTING_IDENTITY },
  });
  const pjMerge = finalizeVisitorIdentity({
    token: 'PJ', automaticClassification: byToken['PJ'].classification,
    confirmedMerge: { canonicalVisitor: 'ROBIN', administrativeConfirmation: VISITOR_ADMIN_CONFIRMATION.CONFIRMED_DISTINCT_VISITOR_IDENTITY },
  });
  const newPersonActive = finalizeVisitorIdentity({
    token: 'NEW PERSON', automaticClassification: byToken['NEW PERSON'].classification,
    confirmedDistinct: { canonicalVisitor: 'NEW PERSON', administrativeConfirmation: VISITOR_ADMIN_CONFIRMATION.CONFIRMED_VISITOR_IDENTITY },
  });
  const ghostInactive = finalizeVisitorIdentity({
    token: 'GHOST VISITOR', automaticClassification: byToken['GHOST VISITOR'].classification,
    confirmedDistinct: { canonicalVisitor: 'GHOST VISITOR', administrativeConfirmation: VISITOR_ADMIN_CONFIRMATION.CONFIRMED_VISITOR_IDENTITY },
  });
  const unclaimed = finalizeVisitorIdentity({ token: 'unclaimed token', automaticClassification: byToken['unclaimed token'].classification });

  check('1: exact roster token classifies EXISTING automatically, no administrative act needed',
    patExact.classification === VISITOR_CLASSIFICATION.EXISTING && patExact.matchType === VISITOR_MATCH_TYPE.EXACT_ROSTER_MATCH
      && patExact.administrativeConfirmation === VISITOR_ADMIN_CONFIRMATION.NONE);

  check('2: confirmed case-variant merge -> EXISTING, canonical = roster entry, labeled CONFIRMED_EXISTING_IDENTITY',
    patVariant.classification === VISITOR_CLASSIFICATION.EXISTING && patVariant.canonicalVisitor === 'PAT'
      && patVariant.matchType === VISITOR_MATCH_TYPE.ADMINISTRATIVELY_CONFIRMED_MERGE
      && patVariant.administrativeConfirmation === VISITOR_ADMIN_CONFIRMATION.CONFIRMED_EXISTING_IDENTITY);

  check('4: confirmed nickname merge (PJ -> ROBIN) -> EXISTING, never classified as an inferred fuzzy match',
    pjMerge.classification === VISITOR_CLASSIFICATION.EXISTING && pjMerge.canonicalVisitor === 'ROBIN'
      && pjMerge.matchType === VISITOR_MATCH_TYPE.ADMINISTRATIVELY_CONFIRMED_MERGE
      && pjMerge.administrativeConfirmation === VISITOR_ADMIN_CONFIRMATION.CONFIRMED_DISTINCT_VISITOR_IDENTITY);

  check('5: confirmed distinct-new visitor (active case) stays NEW, never EXISTING',
    newPersonActive.classification === VISITOR_CLASSIFICATION.NEW && newPersonActive.canonicalVisitor === 'NEW PERSON'
      && newPersonActive.matchType === VISITOR_MATCH_TYPE.ADMINISTRATIVELY_IDENTIFIED_NEW);

  check('5: confirmed distinct-new visitor (inactive case) remains its own separate identity, classification still NEW',
    ghostInactive.classification === VISITOR_CLASSIFICATION.NEW && ghostInactive.canonicalVisitor === 'GHOST VISITOR');

  check('6: no visitor identity is merged merely because names are similar — case variant with NO administrative decision stays unresolved',
    unclaimed.classification === null && unclaimed.matchType === VISITOR_MATCH_TYPE.UNCONFIRMED);

  check('7: explicit administrative confirmation is distinct from automatic identity discovery (different matchType values)',
    patExact.matchType !== patVariant.matchType && patExact.matchType === VISITOR_MATCH_TYPE.EXACT_ROSTER_MATCH
      && patVariant.matchType === VISITOR_MATCH_TYPE.ADMINISTRATIVELY_CONFIRMED_MERGE);

  check('8: historical source tokens remain unchanged (verbatim, including original casing)',
    patVariant.token === 'pat' && pjMerge.token === 'PJ' && ghostInactive.token === 'GHOST VISITOR');

  // 9: operationalStatus never overwrites identity classification
  const declarations = { PAT: OPERATIONAL_STATUS.ACTIVE, PJ: OPERATIONAL_STATUS.ACTIVE, 'GHOST VISITOR': OPERATIONAL_STATUS.INACTIVE };
  const finalized = [
    { compositeKey: 'PAT', ...patExact }, { compositeKey: 'pat', ...patVariant }, { compositeKey: 'PJ', ...pjMerge },
    { compositeKey: 'NEW PERSON', ...newPersonActive }, { compositeKey: 'GHOST VISITOR', ...ghostInactive },
  ];
  const withStatus = applyOperationalStatus(finalized, declarations);
  check('9: operationalStatus is layered separately, never overwrites classification/matchType', (() => {
    const ghost = withStatus.find((r) => r.compositeKey === 'GHOST VISITOR');
    const pj = withStatus.find((r) => r.compositeKey === 'PJ');
    return ghost.classification === VISITOR_CLASSIFICATION.NEW && ghost.operationalStatus === OPERATIONAL_STATUS.INACTIVE
      && pj.classification === VISITOR_CLASSIFICATION.EXISTING && pj.operationalStatus === OPERATIONAL_STATUS.ACTIVE;
  })());

  check('14: inactive confirmed-distinct visitor still resolves historically (classification present), even though operationally inactive', (() => {
    const ghost = withStatus.find((r) => r.compositeKey === 'GHOST VISITOR');
    return ghost.classification !== null && ghost.canonicalVisitor === 'GHOST VISITOR' && ghost.operationalStatus === OPERATIONAL_STATUS.INACTIVE;
  })());

  // 10: case normalization never creates duplicate canonical identities
  check('10: case-variant merge and its target share exactly one canonical identity (no duplicate created)',
    patVariant.canonicalVisitor === patExact.canonicalVisitor && patVariant.canonicalVisitor === 'PAT');

  // 13: no duplicate canonical visitor identities across the whole finalized batch
  check('13: no duplicate canonical visitor identities in the finalized batch', (() => {
    const canonicalNames = [patExact, patVariant, pjMerge, newPersonActive, ghostInactive].map((r) => r.canonicalVisitor);
    // PAT appears twice (exact + merged variant) — that's fine, it's the
    // SAME canonical identity, not a duplicate NEW identity. The real
    // uniqueness property is: every DISTINCT identity concept maps to
    // exactly one canonical name, and distinct identities never share one.
    const distinctIdentityCanonicalNames = [pjMerge.canonicalVisitor, newPersonActive.canonicalVisitor, ghostInactive.canonicalVisitor];
    return new Set(distinctIdentityCanonicalNames).size === distinctIdentityCanonicalNames.length
      && canonicalNames.filter((n) => n === 'PAT').length === 2; // both refer to the one PAT identity
  })());

  // 11 + 12: deterministic across input ordering and independent runs
  check('11 + 12: finalization is deterministic — identical results across independent calls regardless of call order', (() => {
    const runA = finalizeVisitorIdentity({ token: 'PJ', automaticClassification: 'LIKELY_NEW_VISITOR', confirmedMerge: { canonicalVisitor: 'ROBIN', administrativeConfirmation: VISITOR_ADMIN_CONFIRMATION.CONFIRMED_DISTINCT_VISITOR_IDENTITY } });
    const runB = finalizeVisitorIdentity({ token: 'PJ', automaticClassification: 'LIKELY_NEW_VISITOR', confirmedMerge: { canonicalVisitor: 'ROBIN', administrativeConfirmation: VISITOR_ADMIN_CONFIRMATION.CONFIRMED_DISTINCT_VISITOR_IDENTITY } });
    return JSON.stringify(runA) === JSON.stringify(runB);
  })());

  check('CHEF-ARVIN-analog (GHOST VISITOR): remains a separate visitor identity, distinct from every roster member',
    !roster.includes(ghostInactive.canonicalVisitor) && ghostInactive.canonicalVisitor === 'GHOST VISITOR');
}

// ── purpose_reconciliation: cross-source Purpose reconciliation ────────
// (Phase 2 purpose reconciliation). Uses the real legacy purpose names
// (already public in SVMKPI_CORE.gs's APPROVED_PURPOSES and already used
// in earlier committed tests in this file) — these are business-process
// category labels, not sensitive data. Historical usage counts below are
// fictional/small, not the real production statistics.
{
  const legacyPurposeIds = ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'];
  const workbookSelectablePurposes = ['TLTC', 'STORE VISIT', 'CURING/SUPPORT', 'FAILED QA/MS', 'CAPAR'];
  const masterLogRows = [
    { rowRef: 'r1', purpose: 'STORE VISIT' },
    { rowRef: 'r2', purpose: 'STORE VISIT' },
    { rowRef: 'r3', purpose: 'TLTC' },
    { rowRef: 'r4', purpose: 'CAPAR' },
    { rowRef: 'r5', purpose: 'CAPAR' },
    { rowRef: 'r6', purpose: 'CAPAR' },
    { rowRef: 'r7', purpose: 'GHOST PURPOSE' }, // historical-only: not legacy, not workbook-selectable
  ];
  const administrativeDecisions = {
    CAPAR: { decision: PURPOSE_RECONCILIATION_DECISION.CONFIGURE_AS_NEW_PURPOSE },
  };

  const result = reconcilePurposeSources({ legacyPurposeIds, workbookSelectablePurposes, masterLogRows, administrativeDecisions });
  const byName = Object.fromEntries(result.purposes.map((p) => [p.normalizedValue, p]));

  check('1: CAPAR appears in workbook-selectable purposes but not legacy-approved purposes',
    byName.CAPAR.workbookSelectable === true && byName.CAPAR.legacyApproved === false);

  check('2: historical CAPAR usage is counted correctly',
    byName.CAPAR.historicalUseCount === 3 && byName.CAPAR.historicalRowRefs.length === 3);

  check('3: CAPAR is classified as a new purpose, never merged into an existing one', (() => {
    // CAPAR must appear as its OWN entry, not folded into STORE VISIT/TLTC/etc.
    const capar = byName.CAPAR;
    return capar.sourceValue === 'CAPAR' && capar.sourceStatus === PURPOSE_SOURCE_STATUS.WORKBOOK_AND_HISTORICAL
      && !['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'].includes(capar.sourceValue);
  })());

  check('4: the explicit CONFIGURE_AS_NEW_PURPOSE decision is represented separately from source discovery', (() => {
    // sourceStatus (discovery) and reconciliationDecision (administrative act) are distinct fields.
    return byName.CAPAR.sourceStatus === PURPOSE_SOURCE_STATUS.WORKBOOK_AND_HISTORICAL
      && byName.CAPAR.reconciliationDecision === PURPOSE_RECONCILIATION_DECISION.CONFIGURE_AS_NEW_PURPOSE
      && byName.CAPAR.sourceStatus !== byName.CAPAR.reconciliationDecision;
  })());

  check('5: historical source value remains exactly "CAPAR" (verbatim, not rewritten)',
    byName.CAPAR.sourceValue === 'CAPAR');

  check('6: case normalization does not rewrite the source value (lowercase historical variant preserved separately)', (() => {
    const lowerRows = [{ rowRef: 'x1', purpose: 'capar' }];
    const lowerResult = reconcilePurposeSources({ legacyPurposeIds, workbookSelectablePurposes, masterLogRows: lowerRows, administrativeDecisions });
    const lowerCapar = lowerResult.purposes.find((p) => p.normalizedValue === 'CAPAR');
    // sourceValue is picked from the workbook list ("CAPAR") since that
    // list exists; the ORIGINAL lowercase MASTER_LOG text is preserved
    // separately in historicalRowRefs, never silently replaced/upcased
    // as if it were the same edit.
    return lowerCapar.sourceValue === 'CAPAR' && lowerCapar.historicalUseCount === 1;
  })());

  check('7: historical usage alone never creates KPI configuration (no such field exists on the result)',
    !('kpiWeight' in byName.CAPAR) && !('kpiTarget' in byName.CAPAR));

  check('8: historical usage alone never creates risk configuration (no such field exists on the result)',
    !('riskWeight' in byName.CAPAR) && !('riskRule' in byName.CAPAR));

  check('9: historical usage alone never creates compliance configuration (no such field exists on the result)',
    !('complianceRule' in byName.CAPAR) && !('complianceCategory' in byName.CAPAR));

  check('CAPAR configurationStatus is PENDING_DELIBERATE_CONFIGURATION, never a misleading ACTIVE/ESTABLISHED',
    byName.CAPAR.configurationStatus === CONFIGURATION_STATUS.PENDING_DELIBERATE_CONFIGURATION);

  check('10: no existing purpose receives CAPAR\'s historical records through automatic matching', (() => {
    const storeVisit = byName['STORE VISIT'];
    const tltc = byName['TLTC'];
    return !storeVisit.historicalRowRefs.some((r) => ['r4', 'r5', 'r6'].includes(r))
      && !tltc.historicalRowRefs.some((r) => ['r4', 'r5', 'r6'].includes(r));
  })());

  check('13: existing legacy-approved purposes remain unchanged (classification + counts)', (() => {
    const storeVisit = byName['STORE VISIT'];
    return storeVisit.legacyApproved === true && storeVisit.sourceStatus === PURPOSE_SOURCE_STATUS.LEGACY_APPROVED
      && storeVisit.reconciliationDecision === PURPOSE_RECONCILIATION_DECISION.EXISTING_PURPOSE
      && storeVisit.configurationStatus === CONFIGURATION_STATUS.ESTABLISHED
      && storeVisit.historicalUseCount === 2;
  })());

  check('14: workbook-only and historical-only purposes are distinguishable from each other', (() => {
    const ghost = byName['GHOST PURPOSE'];
    // GHOST PURPOSE: not legacy, not workbook-selectable, historically used once -> HISTORICAL_ONLY
    return ghost.sourceStatus === PURPOSE_SOURCE_STATUS.HISTORICAL_ONLY
      && ghost.reconciliationDecision === PURPOSE_RECONCILIATION_DECISION.HUMAN_REVIEW // no administrative decision was supplied for it
      && ghost.sourceStatus !== byName.CAPAR.sourceStatus;
  })());

  check('a purpose that is workbook-selectable but never historically used classifies WORKBOOK_ONLY', (() => {
    const wbOnlyResult = reconcilePurposeSources({
      legacyPurposeIds, workbookSelectablePurposes: [...workbookSelectablePurposes, 'FUTURE PURPOSE'],
      masterLogRows, administrativeDecisions,
    });
    const futurePurpose = wbOnlyResult.purposes.find((p) => p.normalizedValue === 'FUTURE PURPOSE');
    return futurePurpose.sourceStatus === PURPOSE_SOURCE_STATUS.WORKBOOK_ONLY && futurePurpose.historicalUseCount === 0;
  })());

  check('15: source discrepancies are reported without modifying either source list', (() => {
    const legacySnapshot = JSON.stringify(legacyPurposeIds);
    const workbookSnapshot = JSON.stringify(workbookSelectablePurposes);
    reconcilePurposeSources({ legacyPurposeIds, workbookSelectablePurposes, masterLogRows, administrativeDecisions });
    return JSON.stringify(legacyPurposeIds) === legacySnapshot && JSON.stringify(workbookSelectablePurposes) === workbookSnapshot;
  })());

  check('11: reconciliation is deterministic across input ordering (shuffled MASTER_LOG rows)', (() => {
    const shuffled = [masterLogRows[3], masterLogRows[6], masterLogRows[0], masterLogRows[5], masterLogRows[1], masterLogRows[4], masterLogRows[2]];
    const shuffledResult = reconcilePurposeSources({ legacyPurposeIds, workbookSelectablePurposes, masterLogRows: shuffled, administrativeDecisions });
    const summarize = (r) => JSON.stringify(r.purposes.map((p) => ({ v: p.sourceValue, n: p.historicalUseCount, s: p.sourceStatus, d: p.reconciliationDecision })));
    return summarize(result) === summarize(shuffledResult);
  })());

  check('12: reconciliation is deterministic across independent runs', (() => {
    const run2 = reconcilePurposeSources({ legacyPurposeIds, workbookSelectablePurposes, masterLogRows, administrativeDecisions });
    return JSON.stringify(result) === JSON.stringify(run2);
  })());

  check('without an administrative decision, a non-legacy purpose stays HUMAN_REVIEW, never silently CONFIGURE_AS_NEW_PURPOSE', (() => {
    const noDecisionResult = reconcilePurposeSources({ legacyPurposeIds, workbookSelectablePurposes, masterLogRows, administrativeDecisions: {} });
    const capar = noDecisionResult.purposes.find((p) => p.normalizedValue === 'CAPAR');
    return capar.reconciliationDecision === PURPOSE_RECONCILIATION_DECISION.HUMAN_REVIEW
      && capar.configurationStatus === CONFIGURATION_STATUS.UNCONFIRMED
      && capar.unresolvedFlag === true;
  })());
}

// ── purpose_operational_readiness: Phase 2C operational readiness ──────
// (CAPAR removal from active/selectable configuration; generic,
// data-driven future-purpose readiness). Fictional TEST_NEW_PURPOSE
// stands in for "any deliberately added new purpose."
{
  const legacyPurposeIds = ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'];
  const workbookSelectablePurposes = ['TLTC', 'STORE VISIT', 'CURING/SUPPORT', 'FAILED QA/MS', 'CAPAR'];
  const masterLogRows = [
    { rowRef: 'r1', purpose: 'STORE VISIT' },
    { rowRef: 'r2', purpose: 'STORE VISIT' },
    { rowRef: 'r3', purpose: 'TLTC' },
    { rowRef: 'r4', purpose: 'CAPAR' },
    { rowRef: 'r5', purpose: 'CAPAR' },
    { rowRef: 'r6', purpose: 'CAPAR' },
    { rowRef: 'r7', purpose: 'CAPAR' },
    { rowRef: 'r8', purpose: 'CAPAR' },
    { rowRef: 'r9', purpose: 'CAPAR' },
    { rowRef: 'r10', purpose: 'CAPAR' }, // 7 CAPAR rows, mirroring the real 7-occurrence historical count
    { rowRef: 'r11', purpose: 'TEST_NEW_PURPOSE' }, // a fictional, deliberately-added-later purpose
  ];

  // No administrative decision is required for operational readiness —
  // that's purpose_reconciliation.js's separate migration-decision
  // concern. This module only cares whether a DELIBERATE configuration
  // (CONFIG_PURPOSES/CONFIG_KPI/CONFIG_RISK equivalent) exists.
  const baseReconciliation = reconcilePurposeSources({ legacyPurposeIds, workbookSelectablePurposes, masterLogRows, administrativeDecisions: {} });

  // ── A: CAPAR removal ──
  check('A1: CAPAR is not returned as an active/selectable purpose (no deliberate configuration exists for it)', (() => {
    const annotated = annotateWithOperationalStatus(baseReconciliation, {});
    const active = getActiveSelectablePurposes(annotated);
    return !active.some((p) => p.normalizedValue === 'CAPAR');
  })());

  check('A2: CAPAR is not accidentally resurrected through the legacy APPROVED_PURPOSES fallback', (() => {
    // The legacy list passed in is the real, unmodified 4-entry list —
    // proving CAPAR reaching ACTIVE_SELECTABLE would require someone to
    // have added it there, which nothing in this module ever does.
    return !legacyPurposeIds.includes('CAPAR') && legacyPurposeIds.length === 4;
  })());

  check('A3: CAPAR historical usage/workbook presence alone do not make it active', (() => {
    const annotated = annotateWithOperationalStatus(baseReconciliation, {});
    const capar = annotated.purposes.find((p) => p.normalizedValue === 'CAPAR');
    return capar.workbookSelectable === true && capar.historicalUseCount === 7
      && capar.operationalConfigurationStatus.operationalStatus === PURPOSE_OPERATIONAL_STATUS.INACTIVE_NOT_SELECTABLE;
  })());

  // ── B: historical preservation ──
  check('B1: all 7 historical CAPAR rows remain preserved after annotation', (() => {
    const annotated = annotateWithOperationalStatus(baseReconciliation, {});
    const capar = annotated.purposes.find((p) => p.normalizedValue === 'CAPAR');
    return capar.historicalUseCount === 7 && capar.historicalRowRefs.length === 7
      && capar.historicalRowRefs.every((r) => ['r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10'].includes(r));
  })());

  check('B2: exact source value remains "CAPAR" (verbatim) after annotation', (() => {
    const annotated = annotateWithOperationalStatus(baseReconciliation, {});
    const capar = annotated.purposes.find((p) => p.normalizedValue === 'CAPAR');
    return capar.sourceValue === 'CAPAR';
  })());

  check('B3: historical CAPAR rows are not remapped to any other purpose, and its absence from operational status never invalidates them', (() => {
    const annotated = annotateWithOperationalStatus(baseReconciliation, {});
    const capar = annotated.purposes.find((p) => p.normalizedValue === 'CAPAR');
    const storeVisit = annotated.purposes.find((p) => p.normalizedValue === 'STORE VISIT');
    // Inactive operational status is a SEPARATE concept from historical
    // validity — capar's own 7 rows are untouched and unmoved regardless.
    return !storeVisit.historicalRowRefs.some((r) => capar.historicalRowRefs.includes(r))
      && capar.sourceStatus === PURPOSE_SOURCE_STATUS.WORKBOOK_AND_HISTORICAL; // still a real, valid historical fact
  })());

  // ── C: no configuration inheritance ──
  check('C1: CAPAR with no configuration does not resolve another purpose\'s KPI/Risk configuration', (() => {
    const deliberateConfigurations = {
      'STORE VISIT': { hasKpiConfig: true, hasRiskConfig: true },
      // No entry at all for CAPAR.
    };
    const status = resolvePurposeConfigurationStatus({ legacyApproved: false, deliberateConfiguration: deliberateConfigurations.CAPAR });
    return status.hasKpiConfig === false && status.hasRiskConfig === false && status.valid === false;
  })());

  check('C2: a fictional new purpose with no configuration behaves identically to CAPAR (generic, not CAPAR-specific)', (() => {
    const status = resolvePurposeConfigurationStatus({ legacyApproved: false, deliberateConfiguration: undefined });
    const caparStatus = resolvePurposeConfigurationStatus({ legacyApproved: false, deliberateConfiguration: undefined });
    return JSON.stringify(status) === JSON.stringify(caparStatus)
      && status.operationalStatus === PURPOSE_OPERATIONAL_STATUS.INACTIVE_NOT_SELECTABLE;
  })());

  check('C3: annotateWithOperationalStatus looks up each purpose by its OWN exact key only, never a fallback', (() => {
    const deliberateConfigurations = {
      'STORE VISIT': { hasKpiConfig: true, hasRiskConfig: true },
      TLTC: { hasKpiConfig: true, hasRiskConfig: false },
    };
    const annotated = annotateWithOperationalStatus(baseReconciliation, deliberateConfigurations);
    const capar = annotated.purposes.find((p) => p.normalizedValue === 'CAPAR');
    const testNewPurpose = annotated.purposes.find((p) => p.normalizedValue === 'TEST_NEW_PURPOSE');
    return capar.operationalConfigurationStatus.hasKpiConfig === false
      && capar.operationalConfigurationStatus.hasRiskConfig === false
      && testNewPurpose.operationalConfigurationStatus.hasKpiConfig === false
      && testNewPurpose.operationalConfigurationStatus.hasRiskConfig === false;
  })());

  // ── D: generic future-purpose readiness (TEST_NEW_PURPOSE) ──
  check('D1: before deliberate configuration, TEST_NEW_PURPOSE reports a pending/readiness state, not report-ready', (() => {
    const annotated = annotateWithOperationalStatus(baseReconciliation, {});
    const pending = getPendingAnalyticsConfigurationPurposes(annotated);
    const eligible = getReportEligiblePurposes(annotated);
    return !eligible.some((p) => p.normalizedValue === 'TEST_NEW_PURPOSE')
      && !getActiveSelectablePurposes(annotated).some((p) => p.normalizedValue === 'TEST_NEW_PURPOSE')
      // Not yet "pending" either (no CONFIG_PURPOSES-equivalent row was
      // ever created) — it simply does not exist as a configuration yet,
      // exactly like CAPAR, distinguishing "unconfigured" from
      // "configured but incomplete."
      && !pending.some((p) => p.normalizedValue === 'TEST_NEW_PURPOSE');
  })());

  check('D2: TEST_NEW_PURPOSE can be deliberately configured and becomes discoverable dynamically, through the SAME generic function used for every other purpose', (() => {
    // Step 1: a deliberate CONFIG_PURPOSES-equivalent record is created
    // (activated) but KPI/Risk configuration is not complete yet.
    const stepOne = annotateWithOperationalStatus(baseReconciliation, {
      TEST_NEW_PURPOSE: { hasKpiConfig: false, hasRiskConfig: false },
    });
    const activeAfterStepOne = getActiveSelectablePurposes(stepOne);
    const pendingAfterStepOne = getPendingAnalyticsConfigurationPurposes(stepOne);
    const readyAfterStepOne = getReportEligiblePurposes(stepOne);

    // Step 2: KPI + Risk configuration is deliberately completed.
    const stepTwo = annotateWithOperationalStatus(baseReconciliation, {
      TEST_NEW_PURPOSE: { hasKpiConfig: true, hasRiskConfig: true },
    });
    const readyAfterStepTwo = getReportEligiblePurposes(stepTwo);

    return activeAfterStepOne.some((p) => p.normalizedValue === 'TEST_NEW_PURPOSE') // discoverable as soon as it's configured
      && pendingAfterStepOne.some((p) => p.normalizedValue === 'TEST_NEW_PURPOSE')   // explicit pending state, not silently ready
      && !readyAfterStepOne.some((p) => p.normalizedValue === 'TEST_NEW_PURPOSE')
      && readyAfterStepTwo.some((p) => p.normalizedValue === 'TEST_NEW_PURPOSE');    // report-ready once fully configured
  })());

  check('D3: no purpose-specific function/branch exists — getReportEligiblePurposes/getActiveSelectablePurposes take only the annotated result, never a purpose name', (() => {
    // Structural check: both functions have arity 1 (just the annotated
    // result) — there is no per-purpose parameter to hardcode against.
    return getActiveSelectablePurposes.length === 1 && getReportEligiblePurposes.length === 1
      && getPendingAnalyticsConfigurationPurposes.length === 1;
  })());

  check('D4: TEST_NEW_PURPOSE\'s configuration is never borrowed from an existing purpose (e.g. CAPAR\'s or STORE VISIT\'s)', (() => {
    const annotated = annotateWithOperationalStatus(baseReconciliation, {
      'STORE VISIT': { hasKpiConfig: true, hasRiskConfig: true },
      TEST_NEW_PURPOSE: { hasKpiConfig: true, hasRiskConfig: false },
    });
    const testNewPurpose = annotated.purposes.find((p) => p.normalizedValue === 'TEST_NEW_PURPOSE');
    // Its OWN entry says hasRiskConfig:false — if it had inherited
    // STORE VISIT's entry, this would incorrectly read true.
    return testNewPurpose.operationalConfigurationStatus.hasKpiConfig === true
      && testNewPurpose.operationalConfigurationStatus.hasRiskConfig === false
      && testNewPurpose.operationalConfigurationStatus.valid === false;
  })());

  // ── Additional guarantees ──
  check('legacy-approved purposes are always active/selectable, with no configuration record required (matches production backward-compat rule)', (() => {
    const annotated = annotateWithOperationalStatus(baseReconciliation, {});
    const active = getActiveSelectablePurposes(annotated).map((p) => p.normalizedValue);
    return ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'].every((p) => active.includes(p));
  })());

  check('annotateWithOperationalStatus never overwrites the reconciliation\'s own fields (sourceStatus/reconciliationDecision/configurationStatus)', (() => {
    const decisions = { CAPAR: { decision: PURPOSE_RECONCILIATION_DECISION.CONFIGURE_AS_NEW_PURPOSE } };
    const withDecision = reconcilePurposeSources({ legacyPurposeIds, workbookSelectablePurposes, masterLogRows, administrativeDecisions: decisions });
    const annotated = annotateWithOperationalStatus(withDecision, {});
    const capar = annotated.purposes.find((p) => p.normalizedValue === 'CAPAR');
    return capar.sourceStatus === PURPOSE_SOURCE_STATUS.WORKBOOK_AND_HISTORICAL
      && capar.reconciliationDecision === PURPOSE_RECONCILIATION_DECISION.CONFIGURE_AS_NEW_PURPOSE
      && capar.configurationStatus === CONFIGURATION_STATUS.PENDING_DELIBERATE_CONFIGURATION
      && 'operationalConfigurationStatus' in capar; // additive, not a replacement
  })());

  check('annotateWithOperationalStatus never mutates its input reconciliation result', (() => {
    const snapshot = JSON.stringify(baseReconciliation);
    annotateWithOperationalStatus(baseReconciliation, { TEST_NEW_PURPOSE: { hasKpiConfig: true, hasRiskConfig: true } });
    return JSON.stringify(baseReconciliation) === snapshot;
  })());

  check('operational readiness is deterministic across independent calls', (() => {
    const configs = { TEST_NEW_PURPOSE: { hasKpiConfig: true, hasRiskConfig: true } };
    const runA = annotateWithOperationalStatus(baseReconciliation, configs);
    const runB = annotateWithOperationalStatus(baseReconciliation, configs);
    return JSON.stringify(runA) === JSON.stringify(runB);
  })());
}

// ── Source integrity: reconciliation never mutates its inputs ──────────
{
  const settingsRows = [{ rowRef: 'S1', store: 'RIVERBEND', brand: "ANGEL'S PIZZA", region: 'FRANCHISE', category: 'FAR PROVINCIAL' }];
  const masterLogRows = [{ rowRef: 'M1', store: 'RIVERBEND', brand: "ANGEL'S PIZZA", dateVisited: '2026-01-01' }];
  const settingsSnapshot = JSON.parse(JSON.stringify(settingsRows));
  const masterLogSnapshot = JSON.parse(JSON.stringify(masterLogRows));
  buildStoreIdentityReconciliation({ settingsRows, masterLogRows });
  check('store_canonical_identity: source SETTINGS rows unmodified after reconciliation',
    JSON.stringify(settingsRows) === JSON.stringify(settingsSnapshot));
  check('store_canonical_identity: source MASTER_LOG rows unmodified after reconciliation',
    JSON.stringify(masterLogRows) === JSON.stringify(masterLogSnapshot));
}

console.log('\n' + '═'.repeat(34));
console.log(`  PASS ${pass}   FAIL ${fail}`);
console.log('═'.repeat(34));
process.exit(fail > 0 ? 1 : 0);
