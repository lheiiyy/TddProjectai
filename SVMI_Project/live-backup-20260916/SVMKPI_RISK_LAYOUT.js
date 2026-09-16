// ============================================================
// SVMKPI_RISK_LAYOUT.gs
// Store Health v1 — Final Presentation Layout
// ------------------------------------------------------------
// Owns ONLY visual presentation of the STORE HEALTH sheet:
//   - Title section + Last Refreshed timestamp
//   - KPI summary cards (count + % of total)
//   - Executive Focus section (Top 5 stores, rank shown here only)
//   - Header styling / freeze / autofilter
//   - Column widths
//   - Risk Tier / Recommended Action color-coding
//   - Attention Reason emphasis
//   - Row banding / borders / row height / alignment
//
// Does NOT contain and MUST NOT contain:
//   - Risk scoring          → _riskScore() in SVMKPI_RISK.gs (untouched)
//   - Risk tiering           → _riskTier() in SVMKPI_RISK.gs (untouched)
//   - Sorting                → populateRiskEngine() in SVMKPI_RISK.gs (untouched)
//   - Attention Reason text  → _attentionReason() in SVMKPI_RISK.gs (untouched)
//   - RISK_COL / column mapping for the detailed table — unchanged,
//     defined exclusively in SVMKPI_RISK.gs. The Top 5 section's
//     "Rank" is a presentation-only index (array position), it does
//     not exist as a column in the detailed table or in RISK_COL.
//   - Any MASTER_LOG read or data computation
//
// Color palette: reused verbatim from SVMKPI_LAYOUT.gs (Executive
// Summary). No new colors invented. NOTE: the established palette
// has no true red — BURNT_ORANGE (#D46A1A) is already the project's
// existing "danger" color (used for the FAILED QA/MS KPI card in
// Executive Summary) and is reused here as the HIGH / Immediate
// Intervention indicator.
// ============================================================

const RISK_COLORS = {
  NAVY:          '#243F60',
  BURNT_ORANGE:  '#D46A1A',  // stand-in for "red" — see note above
  AMBER:         '#F4B942',
  EMERALD_GREEN: '#1A7A52',
  PURPLE:        '#7030A0',
  LIGHT_GRAY:    '#F2F2F2',
  LIGHT_PEACH:   '#FCE4D6',
  WHITE:         '#FFFFFF',
  WHITE_TEXT:    '#FFFFFF',
  BODY_TEXT:     '#1A1A2E',
  BORDER_CARD:   '#CCCCCC',
  BORDER_GRID:   '#D9D9D9',
};

// Row map for the presentation layout (data positions only — no scoring impact)
const RISK_ROW = {
  TITLE:            1,
  LAST_REFRESHED:   2,
  SPACER_1:         3,
  KPI_LABEL:        4,
  KPI_VALUE:        5,
  KPI_PERCENT:      6,
  SPACER_2:         7,
  FOCUS_TITLE:      8,
  FOCUS_HEADER:     9,
  FOCUS_DATA_START: 10,
  FOCUS_DATA_ROWS:  5,
  SPACER_3:         15,
  HEADER:           16,
  DATA_START:       17,
};

// Column widths (px) — sized to print comfortably on A4 landscape
const RISK_COL_WIDTHS = [
  [RISK_COL.STORE,            170],
  [RISK_COL.BRAND,            100],
  [RISK_COL.REGION,            90],
  [RISK_COL.LAST_DATE,         95],
  [RISK_COL.LAST_PURPOSE,     115],
  [RISK_COL.DAYS_SINCE,        90],
  [RISK_COL.TOTAL_YTD,         85],
  [RISK_COL.STORE_YTD,         85],
  [RISK_COL.FAILED_COUNT,      95],
  [RISK_COL.CURING_COUNT,     100],
  [RISK_COL.RISK_SCORE,        70],
  [RISK_COL.RISK_TIER,         85],
  [RISK_COL.ACTION,           150],
  [RISK_COL.ATTENTION_REASON, 210],
];

// KPI card definitions — 5 cards spread across columns A:N
const RISK_KPI_CARDS = [
  { label: 'TOTAL STORES',                colStart: 1,  colSpan: 3, bg: 'NAVY'          },
  { label: 'HIGH RISK',                   colStart: 4,  colSpan: 3, bg: 'BURNT_ORANGE'  },
  { label: 'MEDIUM RISK',                 colStart: 7,  colSpan: 3, bg: 'AMBER'         },
  { label: 'LOW RISK',                    colStart: 10, colSpan: 3, bg: 'EMERALD_GREEN' },
  { label: 'COVERAGE GAP (NO Q VISIT)',   colStart: 13, colSpan: 2, bg: 'PURPLE'        },
];

