// ============================================================
// SVMKPI_MASTER_REBUILD.gs
// Rebuilds:
//   1. MASTER_LOG — row 1 headers + formatting + brand color rules
//   2. SETTINGS   — row 1 headers + formatting + col D validation formula
// Does NOT modify data rows. Read-safe for all other sheets.
// ============================================================

const MR = {
  NAVY:    '#243F60',
  GOLD:    '#F4B942',
  WHITE:   '#FFFFFF',
  BODY:    '#1A1A2E',
  LIGHT:   '#F2F2F2',
  BORDER:  '#D9D9D9',
  // Brand colors (matching live spreadsheet)
  BRAND_ANGELS:  '#FCE4D6',
  BRAND_FIGARO:  '#DEEAF1',
  BRAND_APEX:    '#E2EFDA',
  BRAND_TIEN:    '#FFF2CC',
  BRAND_KOOBIDEH:'#E8D5F0',
};

// ═══════════════════════════════════════════════════════════════
// SECTION 1: MASTER_LOG REBUILD
// ═══════════════════════════════════════════════════════════════

/**
 * rebuildMasterLogHeaders()
 * Writes/restores MASTER_LOG row 1 headers with formatting.
 * Applies brand-based background color conditional formatting
 * to col D (Brand) for the first 5000 data rows.
 * Does NOT touch data in rows 2+.
 */
function rebuildMasterLogHeaders() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('MASTER_LOG');
  if (!sheet) throw new Error('MASTER_LOG sheet not found.');

  // ── Row 1 headers ───────────────────────────────────────────
  const headers = [
    'TIMES STAMP', 'DATE VISITED', 'STORE', 'BRAND',
    'REGION', 'VISITED BY', 'PURPOSE', 'REMARKS',
    'NAME', '# OF VISIT',
  ];

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setValues([headers])
    .setBackground(MR.NAVY)
    .setFontColor(MR.WHITE)
    .setFontFamily('Arial')
    .setFontSize(10)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(false);

  sheet.setRowHeight(1, 28);

  // ── Column widths ────────────────────────────────────────────
  const colWidths = [140, 95, 120, 110, 95, 120, 120, 180, 90, 80];
  colWidths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // ── Brand conditional formatting (col D, rows 2:5000) ───────
  const dataRange = sheet.getRange('D2:D5000');

  // Remove existing conditional format rules on this range
  const existingRules = sheet.getConditionalFormatRules();
  const filteredRules = existingRules.filter(rule => {
    const ranges = rule.getRanges();
    return !ranges.some(r => r.getA1Notation() === 'D2:D5000');
  });

  const brandColors = [
    { brand: "ANGEL'S PIZZA", bg: MR.BRAND_ANGELS },
    { brand: 'FIGARO',         bg: MR.BRAND_FIGARO  },
    { brand: 'APEX',           bg: MR.BRAND_APEX    },
    { brand: "TIEN MA'S",      bg: MR.BRAND_TIEN    },
    { brand: 'KOOBIDEH',       bg: MR.BRAND_KOOBIDEH},
  ];

  const newRules = brandColors.map(({ brand, bg }) =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(brand)
      .setBackground(bg)
      .setFontColor(MR.BODY)
      .setRanges([sheet.getRange('D2:D5000')])
      .build()
  );

  sheet.setConditionalFormatRules([...filteredRules, ...newRules]);

  // ── Freeze header row ────────────────────────────────────────
  sheet.setFrozenRows(1);

  SpreadsheetApp.flush();
  Logger.log('[MR] MASTER_LOG headers rebuilt.');
  return { success: true, sheet: 'MASTER_LOG' };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: SETTINGS REBUILD
// ═══════════════════════════════════════════════════════════════

