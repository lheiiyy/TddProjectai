// ============================================================
// SVMKPI_VISIT_DATA.gs
// Phase D — reports read the visit tables by Store ID.
// ------------------------------------------------------------
// Phase C built STORE_VISITS / STORE_VISIT_VISITORS (SVMKPI_TABLES.gs): one
// row per visit with its Store ID, one row per visitor. Phase D moves the
// reports onto them, one report at a time, so a store is identified by its
// Store ID — never by its name — and its brand/region come from
// CONFIG_STORES (one place for each fact).
//
// Safety:
//   * Switch: System Tools → "Reports read: visit tables / MASTER_LOG"
//     (Script Property SVMI_REPORT_SOURCE). Default = MASTER_LOG, so
//     deploying this changes nothing until an admin switches it on.
//   * If the tables are missing, a report silently uses MASTER_LOG.
//   * System Tools → "Compare Reports" runs the old and the new version
//     side by side and lists every difference, read-only.
//
// Reports on the tables so far: Visited This Month (D.1), Unvisited / NAC (D.2), Store Insights (D.3),
// Store Health (D.4 — computed live; the STORE HEALTH sheet is rebuilt from the same rows).
//
// Every function except the portal_ entry points ends in "_" (private).
// ============================================================

const SVD_SOURCE_PROP = 'SVMI_REPORT_SOURCE';
const SVD_SOURCE = { TABLES: 'TABLES', MASTER_LOG: 'MASTER_LOG' };


// ═══════════════════════════════════════════════════════════════
// SECTION 1: PUBLIC ENTRY POINTS (System Tools, admin only)
// ═══════════════════════════════════════════════════════════════

function portal_useVisitTablesForReports() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  if (!svd_tablesExist_()) return { success: false, message: 'STORE_VISITS / STORE_VISIT_VISITORS not found — run Rebuild Visit Tables first.' };
  svd_setSource_(SVD_SOURCE.TABLES);
  if (typeof svmiAuditSystem_ === 'function') svmiAuditSystem_('REPORT_SOURCE', 'SWITCH', 'TABLES');
  return { success: true, message: 'Reports now read the visit tables (by Store ID): Visited This Month, Unvisited / NAC, Store Insights, Store Health.' };
}

function portal_useMasterLogForReports() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  svd_setSource_(SVD_SOURCE.MASTER_LOG);
  if (typeof svmiAuditSystem_ === 'function') svmiAuditSystem_('REPORT_SOURCE', 'SWITCH', 'MASTER_LOG');
  return { success: true, message: 'Reports read MASTER_LOG again (as before Phase D).' };
}

/** v28: which source the reports read now (for the Report Source card). */
function portal_getReportSource() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  return { success: true, source: svd_useTables_() && svd_tablesExist_() ? SVD_SOURCE.TABLES : SVD_SOURCE.MASTER_LOG };
}

/**
 * portal_compareReports()
 * Read-only. For every month of the reporting year up to now, runs
 * Visited This Month the old way (MASTER_LOG + SETTINGS, by name) and the
 * new way (visit tables, by Store ID) and lists each store whose numbers
 * differ. Expected, harmless differences are reported separately:
 *   - a visit the old way could not place ("unmapped") that the new way
 *     places in its store (closed stores, old spellings);
 * Anything else is a real difference to look at before switching.
 */
