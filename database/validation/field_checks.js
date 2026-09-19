// database/validation/field_checks.js
//
// Field-by-field sample checks (as distinct from counts.js's aggregate
// totals) — spot-checks specific rows end-to-end through the transform,
// covering: versioned-attribute correction (store category), the
// pipe-delimited-string -> junction-table normalization, risk threshold
// resolution, and a report snapshot's frozen JSONB payload.

const { scalar, query } = require('./psql_query');

function check(name, actual, expected) {
  const pass = String(actual) === String(expected);
  return { check: name, expected, actual, pass };
}

function runFieldChecks({ env = process.env } = {}) {
  const results = [];

  // Store STR-0005's SECOND (corrective) version should carry the
  // corrected category, and the FIRST version must remain unchanged
  // (historical immutability — a correction never rewrites the old row).
  results.push(check(
    'STR-0005 v2 category (corrected)',
    scalar("SELECT category FROM store_versions WHERE store_id='STR-0005' AND version_num=2", { env }),
    'NEAR PROVINCIAL',
  ));
  results.push(check(
    'STR-0005 v1 category (unchanged historical row)',
    scalar("SELECT category FROM store_versions WHERE store_id='STR-0005' AND version_num=1", { env }),
    'NCR',
  ));

  // MASTER_LOG!F "LEO | YANA" for the 2026-01-05 STR-0001 visit must have
  // become two real junction rows, not a string.
  const visitors = query(
    "SELECT v.visitor_id FROM store_visit_visitors v JOIN store_visits sv ON sv.store_visit_id = v.store_visit_id WHERE sv.store_id='STR-0001' AND sv.visited_at='2026-01-05' ORDER BY v.visitor_id",
    { env },
  ).map((r) => r[0]);
  results.push(check(
    'STR-0001 2026-01-05 visitors (pipe-string -> junction rows)',
    visitors.join(','),
    'LEO,YANA',
  ));

  // Risk thresholds: the ACTIVE (2026-01-01+) version, not the retired one.
  results.push(check(
    'risk_rule_versions v2 threshold triple',
    query("SELECT low_threshold, medium_threshold, high_threshold FROM risk_rule_versions WHERE version_num=2", { env })[0].join(','),
    '0,5,15',
  ));

  // Compliance cadence for FAR PROVINCIAL (a category-keyed rule, not
  // purpose-keyed — the bug this phase's own grounding caught).
  results.push(check(
    'FAR PROVINCIAL cadence',
    query("SELECT cadence_type, cadence_days FROM compliance_rule_versions WHERE category='FAR PROVINCIAL'", { env })[0].join(','),
    'QUARTERLY,92',
  ));

  // The FINALIZED 2026 snapshot must be v2 (the correction), and its
  // frozen result_json must round-trip the same totals as the relational
  // projection (report_snapshot_store_results) — both written from the
  // same source, never independently recalculated.
  results.push(check(
    'REPORT-2026 current FINALIZED version',
    scalar("SELECT snapshot_version FROM report_snapshots WHERE reporting_year=2026 AND status='FINALIZED'", { env }),
    '2',
  ));
  results.push(check(
    'REPORT-2026-v2 result_json storeCount matches relational projection row count',
    scalar("SELECT (result_json->'totals'->>'storeCount')::int FROM report_snapshots WHERE snapshot_id='REPORT-2026-v2'", { env }),
    scalar("SELECT count(*) FROM report_snapshot_store_results WHERE snapshot_id='REPORT-2026-v2'", { env }),
  ));
  results.push(check(
    'REPORT-2026-v2 supersedes REPORT-2026-v1',
    scalar("SELECT supersedes_snapshot_id FROM report_snapshots WHERE snapshot_id='REPORT-2026-v2'", { env }),
    'REPORT-2026-v1',
  ));
  results.push(check(
    'REPORT-2026-v1 flipped to SUPERSEDED (status-only mutation)',
    scalar("SELECT status FROM report_snapshots WHERE snapshot_id='REPORT-2026-v1'", { env }),
    'SUPERSEDED',
  ));

  // The legacy purposes/compliance categories must carry is_legacy flags,
  // not silently exist as ordinary rows indistinguishable from a
  // deliberately-configured one.
  results.push(check(
    "purposes.is_legacy for 'STORE VISIT'",
    scalar("SELECT is_legacy FROM purposes WHERE purpose_id='STORE VISIT'", { env }),
    't',
  ));

  return results;
}

module.exports = { runFieldChecks };
