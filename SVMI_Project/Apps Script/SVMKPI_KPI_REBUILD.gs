// ============================================================
// SVMKPI_KPI_REBUILD.gs
// Rebuilds KPI 2026 sheet — layout + all SUMPRODUCT formulas.
// Visitor names read dynamically from SETTINGS!F, plus anyone with real
// MASTER_LOG history who's since been removed from that roster (their
// historical numbers would otherwise vanish from this sheet on rebuild).
// Each visitor gets a unique identity color matching the live sheet.
// ============================================================

// A function, not a top-level const, so cross-file references aren't
// evaluated before every file's top-level code has run (Apps Script's
// cross-file load-order hazard) — every call site below is inside a
// function, so this resolves at runtime.
//
// Phase 1C: `year` is now an explicit parameter (never a hardcoded
// literal) — omit it for getDefaultReportingYear() (SVMKPI_REPORTING_
// YEAR.gs), the latest year actually present in MASTER_LOG. Rebuilding
// for a different year reuses/renames this ONE sheet; it does not create
// or maintain multiple simultaneous per-year sheets (that kind of
// snapshot/archival behavior is explicitly deferred to a later phase).
function _kpiSheetName(year) {
  const y = (year != null && !isNaN(Number(year))) ? Number(year) : getDefaultReportingYear();
  return 'KPI ' + y;
}

// ── Color palette ───────────────────────────────────────────
const KPI_C = {
  NAVY:       '#243F60',
  NAVY_DEEP:  '#1A2F4A',
  GOLD:       '#F4B942',
  WHITE:      '#FFFFFF',
  DISABLED:   '#EEEEEE',   // W5 cells for short months
  DISABLED_FG:'#AAAAAA',
  DATA_BG:    '#FFFFFF',   // even rows
  DATA_ALT:   '#EEF4FF',   // odd rows (alternating tint)
  DATA_FG:    '#1A1A2E',
  ZERO_FG:    '#AAAAAA',   // zero values in data cells
  Q1:  '#1F3864', Q2: '#1F5C2E', Q3: '#8B4513', Q4: '#4A235A',
  SUM: '#2E4A7A',          // Q1/Q2/Q3/Q4/YTD summary columns
};

// Unique visitor identity colors (assigned by roster position 0–11)
const KPI_VISITOR_COLORS = [
  '#4472C4',  // 0 — blue
  '#1F1F1F',  // 1 — near-black
  '#00B050',  // 2 — green
  '#E36C09',  // 3 — orange
  '#938953',  // 4 — olive
  '#7F7F7F',  // 5 — gray
  '#002060',  // 6 — dark navy
  '#17B169',  // 7 — teal
  '#FF0000',  // 8 — red
  '#632523',  // 9 — dark red
  '#7030A0',  // 10 — purple
  '#215868',  // 11 — dark blue-green
];

// ── Layout constants ────────────────────────────────────────
const KPI_NAME_COL  = 2;   // col B
const KPI_MON_START = 3;   // col C — first data column
const KPI_BLOCK     = 7;   // cols per month: W1 W2 W3 W4 W5 TOT spacer
const KPI_Q1_COL    = 87;
const KPI_Q2_COL    = 88;
const KPI_Q3_COL    = 89;
const KPI_Q4_COL    = 90;
const KPI_YTD_COL   = 91;

const KPI_MONTHS = [
  'JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
  'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER',
];

const KPI_QLABELS = ['Q1 · JAN–MAR','Q2 · APR–JUN','Q3 · JUL–SEP','Q4 · OCT–DEC'];
const KPI_QCOLORS = [KPI_C.Q1, KPI_C.Q2, KPI_C.Q3, KPI_C.Q4];
const SUMCOLS     = [KPI_Q1_COL, KPI_Q2_COL, KPI_Q3_COL, KPI_Q4_COL, KPI_YTD_COL];

function _monStartCol(mi) {
  return KPI_MON_START + mi * KPI_BLOCK;
}