function portal_compareReports() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.', errors: [] };
  try {
    if (!svd_tablesExist_()) return { success: false, message: 'Visit tables not found — run Rebuild Visit Tables first.', errors: [] };
    const year = getDefaultReportingYear();
    const now = new Date();
    const lastMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
    const data = svd_loadVisits_();
    let same = 0, placed = 0;
    const diffs = [];
    for (let m = 1; m <= lastMonth; m++) {
      const oldR = _sl_visitedThisMonthFromLog_([], m, year);
      const newR = svd_visitedThisMonth_([], m, year, data);
      const c = svd_compareVisited_(oldR, newR);
      same += c.same;
      placed += c.placed;
      c.diffs.forEach(d => diffs.push(Object.assign({ month: m }, d)));
    }
    // D.2 — Unvisited / NAC, each month evaluated as fully elapsed (or up to today).
    let gSame = 0, gClosedLater = 0;
    const gDiffs = [];
    for (let m = 1; m <= lastMonth; m++) {
      const c = svd_compareGaps_(_sl_complianceGapsFromLog_([], m, year), svd_complianceGaps_([], m, year, null, data));
      gSame += c.same;
      gClosedLater += c.closedLater;
      c.diffs.forEach(d => gDiffs.push(Object.assign({ month: m }, d)));
    }
    const monthName = m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
    // Each difference with the MASTER_LOG rows behind it: where the tables put
    // every visit recorded under that name that month.
    const storeNow = svd_storeLookup_(null);
    const where = (m, name) => data
      .filter(v => v.date && v.date.getFullYear() === year && v.date.getMonth() === m - 1 && v.recordedName === _normalizeEnum(name))
      .map(v => {
        const info = v.storeId ? storeNow(v.storeId) : null;
        return 'row ' + v.sourceRow + ' → ' + (info ? info.name + ' (' + info.brand + ')' : (v.storeId ? v.storeId + ' (no active store)' : 'no Store ID'));
      });
    // D.3 — Store Insights totals per store.
    const ins = svd_compareInsights_(data);
    // D.4 — Store Health: last visit + visits this year per store.
    const sh = svd_compareStoreHealth_(data);
    const errors = diffs.slice(0, 60).map(d => {
      const rows = where(d.month, d.store);
      return {
        row: monthName(d.month),
        message: d.store + ' (' + (d.brand || '—') + '): MASTER_LOG ' + d.oldVisits + ' visit(s), tables ' + d.newVisits
          + (rows.length ? ' · ' + rows.slice(0, 6).join('; ') : ''),
      };
    });
    ins.diffs.slice(0, 60).forEach(d => errors.push({
      row: 'Insights',
      message: d.store + ' (' + (d.brand || '—') + '): MASTER_LOG ' + d.oldVisits + ' visit(s) by name, tables ' + d.newVisits + ' by Store ID' + (d.storeId ? '' : ' (no store with this name + brand in CONFIG_STORES)'),
    }));
    sh.diffs.slice(0, 60).forEach(d => errors.push({
      row: 'Health',
      message: d.store + ' (' + (d.brand || '—') + '): MASTER_LOG by name ' + d.old + ' · tables by Store ID ' + d.now,
    }));
    sh.oldOnly.slice(0, 30).forEach(o => errors.push({
      row: 'Health',
      message: '"' + o.store + '" (' + (o.brand || '—') + ') was a row of its own in the old Store Health — not an open store in CONFIG_STORES (old spelling, closed store, or the other brand); its visits now count in their store',
    }));
    gDiffs.slice(0, 60).forEach(d => errors.push({
      row: monthName(d.month) + ' NAC',
      message: d.store + ' (' + (d.brand || '—') + '): MASTER_LOG ' + d.old + ', tables ' + d.now,
    }));
    // Why they differ: the old report trusts the Brand column (D) when two
    // brands share a name, the tables trust the Store ID (column I).
    const unplaced = svd_unplaced_(data, year);
    unplaced.slice(0, 60).forEach(x => errors.push({
      row: x.row,
      message: '"' + x.name + '" on ' + x.date + ' — ' + x.why,
    }));
    const mismatches = svd_brandMismatches_(data, year);
    mismatches.slice(0, 60).forEach(x => errors.push({
      row: x.row,
      message: '"' + x.name + '" on ' + x.date + ' — MASTER_LOG brand ' + (x.rowBrand || '(blank)') + ', but its Store ID is ' + x.storeName + ' (' + x.storeBrand + ')',
    }));
    const msg = 'Visited This Month, ' + year + ' (' + lastMonth + ' month' + (lastMonth === 1 ? '' : 's') + '): '
      + same + ' store-month(s) identical'
      + (placed ? ' · ' + placed + ' visit(s) the old report could not place are now in their store' : '')
      + (diffs.length ? ' · ⚠ ' + diffs.length + ' difference(s)' : ' · no other differences ✔')
      + ' || Unvisited/NAC: ' + gSame + ' store-month(s) identical'
      + (gClosedLater ? ' · ' + gClosedLater + ' store-month(s) of stores closed since then (open at the time, now counted)' : '')
      + (gDiffs.length ? ' · ⚠ ' + gDiffs.length + ' difference(s) (rows marked NAC)' : ' · no other differences ✔')
      + ' || Store Insights: ' + ins.same + ' store(s) identical'
      + (ins.diffs.length ? ' · ⚠ ' + ins.diffs.length + ' with a different total (rows marked Insights)' : ' · no differences ✔')
      + ' || Store Health ' + sh.year + ': ' + sh.same + ' store(s) identical'
      + (sh.diffs.length ? ' · ' + sh.diffs.length + ' with a different last visit / count (rows marked Health)' : ' · no differences ✔')
      + (sh.oldOnly.length ? ' · ' + sh.oldOnly.length + ' old row(s) that were not real open stores' : '')
      + (unplaced.length ? ' · ' + unplaced.length + ' visit(s) the tables can\'t place in a store — listed below by MASTER_LOG row' : '')
      + (mismatches.length ? ' · ' + mismatches.length + ' MASTER_LOG row(s) whose Brand (D) is not the brand of their Store ID (I) — listed below by row' : '')
      + ' · reports now read: ' + (svd_useTables_() ? 'visit tables' : 'MASTER_LOG');
    return { success: diffs.length === 0 && gDiffs.length === 0 && ins.diffs.length === 0, message: msg, errors, diffs: diffs.length, gapDiffs: gDiffs.length, insightDiffs: ins.diffs.length, healthDiffs: sh.diffs.length, mismatches: mismatches.length, unplaced: unplaced.length };
  } catch (e) {
    if (typeof logError === 'function') logError('portal_compareReports', e);
    return { success: false, message: e.message, errors: [] };
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: SOURCE SWITCH
// ═══════════════════════════════════════════════════════════════

function svd_useTables_() {
  try {
    return PropertiesService.getScriptProperties().getProperty(SVD_SOURCE_PROP) === SVD_SOURCE.TABLES;
  } catch (e) {
    return false;
  }
}

function svd_setSource_(source) {
  PropertiesService.getScriptProperties().setProperty(SVD_SOURCE_PROP, source);
}

function svd_tablesExist_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return !!(ss.getSheetByName(SVT_SHEET.VISITS) && ss.getSheetByName(SVT_SHEET.VISIT_VISITORS));
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: DATA
// ═══════════════════════════════════════════════════════════════

/**
 * Every visit from the tables, with its visitors.
 * @returns {null|{visitId, date: Date|null, storeId, purpose, remarks, recordedName, visitors: string[]}[]}
 *   null when the tables don't exist (callers fall back to MASTER_LOG).
 */
function svd_loadVisits_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const vs = ss.getSheetByName(SVT_SHEET.VISITS);
  const vv = ss.getSheetByName(SVT_SHEET.VISIT_VISITORS);
  if (!vs || !vv) return null;

  const visitorsById = {};
  svt_readTable_(vv, SVT_VV_HEADERS.length).forEach(r => {
    const id = String(r[0] || '').trim();
    const who = _normalizeEnum(r[1]);
    if (!id || !who) return;
    (visitorsById[id] = visitorsById[id] || []).push(who);
  });

  const out = [];
  svt_readTable_(vs, SVT_VISIT_HEADERS.length).forEach(r => {
    const id = String(r[SVT_V.ID] || '').trim();
    if (!id) return;
    out.push({
      visitId: id,
      date: _parseDateCell(r[SVT_V.DATE]),
      storeId: String(r[SVT_V.STORE_ID] || '').trim().toUpperCase(),
      purpose: _normalizeEnum(r[SVT_V.PURPOSE]),
      remarks: String(r[SVT_V.REMARKS] == null ? '' : r[SVT_V.REMARKS]),
      recordedName: _normalizeEnum(r[SVT_V.STORE_NAME]),
      sourceRow: Number(r[SVT_V.SOURCE_ROW]) || 0,
      recordedAt: r[SVT_V.RECORDED_AT] instanceof Date ? r[SVT_V.RECORDED_AT] : (_parseDateCell(r[SVT_V.RECORDED_AT]) || null),
      visitors: visitorsById[id] || [],
    });
  });
  return out;
}

