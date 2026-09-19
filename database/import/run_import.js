#!/usr/bin/env node
// database/import/run_import.js
//
// Orchestrates extract -> transform -> load against a fixture file, with
// the SAME production-safety gate run_migrations.sh uses: refuses unless
// SVMI_DB_ENV=dev (there is no "prod" mode for this script at all — a
// real production migration is explicitly out of scope for this phase;
// see docs/03-migration-mapping.md).
//
// Usage:
//   SVMI_DB_ENV=dev PGHOST=127.0.0.1 PGUSER=svmi_migrator PGPASSWORD=... \
//     PGDATABASE=svmi_dev node database/import/run_import.js \
//     database/import/fixtures/spreadsheet_fixture.json

const path = require('path');
const { extract } = require('./extract');
const { transform } = require('./transform');
const { load } = require('./load');

function main() {
  if (process.env.SVMI_DB_ENV !== 'dev') {
    console.error(`REFUSED: SVMI_DB_ENV must be exactly 'dev' (got: '${process.env.SVMI_DB_ENV || '<unset>'}'). This importer has no production mode — see this file's header comment.`);
    process.exit(1);
  }

  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error('Usage: node run_import.js <fixture.json>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(fixturePath);
  console.log(`[import] extracting: ${resolvedPath}`);
  const data = extract(resolvedPath);

  console.log('[import] transforming...');
  const { tables, warnings } = transform(data);

  for (const w of warnings) {
    console.warn(`[import] WARNING: ${w}`);
  }

  console.log('[import] table row counts:');
  for (const [table, rows] of Object.entries(tables)) {
    console.log(`  ${table}: ${rows.length}`);
  }

  console.log(`[import] loading into database: ${process.env.PGDATABASE || '<unset>'} (host: ${process.env.PGHOST || '<unset>'})`);
  load(tables, { reset: true });

  console.log(`[import] done. ${warnings.length} warning(s).`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
