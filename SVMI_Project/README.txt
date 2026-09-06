SVMI COMMAND CENTER — PROJECT FILES
====================================

/Apps Script/
  The actual Google Apps Script project — 10 .gs files + 1 .html file.
  This is what runs inside Google Sheets. To use it for real:
    1. Open (or create) the target Google Sheet.
    2. Extensions -> Apps Script.
    3. Create each file below with the matching name (Script files
       for .gs, an HTML file for SVMI_PORTAL) and paste in the content.
    4. Make sure the Sheet has MASTER_LOG and SETTINGS tabs matching
       the column layout described in INPUT_PORTAL.gs and
       SVMKPI_CORE.gs.
    5. Reload the Sheet — the "STORE VISIT KPI" menu (from
       SVMKPI_ADMIN.gs) will appear, with "Open Command Center."

  Files:
    INPUT_PORTAL.gs          Sidebar-era backend: read SETTINGS,
                              write new visits, duplicate-visit check,
                              visitor roster management.
    SVMKPI_STORE_LOOKUP.gs   Store Intelligence module: per-store
                              profile, health score, rule-based
                              insight text, monthly coverage,
                              category-based compliance gaps.
    SVMKPI_CORE.gs           Shared constants/enums, MASTER_LOG
                              reader, Executive Summary populate
                              functions, validator, refresh engine.
    SVMKPI_ADMIN.gs          Menu, the unified portal's entry point,
                              and the portal_* functions the HTML
                              calls into for System Tools.
    SVMKPI_LAYOUT.gs         Executive Summary sheet layout,
                              formatting, and live formulas.
    SVMKPI_KPI_REBUILD.gs    Builds the KPI 2026 weekly tracker sheet
                              with SUMPRODUCT formulas.
    SVMKPI_MASTER_REBUILD.gs Rebuilds MASTER_LOG / SETTINGS headers
                              and formatting.
    SVMKPI_RISK.gs           Store Health risk-scoring engine.
    SVMKPI_RISK_LAYOUT.gs    Store Health sheet presentation layer.
    SVMKPI_STORE_MASTER.gs   Store Master Insight sheet builder.
    SVMI_PORTAL.html         The 4-tab Command Center UI itself
                              (Input Portal / Store Insights / Visits
                              This Month / System Tools). Talks to the
                              .gs files above via google.script.run.

/SVMI_Command_Center_Demo.html
  A stand-alone, interactive preview of SVMI_PORTAL.html that runs in
  any browser with no Google Sheet attached — google.script.run is
  replaced with a small in-memory data layer (21 sample stores, ~90
  sample visit records) so every tab is actually clickable. "Validate
  MASTER_LOG" under System Tools runs its real check against the
  sample data; the other five System Tools buttons simulate what
  they'd do to a live spreadsheet. Just open the file in a browser.

Note: SVMI_Command_Center_Demo.html is not part of the Apps Script
project — don't paste it into the Apps Script editor. It's a separate,
self-contained preview file.