/**
 * Store facts by Store ID: today's version (current name, brand, region —
 * what people search for and what the old name-based reports showed; closed
 * stores included). A store with no version today falls back to its version
 * as of `asOf`.
 * @returns {function(string): ({name, brand, region, category, status}|null)}
 */
function svd_storeLookup_(asOf) {
  const toInfo = r => r && r.fields ? {
    name: _normalizeEnum(r.fields.storeName),
    brand: _normalizeEnum(r.fields.brand),
    region: _normalizeEnum(r.fields.region),
    category: _normalizeEnum(r.fields.category),
    status: _normalizeEnum(r.fields.status),
  } : null;
  const today = cfg_resolveAllAsOf(CFG_AREA.STORES, null);
  let atDate = null;
  return function (storeId) {
    if (!storeId) return null;
    if (today[storeId]) return toInfo(today[storeId]);
    if (!atDate) atDate = asOf ? cfg_resolveAllAsOf(CFG_AREA.STORES, asOf) : {};
    return toInfo(atDate[storeId]);
  };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: VISITED THIS MONTH (D.1)
// ═══════════════════════════════════════════════════════════════

/**
 * Same result shape as _sl_getVisitedThisMonth_impl() (SVMKPI_STORE_LOOKUP.gs)
 * plus `storeId` on each resolved row, but:
 *   - a visit belongs to its Store ID (two brands may share a name);
 *   - name/brand/region come from CONFIG_STORES (the store's current version);
 *   - closed stores count — their visits are no longer "unmapped";
 *   - only visits with no Store ID at all are listed as unmapped.
 * @param {object[]} [preloaded] svd_loadVisits_() result, to reuse one read
 * @returns {null|{resolved: object[], unmapped: object[]}} null = no tables
 */
function svd_visitedThisMonth_(brandFilter, monthNumber, reportingYear, preloaded) {
  const visits = preloaded || svd_loadVisits_();
  if (!visits) return null;

  const now  = new Date();
  const year = (reportingYear != null && !isNaN(Number(reportingYear))) ? Number(reportingYear) : getDefaultReportingYear();
  const refMonthIdx = (monthNumber && monthNumber >= 1 && monthNumber <= 12) ? monthNumber - 1 : now.getMonth();
  const monthStart = new Date(year, refMonthIdx, 1, 0, 0, 0, 0);
  const monthEnd   = new Date(year, refMonthIdx + 1, 0, 23, 59, 59, 999);

  const asOf = monthEnd.getTime() < now.getTime() ? monthEnd : now;
  const storeOf = svd_storeLookup_(asOf);

  const acc = {};
  const unmappedAcc = {};
  visits.forEach(v => {
    if (!v.date || v.date < monthStart || v.date > monthEnd) return;
    const info = v.storeId ? storeOf(v.storeId) : null;
    if (!info) {
      const name = v.recordedName || '(no name)';
      const u = unmappedAcc[name] || (unmappedAcc[name] = { visits: 0, lastDate: null });
      u.visits++;
      if (!u.lastDate || v.date > u.lastDate) u.lastDate = v.date;
      return;
    }
    if (!_slBrandAllowed(info.brand, brandFilter)) return;
    const a = acc[v.storeId] || (acc[v.storeId] = { info, visits: 0, lastDate: null, lastPurpose: '', visitors: {} });
    a.visits++;
    if (!a.lastDate || v.date > a.lastDate) { a.lastDate = v.date; a.lastPurpose = v.purpose; }
    v.visitors.forEach(n => { a.visitors[n] = true; });
  });

  const resolved = Object.keys(acc).map(id => {
    const a = acc[id];
    return {
      storeId:       id,
      name:          a.info.name,
      brand:         a.info.brand,
      region:        a.info.region,
      visits:        a.visits,
      lastVisitDate: a.lastDate ? _sl_formatDate(a.lastDate) : '—',
      lastPurpose:   a.lastPurpose || '—',
      visitors:      Object.keys(a.visitors).sort().join(', '),
      daysSince:     a.lastDate ? Math.floor((now - a.lastDate) / 86400000) : null,
    };
  });
  resolved.sort((a, b) => (a.daysSince - b.daysSince) || a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand));

  const unmapped = Object.keys(unmappedAcc).map(name => ({
    name,
    visits:        unmappedAcc[name].visits,
    lastVisitDate: unmappedAcc[name].lastDate ? _sl_formatDate(unmappedAcc[name].lastDate) : '—',
  }));
  unmapped.sort((a, b) => (b.visits - a.visits) || a.name.localeCompare(b.name));

  return { resolved, unmapped };
}

/**
 * Visits (in the reporting year) the tables count as "unmapped": no Store ID,
 * or a Store ID that no store resolves to (e.g. a store whose versions were
 * all deactivated in Admin → Configuration instead of being marked closed).
 * @returns {{row:number, date:string, name:string, storeId:string, why:string}[]}
 */