// Executive Focus section column groups — presentation-only grouping,
// sums to RISK_HEADERS.length (14). No relationship to RISK_COL.
const RISK_FOCUS_COLUMNS = [
  { key: 'rank',   label: 'Rank',              colStart: 1,  colSpan: 1 },
  { key: 'store',  label: 'Store',             colStart: 2,  colSpan: 3 },
  { key: 'region', label: 'Region',            colStart: 5,  colSpan: 2 },
  { key: 'tier',   label: 'Risk Tier',         colStart: 7,  colSpan: 2 },
  { key: 'reason', label: 'Attention Reason',  colStart: 9,  colSpan: 4 },
  { key: 'action', label: 'Recommended Action',colStart: 13, colSpan: 2 },
];


// ═══════════════════════════════════════════════════════════════
// SECTION 1: SHEET SKELETON (title, header, freeze, filter)
// ═══════════════════════════════════════════════════════════════

/**
 * buildRiskEngineLayout(sheet)
 * Draws the title bar, blank KPI card shells, and the styled header
 * row. Called once per refresh, before data is written.
 * Pure presentation — writes no business data.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function buildRiskEngineLayout(sheet) {
  const totalCols = RISK_HEADERS.length;

  // Clear any leftover formatting/filters from a previous build
  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();

  // ── Title bar (row 1) ──────────────────────────────────────
  sheet.getRange(RISK_ROW.TITLE, 1, 1, totalCols).breakApart();
  sheet.getRange(RISK_ROW.TITLE, 1, 1, totalCols).merge();
  sheet.getRange(RISK_ROW.TITLE, 1)
    .setValue('STORE VISIT MONITORING INITIATIVE\nSTORE HEALTH')
    .setBackground(RISK_COLORS.NAVY)
    .setFontColor(RISK_COLORS.WHITE_TEXT)
    .setFontFamily('Arial')
    .setFontSize(16)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(RISK_ROW.TITLE, 48);

  // ── Last Refreshed line (row 2) — value filled by applyRiskLastRefreshed() ──
  sheet.getRange(RISK_ROW.LAST_REFRESHED, 1, 1, totalCols).breakApart();
  sheet.getRange(RISK_ROW.LAST_REFRESHED, 1, 1, totalCols).merge();
  sheet.getRange(RISK_ROW.LAST_REFRESHED, 1)
    .setBackground(RISK_COLORS.WHITE)
    .setFontColor(RISK_COLORS.BODY_TEXT)
    .setFontFamily('Arial')
    .setFontSize(8.5)
    .setFontStyle('italic')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(RISK_ROW.LAST_REFRESHED, 18);

  // ── Spacer ─────────────────────────────────────────────────
  sheet.getRange(RISK_ROW.SPACER_1, 1, 1, totalCols).setBackground(RISK_COLORS.WHITE);
  sheet.setRowHeight(RISK_ROW.SPACER_1, 8);

  // ── KPI card shells (rows 2-3) — values filled by applyRiskKPICards() ──
  RISK_KPI_CARDS.forEach(card => {
    const labelRange = sheet.getRange(RISK_ROW.KPI_LABEL, card.colStart, 1, card.colSpan);
    labelRange.breakApart().merge();
    labelRange
      .setValue(card.label)
      .setBackground(RISK_COLORS[card.bg])
      .setFontColor(RISK_COLORS.WHITE_TEXT)
      .setFontFamily('Arial')
      .setFontSize(8.5)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrap(true);

    const valueRange = sheet.getRange(RISK_ROW.KPI_VALUE, card.colStart, 1, card.colSpan);
    valueRange.breakApart().merge();
    valueRange
      .setBackground(RISK_COLORS.LIGHT_GRAY)
      .setFontColor(RISK_COLORS[card.bg])
      .setFontFamily('Arial')
      .setFontSize(20)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    const percentRange = sheet.getRange(RISK_ROW.KPI_PERCENT, card.colStart, 1, card.colSpan);
    percentRange.breakApart().merge();
    percentRange
      .setBackground(RISK_COLORS.LIGHT_GRAY)
      .setFontColor(RISK_COLORS[card.bg])
      .setFontFamily('Arial')
      .setFontSize(10)
      .setFontWeight('normal')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });
  sheet.setRowHeight(RISK_ROW.KPI_LABEL, 22);
  sheet.setRowHeight(RISK_ROW.KPI_VALUE, 30);
  sheet.setRowHeight(RISK_ROW.KPI_PERCENT, 18);

  // ── Spacer ─────────────────────────────────────────────────
  sheet.getRange(RISK_ROW.SPACER_2, 1, 1, totalCols).setBackground(RISK_COLORS.WHITE);
  sheet.setRowHeight(RISK_ROW.SPACER_2, 10);

  // ── Executive Focus shell (title + header) ──────────────────
  sheet.getRange(RISK_ROW.FOCUS_TITLE, 1, 1, totalCols).breakApart();
  sheet.getRange(RISK_ROW.FOCUS_TITLE, 1, 1, totalCols).merge();
  sheet.getRange(RISK_ROW.FOCUS_TITLE, 1)
    .setValue('TOP 5 STORES NEEDING ATTENTION')
    .setBackground(RISK_COLORS.NAVY)
    .setFontColor(RISK_COLORS.WHITE_TEXT)
    .setFontFamily('Arial')
    .setFontSize(10)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(RISK_ROW.FOCUS_TITLE, 24);

  RISK_FOCUS_COLUMNS.forEach(col => {
    const headerRange = sheet.getRange(RISK_ROW.FOCUS_HEADER, col.colStart, 1, col.colSpan);
    headerRange.breakApart().merge();
    headerRange
      .setValue(col.label)
      .setBackground(RISK_COLORS.LIGHT_GRAY)
      .setFontColor(RISK_COLORS.BODY_TEXT)
      .setFontFamily('Arial')
      .setFontSize(8.5)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  });
  sheet.setRowHeight(RISK_ROW.FOCUS_HEADER, 20);

  // Pre-merge the 5 Executive Focus data rows (values filled by
  // applyRiskExecutiveFocus()) and a sensible default row height
  for (let r = 0; r < RISK_ROW.FOCUS_DATA_ROWS; r++) {
    const row = RISK_ROW.FOCUS_DATA_START + r;
    RISK_FOCUS_COLUMNS.forEach(col => {
      sheet.getRange(row, col.colStart, 1, col.colSpan).breakApart().merge();
    });
    sheet.setRowHeight(row, 24);
  }

  // ── Spacer before the detailed table ────────────────────────
  sheet.getRange(RISK_ROW.SPACER_3, 1, 1, totalCols).setBackground(RISK_COLORS.WHITE);
  sheet.setRowHeight(RISK_ROW.SPACER_3, 10);

  // ── Header row ─────────────────────────────────────────────
  sheet.getRange(RISK_ROW.HEADER, 1, 1, totalCols)
    .setValues([RISK_HEADERS])
    .setBackground(RISK_COLORS.NAVY)
    .setFontColor(RISK_COLORS.WHITE_TEXT)
    .setFontFamily('Arial')
    .setFontSize(9)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(RISK_ROW.HEADER, 32);

  // ── Freeze + column widths ─────────────────────────────────
  sheet.setFrozenRows(RISK_ROW.HEADER);
  RISK_COL_WIDTHS.forEach(([col, px]) => sheet.setColumnWidth(col, px));

  // ── Print setup: fit to A4 landscape as closely as code allows ──
  // NOTE: Apps Script's Spreadsheet service has no API to set page
  // orientation or paper size — that is a Google Sheets UI-only
  // setting (File → Print → Landscape / A4). Column widths above are
  // sized to fit that layout, but the orientation itself must be set
  // manually once; Apps Script remembers it after that.
}

/**
 * applyRiskLastRefreshed(sheet, timestamp)
 * Writes the "Last Refreshed" line below the title. Pure display of
 * a timestamp the orchestrator already generated — no new logic.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Date} timestamp
 */
