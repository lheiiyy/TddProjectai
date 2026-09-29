#!/usr/bin/env node
// database/export/hub_export.js
//
// KPI Monitoring Hub is a static site (GitHub Pages) and cannot open a
// PostgreSQL connection from the browser. This job reads the read-only
// kpi_hub_* views and writes one JSON file, in the same "rows" shape as
// the hub's existing data/cross-training.json, for the hub repo to commit
// as data/store-visits.json. Connection comes from libpq env vars only;
// use the svmi_hub_ro role (scripts/grant_hub_reader.sql).
//
// Usage:
//   PGHOST=... PGDATABASE=... PGUSER=svmi_hub_ro PGPASSWORD=... \
//     node database/export/hub_export.js <year> [out.json]

const fs = require('fs');
const { query } = require('../validation/psql_query');

function json(sql) {
  const rows = query(`SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)::text FROM (${sql}) t`);
  return JSON.parse(rows[0][0]);
}

function main() {
  const year = Number(process.argv[2]);
  if (!Number.isInteger(year)) {
    console.error('Usage: node hub_export.js <year> [out.json]');
    process.exit(1);
  }
  const out = process.argv[3] || 'store-visits.json';
  const y = `report_year = ${year}`;

  const payload = {
    generated_at: new Date().toISOString(),
    report_year: year,
    monthly: json(`SELECT * FROM kpi_hub_store_visit_compliance WHERE ${y} ORDER BY visitor_id, report_month`),
    weekly: json(`SELECT * FROM kpi_hub_visitor_weekly WHERE ${y} ORDER BY visitor_id, report_month, week_of_month`),
    team: json(`SELECT * FROM kpi_hub_team_monthly WHERE ${y} ORDER BY report_month`),
  };
  fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[hub_export] wrote ${out}: ${payload.monthly.length} monthly, ${payload.weekly.length} weekly, ${payload.team.length} team rows`);
}

if (require.main === module) main();