function svd_unplaced_(visits, year) {
  const storeOf = svd_storeLookup_(null);
  const out = [];
  visits.forEach(v => {
    if (!v.date || v.date.getFullYear() !== year) return;
    if (v.storeId && storeOf(v.storeId)) return;
    let why;
    if (!v.storeId) {
      why = 'no Store ID — fix in Store Name Matching';
    } else {
      const history = (typeof cfg_getConfiguration === 'function') ? cfg_getConfiguration(CFG_AREA.STORES, v.storeId) : [];
      const last = history.length ? history[history.length - 1] : null;
      const f = (last && last.fields) || {};
      why = last
        ? 'Store ID ' + v.storeId + ' (' + _normalizeEnum(f.storeName) + ', ' + _normalizeEnum(f.brand) + ') has no active version in CONFIG_STORES — it was deactivated, not closed'
        : 'Store ID ' + v.storeId + ' is not in CONFIG_STORES';
    }
    out.push({ row: v.sourceRow, date: _sl_formatDate(v.date), name: v.recordedName, storeId: v.storeId, why });
  });
  return out.sort((a, b) => a.row - b.row);
}

/**
 * Visits (in the reporting year) whose MASTER_LOG Brand column differs from
 * the brand of the store their Store ID points to. Either the visitor picked
 * the wrong brand, or the row got the wrong Store ID — a person decides.
 * @returns {{row:number, date:string, name:string, rowBrand:string, storeName:string, storeBrand:string}[]}
 */
function svd_brandMismatches_(visits, year) {
  const master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SL_SHEET.MASTER_LOG);
  if (!master || master.getLastRow() < 2) return [];
  const brands = master.getRange(2, SL_COL.BRAND + 1, master.getLastRow() - 1, 1).getValues();
  const storeOf = svd_storeLookup_(null);
  const out = [];
  visits.forEach(v => {
    if (!v.storeId || !v.sourceRow || !v.date || v.date.getFullYear() !== year) return;
    const info = storeOf(v.storeId);
    const cell = brands[v.sourceRow - 2];
    const rowBrand = cell ? _normalizeEnum(cell[0]) : '';
    if (!info || !rowBrand || rowBrand === info.brand) return;
    out.push({ row: v.sourceRow, date: _sl_formatDate(v.date), name: v.recordedName, rowBrand, storeName: info.name, storeBrand: info.brand });
  });
  return out.sort((a, b) => a.row - b.row);
}

/**
 * Old vs new Visited This Month for one month.
 * Rows are matched by store name + brand (the old report has no Store ID).
 * A store the new report has but the old one listed as unmapped (same
 * name) counts as "placed", not as a difference.
 */
