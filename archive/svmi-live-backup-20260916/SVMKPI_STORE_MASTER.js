// ============================================================
// SVMKPI_STORE_MASTER.gs
// Builds and populates the STORE MASTER INSIGHT sheet.
// Script-written values only — no live formulas in data cells.
// Triggered from System Tools in the Command Center portal.
// ============================================================

const SMI_SHEET_NAME = 'STORE MASTER INSIGHT';

const SMI_C = {
  NAVY:        '#243F60',
  NAVY_DEEP:   '#1A2F4A',
  GOLD:        '#F4B942',
  WHITE:       '#FFFFFF',
  BODY:        '#1A1A2E',
  MUTED:       '#6B7A90',
  BORDER_GRID: '#E8EEF7',
  BG_ODD:      '#FFFFFF',
  BG_EVEN:     '#F4F7FB',
  HIGH:        '#C0392B', HIGH_L:        '#FDECEA',
  MEDIUM:      '#D46A1A', MEDIUM_L:      '#FEF3E2',
  LOW:         '#1A7A52', LOW_L:         '#E8F5EE',
  COMPLIANT:   '#1A7A52', COMPLIANT_L:   '#E8F5EE',
  NOT_VISITED: '#D46A1A', NOT_VISITED_L: '#FEF3E2',
  NEVER:       '#6B7A90', NEVER_L:       '#F4F7FB',
  BRAND: {
    "ANGEL'S PIZZA": '#FCE4D6',
    'FIGARO':        '#DEEAF1',
    'APEX':          '#E2EFDA',
    "TIEN MA'S":     '#FFF2CC',
    'KOOBIDEH':      '#E8D5F0',
  },
};

const SMI_COLS = [
  { h: '#',                     w: 40  },
  { h: 'Store Name',            w: 170 },
  { h: 'Brand',                 w: 110 },
  { h: 'Region (As Managed By)',w: 115 },
  { h: 'Category (As Region)',  w: 130 },
  { h: 'Total Visits YTD',      w: 95  },
  { h: 'Store Visits',          w: 85  },
  { h: 'TLTC',                  w: 60  },
  { h: 'Failed QA/MS',          w: 90  },
  { h: 'Curing/Support',        w: 100 },
  { h: 'Last Visit Date',       w: 105 },
  { h: 'Days Since Visit',      w: 100 },
  { h: 'Last Purpose',          w: 115 },
  { h: 'Risk Tier',             w: 85  },
  { h: 'Visit Status',          w: 135 },
];

const SMI_COL = {
  NUM: 1, STORE: 2, BRAND: 3, REGION: 4, CATEGORY: 5,
  TOTAL: 6, SV: 7, TLTC: 8, FAILED: 9, CURING: 10,
  LAST_DATE: 11, DAYS: 12, LAST_PURPOSE: 13, RISK: 14, STATUS: 15,
};
const SMI_TOTAL_COLS = SMI_COLS.length;

