TLM (TEAM LEADER MONITORING) — TL TRACKER — PROJECT FILES
===========================================================

/Apps Script/
  The actual Google Apps Script project — Code.gs (backend), TLForm.html
  (the merged phone/desktop form UI), appsscript.json (the project
  manifest: timezone + web app access settings), and .clasp.json.example
  (rename to .clasp.json and fill in a real Script ID once one exists —
  see README-CLASP.md). To use it for real, see INSTALL.md below for the
  full copy-paste walkthrough, or README-CLASP.md for the clasp-based
  (no copy-paste) workflow.

  Quick version:
    1. Open the target Google Sheet (do this on the
       "[cowork] Team Leader Monitoring" copy first, not the live sheet).
    2. Extensions -> Apps Script.
    3. Paste in Code.gs, and add TLForm.html as a new HTML file named
       exactly "TLForm". (appsscript.json is edited via Project Settings
       > "Show 'appsscript.json' manifest file in editor.")
    4. Reload the Sheet — a "🍕 TL Tracker" menu appears. Run
       "Set Up Sheets (first-time only)" to create MASTER_LOG,
       UNIFORM_LOG, and UNIFORM_INVENTORY with the right headers.
    5. Run "Set / Change Access PIN" to gate the phone link.
    6. Deploy -> New deployment -> Web app (Execute as: Me, Access:
       Anyone) to get the phone-friendly URL. Re-deploy a new version
       any time Code.gs / TLForm.html changes — editing alone doesn't
       update the live link.

  Inside the form: four switchable modes — 🆕 New Entry, ✅ Certify,
  👕 Uniform, and 📦 Stock — covering onboarding, certification status,
  uniform issuance, and supplier stock tracking, all writing back to the
  three sheet tabs above by header name (not fixed column position).

/INSTALL.md
  The full manual (copy-paste) install guide: sheet layout for all three
  tabs, PIN setup, web app deployment, what each of the four form modes
  does, and what changed from the original sheet (dedicated uniform
  tracking, stock on hand, DR#-by-store, regrouped grading fields).

/README-CLASP.md
  How to hook this folder up to `clasp` (Google's Apps Script CLI) so
  edits here can be pushed straight to the live script with one command
  instead of copy-pasting into the Apps Script editor by hand.