function svd_compareVisited_(oldR, newR) {
  const key = (n, b) => _normalizeEnum(n) + '|' + _normalizeEnum(b);
  const oldBy = {}, newBy = {};
  (oldR.resolved || []).forEach(r => { oldBy[key(r.name, r.brand)] = r; });
  (newR.resolved || []).forEach(r => { newBy[key(r.name, r.brand)] = r; });
  const oldUnmapped = {};
  (oldR.unmapped || []).forEach(u => { oldUnmapped[_normalizeEnum(u.name)] = u.visits; });

  let same = 0, placed = 0;
  const diffs = [];
  const keys = {};
  Object.keys(oldBy).concat(Object.keys(newBy)).forEach(k => { keys[k] = true; });
  Object.keys(keys).sort().forEach(k => {
    const o = oldBy[k], n = newBy[k];
    const oldVisits = o ? o.visits : 0;
    const newVisits = n ? n.visits : 0;
    if (oldVisits === newVisits) { same++; return; }
    const name = (o || n).name;
    const fromUnmapped = Math.min(newVisits - oldVisits, oldUnmapped[_normalizeEnum(name)] || 0);
    if (fromUnmapped > 0 && oldVisits + fromUnmapped === newVisits) {
      placed += fromUnmapped;
      oldUnmapped[_normalizeEnum(name)] -= fromUnmapped;
      return;
    }
    diffs.push({ store: name, brand: (o || n).brand, oldVisits, newVisits });
  });
  return { same, placed, diffs };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: UNVISITED / NAC — COMPLIANCE GAPS (D.2)
// ═══════════════════════════════════════════════════════════════

/**
 * Same result shape as _sl_complianceGapsFromLog_() (SVMKPI_STORE_LOOKUP.gs)
 * plus `storeId`, with the same calendar-period-to-date rules, but:
 *   - visits are counted per Store ID (two brands may share a name);
 *   - the roster is CONFIG_STORES, not SETTINGS: every store that was OPEN
 *     on the evaluation date. A store closed since then still had to be
 *     visited in that period; a store closed by then is left out. A store
 *     whose first version starts later (start dates from the migration are
 *     not real opening dates) counts as open if it is open today.
 *   - name/brand/region/category shown are the store's current ones; the
 *     compliance rule is resolved as of the evaluation date, as before.
 * @returns {null|object[]} null = no tables (caller falls back to MASTER_LOG)
 */
function svd_complianceGaps_(brandFilter, monthNumber, reportingYear, evaluationDateStr, preloaded) {
  const visits = preloaded || svd_loadVisits_();
  if (!visits) return null;

  const now  = new Date();
  const year = (reportingYear != null && !isNaN(Number(reportingYear))) ? Number(reportingYear) : getDefaultReportingYear();
  const specificPeriodRequested = !!(monthNumber || reportingYear != null);
  const refMonthIdx = (monthNumber && monthNumber >= 1 && monthNumber <= 12) ? monthNumber - 1 : now.getMonth();
  const periodRefDate = new Date(year, refMonthIdx, 1);

  const monthPeriod   = resolveCalendarPeriod(periodRefDate, CAL_PERIOD_FAMILY.MONTH);
  const quarterPeriod = resolveCalendarPeriod(periodRefDate, CAL_PERIOD_FAMILY.QUARTER);
  const semiPeriod    = resolveCalendarPeriod(periodRefDate, CAL_PERIOD_FAMILY.SEMI_ANNUAL);

  let evaluationDate;
  if (evaluationDateStr) evaluationDate = _parseDateCell(evaluationDateStr) || now;
  else if (specificPeriodRequested) evaluationDate = monthPeriod.periodEnd;
  else evaluationDate = now;

  const clip = (periodEnd) => (periodEnd.getTime() < evaluationDate.getTime() ? periodEnd : evaluationDate);
  const win = {
    month:   [monthPeriod.periodStart,   clip(monthPeriod.periodEnd)],
    quarter: [quarterPeriod.periodStart, clip(quarterPeriod.periodEnd)],
    semi:    [semiPeriod.periodStart,    clip(semiPeriod.periodEnd)],
  };
  const inWin = (d, w) => d >= w[0] && d <= w[1];

  // ── Roster: open on the evaluation date (see above) ──
  const today = cfg_resolveAllAsOf(CFG_AREA.STORES, null);
  const atEval = cfg_resolveAllAsOf(CFG_AREA.STORES, evaluationDate);
  const isClosed = r => String((r.fields && r.fields.status) || CFG_STATUS.ACTIVE).toUpperCase() === CFG_STATUS.INACTIVE;
  const roster = {};
  Object.keys(today).forEach(id => {
    const cur = today[id];
    const then = atEval[id];
    if (then ? isClosed(then) : isClosed(cur)) return;
    const f = cur.fields || {};
    const brand = _normalizeEnum(f.brand);
    if (!_slBrandAllowed(brand, brandFilter)) return;
    roster[id] = { name: _normalizeEnum(f.storeName), brand, region: _normalizeEnum(f.region), category: _normalizeEnum(f.category) };
  });

  // ── Visits per Store ID ──
  const count = { month: {}, quarter: {}, semi: {} };
  const last = {}, ytd = {};
  visits.forEach(v => {
    if (!v.storeId || !roster[v.storeId] || !v.date) return;
    const id = v.storeId, d = v.date;
    if (d.getFullYear() === year) ytd[id] = (ytd[id] || 0) + 1;
    if (!last[id] || d > last[id]) last[id] = d;
    Object.keys(win).forEach(k => { if (inWin(d, win[k])) count[k][id] = (count[k][id] || 0) + 1; });
  });

  const complianceByCategory = cfg_resolveAllAsOf(CFG_AREA.COMPLIANCE, evaluationDate);
  const gaps = [];
  Object.keys(roster).forEach(id => {
    const st = roster[id];
    let rule = null;
    if (atEval[id] && typeof resolveComplianceConfigurationAsOf === 'function') {
      rule = resolveComplianceConfigurationAsOf(id, evaluationDate, atEval, complianceByCategory);
    }
    if (!rule && typeof _cmp_resolveByCategory === 'function') rule = _cmp_resolveByCategory(st.category, evaluationDate, complianceByCategory);
    if (!rule) return;

    const requiredCount = rule.requiredCount || 1;
    let windowLabel, actualCount;
    if (rule.periodDefinition === CAL_PERIOD_FAMILY.MONTH) { windowLabel = 'Monthly'; actualCount = count.month[id] || 0; }
    else if (rule.periodDefinition === CAL_PERIOD_FAMILY.QUARTER) { windowLabel = 'Quarterly'; actualCount = count.quarter[id] || 0; }
    else if (rule.periodDefinition === CAL_PERIOD_FAMILY.SEMI_ANNUAL) { windowLabel = 'Semi-Annual'; actualCount = count.semi[id] || 0; }
    else return;
    if (actualCount >= requiredCount) return;

    const lv = last[id] || null;
    gaps.push({
      storeId: id,
      store: st.name,
      brand: st.brand,
      region: st.region,
      category: st.category,
      lastVisitDate: lv ? _sl_formatDate(lv) : '—',
      daysSince: lv ? Math.floor((evaluationDate - lv) / 86400000) : null,
      windowLabel,
      ytdVisits: ytd[id] || 0,
      requiredCount,
      actualCount,
    });
  });
  gaps.sort((a, b) => a.store.localeCompare(b.store) || a.brand.localeCompare(b.brand));
  return gaps;
}

/**
 * Old vs new Unvisited / NAC for one month, matched by store name + brand.
 * `closedLater` = on the new list only because the store was open then but
 * is closed now (the old report reads today's SETTINGS, which drops closed
 * stores) — expected, not a difference.
 */
function svd_compareGaps_(oldGaps, newGaps) {
  const key = g => _normalizeEnum(g.store) + '|' + _normalizeEnum(g.brand);
  const oldBy = {}, newBy = {};
  (oldGaps || []).forEach(g => { oldBy[key(g)] = g; });
  (newGaps || []).forEach(g => { newBy[key(g)] = g; });
  const today = cfg_resolveAllAsOf(CFG_AREA.STORES, null);
  const closedNow = id => {
    const r = today[id];
    return !!r && String((r.fields && r.fields.status) || '').toUpperCase() === CFG_STATUS.INACTIVE;
  };
  let same = 0, closedLater = 0;
  const diffs = [];
  const keys = {};
  Object.keys(oldBy).concat(Object.keys(newBy)).forEach(k => { keys[k] = true; });
  Object.keys(keys).sort().forEach(k => {
    const o = oldBy[k], n = newBy[k];
    if (o && n && o.actualCount === n.actualCount) { same++; return; }
    if (!o && n && closedNow(n.storeId)) { closedLater++; return; }
    const g = o || n;
    diffs.push({
      store: g.store, brand: g.brand,
      old: o ? 'not met (' + o.actualCount + '/' + o.requiredCount + ')' : 'met / not listed',
      now: n ? 'not met (' + n.actualCount + '/' + n.requiredCount + ')' : 'met / not listed',
    });
  });
  return { same, closedLater, diffs };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6: STORE INSIGHTS (D.3)
// ═══════════════════════════════════════════════════════════════

/**
 * Picker list from CONFIG_STORES: every store, open and closed (a closed
 * store's history is still worth looking at), each with its Store ID.
 * @returns {null|{storeId, name, brand, region, closed}[]} null = no tables
 */
function svd_storeList_() {
  if (!svd_tablesExist_()) return null;
  const today = cfg_resolveAllAsOf(CFG_AREA.STORES, null);
  return Object.keys(today).map(id => {
    const f = today[id].fields || {};
    return {
      storeId: id,
      name: _normalizeEnum(f.storeName),
      brand: _normalizeEnum(f.brand),
      region: _normalizeEnum(f.region),
      closed: String(f.status || CFG_STATUS.ACTIVE).toUpperCase() === CFG_STATUS.INACTIVE,
    };
  }).filter(x => x.name).sort((a, b) => a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand));
}

/**
 * Same result shape as _sl_storeDataFromLog_() (SVMKPI_STORE_LOOKUP.gs),
 * plus meta.storeId / meta.closed, from the visits recorded under the
 * store's Store ID. Without a Store ID (old page, typed name) the store is
 * found by name + brand; a shared name with no brand is never guessed.
 * Health still comes from the shared Store Health engine (D.4 moves it).
 * @returns {null|object} null = no tables, or no such store (caller falls back)
 */
function svd_storeData_(storeId, storeName, brand, preloaded) {
  let id = String(storeId || '').trim().toUpperCase();
  if (!id && storeName && typeof store_resolveIdByCurrentName === 'function') {
    id = store_resolveIdByCurrentName(storeName, brand) || '';
  }
  if (!id) return null;
  const info = svd_storeLookup_(null)(id);
  if (!info) return null;
  const visits = preloaded || svd_loadVisits_();
  if (!visits) return null;

  const meta = { name: info.name, brand: info.brand, region: info.region, storeId: id, closed: info.status === CFG_STATUS.INACTIVE };
  const rows = visits.filter(v => v.storeId === id)
    .sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));

  // D.4 (v26): health from the same Store-ID rows as Store Health (one pass
  // over the visits already loaded) — no MASTER_LOG read, and the score here
  // always equals the store's Store Health row.
  const health = svd_storeHealthFor_(id, visits);

  if (!rows.length) {
    return {
      meta,
      summary:      { totalVisits: 0, lastVisitDate: '—', lastVisitor: '—', lastPurpose: '—' },
      purposes:     APPROVED_PURPOSES.map(label => ({ label, count: 0, pct: '0.0' })),
      topVisitors:  [],
      recentVisits: [],
      health,
      insight:      'No visit records found for ' + info.name + '. Schedule an initial store visit.',
    };
  }

  const who = v => v.visitors.length ? v.visitors.join(' | ') : '—';
  const totalVisits = rows.length;
  const last = rows[0];
  const lastVisitStr = last.date ? _sl_formatDate(last.date) : '—';
  const lastPurpose = last.purpose || '—';

  const purposeCounts = {};
  APPROVED_PURPOSES.forEach(p => { purposeCounts[p] = 0; });
  rows.forEach(v => { if (v.purpose) purposeCounts[v.purpose] = (purposeCounts[v.purpose] || 0) + 1; });
  const purposes = Object.keys(purposeCounts).map(label => ({
    label,
    count: purposeCounts[label],
    pct: ((purposeCounts[label] / totalVisits) * 100).toFixed(1),
  }));

  const visitorMap = {};
  rows.forEach(v => v.visitors.forEach(n => { visitorMap[n] = (visitorMap[n] || 0) + 1; }));
  const topVisitors = Object.keys(visitorMap)
    .map(name => ({ name, count: visitorMap[name] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, SL_TOP_VISITOR_LIMIT);

  const recentVisits = rows.slice(0, SL_RECENT_LIMIT).map(v => ({
    date:    v.date ? _sl_formatDate(v.date) : '—',
    visitor: who(v),
    purpose: v.purpose || '—',
    remarks: String(v.remarks || '').trim() || '—',
  }));

  const insight = _sl_generateInsight({
    meta, totalVisits, lastVisitStr, lastPurpose,
    purposes, topVisitors, health,
    failedCount: purposeCounts['FAILED QA/MS'],
  });

  return {
    meta,
    summary: { totalVisits, lastVisitDate: lastVisitStr, lastVisitor: who(last), lastPurpose },
    purposes,
    topVisitors,
    recentVisits,
    health,
    insight,
  };
}

/**
 * Store Insights, old vs new, for every store in SETTINGS (the old picker
 * list): total visits by name + brand from MASTER_LOG vs by Store ID from
 * the tables. Cheap — one pass over each, no per-store report run.
 */
function svd_compareInsights_(visits) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = ss.getSheetByName(SL_SHEET.SETTINGS);
  const master = ss.getSheetByName(SL_SHEET.MASTER_LOG);
  if (!settings || !master || settings.getLastRow() < 2) return { same: 0, diffs: [] };
  const oldCount = {};
  if (master.getLastRow() >= 2) {
    master.getRange(2, 1, master.getLastRow() - 1, 4).getValues().forEach(r => {
      const k = _normalizeEnum(r[SL_COL.STORE]) + '|' + _normalizeEnum(r[SL_COL.BRAND]);
      oldCount[k] = (oldCount[k] || 0) + 1;
    });
  }
  const newCount = {};
  visits.forEach(v => { if (v.storeId) newCount[v.storeId] = (newCount[v.storeId] || 0) + 1; });

  // name|brand → Store ID, from ONE CONFIG_STORES read (not one per store).
  const idByKey = {};
  const today = cfg_resolveAllAsOf(CFG_AREA.STORES, null);
  Object.keys(today).forEach(sid => {
    const f = today[sid].fields || {};
    const k = _normalizeEnum(f.storeName) + '|' + _normalizeEnum(f.brand);
    if (!idByKey[k]) idByKey[k] = sid;
  });

  let same = 0;
  const diffs = [];
  const seen = {};
  settings.getRange(2, 1, settings.getLastRow() - 1, 2).getValues().forEach(r => {
    const name = _normalizeEnum(r[0]), brand = _normalizeEnum(r[1]);
    if (!name || seen[name + '|' + brand]) return;
    seen[name + '|' + brand] = true;
    const id = idByKey[name + '|' + brand] || null;
    const o = oldCount[name + '|' + brand] || 0;
    const n = id ? (newCount[id] || 0) : 0;
    if (o === n) same++;
    else diffs.push({ store: name, brand, oldVisits: o, newVisits: n, storeId: id || '' });
  });
  return { same, diffs };
}



