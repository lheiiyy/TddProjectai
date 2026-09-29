#!/usr/bin/env node
// database/import/import_cross_training.js
//
// Loads a CSV export of the CROSS TRAINED STAFFS MONITORING sheet into
// cross_training_validations. Real staff data is deliberately NOT
// committed: pass the CSV path (File > Download > CSV from the native
// Google Sheet). Dev-gated like run_import.js.
//
// Usage:
//   SVMI_DB_ENV=dev PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... \
//     node database/import/import_cross_training.js sheet.csv [sheet_id]
//   Add --dry-run to print the SQL instead of applying it.

const fs = require('fs');
const { spawnSync } = require('child_process');

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((v) => v !== '')) rows.push(row); }
  return rows;
}

// "97%" -> 97; anything else (blank, compound like "SVC-92/CAS-90") -> null.
function parseGrade(raw) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(raw || '');
  return m ? Number(m[1]) : null;
}

function lit(v) {
  return v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
}

function toRecords(csvText) {
  const [header, ...rows] = parseCsv(csvText);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const col of ['brand', 'validation_date', 'store', 'staff_name', 'mother_station', 'station_validation']) {
    if (!(col in idx)) throw new Error(`missing column: ${col}`);
  }
  return rows.map((r, n) => {
    const g = (k) => (r[idx[k]] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g('validation_date'))) {
      throw new Error(`row ${n + 2}: validation_date must be YYYY-MM-DD, got '${g('validation_date')}'`);
    }
    const remarks = g('remarks');
    return {
      brand: g('brand'), validated_on: g('validation_date'), store_name: g('store'),
      staff_name: g('staff_name'), mother_station: g('mother_station'),
      station_validated: g('station_validation'),
      tech_val_grade_raw: g('tech_val_grade'), tech_val_grade: parseGrade(g('tech_val_grade')),
      exam_grade_raw: g('exam_grade'), exam_grade: parseGrade(g('exam_grade')),
      training_dept: g('training_dept'), remarks,
      passed: /\bFAILED\b/i.test(remarks) ? false : null,
    };
  });
}

function toSql(records, sheetId) {
  const cols = ['brand', 'validated_on', 'store_name', 'staff_name', 'mother_station', 'station_validated',
    'tech_val_grade_raw', 'tech_val_grade', 'exam_grade_raw', 'exam_grade', 'training_dept', 'remarks', 'passed', 'source_sheet_id'];
  const values = records.map((r) => '(' + [
    lit(r.brand), lit(r.validated_on), lit(r.store_name), lit(r.staff_name), lit(r.mother_station), lit(r.station_validated),
    lit(r.tech_val_grade_raw), r.tech_val_grade === null ? 'NULL' : r.tech_val_grade,
    lit(r.exam_grade_raw), r.exam_grade === null ? 'NULL' : r.exam_grade,
    lit(r.training_dept), lit(r.remarks), r.passed === null ? 'NULL' : (r.passed ? 'TRUE' : 'FALSE'), lit(sheetId),
  ].join(', ') + ')');
  return `BEGIN;\nINSERT INTO cross_training_validations (${cols.join(', ')}) VALUES\n${values.join(',\n')}\n` +
    `ON CONFLICT (brand, validated_on, store_name, staff_name, station_validated) DO UPDATE SET\n` +
    `  tech_val_grade_raw = EXCLUDED.tech_val_grade_raw, tech_val_grade = EXCLUDED.tech_val_grade,\n` +
    `  exam_grade_raw = EXCLUDED.exam_grade_raw, exam_grade = EXCLUDED.exam_grade,\n` +
    `  training_dept = EXCLUDED.training_dept, remarks = EXCLUDED.remarks, passed = EXCLUDED.passed;\nCOMMIT;\n`;
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dry = process.argv.includes('--dry-run');
  if (!args[0]) { console.error('Usage: import_cross_training.js <sheet.csv> [sheet_id] [--dry-run]'); process.exit(1); }
  if (!dry && process.env.SVMI_DB_ENV !== 'dev') {
    console.error(`REFUSED: SVMI_DB_ENV must be exactly 'dev' (got: '${process.env.SVMI_DB_ENV || '<unset>'}').`);
    process.exit(1);
  }
  const sql = toSql(toRecords(fs.readFileSync(args[0], 'utf8')), args[1] || null);
  if (dry) { process.stdout.write(sql); return; }
  const r = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
  process.exit(r.status === null ? 1 : r.status);
}

if (require.main === module) main();
module.exports = { parseCsv, parseGrade, toRecords, toSql };
