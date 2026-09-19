// database/import/load.js
//
// Generates a single deterministic SQL script from transform.js's table
// rows and applies it via `psql` (no `pg` npm dependency — same
// psql/pg_dump/pg_restore-CLI convention as every other script in
// database/scripts/, and consistent with the existing test suite's
// vanilla-Node-only convention). Nothing here ever runs outside a
// dev-gated caller (see run_import.js) — this module itself has no
// environment-name awareness; it only executes whatever connection the
// environment variables it's given point at, exactly like psql itself.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Standard SQL string-literal escaping (double embedded single quotes).
// standard_conforming_strings is on by default in PostgreSQL >= 9.1, so
// backslashes need no special handling.
function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJsonb(value) {
  const json = JSON.stringify(value).replace(/'/g, "''");
  return `'${json}'::jsonb`;
}

// Explicit column lists per table (never inferred from JS object key
// order) so a fixture row with a missing/extra key fails loudly (a
// mismatched INSERT column/value count is a PostgreSQL error) rather than
// silently writing to the wrong column.
const TABLE_SPECS = [
  { table: 'stores', columns: ['store_id'] },
  { table: 'store_versions', columns: ['version_id', 'store_id', 'version_num', 'store_name', 'brand', 'region', 'category', 'status', 'effective_from', 'effective_to', 'envelope_status', 'created_at', 'reason'] },
  { table: 'unmapped_store_references', columns: ['original_store_name', 'occurrence_count', 'first_seen', 'last_seen', 'status'] },
  { table: 'visitors', columns: ['visitor_id'] },
  { table: 'visitor_versions', columns: ['version_id', 'visitor_id', 'version_num', 'visitor_name', 'effective_from', 'effective_to', 'envelope_status', 'created_at', 'reason'] },
  { table: 'purposes', columns: ['purpose_id', 'is_legacy'] },
  { table: 'purpose_versions', columns: ['version_id', 'purpose_id', 'version_num', 'risk_weight', 'effective_from', 'effective_to', 'envelope_status', 'created_at', 'reason'] },
  { table: 'compliance_rules', columns: ['category', 'is_legacy_default'] },
  { table: 'compliance_rule_versions', columns: ['version_id', 'category', 'version_num', 'cadence_type', 'cadence_days', 'period_definition', 'required_count', 'grace_days', 'effective_from', 'effective_to', 'envelope_status', 'created_at', 'reason'] },
  { table: 'risk_rule_versions', columns: ['version_id', 'risk_rule_set_id', 'version_num', 'low_threshold', 'medium_threshold', 'high_threshold', 'effective_from', 'effective_to', 'envelope_status', 'created_at', 'reason'] },
  { table: 'kpi_configurations', columns: ['kpi_id'] },
  { table: 'kpi_configuration_versions', columns: ['version_id', 'kpi_id', 'version_num', 'target_value', 'target_type', 'weight', 'purpose_id', 'effective_from', 'effective_to', 'envelope_status', 'created_at', 'reason'] },
  { table: 'system_configurations', columns: ['setting_key'] },
  { table: 'system_configuration_versions', columns: ['version_id', 'setting_key', 'version_num', 'setting_value', 'setting_label', 'effective_from', 'effective_to', 'envelope_status', 'created_at', 'reason'] },
  { table: 'audit_logs', columns: ['audit_id', 'occurred_at', 'actor_user_id', 'entity_type', 'entity_id', 'action', 'previous_value', 'new_value', 'effective_from', 'effective_to', 'reason', 'version_num', 'was_backdated', 'backdate_confirmed'] },
  { table: 'store_visits', columns: ['store_visit_id', 'store_id', 'visited_at', 'purpose_id', 'remarks', 'recorded_at', 'source_row_ref'] },
  { table: 'store_visit_visitors', columns: ['store_visit_id', 'visitor_id'] },
  { table: 'report_snapshots', columns: ['snapshot_id', 'reporting_year', 'snapshot_version', 'status', 'created_at', 'finalized_at', 'evaluation_date', 'reason', 'supersedes_snapshot_id', 'calculation_timestamp', 'risk_config_version_id', 'risk_config_source', 'kpi_config_note', 'purpose_store_config_note', 'result_json'] },
  { table: 'report_snapshot_store_results', columns: ['snapshot_id', 'store_id', 'brand', 'region', 'category', 'last_visit_date', 'last_purpose', 'days_since', 'total_ytd', 'store_ytd', 'failed_count', 'curing_count', 'risk_score', 'risk_tier', 'action', 'attention_reason'] },
  { table: 'report_snapshot_compliance_gaps', columns: ['snapshot_id', 'store_id', 'category', 'window_label', 'ytd_visits', 'required_count', 'actual_count'] },
  { table: 'report_snapshot_compliance_provenance', columns: ['snapshot_id', 'category', 'compliance_config_version_id', 'source'] },
];

// Tables truncated (in reverse dependency order) before a fresh load, so
// re-running the importer against the same DEV database is idempotent —
// this is a DEV-only fixture reload, gated by run_import.js's own
// SVMI_DB_ENV=dev check, never something this module decides on its own.
const TRUNCATE_ORDER = [
  'report_snapshot_compliance_provenance', 'report_snapshot_compliance_gaps',
  'report_snapshot_store_results', 'report_snapshots',
  'store_visit_visitors', 'store_visits',
  'audit_logs',
  'system_configuration_versions', 'system_configurations',
  'kpi_configuration_versions', 'kpi_configurations',
  'risk_rule_versions',
  'compliance_rule_versions', 'compliance_rules',
  'purpose_versions', 'purposes',
  'visitor_versions', 'visitors',
  'unmapped_store_references', 'store_versions', 'stores',
];

function buildInsertStatements(tables) {
  const lines = [];
  for (const spec of TABLE_SPECS) {
    const rows = tables[spec.table] || [];
    for (const row of rows) {
      const values = spec.columns.map((col) => {
        const v = row[col];
        if (col === 'result_json') return sqlJsonb(v);
        return sqlLiteral(v);
      });
      lines.push(`INSERT INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (${values.join(', ')});`);
    }
  }
  return lines.join('\n');
}

function buildTruncateStatements() {
  return `TRUNCATE TABLE ${TRUNCATE_ORDER.join(', ')} RESTART IDENTITY CASCADE;`;
}

// Runs `psql` with the given SQL script (as a temp file, so failures show
// a real file:line in psql's own error output). Connection details come
// entirely from the environment (PGHOST/PGPORT/PGDATABASE/PGUSER/
// PGPASSWORD), exactly like every other script in database/.
function runPsql(sql, { env = process.env } = {}) {
  const tmpFile = path.join(os.tmpdir(), `svmi-import-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(tmpFile, sql, 'utf8');
  try {
    const result = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-f', tmpFile], { env, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`psql exited with status ${result.status}:\n${result.stderr}`);
    }
    return result.stdout;
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

function load(tables, { reset = true, env = process.env } = {}) {
  const parts = [];
  if (reset) parts.push(buildTruncateStatements());
  parts.push(buildInsertStatements(tables));
  const sql = parts.join('\n\n');
  return runPsql(sql, { env });
}

module.exports = { load, buildInsertStatements, buildTruncateStatements, sqlLiteral, sqlJsonb, TABLE_SPECS };