// ═══════════════════════════════════════════════════════════════
// SECTION 7: STORE HEALTH (D.4, v26)
// ═══════════════════════════════════════════════════════════════

/**
 * Store Health rows by Store ID from the visit tables — same scoring rules
 * as the MASTER_LOG version (_sl_scoreStores_ in SVMKPI_RISK.gs), but:
 *   - a visit belongs to its Store ID (old spellings, merged stores and
 *     two brands sharing a name all land on the right store);
 *   - the roster is every store OPEN today in CONFIG_STORES, with its
 *     current name / brand / region / category;
 *   - computed live on every read, so it always matches the other reports
 *     (the old sheet was a snapshot from the last rebuild).
 * @param {Date} [today]
 * @param {number} [year] reporting year; default = latest year with visits
 * @param {object[]} [preloaded] svd_loadVisits_() result
 * @returns {null|object[]} null = no tables
 */
function svd_storeRisk_(today, year, preloaded) {
  const visits = preloaded || svd_loadVisits_();
  if (!visits) return null;
  today = today || new Date();
  let evaluationYear = (year != null && !isNaN(Number(year))) ? Number(year) : null;
  if (evaluationYear === null) {
    visits.forEach(v => { if (v.date && (evaluationYear === null || v.date.getFullYear() > evaluationYear)) evaluationYear = v.date.getFullYear(); });
    if (evaluationYear === null) evaluationYear = today.getFullYear();
  }
  const monthLimit = today.getFullYear() === evaluationYear ? today.getMonth() : 11;

  const byStore = {};
  const stores = cfg_resolveAllAsOf(CFG_AREA.STORES, null);
  Object.keys(stores).forEach(id => {
    const f = stores[id].fields || {};
    if (String(f.status || CFG_STATUS.ACTIVE).toUpperCase() === CFG_STATUS.INACTIVE) return;
    const name = _normalizeEnum(f.storeName);
    if (!name) return;
    const s = _sl_freshRiskStore_(name, {
      brand: _normalizeEnum(f.brand) || '—',
      region: _normalizeEnum(f.region) || '—',
      category: _normalizeEnum(f.category) || '—',
    });
    s.storeId = id;
    byStore[id] = s;
  });
  visits.forEach(v => {
    const s = v.storeId ? byStore[v.storeId] : null;
    if (s) _sl_addRiskVisit_(s, v.date, v.purpose, evaluationYear, monthLimit);
  });

  const outerMemo = _SL_RISK_MEMO_;
  if (!outerMemo) _SL_RISK_MEMO_ = {};
  try {
    return _sl_scoreStores_(byStore, today, monthLimit);
  } finally {
    if (!outerMemo) _SL_RISK_MEMO_ = null;
  }
}

