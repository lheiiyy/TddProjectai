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
const { buildStoreIdentityReconciliation, compositeKey, STATUS: STORE_STATUS } = require('./store_canonical_identity');
const { deriveProposedStoreId, buildProposedStoreIdMap, uuidV5, SVMI_STORE_NAMESPACE_UUID } = require('./store_id_generator');
const { classifyVisitorTokens } = require('./visitor_identity_classification');

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