function applyRiskLastRefreshed(sheet, timestamp) {
  const formatted = Utilities.formatDate(
    timestamp, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'MMMM d, yyyy HH:mm'
  );
  sheet.getRange(RISK_ROW.LAST_REFRESHED, 1).setValue('Last Refreshed: ' + formatted);
}

/**
 * applyRiskKPICards(sheet, kpis)
 * Writes the 5 KPI summary values (count + % of total) into the card
 * shells built by buildRiskEngineLayout(). Pure display of
 * already-computed counts — percentage is a display-only derivation,
 * no scoring or tiering logic lives here.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {{total:number, high:number, medium:number, low:number, coverageGap:number}} kpis
 */
function applyRiskKPICards(sheet, kpis) {
  const values = [kpis.total, kpis.high, kpis.medium, kpis.low, kpis.coverageGap];
  const pct = n => kpis.total > 0 ? (n / kpis.total * 100).toFixed(1) + '%' : '—';

  RISK_KPI_CARDS.forEach((card, i) => {
    sheet.getRange(RISK_ROW.KPI_VALUE, card.colStart).setValue(values[i]);
    sheet.getRange(RISK_ROW.KPI_PERCENT, card.colStart).setValue(pct(values[i]));
  });
}

/**
 * applyRiskExecutiveFocus(sheet, top5)
 * Writes the Top 5 Stores Needing Attention section. Displays rank
 * 1-5 purely as the array position — reads the already-sorted data
 * handed to it, computes and stores nothing new.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {{store:string, region:string, tier:string, reason:string, action:string}[]} top5
 */
