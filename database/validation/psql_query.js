// database/validation/psql_query.js
// Tiny shared helper: runs one SQL query via `psql` (no `pg` npm
// dependency — see import/load.js's header for why) and returns rows as
// an array of string arrays. Used by both the count-comparison and
// field-sample validation scripts.

const { spawnSync } = require('child_process');

function query(sql, { env = process.env } = {}) {
  const result = spawnSync('psql', ['-tA', '-F', '\t', '-c', sql], { env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`psql query failed: ${sql}\n${result.stderr}`);
  }
  const trimmed = result.stdout.replace(/\n$/, '');
  if (trimmed === '') return [];
  return trimmed.split('\n').map((line) => line.split('\t'));
}

function scalar(sql, opts) {
  const rows = query(sql, opts);
  return rows.length ? rows[0][0] : null;
}

module.exports = { query, scalar };