/**
 * rebuildSettingsHeaders()
 * Writes/restores SETTINGS row 1 headers and formatting.
 * Rebuilds the col D validation formula for all data rows.
 * Col D formula: =IF(OR(B="<brand1>",B="<brand2>",...),IF(C="","⚠ MISSING REGION","OK"),"N/A")
 * built from ALL brands in SVMKPI_CORE.gs's APPROVED_BRANDS — not a
 * hardcoded subset — so every approved brand gets the Region check.
 * (Previously hardcoded to only "Angel's Pizza"/"Figaro", a leftover
 * from an earlier 2-brand version that silently stopped flagging
 * missing Region for the 3 brands added since.)
 * Does NOT touch store/visitor/category data.
 */
function rebuildSettingsHeaders() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('SETTINGS');
  if (!sheet) throw new Error('SETTINGS sheet not found.');

  const lastRow = Math.max(sheet.getLastRow(), 2);

  // ── Row 1 headers ───────────────────────────────────────────
  // A: STORES, B: BRAND, C: REGION, D: N/A (formula helper),
  // E: category, F: Visited by list, G: (spacer),
  // H: Visit Type list, I: (spacer), J: REGION LIST
  const headers = [
    'STORES', 'BRAND', 'REGION (AS MANAGED BY)', 'FORMULA HELPER',
    'CATEGORY (AS REGION)', 'Visited by list', '',
    'Visit Type list', '', 'REGION LIST',
  ];

  const headerRange = sheet.getRange(1, 1, 1, 10);
  headerRange
    .setValues([headers])
    .setBackground(MR.NAVY)
    .setFontColor(MR.WHITE)
    .setFontFamily('Arial')
    .setFontSize(10)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(false);

  sheet.setRowHeight(1, 28);

  // Highlight col D header gold (formula helper)
  sheet.getRange(1, 4)
    .setBackground(MR.GOLD)
    .setFontColor(MR.NAVY);

  // ── Column widths ────────────────────────────────────────────
  const widths = [140, 110, 100, 110, 130, 120, 20, 130, 20, 110];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // ── Col D validation formula (rows 2 to lastRow) ────────────
  // =IF(OR(B2="<brand1>",B2="<brand2>",...),IF(C2="","⚠ MISSING REGION","OK"),"N/A")
  // Brand list comes from APPROVED_BRANDS (SVMKPI_CORE.gs) so every
  // approved brand is checked — no hardcoded subset to fall out of sync.
  if (lastRow >= 2) {
    const dFormulas = [];
    for (let row = 2; row <= lastRow; row++) {
      const brandChecks = APPROVED_BRANDS
        .map(brand => `B${row}="${brand.replace(/"/g, '""')}"`)
        .join(',');
      dFormulas.push([
        `=IF(OR(${brandChecks}),IF(C${row}="","⚠ MISSING REGION","OK"),"N/A")`,
      ]);
    }
    sheet.getRange(2, 4, lastRow - 1, 1).setFormulas(dFormulas);

    // Style the formula helper column
    sheet.getRange(2, 4, lastRow - 1, 1)
      .setFontFamily('Arial')
      .setFontSize(9)
      .setHorizontalAlignment('center')
      .setFontColor('#555555');
  }

  // ── Freeze header + apply alternating banding ────────────────
  sheet.setFrozenRows(1);

  SpreadsheetApp.flush();
  Logger.log('[MR] SETTINGS headers rebuilt. D formula written to ' + (lastRow - 1) + ' rows.');
  return { success: true, sheet: 'SETTINGS', rowsProcessed: lastRow - 1 };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: COMBINED ENTRY POINT
// ═══════════════════════════════════════════════════════════════

/**
 * rebuildDataSheetHeaders()
 * Runs both MASTER_LOG and SETTINGS rebuilds in sequence.
 * Called by System Tools in the unified portal.
 * @returns {{ success: boolean, results: object[] }}
 */
function rebuildDataSheetHeaders() {
  const results = [];
  try {
    results.push(rebuildMasterLogHeaders());
  } catch (e) {
    results.push({ success: false, sheet: 'MASTER_LOG', error: e.message });
  }
  try {
    results.push(rebuildSettingsHeaders());
  } catch (e) {
    results.push({ success: false, sheet: 'SETTINGS', error: e.message });
  }
  return { success: results.every(r => r.success), results };
}