function _colLetter(col) {
  let s = '', c = col;
  while (c > 0) {
    const r = (c - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

// ── Week date-range calculator ──────────────────────────────
// Weeks are Sun–Sat. W1 = day 1 → next Saturday. W5 = remaining days.
function _weekRanges(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const weeks = [];
  let day = 1;

  while (day <= lastDay && weeks.length < 5) {
    const dow = new Date(year, month - 1, day).getDay(); // 0=Sun,6=Sat
    const toSat = (6 - dow + 7) % 7;
    const endDay = weeks.length === 4 ? lastDay : Math.min(day + toSat, lastDay);
    weeks.push({ s: day, e: endDay });
    day = endDay + 1;
  }

  return weeks;
}

// ── Formula builders ────────────────────────────────────────
// ref is a pre-built formula fragment to search for in MASTER_LOG's
// Visited By column — either a live SETTINGS!F cell reference (current
// roster member) or a literal quoted name (someone with visit history who
// has since been removed from the roster; see buildKPI2026()) — either
// way this formula doesn't care which.
function _visitorWeekFormula(ref, year, month, s, e) {
  // Normalize pipe spacing:
  // "JAMES | LEO" -> "JAMES|LEO"
  // "GIO | RICE | JAMES" -> "GIO|RICE|JAMES"
  const maxRow = MASTER_LOG_MAX_ROW; // SVMKPI_CORE.gs — see comment there
  const visitedBy = `REGEXREPLACE(TRIM(MASTER_LOG!F$2:F$${maxRow}),"\\s*\\|\\s*","|")`;

  return `=SUMPRODUCT(
    --ISNUMBER(SEARCH("|"&${ref}&"|","|"&${visitedBy}&"|")),
    --(MASTER_LOG!B$2:B$${maxRow}>=DATE(${year},${month},${s})),
    --(MASTER_LOG!B$2:B$${maxRow}<=DATE(${year},${month},${e}))
  )`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════
/**
 * buildKPI2026(year)
 * Rebuilds the "KPI <year>" weekly tracker sheet — SAME implementation
 * for any requested year (Phase 1C), not a per-year copy. Historically
 * named for its original single-year use; kept as-is rather than renamed,
 * to avoid touching every existing menu item/portal button/HTML call site
 * that already calls it by this name — see DEPLOY.md's Phase 1C section.
 * @param {number} [year] - Reporting year. Omit for
 *   getDefaultReportingYear() (SVMKPI_REPORTING_YEAR.gs) — the latest
 *   year actually present in MASTER_LOG, never a hardcoded literal.
 */
function buildKPI2026(year) {
  // Phase 1H-B.1 (Required finding 2, reviews/003 §H) — see
  // buildExecutiveSummaryLayout() in SVMKPI_LAYOUT.gs for the full
  // rationale; same fix, same typeof-guard, applied here.
  if (typeof sl_isAdmin === 'function' && !sl_isAdmin()) {
    throw new Error('Admin access required.');
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const KPI_YEAR = (year != null && !isNaN(Number(year))) ? Number(year) : getDefaultReportingYear();

  // ── Read visitor roster from SETTINGS!F ───────────────────
  const settings = ss.getSheetByName('SETTINGS');
  if (!settings) throw new Error('SETTINGS sheet not found.');

  const sLastRow = settings.getLastRow();
  const rawVisitors = sLastRow >= 2
    ? settings.getRange(2, 6, sLastRow - 1, 1).getValues()
    : [];

  const visitors = [];
  const rosterNames = new Set();
  rawVisitors.forEach((row, idx) => {
    const name = String(row[0] || '').trim().toUpperCase();
    if (name) {
      visitors.push({ name, settingsRow: idx + 2 });
      rosterNames.add(name);
    }
  });

  // ── Add back anyone with real visit history who isn't on the current
  //    roster (removed via Store & Roster Manager, or the roster row was
  //    simply never backfilled for them) — otherwise their historical
  //    numbers would silently vanish from this sheet on the next rebuild,
  //    even though the underlying MASTER_LOG rows are untouched. Appended
  //    after the roster names (alphabetically) rather than interleaved, so
  //    the active roster's existing row order/colors don't shift around.
  const masterLog = _getSheet(SHEET.MASTER_LOG);
  const logData = _getData(masterLog);
  const historicalNames = new Set();
  logData.dates.forEach((date, i) => {
    if (!(date instanceof Date) || isNaN(date.getTime()) || date.getFullYear() !== KPI_YEAR) return;
    String(logData.rawVisitors[i] || '').split('|').map(v => v.trim().toUpperCase()).filter(Boolean)
      .forEach(name => { if (!rosterNames.has(name)) historicalNames.add(name); });
  });
  Array.from(historicalNames).sort().forEach(name => {
    visitors.push({ name, settingsRow: null });
  });

  if (!visitors.length) throw new Error('No visitors found in SETTINGS!F.');

  // ── Get or create sheet ────────────────────────────────────
  let sheet = ss.getSheetByName(_kpiSheetName(KPI_YEAR));
  if (!sheet) {
    sheet = ss.insertSheet(_kpiSheetName(KPI_YEAR));
  } else {
    sheet.clear();
    sheet.clearFormats();
  }

  const DATA_ROW_START = 6;
  const TEAM_TOTAL_ROW = DATA_ROW_START + visitors.length;
  const neededRows = TEAM_TOTAL_ROW + 2;
  const neededCols = KPI_YTD_COL + 2;

  if (sheet.getMaxRows() < neededRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < neededCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
  }

  // ── ROW 1: Title ───────────────────────────────────────────
  sheet.getRange(1, 1, 1, 2)
    .setBackground(KPI_C.NAVY)
    .setValue('');

  sheet.getRange(1, KPI_MON_START, 1, KPI_YTD_COL - KPI_MON_START + 1).merge();
  sheet.getRange(1, KPI_MON_START)
    .setValue(`STORE VISIT PROGRAM ${KPI_YEAR} — WEEKLY KPI TRACKER  (JAN – DEC)`)
    .setBackground(KPI_C.NAVY)
    .setFontColor(KPI_C.WHITE)
    .setFontFamily('Arial')
    .setFontSize(13)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(1, 32);

  // ── ROW 2: Subtitle ────────────────────────────────────────
  sheet.getRange(2, 1, 1, 2)
    .setBackground(KPI_C.NAVY_DEEP)
    .setValue('');

  sheet.getRange(2, KPI_MON_START, 1, KPI_YTD_COL - KPI_MON_START + 1).merge();
  sheet.getRange(2, KPI_MON_START)
    .setValue('Live SUMPRODUCT from MASTER_LOG  ·  Multi-visitor rows count for each person  ·  Jan–Dec tracking')
    .setBackground(KPI_C.NAVY_DEEP)
    .setFontColor('#7FA8D4')
    .setFontFamily('Arial')
    .setFontSize(8.5)
    .setFontStyle('italic')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(2, 18);

  // ── ROW 3: Quarter group headers ───────────────────────────
  const qStart = [[3,21],[24,42],[45,63],[66,84]];
  qStart.forEach(([sc, ec], qi) => {
    sheet.getRange(3, sc, 1, ec - sc + 1).merge();
    sheet.getRange(3, sc)
      .setValue(KPI_QLABELS[qi])
      .setBackground(KPI_QCOLORS[qi])
      .setFontColor(KPI_C.WHITE)
      .setFontFamily('Arial')
      .setFontSize(9)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });

  // Summary header
  sheet.getRange(3, KPI_Q1_COL, 1, 5).merge();
  sheet.getRange(3, KPI_Q1_COL)
    .setValue('SUMMARY')
    .setBackground(KPI_C.SUM)
    .setFontColor(KPI_C.WHITE)
    .setFontFamily('Arial')
    .setFontSize(9)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  // Name column row 3 — navy
  sheet.getRange(3, KPI_NAME_COL).setBackground(KPI_C.NAVY);
  sheet.getRange(3, 1).setBackground(KPI_C.NAVY);
  sheet.setRowHeight(3, 20);

  // ── ROW 4: "VISITOR" + Month names ────────────────────────
  sheet.getRange(4, 1).setBackground(KPI_C.NAVY);
  sheet.getRange(4, KPI_NAME_COL)
    .setValue('VISITOR')
    .setBackground(KPI_C.NAVY)
    .setFontColor(KPI_C.WHITE)
    .setFontFamily('Arial')
    .setFontSize(9)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  KPI_MONTHS.forEach((name, mi) => {
    const sc = _monStartCol(mi);
    const span = KPI_BLOCK - 1; // 6 cols (W1–TOT), exclude spacer
    sheet.getRange(4, sc, 1, span).merge();
    sheet.getRange(4, sc)
      .setValue(name)
      .setBackground(KPI_QCOLORS[Math.floor(mi / 3)])
      .setFontColor(KPI_C.WHITE)
      .setFontFamily('Arial')
      .setFontSize(9)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    sheet.getRange(4, sc + 6).setBackground(KPI_C.WHITE);
  });

  ['Q1','Q2','Q3','Q4','YTD'].forEach((lbl, i) => {
    sheet.getRange(4, SUMCOLS[i])
      .setValue(lbl)
      .setBackground(KPI_QCOLORS[i] || KPI_C.SUM)
      .setFontColor(KPI_C.WHITE)
      .setFontFamily('Arial')
      .setFontSize(9)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });

  sheet.getRange(4, SUMCOLS[4]).setBackground(KPI_C.SUM);
  sheet.setRowHeight(4, 20);

  // ── ROW 5: "NAME" + W1-W5-TOT week headers ─────────────────
  sheet.getRange(5, 1).setBackground(KPI_C.NAVY);
  sheet.getRange(5, KPI_NAME_COL)
    .setValue('NAME')
    .setBackground(KPI_C.NAVY)
    .setFontColor(KPI_C.WHITE)
    .setFontFamily('Arial')
    .setFontSize(9)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  KPI_MONTHS.forEach((_, mi) => {
    const sc = _monStartCol(mi);
    ['W1','W2','W3','W4','W5','TOT'].forEach((lbl, wi) => {
      const isTot = wi === 5;
      sheet.getRange(5, sc + wi)
        .setValue(lbl)
        .setBackground(isTot ? KPI_C.GOLD : KPI_C.NAVY)
        .setFontColor(isTot ? KPI_C.NAVY : KPI_C.WHITE)
        .setFontFamily('Arial')
        .setFontSize(8.5)
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    });
    sheet.getRange(5, sc + 6).setBackground(KPI_C.WHITE).setValue('');
  });

  ['Q1','Q2','Q3','Q4','YTD'].forEach((lbl, i) => {
    sheet.getRange(5, SUMCOLS[i])
      .setValue(lbl)
      .setBackground(i < 4 ? KPI_QCOLORS[i] : KPI_C.SUM)
      .setFontColor(KPI_C.WHITE)
      .setFontFamily('Arial')
      .setFontSize(8.5)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });

  sheet.setRowHeight(5, 20);

  // ── ROWS 6+: Visitor data rows ──────────────────────────────
  const monthTotCols = KPI_MONTHS.map((_, mi) => _monStartCol(mi) + 5);

  visitors.forEach(({ name, settingsRow }, vi) => {
    const row = DATA_ROW_START + vi;
    const visColor = KPI_VISITOR_COLORS[vi % KPI_VISITOR_COLORS.length];
    const dataBg = vi % 2 === 0 ? KPI_C.DATA_BG : KPI_C.DATA_ALT;
    // A roster member's name stays a live formula (so renaming SETTINGS!F
    // updates this sheet too); someone who's since been removed from the
    // roster has no live cell to point to anymore, so their name is
    // written as a plain literal instead — their numbers still come from
    // MASTER_LOG either way.
    const nameRef = settingsRow ? `TRIM(SETTINGS!F${settingsRow})` : JSON.stringify(name);

    sheet.setRowHeight(row, 18);

    // Col A margin
    sheet.getRange(row, 1).setBackground(KPI_C.NAVY_DEEP);

    // Col B — visitor identity color
    const nameCell = sheet.getRange(row, KPI_NAME_COL);
    if (settingsRow) nameCell.setFormula(`=${nameRef}`); else nameCell.setValue(name);
    nameCell
      .setBackground(visColor)
      .setFontColor(KPI_C.WHITE)
      .setFontFamily('Arial')
      .setFontSize(9)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    // Month data
    KPI_MONTHS.forEach((_, mi) => {
      const month = mi + 1;
      const sc = _monStartCol(mi);
      const weeks = _weekRanges(KPI_YEAR, month);

      // W1–W5
      for (let wi = 0; wi < 5; wi++) {
        const col = sc + wi;
        if (wi < weeks.length) {
          const { s, e } = weeks[wi];
          sheet.getRange(row, col)
            .setFormula(_visitorWeekFormula(nameRef, KPI_YEAR, month, s, e))
            .setBackground(dataBg)
            .setFontColor(KPI_C.DATA_FG)
            .setFontFamily('Arial')
            .setFontSize(9)
            .setHorizontalAlignment('center')
            .setVerticalAlignment('middle');
        } else {
          const disabledBg = vi % 2 === 0 ? '#E8E8E8' : '#D8E8F8';
          sheet.getRange(row, col)
            .setValue(0)
            .setBackground(disabledBg)
            .setFontColor(KPI_C.DISABLED_FG)
            .setFontFamily('Arial')
            .setFontSize(9)
            .setHorizontalAlignment('center')
            .setVerticalAlignment('middle');
        }
      }

      // TOT = SUM(W1:W5)
      const w1l = _colLetter(sc);
      const w5l = _colLetter(sc + 4);
      sheet.getRange(row, sc + 5)
        .setFormula(`=SUM(${w1l}${row}:${w5l}${row})`)
        .setBackground(KPI_C.GOLD)
        .setFontColor(KPI_C.NAVY)
        .setFontFamily('Arial')
        .setFontSize(9)
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');

      // Spacer
      sheet.getRange(row, sc + 6).setBackground(KPI_C.WHITE).setValue('');
    });

    // Q1–Q4
    const qm = [
      [monthTotCols[0], monthTotCols[1], monthTotCols[2]],
      [monthTotCols[3], monthTotCols[4], monthTotCols[5]],
      [monthTotCols[6], monthTotCols[7], monthTotCols[8]],
      [monthTotCols[9], monthTotCols[10], monthTotCols[11]],
    ];

    qm.forEach((cols, qi) => {
      const refs = cols.map(c => _colLetter(c) + row).join(',');
      sheet.getRange(row, SUMCOLS[qi])
        .setFormula(`=SUM(${refs})`)
        .setBackground(KPI_QCOLORS[qi])
        .setFontColor(KPI_C.WHITE)
        .setFontFamily('Arial')
        .setFontSize(9)
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    });

    // YTD
    const ytdRefs = monthTotCols.map(c => _colLetter(c) + row).join(',');
    sheet.getRange(row, KPI_YTD_COL)
      .setFormula(`=SUM(${ytdRefs})`)
      .setBackground(KPI_C.NAVY)
      .setFontColor(KPI_C.GOLD)
      .setFontFamily('Arial')
      .setFontSize(9)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });

  // ── TEAM TOTAL row ──────────────────────────────────────────
  const r1 = DATA_ROW_START;
  const r2 = TEAM_TOTAL_ROW - 1;

  sheet.setRowHeight(TEAM_TOTAL_ROW, 22);
  sheet.getRange(TEAM_TOTAL_ROW, 1).setBackground(KPI_C.NAVY);
  sheet.getRange(TEAM_TOTAL_ROW, KPI_NAME_COL)
    .setValue('TEAM TOTAL')
    .setBackground(KPI_C.NAVY)
    .setFontColor(KPI_C.GOLD)
    .setFontFamily('Arial')
    .setFontSize(9)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  KPI_MONTHS.forEach((_, mi) => {
    const sc = _monStartCol(mi);
    for (let wi = 0; wi <= 5; wi++) {
      const col = sc + wi;
      const isTot = wi === 5;
      sheet.getRange(TEAM_TOTAL_ROW, col)
        .setFormula(`=SUM(${_colLetter(col)}${r1}:${_colLetter(col)}${r2})`)
        .setBackground(isTot ? KPI_C.GOLD : KPI_C.NAVY)
        .setFontColor(isTot ? KPI_C.NAVY : KPI_C.WHITE)
        .setFontFamily('Arial')
        .setFontSize(9)
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }
    sheet.getRange(TEAM_TOTAL_ROW, sc + 6).setBackground(KPI_C.WHITE).setValue('');
  });

  SUMCOLS.forEach((col, i) => {
    sheet.getRange(TEAM_TOTAL_ROW, col)
      .setFormula(`=SUM(${_colLetter(col)}${r1}:${_colLetter(col)}${r2})`)
      .setBackground(i < 4 ? KPI_QCOLORS[i] : KPI_C.NAVY)
      .setFontColor(KPI_C.WHITE)
      .setFontFamily('Arial')
      .setFontSize(9)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });

  sheet.getRange(TEAM_TOTAL_ROW, KPI_YTD_COL)
    .setBackground(KPI_C.GOLD)
    .setFontColor(KPI_C.NAVY);

  // ── Column widths ────────────────────────────────────────────
  sheet.setColumnWidth(1, 16);   // A margin
  sheet.setColumnWidth(2, 88);   // B NAME

  for (let mi = 0; mi < 12; mi++) {
    const sc = _monStartCol(mi);
    for (let wi = 0; wi < 5; wi++) {
      sheet.setColumnWidth(sc + wi, 32);
    }
    sheet.setColumnWidth(sc + 5, 40);  // TOT wider
    sheet.setColumnWidth(sc + 6, 6);    // thin spacer
  }

  SUMCOLS.forEach(c => sheet.setColumnWidth(c, 44));

  // ── Freeze ────────────────────────────────────────────────────
  sheet.setFrozenRows(5);
  sheet.setFrozenColumns(2);

  SpreadsheetApp.flush();
  Logger.log(`[KPI] Rebuilt. ${visitors.length} visitors.`);

  return { success: true, visitors: visitors.length };
}
