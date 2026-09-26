#!/usr/bin/env node
// database/validation/run_validation.js
//
// Runs the full validation suite (business-total counts + field-by-field
// sample checks) against whatever database the environment variables
// point at, and prints a PASS/FAIL line per check. Exits non-zero if any
// check fails, so it can gate a pipeline the same way the SVMI_Project
// test suite does.
//
// Usage:
//   PGHOST=127.0.0.1 PGUSER=svmi_migrator PGPASSWORD=... PGDATABASE=svmi_dev \
//     node database/validation/run_validation.js database/import/fixtures/spreadsheet_fixture.json

const path = require('path');
const { runCountValidation } = require('./counts');
const { runFieldChecks } = require('./field_checks');

function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error('Usage: node run_validation.js <fixture.json>');
    process.exit(1);
  }

  const results = [
    ...runCountValidation(path.resolve(fixturePath)),
    ...runFieldChecks(),
  ];

  let failCount = 0;
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass) failCount += 1;
    console.log(`[${status}] ${r.check}  (expected: ${r.expected}, actual: ${r.actual})`);
  }

  console.log(`\n${results.length - failCount}/${results.length} checks passed.`);
  if (failCount > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
