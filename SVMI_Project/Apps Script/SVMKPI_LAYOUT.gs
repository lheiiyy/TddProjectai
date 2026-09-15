// ============================================================
// STORE VISIT PROGRAM — EXECUTIVE SUMMARY
// SVMKPI_LAYOUT.gs
// Layout only. Formatting only. Executive Summary construction only.
// ============================================================

// ═══════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════════════════
const C = {
  // ── Backgrounds ───────────────────────────────────────────
  NAVY:            '#243F60',
  FOOTER_BG:       '#0D1117',
  EMERALD_GREEN:   '#1A7A52',
  FOREST_GREEN:    '#4E6B2F',
  BURNT_ORANGE:    '#D46A1A',
  MEDIUM_BLUE:     '#2E75B6',
  PURPLE:          '#7030A0',
  BRIGHT_BLUE:     '#0070C0',
  AMBER:           '#F4B942',
  LIGHT_GRAY:      '#F2F2F2',
  LIGHT_BLUE:      '#DEEAF1',
  LIGHT_MINT:      '#E8F5EE',
  VERY_LIGHT_BLUE: '#F0F4FF',
  LIGHT_GREEN:     '#D6E4BC',
  LIGHT_PEACH:     '#FCE4D6',
  MONTHLY_ALT:     '#E8EEF7',
  RANK2_GRAY:      '#E8E8E8',
  RANK3_WHEAT:     '#F5DEB3',
  WHITE:           '#FFFFFF',
  // ── Fonts ─────────────────────────────────────────────────
  BODY_TEXT:       '#1A1A2E',
  WHITE_TEXT:      '#FFFFFF',
  FOOTER_TEXT:     '#484F58',
  // ── Borders ───────────────────────────────────────────────
  BORDER_CARD:       '#CCCCCC',   // outer card borders
  BORDER_MED_NAVY:   '#2E4A7A',
  BORDER_GRID:       '#D9D9D9',   // internal gridlines
  BORDER_COL_SEP:    '#D9E4EF',   // column separators
  BORDER_WHITE:      '#FFFFFF',
  BORDER_GOLD:       '#C9A84C',
  BORDER_DARK_GREEN: '#1E5631',
  BORDER_OLIVE:      '#4E6B2F',
};

const BS = {
  THIN:   SpreadsheetApp.BorderStyle.SOLID,
  MEDIUM: SpreadsheetApp.BorderStyle.SOLID_MEDIUM,
};

// Column widths [col index → px]
const COL_WIDTHS = [
  [1, 18], [2, 15], [3, 145], [4, 105],
  [5, 100], [6, 100], [7, 100], [8, 100],
  [9, 95],  [10, 18],
];

// Row heights [row index → px]
const ROW_HEIGHTS = {
  1: 6,  2: 42, 3: 18, 4: 14,
  5: 16, 6: 40, 7: 44, 8: 14,
  9: 16, 10: 20,
  23: 21, 24: 10,
  25: 16, 26: 16,
  27: 17, 28: 17, 29: 17, 30: 17,
  31: 18, 32: 10,
  33: 16, 34: 16,
  45: 17, 46: 17, 47: 10,
  48: 16, 49: 18,
  55: 20, 56: 10, 57: 14,
};

