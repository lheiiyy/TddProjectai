// database/import/transform.js
//
// Pure transform: takes the extracted fixture shape (see extract.js) and
// produces one row array per destination table, in dependency order, plus
// a quarantine list for anything that cannot be safely loaded (never
// guessed, never silently dropped — see the store_id note below).
//
// Deliberately pure / side-effect-free (no DB, no filesystem) so it can
// be unit-tested (see validation/transform.test.js) independently of a
// running PostgreSQL instance.

const crypto = require('crypto');

function newUuid() {
  return crypto.randomUUID();
}

function splitVisitedBy(str) {
  return String(str || '')
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
}

function transform(data) {
  const tables = {
    stores: [],
    store_versions: [],
    unmapped_store_references: [],
    visitors: [],
    visitor_versions: [],
    purposes: [],
    purpose_versions: [],
    compliance_rules: [],
    compliance_rule_versions: [],
    risk_rule_versions: [],
    kpi_configurations: [],
    kpi_configuration_versions: [],
    system_configurations: [],
    system_configuration_versions: [],
    audit_logs: [],
    store_visits: [],
    store_visit_visitors: [],
    report_snapshots: [],
    report_snapshot_store_results: [],
    report_snapshot_compliance_gaps: [],
    report_snapshot_compliance_provenance: [],
  };

  const warnings = [];

  // ── Stores ──────────────────────────────────────────────────────
  const storeIds = new Set();
  for (const row of data.configStores) {
    if (!storeIds.has(row.entityId)) {
      storeIds.add(row.entityId);
      tables.stores.push({ store_id: row.entityId });
    }
    tables.store_versions.push({
      version_id: newUuid(),
      store_id: row.entityId,
      version_num: row.versionNum,
      store_name: row.storeName,
      brand: row.brand,
      region: row.region,
      category: row.category,
      status: row.status,
      effective_from: row.effectiveFrom,
      effective_to: row.effectiveTo,
      envelope_status: row.envelopeStatus,
      created_at: row.createdAt,
      reason: row.reason,
    });
  }

  // ── Visitors ────────────────────────────────────────────────────
  const visitorIds = new Set();
  for (const row of data.configVisitors) {
    if (!visitorIds.has(row.entityId)) {
      visitorIds.add(row.entityId);
      tables.visitors.push({ visitor_id: row.entityId });
    }
    tables.visitor_versions.push({
      version_id: newUuid(),
      visitor_id: row.entityId,
      version_num: row.versionNum,
      visitor_name: row.visitorName,
      effective_from: row.effectiveFrom,
      effective_to: row.effectiveTo,
      envelope_status: row.envelopeStatus,
      created_at: row.createdAt,
      reason: row.reason,
    });
  }

  // ── Purposes ────────────────────────────────────────────────────
  const purposeIds = new Set();
  for (const row of data.configPurposes) {
    if (!purposeIds.has(row.entityId)) {
      purposeIds.add(row.entityId);
      tables.purposes.push({ purpose_id: row.entityId, is_legacy: !!row.isLegacy });
    }
    tables.purpose_versions.push({
      version_id: newUuid(),
      purpose_id: row.entityId,
      version_num: row.versionNum,
      risk_weight: row.riskWeight,
      effective_from: row.effectiveFrom,
      effective_to: row.effectiveTo,
      envelope_status: row.envelopeStatus,
      created_at: row.createdAt,
      reason: row.reason,
    });
  }

  // ── Compliance rules (keyed by CATEGORY, not purpose) ──────────
  const categories = new Set();
  for (const row of data.configComplianceRules) {
    if (!categories.has(row.category)) {
      categories.add(row.category);
      tables.compliance_rules.push({ category: row.category, is_legacy_default: !!row.isLegacyDefault });
    }
    tables.compliance_rule_versions.push({
      version_id: newUuid(),
      category: row.category,
      version_num: row.versionNum,
      cadence_type: row.cadenceType,
      cadence_days: row.cadenceDays,
      period_definition: row.periodDefinition,
      required_count: row.requiredCount,
      grace_days: row.graceDays,
      effective_from: row.effectiveFrom,
      effective_to: row.effectiveTo,
      envelope_status: row.envelopeStatus,
      created_at: row.createdAt,
      reason: row.reason,
    });
  }

  // ── Risk (global singleton, risk_rule_set_id = 1) ──────────────
  // Keyed by version_num so report_snapshots.configProvenance.riskConfigVersion
  // (a version_num, matching how the source system's Report Snapshot
  // provenance names a version) can resolve to a real version_id below.
  const riskVersionIdByNum = new Map();
  for (const row of data.configRisk) {
    const versionId = newUuid();
    riskVersionIdByNum.set(row.versionNum, versionId);
    tables.risk_rule_versions.push({
      version_id: versionId,
      risk_rule_set_id: 1,
      version_num: row.versionNum,
      low_threshold: row.lowThreshold,
      medium_threshold: row.mediumThreshold,
      high_threshold: row.highThreshold,
      effective_from: row.effectiveFrom,
      effective_to: row.effectiveTo,
      envelope_status: row.envelopeStatus,
      created_at: row.createdAt,
      reason: row.reason,
    });
  }

  // ── KPI ─────────────────────────────────────────────────────────
  const kpiIds = new Set();
  for (const row of data.configKpi) {
    if (!kpiIds.has(row.entityId)) {
      kpiIds.add(row.entityId);
      tables.kpi_configurations.push({ kpi_id: row.entityId });
    }
    tables.kpi_configuration_versions.push({
      version_id: newUuid(),
      kpi_id: row.entityId,
      version_num: row.versionNum,
      target_value: row.targetValue,
      target_type: row.targetType,
      weight: row.weight,
      purpose_id: row.purposeId || null,
      effective_from: row.effectiveFrom,
      effective_to: row.effectiveTo,
      envelope_status: row.envelopeStatus,
      created_at: row.createdAt,
      reason: row.reason,
    });
  }

  // ── System (documented empty — see migrations/007) ─────────────
  for (const row of data.configSystem) {
    warnings.push(`Unexpected configSystem row for '${row.entityId}' — system_configurations is documented as seeded empty; loading anyway.`);
    tables.system_configurations.push({ setting_key: row.entityId });
    tables.system_configuration_versions.push({
      version_id: newUuid(),
      setting_key: row.entityId,
      version_num: row.versionNum,
      setting_value: row.settingValue,
      setting_label: row.settingLabel || null,
      effective_from: row.effectiveFrom,
      effective_to: row.effectiveTo,
      envelope_status: row.envelopeStatus,
      created_at: row.createdAt,
      reason: row.reason,
    });
  }

  // ── Audit logs ──────────────────────────────────────────────────
  for (const row of data.configAudit) {
    tables.audit_logs.push({
      audit_id: newUuid(),
      occurred_at: row.timestamp,
      actor_user_id: null, // no `users` row exists to attribute to yet — see migrations/002's own note
      entity_type: row.area,
      entity_id: row.entityId,
      action: row.action,
      previous_value: row.previousValue,
      new_value: row.newValue,
      effective_from: row.effectiveFrom,
      effective_to: row.effectiveTo,
      reason: row.reason,
      version_num: row.version,
      was_backdated: false,
      backdate_confirmed: false,
    });
  }

  // ── Store visits (MASTER_LOG) ───────────────────────────────────
  // A row with a blank/unresolved Store ID cannot be loaded into
  // store_visits (store_id is a NOT NULL FK) without GUESSING which
  // store it belongs to — exactly the thing this whole architecture
  // refuses to do. Such rows are quarantined into
  // unmapped_store_references (matching CONFIG_UNMAPPED_STORES's own
  // "reconciled explicitly and auditably, never rewriting the original
  // historical reference" contract) instead of being silently dropped
  // OR guessed into an arbitrary store. See docs/03-migration-mapping.md.
  const unmappedByName = new Map();
  for (const row of data.masterLog) {
    const hasStoreId = row.storeId && storeIds.has(row.storeId);
    if (!hasStoreId) {
      const key = row.store;
      if (!unmappedByName.has(key)) {
        unmappedByName.set(key, {
          original_store_name: key,
          occurrence_count: 0,
          first_seen: row.dateVisited,
          last_seen: row.dateVisited,
          status: 'UNMAPPED',
        });
      }
      const entry = unmappedByName.get(key);
      entry.occurrence_count += 1;
      if (row.dateVisited < entry.first_seen) entry.first_seen = row.dateVisited;
      if (row.dateVisited > entry.last_seen) entry.last_seen = row.dateVisited;
      warnings.push(`MASTER_LOG row for store "${row.store}" on ${row.dateVisited} has no resolvable Store ID — quarantined to unmapped_store_references, NOT loaded into store_visits.`);
      continue;
    }

    if (!purposeIds.has(row.purpose)) {
      warnings.push(`MASTER_LOG row for store "${row.store}" on ${row.dateVisited} has purpose "${row.purpose}" with no matching purposes row — skipped (never invented).`);
      continue;
    }

    const visitId = newUuid();
    tables.store_visits.push({
      store_visit_id: visitId,
      store_id: row.storeId,
      visited_at: row.dateVisited,
      purpose_id: row.purpose,
      remarks: row.remarks || null,
      recorded_at: row.timestamp,
      source_row_ref: `masterLog[${row.store}|${row.dateVisited}]`,
    });

    for (const visitorName of splitVisitedBy(row.visitedBy)) {
      if (!visitorIds.has(visitorName)) {
        warnings.push(`MASTER_LOG row for store "${row.store}" on ${row.dateVisited} names visitor "${visitorName}" with no matching visitors row — skipped for this visit (never invented).`);
        continue;
      }
      tables.store_visit_visitors.push({ store_visit_id: visitId, visitor_id: visitorName });
    }
  }
  tables.unmapped_store_references = Array.from(unmappedByName.values());

  // ── Report snapshots ────────────────────────────────────────────
  for (const snap of data.reportSnapshots) {
    const snapshotId = `REPORT-${snap.reportingYear}-v${snap.versionNum}`;
    const supersedesId = snap.supersedesVersion
      ? `REPORT-${snap.reportingYear}-v${snap.supersedesVersion}`
      : null;
    const riskConfigVersionId = snap.configProvenance && snap.configProvenance.riskConfigVersion != null
      ? (riskVersionIdByNum.get(snap.configProvenance.riskConfigVersion) || null)
      : null;

    tables.report_snapshots.push({
      snapshot_id: snapshotId,
      reporting_year: snap.reportingYear,
      snapshot_version: snap.versionNum,
      status: snap.status,
      created_at: snap.createdAt,
      finalized_at: snap.status === 'DRAFT' ? null : snap.createdAt,
      evaluation_date: snap.evaluationDate,
      reason: snap.reason,
      supersedes_snapshot_id: supersedesId,
      calculation_timestamp: snap.createdAt,
      risk_config_version_id: riskConfigVersionId,
      risk_config_source: riskConfigVersionId ? 'CONFIG_RISK' : null,
      kpi_config_note: snap.configProvenance && snap.configProvenance.note ? snap.configProvenance.note : null,
      purpose_store_config_note: 'Store and Purpose configuration are resolved per-entity at calculation time, not represented as one report-wide version.',
      result_json: snap,
    });

    for (const sr of snap.storeResults || []) {
      tables.report_snapshot_store_results.push({
        snapshot_id: snapshotId,
        store_id: sr.storeId,
        brand: sr.brand || null,
        region: sr.region || null,
        category: sr.category || null,
        last_visit_date: sr.lastVisitDate || null,
        last_purpose: sr.lastPurpose || null,
        days_since: sr.daysSince != null ? sr.daysSince : null,
        total_ytd: sr.totalYtd || 0,
        store_ytd: sr.storeYtd || 0,
        failed_count: sr.failedCount || 0,
        curing_count: sr.curingCount || 0,
        risk_score: sr.riskScore || 0,
        risk_tier: sr.riskTier || null,
        action: sr.action || null,
        attention_reason: sr.attentionReason || null,
      });
    }

    for (const gap of snap.complianceGaps || []) {
      tables.report_snapshot_compliance_gaps.push({
        snapshot_id: snapshotId,
        store_id: gap.storeId,
        category: gap.category || null,
        window_label: gap.windowLabel || null,
        ytd_visits: gap.ytdVisits || 0,
        required_count: gap.requiredCount,
        actual_count: gap.actualCount,
      });
    }
  }

  return { tables, warnings };
}

module.exports = { transform, splitVisitedBy };