function rebuildStoreMasterInsight() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const tz  = ss.getSpreadsheetTimeZone();
  const now = new Date();

  // ── Read SETTINGS ─────────────────────────────────────────────
  const settings = ss.getSheetByName('SETTINGS');
  if (!settings) throw new Error('SETTINGS sheet not found.');
  const sLast = settings.getLastRow();
  if (sLast < 2) throw new Error('SETTINGS has no store data.');
  const settingsData = settings.getRange(2, 1, sLast - 1, 5).getValues();

  const storeMap = new Map();
  settingsData.forEach(r => {
    const name = String(r[0]||'').trim().toUpperCase();
    if (!name) return;
    storeMap.set(name, {
      brand:    String(r[1]||'').trim().toUpperCase(),
      region:   String(r[2]||'').trim().toUpperCase(),
      category: String(r[4]||'').trim().toUpperCase(),
    });
  });

  const storeList  = Array.from(storeMap.keys()).sort((a,b) => a.localeCompare(b));
  const storeCount = storeList.length;

  // ── Read MASTER_LOG ───────────────────────────────────────────
  const log = ss.getSheetByName('MASTER_LOG');
  if (!log || log.getLastRow() < 2) throw new Error('MASTER_LOG has no data.');
  const logData = log.getRange(2, 1, log.getLastRow() - 1, 8).getValues();

  const acc = new Map();
  storeList.forEach(n => acc.set(n, {
    total:0, sv:0, tltc:0, failed:0, curing:0, lastDate:null, lastPurpose:'',
  }));

  logData.forEach(r => {
    const store   = String(r[2]||'').trim().toUpperCase();
    const dateRaw = r[1];
    const purpose = String(r[6]||'').trim().toUpperCase();
    if (!acc.has(store)) return;
    const s = acc.get(store);
    const d = dateRaw instanceof Date && !isNaN(dateRaw) ? dateRaw : null;
    s.total++;
    if (purpose === 'STORE VISIT')    s.sv++;
    if (purpose === 'TLTC')           s.tltc++;
    if (purpose === 'FAILED QA/MS')   s.failed++;
    if (purpose === 'CURING/SUPPORT') s.curing++;
    if (d && (!s.lastDate || d > s.lastDate)) { s.lastDate = d; s.lastPurpose = purpose; }
  });

  // ── Read Risk Tiers from STORE HEALTH ─────────────────────────
  const tierMap    = new Map();
  const healthSheet = ss.getSheetByName('STORE HEALTH');
  if (healthSheet && healthSheet.getLastRow() >= 17) {
    const hd = healthSheet.getRange(17, 1, healthSheet.getLastRow() - 16, 14).getValues();
    hd.forEach(r => {
      const n = String(r[0]||'').trim().toUpperCase();
      const t = String(r[11]||'').trim().toUpperCase();
      if (n && t) tierMap.set(n, t);
    });
  }

  // ── Window boundaries ─────────────────────────────────────────
  const monthStart   = new Date(now.getFullYear(), now.getMonth(), 1);
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth()-6, now.getDate());

  // ── Build data rows ───────────────────────────────────────────
  const dataRows = storeList.map((name, idx) => {
    const info = storeMap.get(name);
    const s    = acc.get(name);
    const tier = tierMap.get(name) || '—';

    const daysSince   = s.lastDate ? Math.floor((now - s.lastDate) / 86400000) : null;
    const lastDateFmt = s.lastDate ? Utilities.formatDate(s.lastDate, tz, 'yyyy-MM-dd') : '—';

    let status = '— NEVER VISITED';
    if (s.lastDate) {
      const cat = info.category;
      let ok = false;
      if      (cat==='NCR'||cat==='NEAR PROVINCIAL') ok = s.lastDate >= monthStart;
      else if (cat==='FAR PROVINCIAL')               ok = s.lastDate >= quarterStart;
      else if (cat==='FLIGHT PROVINCIAL')            ok = s.lastDate >= sixMonthsAgo;
      status = ok ? '✅ COMPLIANT' : '⚠️ NOT YET VISITED';
    }

    return [
      idx+1, name, info.brand, info.region, info.category,
      s.total, s.sv, s.tltc, s.failed, s.curing,
      lastDateFmt, daysSince===null ? '—' : daysSince,
      s.lastPurpose||'—', tier, status,
    ];
  });

  // ── Get or create sheet ───────────────────────────────────────
  let sheet = ss.getSheetByName(SMI_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(SMI_SHEET_NAME); }
  else {
    sheet.clear(); sheet.clearFormats(); sheet.setConditionalFormatRules([]);
    const f = sheet.getFilter(); if (f) f.remove();
  }

  const neededRows = storeCount + 5;
  if (sheet.getMaxRows()    < neededRows)    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < SMI_TOTAL_COLS) sheet.insertColumnsAfter(sheet.getMaxColumns(), SMI_TOTAL_COLS - sheet.getMaxColumns());

  // ── Row 1: Title ──────────────────────────────────────────────
  sheet.getRange(1,1,1,SMI_TOTAL_COLS).merge();
  sheet.getRange(1,1)
    .setValue('STORE MASTER INSIGHT  ·  ' + Utilities.formatDate(now, tz, 'MMMM d, yyyy  HH:mm'))
    .setBackground(SMI_C.NAVY).setFontColor(SMI_C.GOLD)
    .setFontFamily('Arial').setFontSize(12).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 32);

  // ── Row 2: Headers ────────────────────────────────────────────
  sheet.getRange(2,1,1,SMI_TOTAL_COLS)
    .setValues([SMI_COLS.map(c=>c.h)])
    .setBackground(SMI_C.NAVY_DEEP).setFontColor(SMI_C.WHITE)
    .setFontFamily('Arial').setFontSize(9).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.getRange(2,1,1,SMI_TOTAL_COLS)
    .setBorder(null,null,true,null,null,null,SMI_C.GOLD,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.setRowHeight(2, 32);

  // ── Column widths ─────────────────────────────────────────────
  SMI_COLS.forEach((c,i) => sheet.setColumnWidth(i+1, c.w));

  // ── Write data in batches ─────────────────────────────────────
  const DATA_START = 3;
  const BATCH      = 50;
  for (let i=0; i<dataRows.length; i+=BATCH) {
    const chunk = dataRows.slice(i, i+BATCH);
    sheet.getRange(DATA_START+i, 1, chunk.length, SMI_TOTAL_COLS).setValues(chunk);
  }

  // ── Base formatting ───────────────────────────────────────────
  const dataRange = sheet.getRange(DATA_START, 1, storeCount, SMI_TOTAL_COLS);
  dataRange.setFontFamily('Arial').setFontSize(9).setVerticalAlignment('middle')
    .setBorder(true,true,true,true,true,true, SMI_C.BORDER_GRID, SpreadsheetApp.BorderStyle.SOLID);

  for (let r=0; r<storeCount; r++) {
    const bg = r%2===0 ? SMI_C.BG_ODD : SMI_C.BG_EVEN;
    sheet.getRange(DATA_START+r, 1, 1, SMI_TOTAL_COLS).setBackground(bg);
    sheet.setRowHeight(DATA_START+r, 20);
  }

  // Column alignments
  sheet.getRange(DATA_START, SMI_COL.NUM,          storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.STORE,        storeCount,1).setHorizontalAlignment('left').setFontWeight('bold');
  sheet.getRange(DATA_START, SMI_COL.BRAND,        storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.REGION,       storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.CATEGORY,     storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.TOTAL,        storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.SV,           storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.TLTC,         storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.FAILED,       storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.CURING,       storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.LAST_DATE,    storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.DAYS,         storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.LAST_PURPOSE, storeCount,1).setHorizontalAlignment('center');
  sheet.getRange(DATA_START, SMI_COL.RISK,         storeCount,1).setHorizontalAlignment('center').setFontWeight('bold');
  sheet.getRange(DATA_START, SMI_COL.STATUS,       storeCount,1).setHorizontalAlignment('center').setFontWeight('bold');

  // ── Brand colors ──────────────────────────────────────────────
  dataRows.forEach((row,i) => {
    const bg = SMI_C.BRAND[row[SMI_COL.BRAND-1]];
    if (bg) sheet.getRange(DATA_START+i, SMI_COL.BRAND).setBackground(bg);
  });

  // ── Risk Tier colors ──────────────────────────────────────────
  dataRows.forEach((row,i) => {
    const tier = row[SMI_COL.RISK-1];
    const cell = sheet.getRange(DATA_START+i, SMI_COL.RISK);
    if      (tier==='HIGH')   cell.setBackground(SMI_C.HIGH_L).setFontColor(SMI_C.HIGH);
    else if (tier==='MEDIUM') cell.setBackground(SMI_C.MEDIUM_L).setFontColor(SMI_C.MEDIUM);
    else if (tier==='LOW')    cell.setBackground(SMI_C.LOW_L).setFontColor(SMI_C.LOW);
  });

  // ── Visit Status colors ───────────────────────────────────────
  dataRows.forEach((row,i) => {
    const status = row[SMI_COL.STATUS-1];
    const cell   = sheet.getRange(DATA_START+i, SMI_COL.STATUS);
    if      (status==='✅ COMPLIANT')       cell.setBackground(SMI_C.COMPLIANT_L).setFontColor(SMI_C.COMPLIANT);
    else if (status==='⚠️ NOT YET VISITED') cell.setBackground(SMI_C.NOT_VISITED_L).setFontColor(SMI_C.NOT_VISITED);
    else                                    cell.setBackground(SMI_C.NEVER_L).setFontColor(SMI_C.NEVER);
  });

  // ── Freeze + Autofilter ───────────────────────────────────────
  sheet.setFrozenRows(2);
  sheet.getRange(2, 1, storeCount+1, SMI_TOTAL_COLS).createFilter();

  SpreadsheetApp.flush();
  Logger.log('[SMI] Store Master Insight rebuilt. ' + storeCount + ' stores.');
  return { success: true, stores: storeCount, message: 'Store Master Insight rebuilt. ' + storeCount + ' stores written.' };
}
