SVMI COMMAND CENTER — PROJECT FILES
====================================

/Apps Script/
  The actual Google Apps Script project — 24 .gs files, 1 .html file,
  and appsscript.json (the project manifest). [Corrected — this said
  "10 .gs files" as of early versions of this file; the project has
  grown substantially since (Admin Configuration engine, versioned
  Risk/Compliance/KPI/Store/Visitor/Purpose config, report snapshots).
  See ../ARCHITECTURE.md section 4 for the complete, current file map
  with a one-line description of each file — not repeated here to avoid
  two lists that can drift out of sync again.] This is what runs inside
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
        the in-Sheet Command Center (same nav sections, same data), just
        without needing the Sheet open.
  To ship an update after editing any file: Deploy -> Manage
  deployments -> pencil icon on your deployment -> New version ->
  Deploy. (Editing files alone does NOT update a live deployment —
  you must push a new version.)

  Files: for the paste-in step above, create every .gs/.html file that
  exists in this directory — do not stop at a partial list (an earlier
  version of this README named only 10 representative files, which is
  why step 3 above says "each file below," not "the 10 files below").
  The current full file map with a one-line description of each is
  ../ARCHITECTURE.md section 4.

    SVMI_PORTAL.html         The Command Center UI itself — currently 5
                              nav sections (Reports / Store Insights /
                              Unvisited This Month / Input Portal /
                              Admin, the last admin-only). Talks to the
                              .gs files via google.script.run. [Corrected
                              — this said "4-tab ... / System Tools" in
                              earlier versions of this file; System
                              Tools was folded into Admin -> Tools and
                              an Admin tab was added. See
                              ../ARCHITECTURE.md section 3.]

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
