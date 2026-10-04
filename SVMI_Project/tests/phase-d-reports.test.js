// Phase D.1: Visited This Month by Store ID from the visit tables
// (SVMKPI_VISIT_DATA.gs), the Report Source switch and Compare Reports.
// Runs the REAL Apps Script code in a Node vm sandbox, reusing the
// store-name-matching test's in-memory spreadsheet and seed data.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lib = {};
const testSrc = fs.readFileSync(path.join(__dirname, 'store-name-matching.test.js'), 'utf8');
new Function('lib', 'require', '__dirname',
  testSrc.split("console.log('\\n── Find:")[0] + '\nlib.newSandbox = newSandbox; lib.seed = seed; lib.cell = cell; lib.sheetRows = sheetRows;'
)(lib, require, __dirname);

const src = f => fs.readFileSync(path.join(__dirname, '..', 'Apps Script', f), 'utf8');
const EXTRA = ['SVMKPI_REPORTING_YEAR.gs', 'SVMKPI_CALENDAR.gs', 'SVMKPI_COMPLIANCE_CONFIG.gs', 'SVMKPI_RISK.gs', 'SVMKPI_STORE_LOOKUP.gs', 'SVMKPI_VISIT_DATA.gs'];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); fail++; }
}

function env() {
  const e = lib.newSandbox();
  const props = {};
  e.sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) };
  e.sandbox.SHEET = e.sandbox.SHEET || undefined;
  EXTRA.forEach(f => vm.runInContext(src(f), e.sandbox, { filename: f }));
  e.props = props;
  return e;
}

// Seed, then clean up the store names the way Leo did on live (v15–v18):
// Figaro Sta. Maria merged and named exactly like Angel's Pizza's store,
// closed stores created, visit tables rebuilt.
function cleaned() {
  const e = env();
  const ids = lib.seed(e);
  const s = e.sandbox;
  const run = d => { const r = s.portal_applyStoreCleanupDecision(d); if (!r.success) throw new Error(JSON.stringify(r)); return r; };
  run({ type: 'merge', keepId: ids.K, mergeIds: [ids.M], finalName: 'STA. MARIA' });
  run({ type: 'map', name: 'STA. MARIA (F)', storeId: ids.K });
  run({ type: 'create', name: 'SHANGRILA', storeName: 'SHANGRILA', brand: "ANGEL'S PIZZA", region: 'NCR', category: 'NCR', active: false, closedFrom: '2026-06-01' });
  run({ type: 'create', name: 'URDANETA FIGARO', storeName: 'URDANETA', brand: 'FIGARO', region: 'FRANCHISE', category: 'FAR PROVINCIAL', active: false, closedFrom: '2026-05-06' });
  run({ type: 'merge', keepId: ids.SP, mergeIds: [], finalName: 'SAN PEDRO' });
  const rb = s.portal_rebuildVisitTables();
  if (!rb.success) throw new Error(rb.message);
  return { e, s, ids };
}

console.log('\n── Default: reports still read MASTER_LOG ──');
{
  const { s } = cleaned();
  const viaPortal = s.sl_getVisitedThisMonth([], 7, 2026);
  const fromLog = s._sl_visitedThisMonthFromLog_([], 7, 2026);
  check('no switch set → Visited This Month = the MASTER_LOG version', JSON.stringify(viaPortal) === JSON.stringify(fromLog));
  check('...which has no Store IDs', viaPortal.resolved.every(r => !('storeId' in r)));
}