// ═══════════════════════════════════════════════════════════════
// SECTION 2: LAYOUT ENTRY POINT
// ═══════════════════════════════════════════════════════════════
function buildExecutiveSummaryLayout() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName('EXECUTIVE SUMMARY');

  if (!sheet) {
    sheet = ss.insertSheet('EXECUTIVE SUMMARY');
  } else {
    sheet.clear();
    sheet.clearFormats();
  }

  if (sheet.getMaxRows()    < 65) sheet.insertRowsAfter(sheet.getMaxRows(),    65 - sheet.getMaxRows());
  if (sheet.getMaxColumns() < 11) sheet.insertColumnsAfter(sheet.getMaxColumns(), 11 - sheet.getMaxColumns());

  // Global baseline — applied once; sections override as needed
  sheet.getRange(1, 1, 65, 11)
    .setBackground(C.WHITE)
    .setFontFamily('Arial')
    .setFontSize(8)
    .setFontColor(C.BODY_TEXT)
    .setVerticalAlignment('middle')
    .setFontWeight('normal')
    .setFontStyle('normal')
    .setHorizontalAlignment('left')
    .setWrap(false)
    .setBorder(false, false, false, false, false, false);

  _applyColumnWidths(sheet);
  _applyRowHeights(sheet);

  buildTitle(sheet);
  buildKPI(sheet);
  buildMonthly(sheet);
  buildRegion(sheet);
  buildPurpose(sheet);
  buildTopStores(sheet);
  buildLeaderboard(sheet);
  buildBrandPerformance(sheet);
  buildFooter(sheet);

  // Borders applied last — overlay all fill formatting
  _applyAllBorders(sheet);

  // Write native Google Sheets formulas into all data cells
  // so the dashboard auto-updates when MASTER_LOG receives new rows
  _buildESFormulas(sheet);

  SpreadsheetApp.flush();
  Logger.log('✅ Executive Summary layout and formulas rebuilt.');
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3: DASHBOARD LAYOUT BUILDERS
// ═══════════════════════════════════════════════════════════════
function buildTitle(sheet) {
  _merge(sheet, 'C2:I2');
  sheet.getRange('C2')
    .setValue('STORE VISIT PROGRAM — EXECUTIVE SUMMARY ' + DATA_YEAR)
    .setBackground('#1F3864')
    .setFontColor(C.WHITE_TEXT)
    .setFontSize(16)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(false);

  _merge(sheet, 'C3:I3');
  sheet.getRange('C3')
    .setValue('⚡ Live data from MASTER_LOG · All formulas auto-update when rows are added')
    .setBackground(C.NAVY)
    .setFontColor('#7FA8D4')
    .setFontSize(8)
    .setFontStyle('italic')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sheet.getRange('C4:I4').setBackground(C.WHITE);
}

function buildKPI(sheet) {
  _merge(sheet, 'C5:I5');
  _sectionHeader(sheet.getRange('C5'), 'KEY PERFORMANCE INDICATORS', C.NAVY, 8.5);

  const cards = [
    { col: 3, label: 'TOTAL\nVISITS',    bg: C.NAVY          },
    { col: 4, label: 'STORE\nVISITS',    bg: C.MEDIUM_BLUE   },
    { col: 5, label: 'TLTC',             bg: C.FOREST_GREEN  },
    { col: 6, label: 'FAILED\nQA/MS',    bg: C.BURNT_ORANGE   },
    { col: 7, label: 'CURING/\nSUPPORT', bg: C.PURPLE        },
    { col: 8, label: 'NCR',              bg: C.BRIGHT_BLUE   },
    { col: 9, label: 'PROVINCIAL',       bg: C.EMERALD_GREEN },
  ];

  cards.forEach(({ col, label, bg }) => {
    sheet.getRange(6, col)
      .setValue(label)
      .setBackground(bg)
      .setFontColor(C.WHITE_TEXT)
      .setFontSize(7.5)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrap(true);

    sheet.getRange(7, col)
      .setValue('0')
      .setBackground(C.LIGHT_GRAY)
      .setFontColor(bg)
      .setFontSize(18)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });

  sheet.getRange('C8:I8').setBackground(C.WHITE).setValue('');
}

function buildMonthly(sheet) {
  _merge(sheet, 'C9:I9');
  _sectionHeader(sheet.getRange('C9'), 'MONTHLY VISIT SUMMARY BY BRAND', '#1F3864', 8.5);

  // Column headers row 10 — three distinct bg zones
  const monthHeaders = ['MONTH', ...APPROVED_BRANDS, 'TOTAL']; // single source of truth — SVMKPI_CORE.gs
  monthHeaders.forEach((label, i) => {
    const col = 3 + i;
    const bg  = col >= 4 && col <= 8 ? C.MEDIUM_BLUE
              : col === 9             ? C.AMBER
              :                        '#1F3864';

    sheet.getRange(10, col)
      .setValue(label)
      .setBackground(bg)
      .setFontColor(C.WHITE_TEXT)
      .setFontSize(7.5)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrap(true);
  });

  // Data rows 11–22 — odd rows light blue, even rows white
  const months = [
    'JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
    'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER',
  ];

  months.forEach((month, i) => {
    const row = 11 + i;
    const bg  = i % 2 === 0 ? '#D6E4F7' : C.WHITE;

    sheet.getRange(row, 3)
      .setValue(month)
      .setBackground(bg)
      .setFontColor(C.BODY_TEXT)
      .setFontSize(8)
      .setFontWeight('bold')
      .setHorizontalAlignment('left')
      .setWrap(false);

    for (let c = 4; c <= 8; c++) {
      sheet.getRange(row, c)
        .setValue('0')
        .setBackground(bg)
        .setFontColor(C.BODY_TEXT)
        .setFontSize(8)
        .setHorizontalAlignment('center');
    }

    // TOTAL column always uses MONTHLY_ALT (#E8EEF7)
    sheet.getRange(row, 9)
      .setValue('0')
      .setBackground(C.MONTHLY_ALT)
      .setFontColor(C.NAVY)
      .setFontSize(8)
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
  });

  // Grand Total row 23 — deep navy + amber total cell
  sheet.getRange(23, 3, 1, 6).setBackground('#1F3864');

  const gtBase = { bg: '#1F3864', fg: C.WHITE_TEXT, size: 8, weight: 'bold' };
  sheet.getRange('C23').setValue('GRAND TOTAL')
    .setBackground(gtBase.bg)
    .setFontColor(gtBase.fg)
    .setFontWeight(gtBase.weight)
    .setFontSize(gtBase.size)
    .setHorizontalAlignment('left');

  for (let c = 4; c <= 8; c++) {
    sheet.getRange(23, c).setValue('0')
      .setBackground(gtBase.bg)
      .setFontColor(gtBase.fg)
      .setFontWeight(gtBase.weight)
      .setFontSize(gtBase.size)
      .setHorizontalAlignment('center');
  }

  sheet.getRange(23, 9).setValue('0')
    .setBackground(C.AMBER)
    .setFontColor(C.NAVY)
    .setFontWeight('bold')
    .setFontSize(8)
    .setHorizontalAlignment('center');

  sheet.getRange('C24:I24').setBackground(C.WHITE).setValue('');
}