function applyRiskExecutiveFocus(sheet, top5) {
  const TIER_COLOR = {
    HIGH:   RISK_COLORS.BURNT_ORANGE,
    MEDIUM: RISK_COLORS.AMBER,
    LOW:    RISK_COLORS.EMERALD_GREEN,
  };
  const ACTION_COLOR = {
    'Immediate Intervention': RISK_COLORS.BURNT_ORANGE,
    'Planned Follow-up':      RISK_COLORS.AMBER,
    'Monitor':                RISK_COLORS.EMERALD_GREEN,
  };
  const colByKey = {};
  RISK_FOCUS_COLUMNS.forEach(c => { colByKey[c.key] = c.colStart; });

  for (let r = 0; r < RISK_ROW.FOCUS_DATA_ROWS; r++) {
    const row    = RISK_ROW.FOCUS_DATA_START + r;
    const bg     = r % 2 === 0 ? RISK_COLORS.WHITE : RISK_COLORS.LIGHT_GRAY;
    const item   = top5[r];

    sheet.getRange(row, 1, 1, RISK_HEADERS.length)
      .setBackground(bg)
      .setFontFamily('Arial')
      .setFontSize(9)
      .setVerticalAlignment('middle');

    if (!item) continue;  // fewer than 5 stores — leave row blank

    sheet.getRange(row, colByKey.rank)  .setValue(r + 1).setHorizontalAlignment('center').setFontWeight('bold');
    sheet.getRange(row, colByKey.store) .setValue(item.store).setHorizontalAlignment('left').setFontWeight('bold');
    sheet.getRange(row, colByKey.region).setValue(item.region).setHorizontalAlignment('center');
    sheet.getRange(row, colByKey.reason).setValue(item.reason).setHorizontalAlignment('left').setWrap(true);

    const tierCell = sheet.getRange(row, colByKey.tier).setValue(item.tier).setHorizontalAlignment('center').setFontWeight('bold');
    if (TIER_COLOR[item.tier]) tierCell.setBackground(TIER_COLOR[item.tier]).setFontColor(RISK_COLORS.WHITE_TEXT);

    const actionCell = sheet.getRange(row, colByKey.action).setValue(item.action).setHorizontalAlignment('center').setWrap(true);
    if (ACTION_COLOR[item.action]) actionCell.setBackground(ACTION_COLOR[item.action]).setFontColor(RISK_COLORS.WHITE_TEXT);
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: TABLE FORMATTING (banding, color-coding, borders)
// ═══════════════════════════════════════════════════════════════

/**
 * applyRiskTableFormatting(sheet, numDataRows)
 * Applies alternating row colors, borders, autofilter, alignment,
 * and color-codes Risk Tier / Recommended Action / Attention Reason.
 * Reads the already-written Risk Tier / Action columns to decide
 * colors — does not recompute or alter any value.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} numDataRows
 */
function applyRiskTableFormatting(sheet, numDataRows) {
  const totalCols = RISK_HEADERS.length;
  if (numDataRows <= 0) return;

  const dataRange = sheet.getRange(RISK_ROW.DATA_START, 1, numDataRows, totalCols);

  // Base style: consistent font + alignment + wrap on text-heavy columns
  dataRange
    .setFontFamily('Arial')
    .setFontSize(9)
    .setVerticalAlignment('middle');
  for (let r = 0; r < numDataRows; r++) {
    sheet.setRowHeight(RISK_ROW.DATA_START + r, 24);  // slightly taller for readability
  }
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.STORE, numDataRows, 1).setHorizontalAlignment('left').setFontWeight('bold');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.BRAND, numDataRows, 1).setHorizontalAlignment('left');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.REGION, numDataRows, 1).setHorizontalAlignment('center');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.LAST_DATE, numDataRows, 1).setHorizontalAlignment('center');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.LAST_PURPOSE, numDataRows, 1).setHorizontalAlignment('center');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.DAYS_SINCE, numDataRows, 1).setHorizontalAlignment('center');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.TOTAL_YTD, numDataRows, 1).setHorizontalAlignment('center');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.STORE_YTD, numDataRows, 1).setHorizontalAlignment('center');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.FAILED_COUNT, numDataRows, 1).setHorizontalAlignment('center');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.CURING_COUNT, numDataRows, 1).setHorizontalAlignment('center');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.RISK_SCORE, numDataRows, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.RISK_TIER, numDataRows, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.ACTION, numDataRows, 1).setHorizontalAlignment('center').setWrap(true);
  sheet.getRange(RISK_ROW.DATA_START, RISK_COL.ATTENTION_REASON, numDataRows, 1).setHorizontalAlignment('left').setWrap(true);

  // Alternating row bands (applied first; tier/action/reason cells
  // are recolored on top below so the color-coding always wins)
  for (let r = 0; r < numDataRows; r++) {
    const bg = r % 2 === 0 ? RISK_COLORS.WHITE : RISK_COLORS.LIGHT_GRAY;
    sheet.getRange(RISK_ROW.DATA_START + r, 1, 1, totalCols).setBackground(bg);
  }

  // Read back Risk Tier + Action + Attention Reason to color-code
  const tiers   = sheet.getRange(RISK_ROW.DATA_START, RISK_COL.RISK_TIER, numDataRows, 1).getValues();
  const actions = sheet.getRange(RISK_ROW.DATA_START, RISK_COL.ACTION, numDataRows, 1).getValues();
  const reasons = sheet.getRange(RISK_ROW.DATA_START, RISK_COL.ATTENTION_REASON, numDataRows, 1).getValues();

  const TIER_COLOR = {
    HIGH:   RISK_COLORS.BURNT_ORANGE,
    MEDIUM: RISK_COLORS.AMBER,
    LOW:    RISK_COLORS.EMERALD_GREEN,
  };
  const ACTION_COLOR = {
    'Immediate Intervention': RISK_COLORS.BURNT_ORANGE,
    'Planned Follow-up':      RISK_COLORS.AMBER,
    'Monitor':                RISK_COLORS.EMERALD_GREEN,
  };

  for (let r = 0; r < numDataRows; r++) {
    const row    = RISK_ROW.DATA_START + r;
    const tier   = tiers[r][0];
    const action = actions[r][0];
    const reason = reasons[r][0];

    if (TIER_COLOR[tier]) {
      sheet.getRange(row, RISK_COL.RISK_TIER)
        .setBackground(TIER_COLOR[tier])
        .setFontColor(RISK_COLORS.WHITE_TEXT);
    }
    if (ACTION_COLOR[action]) {
      sheet.getRange(row, RISK_COL.ACTION)
        .setBackground(ACTION_COLOR[action])
        .setFontColor(RISK_COLORS.WHITE_TEXT);
    }

    // Attention Reason: always stands out (bold + light peach tint);
    // text turns the danger color when it's a QA/MS-driven reason.
    const reasonCell = sheet.getRange(row, RISK_COL.ATTENTION_REASON)
      .setBackground(RISK_COLORS.LIGHT_PEACH)
      .setFontWeight('bold');
    reasonCell.setFontColor(
      String(reason).indexOf('QA/MS') !== -1 ? RISK_COLORS.BURNT_ORANGE : RISK_COLORS.BODY_TEXT
    );
  }

  // Borders — outer card border + internal gridlines
  dataRange.setBorder(true, true, true, true, true, true, RISK_COLORS.BORDER_GRID, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(RISK_ROW.HEADER, 1, numDataRows + 1, totalCols)
    .setBorder(true, true, true, true, null, null, RISK_COLORS.BORDER_CARD, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // Autofilter over header + data
  const filterRange = sheet.getRange(RISK_ROW.HEADER, 1, numDataRows + 1, totalCols);
  sheet.getFilter() && sheet.getFilter().remove();
  filterRange.createFilter();
}
