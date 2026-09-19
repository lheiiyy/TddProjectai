// database/import/extract.js
//
// "Extraction" step of the extract -> transform -> load pipeline. In
// production this step would eventually read the real Google Sheet
// (SETTINGS / MASTER_LOG / CONFIG_* / CONFIG_AUDIT / REPORT_SNAPSHOTS)
// via the Sheets API — deliberately NOT built here (this phase never
// touches live production data). Today it reads a SYNTHETIC fixture file
// shaped exactly like those sheets (see import/fixtures/spreadsheet_fixture.json)
// so the rest of the pipeline (transform/load/validate) can be built and
// proven against something real, without ever needing Sheets credentials
// or live data.
//
// Swapping this one function out for a real Sheets-API reader later is
// the ONLY change a genuine future migration would need — transform.js
// and load.js are already written against the extracted shape, not
// against "is this a fixture."

const fs = require('fs');

function extract(fixturePath) {
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const data = JSON.parse(raw);
  const required = [
    'settings', 'configStores', 'configVisitors', 'configPurposes',
    'configComplianceRules', 'configRisk', 'configKpi', 'configSystem',
    'configAudit', 'masterLog', 'reportSnapshots',
  ];
  for (const key of required) {
    if (!Array.isArray(data[key])) {
      throw new Error(`extract(): fixture is missing required array field "${key}"`);
    }
  }
  return data;
}

module.exports = { extract };
