const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, parseGrade, toRecords, toSql } = require('./import_cross_training');

const CSV = `brand,validation_date,store,staff_name,mother_station,tech_val_grade,exam_grade,station_validation,training_dept,remarks
ANGELS PIZZA,2026-08-26,AP DAU,TEST ONE,CASHIER,60%,70%,FOODPREP,ANN,FAILED
ANGELS PIZZA,2026-09-04,PASIG,"DOE, JANE",FOOD PREP,,SVC-92/CAS-90,PIZZA MAKER,ANN,
`;

test('parseGrade handles percent, blank and compound values', () => {
  assert.strictEqual(parseGrade('97%'), 97);
  assert.strictEqual(parseGrade(''), null);
  assert.strictEqual(parseGrade('SVC-92/CAS-90'), null);
});
test('quoted commas survive and FAILED sets passed=false', () => {
  const recs = toRecords(CSV);
  assert.strictEqual(recs[1].staff_name, 'DOE, JANE');
  assert.strictEqual(recs[0].passed, false);
  assert.strictEqual(recs[1].passed, null);
  assert.strictEqual(recs[1].exam_grade, null);
  assert.strictEqual(recs[1].exam_grade_raw, 'SVC-92/CAS-90');
});
test('SQL escapes quotes and is idempotent via ON CONFLICT', () => {
  const sql = toSql(toRecords(CSV.replace('TEST ONE', "O'NEIL")), 'sheet1');
  assert.match(sql, /'O''NEIL'/);
  assert.match(sql, /ON CONFLICT/);
});
test('bad date is rejected', () => {
  assert.throws(() => toRecords(CSV.replace('2026-08-26', 'Aug 26')), /YYYY-MM-DD/);
});