function buildRegion(sheet) {
  _merge(sheet, 'C25:E25');
  _sectionHeader(sheet.getRange('C25'), 'VISITS BY REGION', C.FOREST_GREEN);
  _subHeaders(sheet, [['C26','REGION'],['D26','VISITS'],['E26','% SHARE']], C.FOREST_GREEN);

  const rows = [
    { name: 'NCR',        bg: C.LIGHT_GREEN },
    { name: 'PROVINCIAL', bg: C.WHITE },
    { name: 'FRANCHISE',  bg: C.LIGHT_GREEN },
  ];

  rows.forEach(({ name, bg }, i) => {
    const row = 27 + i;
    sheet.getRange(`C${row}`).setValue(name)
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('left').setFontWeight('normal');

    sheet.getRange(`D${row}`).setValue('0')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontWeight('bold').setFontColor(C.NAVY);

    sheet.getRange(`E${row}`).setValue('0.0%')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontColor(C.BODY_TEXT);
  });

  sheet.getRange('C30:E30').setBackground(C.WHITE).setValue('');
  _totalRow(sheet, 31, ['C','D','E'], ['TOTAL','0','100.00%'], C.FOREST_GREEN);
  sheet.getRange('F25:F31').setBackground(C.WHITE).setValue('');
}

function buildPurpose(sheet) {
  _merge(sheet, 'G25:I25');
  _sectionHeader(sheet.getRange('G25'), 'VISIT PURPOSE BREAKDOWN', C.BURNT_ORANGE);
  _subHeaders(sheet, [['G26','PURPOSE'],['H26','COUNT'],['I26','% SHARE']], C.BURNT_ORANGE);

  const rows = [
    { name: 'STORE VISIT',    bg: C.LIGHT_PEACH },
    { name: 'TLTC',           bg: C.WHITE },
    { name: 'FAILED QA/MS',   bg: C.LIGHT_PEACH },
    { name: 'CURING/SUPPORT', bg: C.WHITE },
  ];

  rows.forEach(({ name, bg }, i) => {
    const row = 27 + i;
    sheet.getRange(`G${row}`).setValue(name)
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('left').setFontColor(C.BODY_TEXT).setFontWeight('normal').setWrap(false);

    sheet.getRange(`H${row}`).setValue('0')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontWeight('bold').setFontColor(C.NAVY);

    sheet.getRange(`I${row}`).setValue('0.0%')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontColor(C.BODY_TEXT);
  });

  _totalRow(sheet, 31, ['G','H','I'], ['TOTAL','0','100.00%'], C.BURNT_ORANGE);
  sheet.getRange('C32:I32').setBackground(C.WHITE).setValue('');
}

function buildTopStores(sheet) {
  _merge(sheet, 'C33:E33');
  _sectionHeader(sheet.getRange('C33'), 'TOP 10 MOST VISITED STORES', C.NAVY);
  _subHeaders(sheet, [['C34','#'],['D34','STORE NAME'],['E34','VISITS']], C.NAVY);

  for (let i = 0; i < 10; i++) {
    const row  = 35 + i;
    const bg   = _rankBg(i, C.LIGHT_BLUE);
    const bold = i < 3 ? 'bold' : 'normal';

    sheet.getRange(`C${row}`).setValue(i + 1)
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontWeight(bold).setFontColor(C.BODY_TEXT);

    sheet.getRange(`D${row}`).setValue('')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('left').setFontWeight(bold).setFontColor(C.BODY_TEXT);

    sheet.getRange(`E${row}`).setValue('')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontWeight(bold).setFontColor(C.BODY_TEXT);
  }

  sheet.getRange('F33:F46').setBackground(C.WHITE).setValue('');
}