/**
 * The Reports tab's Store Health, live from the tables — same shape as
 * _getStoreHealthReport_impl() (SVMKPI_REPORTS.gs), which reads the sheet.
 */
function svd_storeHealthReport_(preloaded) {
  const rows = svd_storeRisk_(new Date(), null, preloaded);
  if (!rows) return null;
  rows.sort((a, b) => b.riskScore - a.riskScore || a.store.localeCompare(b.store) || a.brand.localeCompare(b.brand));
  const n = rows.length;
  const count = f => rows.filter(f).length;
  const values = [n, count(r => r.riskTier === 'HIGH'), count(r => r.riskTier === 'MEDIUM'), count(r => r.riskTier === 'LOW'),
    count(r => r.complianceStatus === 'OVERDUE' || r.complianceStatus === 'NO HISTORY')];
  const labels = (typeof RISK_KPI_CARDS !== 'undefined') ? RISK_KPI_CARDS.map(c => c.label)
    : ['TOTAL STORES', 'HIGH RISK', 'MEDIUM RISK', 'LOW RISK', 'COVERAGE GAP (OVERDUE)'];
  const p2 = x => String(x).padStart(2, '0');
  const ymd = d => (d instanceof Date && !isNaN(d)) ? d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) : '';
  return {
    kpis: labels.map((label, i) => ({ label, value: String(values[i]) })),
    headers: (typeof RISK_HEADERS !== 'undefined') ? RISK_HEADERS : [],
    live: true,
    rows: rows.map(r => ({
      storeId:         r.storeId,
      store:           r.store,
      brand:           r.brand,
      region:          r.region,
      lastVisitDate:   ymd(r.lastDate),
      lastPurpose:     r.lastPurpose || '',
      daysSince:       r.daysSince == null ? null : r.daysSince,
      totalYtd:        r.totalYTD,
      storeYtd:        r.storeYTD,
      failedCount:     r.failedCount,
      curingCount:     r.curingCount,
      riskScore:       r.riskScore,
      riskTier:        r.riskTier,
      action:          r.action,
      attentionReason: r.attentionReason,
    })),
  };
}