console.log('\n── Switched to the visit tables ──');
{
  const { e, s, ids } = cleaned();
  const on = s.portal_useVisitTablesForReports();
  check('switch on succeeds', on.success && e.props.SVMI_REPORT_SOURCE === 'TABLES', on);

  const jul = s.sl_getVisitedThisMonth([], 7, 2026);
  const fig = jul.resolved.filter(r => r.storeId === ids.K)[0];
  check('July: Figaro STA. MARIA, 2 visits, by Store ID', fig && fig.name === 'STA. MARIA' && fig.brand === 'FIGARO' && fig.visits === 2, jul.resolved);
  check('no Date objects (google.script.run)', !JSON.stringify(jul).includes('T00:00') && jul.resolved.every(r => typeof r.lastVisitDate === 'string'));

  const jan = s.sl_getVisitedThisMonth([], 1, 2026);
  const ap = jan.resolved.filter(r => r.storeId === ids.APSM)[0];
  check('January: Angel\'s Pizza STA. MARIA is its own row (same name, other brand)', ap && ap.name === 'STA. MARIA' && ap.brand === "ANGEL'S PIZZA" && ap.visits === 1, jan.resolved);
  const sha = jan.resolved.filter(r => r.name === 'SHANGRILA')[0];
  check('January: closed store SHANGRILA counts in its store, brand from CONFIG_STORES', sha && sha.brand === "ANGEL'S PIZZA" && sha.region === 'NCR' && sha.visits === 1, jan.resolved);
  check('January: nothing unmapped', jan.unmapped.length === 0, jan.unmapped);

  const oldJan = s._sl_visitedThisMonthFromLog_([], 1, 2026);
  check('(the old report listed SHANGRILA as unmapped — it is closed, so not in SETTINGS)', oldJan.unmapped.some(u => u.name === 'SHANGRILA'), oldJan);

  const figOnly = s.sl_getVisitedThisMonth(['FIGARO'], 7, 2026);
  check('brand filter uses the store\'s brand', figOnly.resolved.length && figOnly.resolved.every(r => r.brand === 'FIGARO'), figOnly.resolved);

  const off = s.portal_useMasterLogForReports();
  check('switch back → MASTER_LOG version again', off.success && JSON.stringify(s.sl_getVisitedThisMonth([], 7, 2026)) === JSON.stringify(s._sl_visitedThisMonthFromLog_([], 7, 2026)));
}

console.log('\n── A visit with no Store ID is listed as unmapped ──');
{
  const { e, s } = cleaned();
  const SD = e.SDate;
  e.master.appendRow([new SD(2026, 6, 2, 9), new SD(2026, 6, 2), 'NOWHERE MALL', 'FIGARO', 'NCR', 'LEO', 'STORE VISIT', '', '']);
  s.portal_rebuildVisitTables();
  s.portal_useVisitTablesForReports();
  const jul = s.sl_getVisitedThisMonth([], 7, 2026);
  check('NOWHERE MALL → unmapped with 1 visit', jul.unmapped.length === 1 && jul.unmapped[0].name === 'NOWHERE MALL' && jul.unmapped[0].visits === 1, jul.unmapped);
}

console.log('\n── Missing tables → MASTER_LOG, and the switch refuses ──');
{
  const e = env();
  lib.seed(e);
  const s = e.sandbox;
  const r = s.portal_useVisitTablesForReports();
  check('switch refused without tables', !r.success && /Rebuild Visit Tables/.test(r.message), r);
  e.props.SVMI_REPORT_SOURCE = 'TABLES'; // set anyway (e.g. tables deleted later)
  check('report falls back to MASTER_LOG', JSON.stringify(s.sl_getVisitedThisMonth([], 7, 2026)) === JSON.stringify(s._sl_visitedThisMonthFromLog_([], 7, 2026)));
}