function buildLeaderboard(sheet) {
  _merge(sheet, 'G33:I33');
  _sectionHeader(sheet.getRange('G33'), 'VISITOR LEADERBOARD (YTD)', C.NAVY);
  _subHeaders(sheet, [['G34','RANK'],['H34','VISITOR'],['I34','VISITS']], C.NAVY);

  for (let i = 0; i < 12; i++) {
    const row  = 35 + i;
    const bg   = _rankBg(i, C.VERY_LIGHT_BLUE);
    const bold = i < 3 ? 'bold' : 'normal';

    sheet.getRange('G' + row).setValue(i + 1)
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontWeight(bold).setFontColor(C.BODY_TEXT);

    sheet.getRange('H' + row).setValue('')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('left').setFontWeight(bold).setFontColor(C.BODY_TEXT);

    sheet.getRange('I' + row).setValue('')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontWeight(bold).setFontColor(C.BODY_TEXT);
  }

  sheet.getRange('C47:I47').setBackground(C.WHITE).setValue('');
}

function buildBrandPerformance(sheet) {
  _merge(sheet, 'C48:I48');
  _sectionHeader(sheet.getRange('C48'), 'BRAND PERFORMANCE SUMMARY', C.EMERALD_GREEN, 8.5);

  // Header row 49 — cols H:I filled emerald (no label)
  sheet.getRange(49, 8, 1, 2).setBackground(C.EMERALD_GREEN).setValue('');

  _subHeaders(sheet, [
    ['C49','BRAND'], ['D49','TOTAL VISIT'], ['E49','% SHARE'],
    ['F49','PEAK MONTH'], ['G49','PEAK COUNT'],
  ], C.EMERALD_GREEN, true);

  const brands = APPROVED_BRANDS; // single source of truth — SVMKPI_CORE.gs

  brands.forEach((brand, i) => {
    const row = 50 + i;
    const bg  = i % 2 === 0 ? C.WHITE : C.LIGHT_MINT;

    sheet.getRange(row, 3).setValue(brand)
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('left').setFontWeight('bold').setFontColor(C.BODY_TEXT).setWrap(false);

    sheet.getRange(row, 4).setValue('0')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontColor(C.NAVY).setFontWeight('bold');

    sheet.getRange(row, 5).setValue('0.0%')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontColor(C.BODY_TEXT);

    sheet.getRange(row, 6).setValue('0')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontColor(C.BODY_TEXT);

    sheet.getRange(row, 7).setValue('0')
      .setBackground(bg).setFontSize(8).setHorizontalAlignment('center').setFontColor(C.BODY_TEXT).setFontWeight('bold');

    sheet.getRange(row, 8, 1, 2).setBackground(bg).setValue('');
  });

  // Total row 55 — painted col-by-col to guarantee full emerald fill
  [
    [3,'TOTAL'], [4,'0'], [5,'0.00%'], [6,'0'], [7,'0'], [8,''], [9,''],
  ].forEach(([col, val]) => {
    sheet.getRange(55, col)
      .setValue(val)
      .setBackground(C.EMERALD_GREEN)
      .setFontColor(C.WHITE_TEXT)
      .setFontWeight('bold')
      .setFontSize(8)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrap(false);
  });

  sheet.getRange('C56:I56').setBackground(C.WHITE).setValue('');
}