/** Store Insights' health block for one store, from the same rows as Store Health. */
function svd_storeHealthFor_(storeId, visits) {
  const rows = svd_storeRisk_(new Date(), null, visits) || [];
  const row = rows.filter(r => r.storeId === storeId)[0];
  if (row) {
    return { score: row.riskScore, label: row.riskTier, components: { daysSince: row.daysSince != null ? row.daysSince : 999 } };
  }
  // A closed store is not on the Store Health roster.
  let last = null;
  (visits || []).forEach(v => { if (v.storeId === storeId && v.date && (!last || v.date > last)) last = v.date; });
  return { score: 0, label: 'LOW', components: { daysSince: last ? Math.floor((new Date() - last) / 86400000) : 999 } };
}

/**
 * Store Health, old (MASTER_LOG by name + brand) vs new (tables by Store
 * ID), matched by store name + brand: last visit date and visits this year.
 */
function svd_compareStoreHealth_(visits) {
  const log = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SL_SHEET.MASTER_LOG);
  const today = new Date();
  const newRows = svd_storeRisk_(today, null, visits) || [];
  let year = null;
  visits.forEach(v => { if (v.date && (year === null || v.date.getFullYear() > year)) year = v.date.getFullYear(); });
  const oldRows = log ? _computeStoreRisk(_getData(log), today, year) : [];
  const key = r => _normalizeEnum(r.store) + '|' + _normalizeEnum(r.brand);
  const p2 = x => String(x).padStart(2, '0');
  const ymd = d => (d instanceof Date && !isNaN(d)) ? d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) : '—';
  const oldBy = {};
  oldRows.forEach(r => { oldBy[key(r)] = r; });
  let same = 0;
  const diffs = [];
  newRows.forEach(n => {
    const o = oldBy[key(n)];
    delete oldBy[key(n)];
    const nd = ymd(n.lastDate), od = o ? ymd(o.lastDate) : '—';
    if (o && nd === od && o.totalYTD === n.totalYTD) { same++; return; }
    diffs.push({ store: n.store, brand: n.brand, storeId: n.storeId, old: o ? od + ', ' + o.totalYTD + ' this year' : 'not listed', now: nd + ', ' + n.totalYTD + ' this year' });
  });
  const oldOnly = Object.keys(oldBy).map(k => oldBy[k]).filter(o => o.hasHistory);
  return { same, diffs, oldOnly, year };
}



// ═══════════════════════════════════════════════════════════════
// SECTION 8: INPUT PORTAL — WEEKLY HISTORY (F5, v29)
// ═══════════════════════════════════════════════════════════════

/**
 * portal_getWeekHistory(anyDateStr)
 * Every visit SUBMITTED (MASTER_LOG timestamp = the tables' Recorded At) in
 * the Monday–Sunday week that contains `anyDateStr` ('yyyy-MM-dd'; default
 * today, Asia/Manila) — Leo's choice 2026-10-07 — from the visit tables by
 * Store ID, newest first, with a count per day. Each row also carries the
 * date visited (a visit can be logged days later).
 * Read-only; the Input Portal's history panel. Dates go out as text.
 */
function portal_getWeekHistory(anyDateStr) {
  const t0 = Date.now();
  try {
    if (!svd_tablesExist_()) return { success: false, message: 'Visit tables not found — an admin needs to run Rebuild Visit Tables.' };
    const ref = (anyDateStr && _parseDateCell(anyDateStr)) || new Date();
    const monday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - ((ref.getDay() + 6) % 7));
    const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    const today = new Date();
    const thisMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));

    const p2 = n => String(n).padStart(2, '0');
    const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const hm = d => (d instanceof Date && !isNaN(d)) ? ymd(d) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) : '';
    const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      days.push({ date: ymd(d), label: DAY[d.getDay()] + ' ' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()), count: 0 });
    }
    const dayIdx = {};
    days.forEach((d, i) => { dayIdx[d.date] = i; });

    const storeOf = svd_storeLookup_(null);
    const visits = (svd_loadVisits_() || []).filter(v => v.recordedAt && v.recordedAt >= monday && v.recordedAt < nextMonday);
    visits.sort((a, b) => (b.recordedAt - a.recordedAt) || ((b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0)));
    const visitorSet = {};
    const rows = visits.map(v => {
      const info = v.storeId ? storeOf(v.storeId) : null;
      const key = ymd(v.recordedAt);
      if (key in dayIdx) days[dayIdx[key]].count++;
      v.visitors.forEach(n => { visitorSet[n] = true; });
      return {
        date: key,                                   // day it was submitted (the list groups by this)
        day: DAY[v.recordedAt.getDay()],
        visited: v.date ? ymd(v.date) : '',          // date visited
        storeId: v.storeId || '',
        store: info ? info.name : (v.recordedName || '—'),
        brand: info ? info.brand : '',
        visitors: v.visitors.slice(),
        purpose: v.purpose || '—',
        remarks: String(v.remarks || '').trim(),
        recordedAt: hm(v.recordedAt),
      };
    });
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const label = MON[monday.getMonth()] + ' ' + monday.getDate() + ' – '
      + (sunday.getMonth() !== monday.getMonth() ? MON[sunday.getMonth()] + ' ' : '') + sunday.getDate() + ', ' + sunday.getFullYear();
    return {
      success: true,
      weekStart: ymd(monday),
      weekEnd: ymd(sunday),
      label,
      isCurrentWeek: monday.getTime() === thisMonday.getTime(),
      prevStart: ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)),
      nextStart: monday.getTime() < thisMonday.getTime() ? ymd(nextMonday) : '',
      days,
      total: rows.length,
      visitors: Object.keys(visitorSet).sort(),
      rows,
    };
  } catch (e) {
    if (typeof logError === 'function') logError('portal_getWeekHistory', e);
    return { success: false, message: e.message };
  } finally {
    if (typeof _perfLog === 'function') _perfLog('portal_getWeekHistory', t0);
  }
}