console.log('\n── Compare Reports ──');
{
  const { s } = cleaned();
  const c = s.portal_compareReports();
  check('after cleanup: closed-store visits counted as placed', /2 visit\(s\) the old report could not place are now in their store/.test(c.message), c.message);
  // The only real difference is an OLD-report bug the tables fix: Figaro URDANETA is
  // closed, so it isn't in SETTINGS, and the old report gave its May visit to the open
  // Angel's Pizza URDANETA (same name).
  check('only difference: May URDANETA visit moves from Angel\'s Pizza (old, wrong) to Figaro (tables)',
    c.diffs === 2 && c.errors.every(x => x.row === 'May' && /^URDANETA/.test(x.message))
    && c.errors.some(x => /URDANETA \(ANGEL'S PIZZA\): MASTER_LOG 1 visit\(s\), tables 0/.test(x.message))
    && c.errors.some(x => /URDANETA \(FIGARO\): MASTER_LOG 0 visit\(s\), tables 1/.test(x.message)), c.errors);
  check('each difference shows the MASTER_LOG rows and where the tables put them', c.errors.some(x => /URDANETA \(FIGARO\).*row 11 → URDANETA \(FIGARO\)/.test(x.message)), c.errors);
  check('message names what reports read now', /reports now read: MASTER_LOG/.test(c.message), c.message);

  const cmp = s.svd_compareVisited_(
    { resolved: [{ name: 'A', brand: 'FIGARO', visits: 2 }, { name: 'B', brand: 'APEX', visits: 1 }], unmapped: [{ name: 'C', visits: 3 }] },
    { resolved: [{ name: 'A', brand: 'FIGARO', visits: 2 }, { name: 'B', brand: 'APEX', visits: 4 }, { name: 'C', brand: 'APEX', visits: 3 }], unmapped: [] });
  check('compare: equal → same, unmapped→placed, other change → difference', cmp.same === 1 && cmp.placed === 3 && cmp.diffs.length === 1 && cmp.diffs[0].store === 'B', cmp);
}

console.log('\n── Compare explains differences by MASTER_LOG row ──');
{
  const { e, s, ids } = cleaned();
  // Row 7 is Angel's Pizza STA. MARIA's January visit (Store ID APSM). Say the
  // visitor picked FIGARO as brand: the old report (trusts column D for a shared
  // name) gives it to Figaro STA. MARIA; the tables (trust Store ID) keep it at AP.
  e.master.getRange(7, 4).setValue('FIGARO');
  s.portal_rebuildVisitTables();
  const c = s.portal_compareReports();
  check('January STA. MARIA shows as a difference', c.diffs >= 2 && c.errors.some(x => x.row === 'Jan' && /STA\. MARIA \(ANGEL'S PIZZA\): MASTER_LOG 0 visit\(s\), tables 1/.test(x.message)), c.errors);
  check('...and the cause is listed with its MASTER_LOG row number', c.mismatches === 1 && c.errors.some(x => x.row === 7 && /MASTER_LOG brand FIGARO, but its Store ID is STA\. MARIA \(ANGEL'S PIZZA\)/.test(x.message)), c.errors);
  check('message counts the rows', /1 MASTER_LOG row\(s\) whose Brand \(D\) is not the brand of their Store ID \(I\)/.test(c.message), c.message);
}

console.log('\n── Compare lists visits whose Store ID points to a deactivated store ──');
{
  const { s, ids } = cleaned();
  // Deactivate (void) every version of SAN PEDRO in Configuration — it then
  // resolves on no date, so the tables can't place its visits.
  s.cfg_getConfiguration('STORES', ids.SP).forEach(v => s.cfg_deactivateConfiguration('STORES', v.versionId, 'test', {}));
  const c = s.portal_compareReports();
  check('its visits are listed by MASTER_LOG row with the reason', c.unplaced >= 2 && c.errors.some(x => x.row === 12 && /Store ID STR-[^ ]+ \(SAN PEDRO, ANGEL'S PIZZA\) has no active version in CONFIG_STORES/.test(x.message)), c.errors);
  check('message counts them', /visit\(s\) the tables can't place in a store/.test(c.message), c.message);
}

console.log('\n── Admin only ──');
{
  const { e, s } = cleaned();
  e.state.isAdmin = false;
  check('compare refused', !s.portal_compareReports().success);
  check('switch refused', !s.portal_useVisitTablesForReports().success && !s.portal_useMasterLogForReports().success && !e.props.SVMI_REPORT_SOURCE);
}

console.log('\n══════════════════════════════════');
console.log('  PASS ' + pass + '   FAIL ' + fail);
process.exit(fail ? 1 : 0);
