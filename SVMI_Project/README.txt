SVMI COMMAND CENTER — PROJECT FILES
====================================

/Apps Script/
  The actual Google Apps Script project — 10 .gs files, 1 .html file,
  and appsscript.json (the project manifest). This is what runs inside
  Google Sheets. To use it for real:
    1. Open (or create) the target Google Sheet.
    2. Extensions -> Apps Script.
    3. Create each file below with the matching name (Script files
       for .gs, an HTML file for SVMI_PORTAL) and paste in the content.
       (appsscript.json is edited via Project Settings > "Show
       'appsscript.json' manifest file in editor" — it isn't pasted
       in like the others.)
    4. Make sure the Sheet has MASTER_LOG and SETTINGS tabs matching
       the column layout described in INPUT_PORTAL.gs and
       SVMKPI_CORE.gs.
    5. Reload the Sheet — the "STORE VISIT KPI" menu (from
       SVMKPI_ADMIN.gs) will appear, with "Open Command Center."

  --- Deploying as a standalone Web App (a real URL) ---
  Steps 1-5 above still apply (the Sheet is still the database), but
  you can ALSO open the Command Center at its own URL instead of only
  through the Sheets menu:
    6. In the Apps Script editor: Deploy (top right) -> New deployment.
    7. Click the gear icon next to "Select type" -> Web app.
    8. Description: anything (e.g. "SVMI Command Center v1").
       Execute as: "Me" (so visitors don't need their own edit access
       to the Sheet). Who has access: "Anyone" (any Google account can
       open the link) or "Anyone within [your org]" if you're on
       Google Workspace and want it restricted internally.
    9. Click Deploy, then Authorize access the first time (it's your
       own script, so this is expected).
    10. Copy the Web app URL it gives you — that's your live link.
        Bookmark it / share it with your team; it works exactly like
        the in-Sheet Command Center (same 4 tabs, same data), just
        without needing the Sheet open.
  To ship an update after editing any file: Deploy -> Manage
  deployments -> pencil icon on your deployment -> New version ->
  Deploy. (Editing files alone does NOT update a live deployment —
  you must push a new version.)

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
