KPI MONITORING INITIATIVE — FACILITATOR KPI SCORECARD
=======================================================

What this is
-------------
A standalone HTML/JS dashboard that scores Training & Development
facilitators (trainers) against the Store Visit Evaluation Survey — the
same 15-criteria, 5-point survey (5 Excellent .. 1 Poor) that feeds the
KPI/risk system in SVMI_Project, but rolled up per facilitator instead
of per store.

It was ported from a Claude Cowork session ("Facilitator KPI reports")
that built this as a live Google Drive-backed scorecard with CSV
export, ready to share with HRAD / Training & Development.

/Facilitator_KPI_Scorecard_Demo.html
  Self-contained demo (HTML + CSS + JS, no build step). Open it
  directly in a browser. It ships with an embedded CSV snapshot of
  survey responses so it renders immediately with no setup, mirroring
  how SVMI_Project/SVMI_Command_Center_Demo.html works.

  Data pipeline (all client-side, in the <script> block):
    - Parses the "Form responses 1" CSV export of the Store Visit
      Evaluation Survey Google Form.
    - Matches the free-text Facilitator/Trainer field against a
      known-facilitator roster (regex per person, to absorb
      misspellings/nicknames — "Sir Leo", "loe", "lea" -> Leo
      Fernandez, etc.). Responses naming several facilitators credit
      each of them; responses naming no one are credited to
      "Team Effort".
    - Groups scores into four KPIs: Delivery, Content, Impact, and
      Satisfaction (defined in the "How this report was built" panel
      at the bottom of the page).
    - Classifies each response's activity into a category (Rider
      Refresher, Professional Image Enhancement, Food Safety, etc.)
      by matching the free-text "Activity Conducted" field, with a
      same-day/same-store/same-facilitator fallback for unclear
      entries.

  Dashboard features:
    - Ranked scorecard table (sortable columns, rating-band pills,
      low-sample-size flag for facilitators with under 5 responses).
    - Evaluations-received and average-rating charts per facilitator,
      with a "Team Effort" series broken out separately.
    - Monthly activity heatmap.
    - Per-facilitator drill-down profile: criteria scores vs.
      department average, activities conducted, co-facilitators,
      stores visited, and the most-valuable / suggested-improvement
      free-text quotes.
    - "Responses to review" table — entries averaging below 3.00.
    - Month and brand filters, an "exclude likely scale misreads"
      toggle, and CSV export of the current scorecard view.
    - Optional live refresh from Google Drive (via the artifact's
      declared Google Drive MCP connector, download_file_content) to
      pull the latest form-response CSV instead of the embedded
      snapshot — falls back to the snapshot when that connector isn't
      available.

Status / next steps
--------------------
This is the initial import of the deliverable into the repo as a
static demo, same pattern as SVMI_Project's command-center demo. It
does not yet have an Apps Script backend or tests. If this needs to
run the way SVMI_Project does (deployed against a live Google Sheet,
with the "STORE VISIT KPI" menu / web app flow described in
SVMI_Project/README.txt and DEPLOY.md), that backend + a
SVMI_Project/tests-style test suite is the next piece of work, likely
sharing the survey-parsing/name-matching logic with SVMI_Project's
existing SVMKPI_* scripts rather than duplicating it.
