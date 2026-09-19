// database/validation/counts.js
//
// Business-total count comparisons: derives "expected" counts from the
// SAME fixture + SAME transform.js the importer used (never a hardcoded
// number — the fixture is the one source of truth), then compares each
// against what actually landed in the DEV database. See
// docs/04-backup-restore.md / the phase's own instruction: "validation
// comparing business totals... plus field-by-field sample checks."

const { extract } = require('../import/extract');
const { transform } = require('../import/transform');
const { scalar } = require('./psql_query');

function expectedCounts(fixturePath) {
  const data = extract(fixturePath);
  const { tables } = transform(data);

  const years = new Set(tables.store_visits.map((v) => v.visited_at.slice(0, 4)));

  return {
    stores: tables.stores.length,
    store_visits: tables.store_visits.length,
    store_visit_visitors: tables.store_visit_visitors.length,
    visitors: tables.visitors.length,
    purposes: tables.purposes.length,
    compliance_rules: tables.compliance_rules.length,
    store_versions: tables.store_versions.length,
    visitor_versions: tables.visitor_versions.length,
    purpose_versions: tables.purpose_versions.length,
    compliance_rule_versions: tables.compliance_rule_versions.length,
    risk_rule_versions: tables.risk_rule_versions.length,
    kpi_configurations: tables.kpi_configurations.length,
    kpi_configuration_versions: tables.kpi_configuration_versions.length,
    audit_logs: tables.audit_logs.length,
    report_snapshots: tables.report_snapshots.length,
    report_snapshot_store_results: tables.report_snapshot_store_results.length,
    report_snapshot_compliance_gaps: tables.report_snapshot_compliance_gaps.length,
    unmapped_store_references: tables.unmapped_store_references.length,
    reporting_years: years.size,
  };
}

const ACTUAL_QUERIES = {
  stores: 'SELECT count(*) FROM stores',
  store_visits: 'SELECT count(*) FROM store_visits',
  store_visit_visitors: 'SELECT count(*) FROM store_visit_visitors',
  visitors: 'SELECT count(*) FROM visitors',
  purposes: 'SELECT count(*) FROM purposes',
  compliance_rules: 'SELECT count(*) FROM compliance_rules',
  store_versions: 'SELECT count(*) FROM store_versions',
  visitor_versions: 'SELECT count(*) FROM visitor_versions',
  purpose_versions: 'SELECT count(*) FROM purpose_versions',
  compliance_rule_versions: 'SELECT count(*) FROM compliance_rule_versions',
  risk_rule_versions: 'SELECT count(*) FROM risk_rule_versions',
  kpi_configurations: 'SELECT count(*) FROM kpi_configurations',
  kpi_configuration_versions: 'SELECT count(*) FROM kpi_configuration_versions',
  audit_logs: 'SELECT count(*) FROM audit_logs',
  report_snapshots: 'SELECT count(*) FROM report_snapshots',
  report_snapshot_store_results: 'SELECT count(*) FROM report_snapshot_store_results',
  report_snapshot_compliance_gaps: 'SELECT count(*) FROM report_snapshot_compliance_gaps',
  unmapped_store_references: 'SELECT count(*) FROM unmapped_store_references',
  reporting_years: 'SELECT count(*) FROM reporting_periods',
};

function runCountValidation(fixturePath, { env = process.env } = {}) {
  const expected = expectedCounts(fixturePath);
  const results = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualRaw = scalar(ACTUAL_QUERIES[key], { env });
    const actualValue = Number(actualRaw);
    results.push({
      check: key,
      expected: expectedValue,
      actual: actualValue,
      pass: actualValue === expectedValue,
    });
  }
  return results;
}

module.exports = { expectedCounts, runCountValidation, ACTUAL_QUERIES };
