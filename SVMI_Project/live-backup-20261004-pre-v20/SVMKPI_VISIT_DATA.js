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
// Reports on the tables so far: Visited This Month (D.1).
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
  return { success: true, message: 'Reports now read the visit tables (by Store ID): Visited This Month.' };
}

function portal_useMasterLogForReports() {
  if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
  svd_setSource_(SVD_SOURCE.MASTER_LOG);
  return { success: true, message: 'Reports read MASTER_LOG again (as before Phase D).' };
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
    const monthName = m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
    const errors = diffs.slice(0, 30).map(d => ({
      row: monthName(d.month),
      message: d.store + ' (' + (d.brand || '—') + '): MASTER_LOG ' + d.oldVisits + ' visit(s), tables ' + d.newVisits,
    }));
    const msg = 'Visited This Month, ' + year + ' (' + lastMonth + ' month' + (lastMonth === 1 ? '' : 's') + '): '
      + same + ' store-month(s) identical'
      + (placed ? ' · ' + placed + ' visit(s) the old report could not place are now in their store' : '')
      + (diffs.length ? ' · ⚠ ' + diffs.length + ' difference(s) — listed below' : ' · no other differences ✔')
      + ' · reports now read: ' + (svd_useTables_() ? 'visit tables' : 'MASTER_LOG');
    return { success: diffs.length === 0, message: msg, errors, diffs: diffs.length };
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