function buildFooter(sheet) {
  _merge(sheet, 'C57:I57');
  sheet.getRange('C57')
    .setValue('⚡ Run buildExecutiveSummary() to rebuild · All COUNTIF/QUERY formulas update live from MASTER_LOG')
    .setBackground(C.FOOTER_BG)
    .setFontColor(C.FOOTER_TEXT)
    .setFontSize(7.5)
    .setFontStyle('italic')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle')
    .setWrap(false);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4: LAYOUT HELPERS
// ═══════════════════════════════════════════════════════════════
function _applyColumnWidths(sheet) {
  COL_WIDTHS.forEach(([col, px]) => sheet.setColumnWidth(col, px));
}

function _applyRowHeights(sheet) {
  const h = Object.assign({}, ROW_HEIGHTS);
  for (let row = 11; row <= 22; row++) h[row] = 17;   // Monthly data rows
  for (let row = 35; row <= 46; row++) h[row] = 17;   // Stores / Leaderboard rows
  for (let row = 50; row <= 54; row++) h[row] = 17;   // Brand Performance data rows
  Object.entries(h).forEach(([row, px]) => sheet.setRowHeight(+row, px));
}

// ═══════════════════════════════════════════════════════════════
// SECTION 5: BORDER HELPERS
// ═══════════════════════════════════════════════════════════════
function _applyAllBorders(sheet) {
  const r   = (row, col, nR, nC) => sheet.getRange(row, col, nR, nC);
  const box = (rng, style, color) => rng.setBorder(true, true, true, true, null, null, color, style);
  const hl  = (rng, style, color) => rng.setBorder(null, null, null, null, null, true, color, style);
  const sd  = (rng, which, style, color) => {
    const t = which === 'top', l = which === 'left', b = which === 'bottom', rv = which === 'right';
    rng.setBorder(t, l, b, rv, null, null, color, style);
  };
  const rb  = (rng, style, color) => rng.setBorder(null, null, null, true, null, null, color, style);

  // Title rows 2–3
  box(r(2, 3, 1, 7), BS.THIN,   C.BORDER_CARD);
  sd( r(2, 3, 1, 7), 'bottom',  BS.THIN,   C.AMBER);
  sd( r(3, 3, 1, 7), 'bottom',  BS.THIN,   C.BORDER_MED_NAVY);

  // KPI cards rows 5–7 — internal white separators only (no outer border)
  [3, 4, 5, 6, 7, 8].forEach(col => rb(r(5, col, 3, 1), BS.THIN, C.BORDER_WHITE));
  sd(r(5, 3, 1, 7), 'bottom', BS.THIN, C.BORDER_WHITE);
  sd(r(6, 3, 1, 7), 'bottom', BS.THIN, C.BORDER_WHITE);

  // Monthly rows 9–23
  box(r(9, 3, 15, 7), BS.MEDIUM, C.BORDER_CARD);
  sd( r(9,  3, 1, 7), 'bottom', BS.MEDIUM, C.BORDER_CARD);
  sd( r(10, 3, 1, 7), 'bottom', BS.MEDIUM, C.BORDER_MED_NAVY);
  hl( r(11, 3, 12, 7), BS.THIN, C.BORDER_GRID);
  [4, 5, 6, 7].forEach(col => rb(r(10, col, 14, 1), BS.THIN, C.BORDER_COL_SEP));
  rb( r(9,  8, 15, 1), BS.MEDIUM, C.BORDER_MED_NAVY);
  r(23, 3, 1, 7).setBorder(true, null, true, null, null, null, C.BORDER_GOLD,  BS.MEDIUM);
  r(23, 3, 1, 6).setBorder(null, null, null, null, true,  null, C.BORDER_WHITE, BS.THIN);
  box(r(9, 3, 15, 7), BS.MEDIUM, C.BORDER_CARD);   // re-stamp outer over internal lines

  // Region rows 25–31
  box(r(25, 3, 7, 3), BS.MEDIUM, C.BORDER_CARD);
  sd( r(25, 3, 1, 3), 'bottom', BS.MEDIUM, C.BORDER_CARD);
  sd( r(26, 3, 1, 3), 'bottom', BS.MEDIUM, '#375623');
  hl( r(27, 3, 3, 3), BS.THIN,  C.BORDER_GRID);
  rb( r(26, 4, 6, 1), BS.THIN,  C.BORDER_COL_SEP);
  rb( r(26, 5, 6, 1), BS.THIN,  C.BORDER_COL_SEP);
  sd( r(31, 3, 1, 3), 'top',    BS.MEDIUM, C.BORDER_GOLD);
  box(r(25, 3, 7, 3), BS.MEDIUM, C.BORDER_CARD);

  // Purpose rows 25–31
  box(r(25, 7, 7, 3), BS.MEDIUM, C.BORDER_CARD);
  sd( r(25, 7, 1, 3), 'bottom', BS.MEDIUM, C.BORDER_CARD);
  sd( r(26, 7, 1, 3), 'bottom', BS.MEDIUM, '#C55A11');
  hl( r(27, 7, 4, 3), BS.THIN,  C.BORDER_GRID);
  rb( r(26, 8, 6, 1), BS.THIN,  C.BORDER_COL_SEP);
  rb( r(26, 9, 6, 1), BS.THIN,  C.BORDER_COL_SEP);
  sd( r(31, 7, 1, 3), 'top',    BS.MEDIUM, C.BORDER_GOLD);
  box(r(25, 7, 7, 3), BS.MEDIUM, C.BORDER_CARD);

  // Top Stores rows 33–44
  box(r(33, 3, 12, 3), BS.MEDIUM, C.BORDER_CARD);
  sd( r(33, 3,  1, 3), 'bottom', BS.MEDIUM, C.BORDER_CARD);
  sd( r(34, 3,  1, 3), 'bottom', BS.THIN,   C.BORDER_WHITE);
  hl( r(35, 3, 10, 3), BS.THIN,  C.BORDER_GRID);
  rb( r(34, 3, 11, 1), BS.THIN,  C.BORDER_COL_SEP);
  rb( r(34, 4, 11, 1), BS.THIN,  C.BORDER_COL_SEP);
  box(r(33, 3, 12, 3), BS.MEDIUM, C.BORDER_CARD);

  // Leaderboard rows 33–46
  box(r(33, 7, 14, 3), BS.MEDIUM, C.BORDER_CARD);
  sd( r(33, 7,  1, 3), 'bottom', BS.MEDIUM, C.BORDER_CARD);
  sd( r(34, 7,  1, 3), 'bottom', BS.THIN,   C.BORDER_WHITE);
  hl( r(35, 7, 12, 3), BS.THIN,  C.BORDER_GRID);
  rb( r(34, 7, 13, 1), BS.MEDIUM, C.BORDER_MED_NAVY);
  rb( r(34, 7,  1, 1), BS.THIN,   C.BORDER_WHITE);   // G34/H34 internal separator
  rb( r(34, 8, 13, 1), BS.THIN,   C.BORDER_COL_SEP);
  box(r(33, 7, 14, 3), BS.MEDIUM, C.BORDER_CARD);

  // Brand Performance rows 48–55 — intentional dark green border retained
  box(r(48, 3, 8, 7), BS.MEDIUM, C.BORDER_DARK_GREEN);
  sd( r(48, 3, 1, 7), 'bottom', BS.MEDIUM, C.BORDER_DARK_GREEN);
  sd( r(49, 3, 1, 7), 'bottom', BS.MEDIUM, C.BORDER_OLIVE);
  hl( r(50, 3, 5, 7), BS.THIN,  C.BORDER_GRID);
  [3, 4, 5, 6, 7].forEach(col => rb(r(49, col, 7, 1), BS.THIN, C.BORDER_COL_SEP));
  r(55, 3, 1, 7).setBorder(true, null, true, null, null, null, C.BORDER_GOLD, BS.MEDIUM);
  box(r(48, 3, 8, 7), BS.MEDIUM, C.BORDER_DARK_GREEN);

  // Footer row 57
  box(r(57, 3, 1, 7), BS.MEDIUM, C.BORDER_CARD);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7: NATIVE FORMULA WRITER
// Auto-updates dashboard from MASTER_LOG without script refresh.
// ═══════════════════════════════════════════════════════════════
function _buildESFormulas(sheet) {
  const ML = 'MASTER_LOG'; // sheet reference prefix

  // ── KPI Cards (row 7, cols 3-9) ──────────────────────────────
  const kpiFormulas = [
    `=COUNTA(${ML}!C:C)-1`,                              // Total Visits
    `=COUNTIF(${ML}!G:G,"STORE VISIT")`,                 // Store Visits
    `=COUNTIF(${ML}!G:G,"TLTC")`,                        // TLTC
    `=COUNTIF(${ML}!G:G,"FAILED QA/MS")`,                // Failed QA/MS
    `=COUNTIF(${ML}!G:G,"CURING/SUPPORT")`,              // Curing/Support
    `=COUNTIF(${ML}!E:E,"NCR")`,                         // NCR
    `=COUNTIF(${ML}!E:E,"PROVINCIAL")`,                  // Provincial
  ];
  sheet.getRange(7, 3, 1, kpiFormulas.length).setFormulas([kpiFormulas]);

  // ── Monthly by Brand (rows 11-22, cols 4-9) ─────────────────
  const brands = APPROVED_BRANDS; // single source of truth — SVMKPI_CORE.gs
  // Computed from DATA_YEAR rather than hardcoded, so this stays correct
  // in leap years too (Feb 28 vs 29) once DATA_YEAR is updated annually.
  const monthEnds = Array.from({ length: 12 }, (_, m) => new Date(DATA_YEAR, m + 1, 0).getDate());

  for (let m = 0; m < 12; m++) {
    const row   = 11 + m;
    const month = m + 1;
    const rowFormulas = [];

    brands.forEach(brand => {
      rowFormulas.push(
        `=COUNTIFS(${ML}!D:D,"${brand}",${ML}!B:B,">="&DATE(${DATA_YEAR},${month},1),${ML}!B:B,"<="&DATE(${DATA_YEAR},${month},${monthEnds[m]}))`
      );
    });

    rowFormulas.push(`=SUM(D${row}:H${row})`); // TOTAL col
    sheet.getRange(row, 4, 1, rowFormulas.length).setFormulas([rowFormulas]);
  }

  // Grand Total row 23
  const grandTotalBrand = brands.map((_, i) => {
    const col = String.fromCharCode(68 + i); // D, E, F, G, H
    return `=SUM(${col}11:${col}22)`;
  });
  grandTotalBrand.push('=SUM(I11:I22)');
  sheet.getRange(23, 4, 1, grandTotalBrand.length).setFormulas([grandTotalBrand]);

  // ── Visits by Region (rows 27-29, cols 4-5) ─────────────────
  const regions = ['NCR', 'PROVINCIAL', 'FRANCHISE'];
  regions.forEach((region, i) => {
    const row = 27 + i;
    sheet.getRange(row, 4).setFormula(`=COUNTIF(${ML}!E:E,"${region}")`);
    sheet.getRange(row, 5).setFormula(`=IFERROR(D${row}/D31,0)`).setNumberFormat('0.0%');
  });
  sheet.getRange(31, 4).setFormula('=SUM(D27:D29)');
  sheet.getRange(31, 5).setFormula('=IFERROR(D31/D31,1)').setNumberFormat('0.0%');

  // ── Visit Purpose Breakdown (rows 27-30, cols 8-9) ──────────
  const purposes = ['STORE VISIT', 'TLTC', 'FAILED QA/MS', 'CURING/SUPPORT'];
  purposes.forEach((purpose, i) => {
    const row = 27 + i;
    sheet.getRange(row, 8).setFormula(`=COUNTIF(${ML}!G:G,"${purpose}")`);
    sheet.getRange(row, 9).setFormula(`=IFERROR(H${row}/H31,0)`).setNumberFormat('0.0%');
  });
  sheet.getRange(31, 8).setFormula('=SUM(H27:H30)');
  sheet.getRange(31, 9).setFormula('=IFERROR(H31/H31,1)').setNumberFormat('0.0%');

  // ── Top 10 Most Visited Stores (rows 35-44, cols 4-5) ───────
  // QUERY auto-sorts live; INDEX extracts each rank
  const storeQuery = `"SELECT C, COUNT(C) WHERE C<>'' GROUP BY C ORDER BY COUNT(C) DESC LIMIT 10 LABEL COUNT(C) ''"`;
  for (let i = 0; i < 10; i++) {
    const row  = 35 + i;
    const rank = i + 1;
    sheet.getRange(row, 3).setValue(rank);
    sheet.getRange(row, 4).setFormula(
      `=IFERROR(INDEX(QUERY(${ML}!C$2:C,${storeQuery}),${rank},1),"")`
    );
    sheet.getRange(row, 5).setFormula(
      `=IFERROR(INDEX(QUERY(${ML}!C$2:C,${storeQuery}),${rank},2),"")`
    );
  }

  // ── Visitor Leaderboard (rows 35-46, cols 7-9) ──────────────
  // Read SETTINGS!F roster + sort by current count at rebuild time
  _buildLeaderboardFormulas(sheet, ML);

  // ── Brand Performance (rows 50-54, cols 4-7) ────────────────
  const dateFrom = Array.from({length:12},(_,i)=>`DATE(${DATA_YEAR},${i+1},1)`).join(',');
  const dateTo   = Array.from({length:12},(_,i)=>i<11?`DATE(${DATA_YEAR},${i+2},1)`:`DATE(${DATA_YEAR + 1},1,1)`).join(',');
  const mnNames  = MONTH_NAMES.map(m=>`"${m}"`).join(','); // single source of truth — SVMKPI_CORE.gs

  brands.forEach((brand, i) => {
    const row = 50 + i;
    sheet.getRange(row, 4).setFormula(`=COUNTIF(${ML}!D:D,"${brand}")`);
    sheet.getRange(row, 5).setFormula(`=IFERROR(D${row}/D55,0)`).setNumberFormat('0.00%');

    // Peak month / peak count logic left intact
    const monthlyCounts =
      `COUNTIFS(${ML}!D:D,"${brand}",${ML}!B:B,">="&{${dateFrom}},${ML}!B:B,"<"&{${dateTo}})`;

    sheet.getRange(row, 6).setFormula(
      `=IFERROR(INDEX({${mnNames}},MATCH(MAX(${monthlyCounts}),${monthlyCounts},0)),"")`
    );
    sheet.getRange(row, 7).setFormula(`=IFERROR(MAX(${monthlyCounts}),0)`);
  });

  // Grand total row 55
  sheet.getRange(55, 4).setFormula('=SUM(D50:D54)');
  sheet.getRange(55, 5).setFormula('=IFERROR(D55/D55,1)').setNumberFormat('0.00%');
}

/**
 * _buildLeaderboardFormulas(sheet, ML)
 * Reads SETTINGS!F visitor roster, computes current visit counts,
 * sorts by count desc, writes formulas referencing SETTINGS!F per row.
 * Counts auto-update live; rank order refreshes on next rebuild.
 */
function _buildLeaderboardFormulas(sheet, ML) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const settings = ss.getSheetByName('SETTINGS');
  if (!settings || settings.getLastRow() < 2) return;

  const rawVisitors = settings.getRange(2, 6, settings.getLastRow() - 1, 1).getValues();
  const roster = rawVisitors
    .map((r, i) => ({ name: String(r[0] || '').trim().toUpperCase(), row: i + 2 }))
    .filter(v => v.name);

  if (roster.length === 0) return;

  // Compute current counts from MASTER_LOG!F
  const logSheet = ss.getSheetByName('MASTER_LOG');
  const logLastRow = logSheet ? logSheet.getLastRow() : 1;
  const visitorCounts = {};

  roster.forEach(v => { visitorCounts[v.name] = 0; });

  if (logSheet && logLastRow >= 2) {
    const visitedByCol = logSheet.getRange(2, 6, logLastRow - 1, 1).getValues();

    visitedByCol.forEach(([cell]) => {
      const raw = String(cell || '').toUpperCase();
      raw.split('|').map(n => n.trim()).filter(Boolean).forEach(name => {
        if (Object.prototype.hasOwnProperty.call(visitorCounts, name)) visitorCounts[name]++;
      });
    });
  }

  // Sort roster by count descending
  const sorted = roster.sort((a, b) => (visitorCounts[b.name] || 0) - (visitorCounts[a.name] || 0));

  // Write up to 12 leaderboard rows (rows 35-46)
  sorted.slice(0, 12).forEach(({ row: settingsRow }, i) => {
    const sheetRow = 35 + i;
    sheet.getRange(sheetRow, 7).setValue(i + 1);
    sheet.getRange(sheetRow, 8).setFormula(`=SETTINGS!F${settingsRow}`);

    // Fixed match logic:
    // Normalize MASTER_LOG!F by removing spaces around pipes before matching.
    sheet.getRange(sheetRow, 9).setFormula(
      `=SUMPRODUCT(--ISNUMBER(SEARCH("|"&TRIM(SETTINGS!F${settingsRow})&"|","|"&REGEXREPLACE(TRIM(${ML}!F$2:F$5000),"\\s*\\|\\s*","|")&"|")))`
    );
  });
}

// Safe merge — breaks apart first to avoid conflicts
function _merge(sheet, a1) {
  try { sheet.getRange(a1).breakApart(); } catch(e) {}
  try { sheet.getRange(a1).mergeAcross(); } catch(e) {
    Logger.log('⚠️ Merge failed for ' + a1 + ': ' + e);
  }
}

// Styled section title (merged header cell)
function _sectionHeader(range, label, bg, size) {
  range
    .setValue(label)
    .setBackground(bg)
    .setFontColor(C.WHITE_TEXT)
    .setFontSize(size || 8)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
}

// Column sub-headers row (e.g. [['C26','REGION'], ...])
function _subHeaders(sheet, defs, bg, wrap) {
  defs.forEach(([a1, label]) => {
    const r = sheet.getRange(a1)
      .setValue(label)
      .setBackground(bg)
      .setFontColor(C.WHITE_TEXT)
      .setFontSize(7.5)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    if (wrap) r.setWrap(true);
  });
}

// Total/summary row — same bg + white text across given cols
function _totalRow(sheet, row, cols, vals, bg) {
  cols.forEach((col, i) => {
    sheet.getRange(`${col}${row}`)
      .setValue(vals[i])
      .setBackground(bg)
      .setFontColor(C.WHITE_TEXT)
      .setFontWeight('bold')
      .setFontSize(8)
      .setHorizontalAlignment('center');
  });
}

// Background color for ranked list rows (top 3 medals + alternating)
function _rankBg(i, altColor) {
  if (i === 0) return C.AMBER;
  if (i === 1) return C.RANK2_GRAY;
  if (i === 2) return C.RANK3_WHEAT;
  return i % 2 === 0 ? altColor : C.WHITE;
}
