KPI MONITORING INITIATIVE — FACILITATOR KRA SCORECARD
=======================================================

What this is
-------------
A facilitator KRA (Key Result Area) scorecard for Training & Development
Division, covering the five KRAs HRAD scores facilitators on:

  KRA                              Weight  Formula
  Attendance / Punctuality/Behavior   10%  (Days Present - Lates - Absences)
                                           / Total Working Days x 100%
  Store Visit Compliance             25%  Actual Store Visits / Target
                                           Store Visits x 100%
  Staff Proficiency / Cross-Training 25%  Staff Certified / Staff
                                           Scheduled for Certification x 100%
  Training Program Delivery          20%  Programs Delivered / Programs
                                           Required x 100%
  Coaching & Feedback                20%  Average Survey Score / Maximum
                                           Possible Score x 100%

/index.html
  The landing page — NOT a dashboard itself. Five nav cards, one per
  KRA above (name, weight, formula, target), each linking to that KRA's
  monitoring page under /pages. Also shows an illustrative total KRA
  score (weighted sum across all five) built from the numbers below.

/pages/coaching-feedback.html
  The Coaching & Feedback KRA page. This is the Facilitator KPI
  Scorecard — ported verbatim (same layout the survey team supplied,
  Jul-Sep 2026 data) from a Claude Cowork session ("Facilitator KPI
  reports") that built it as a live Google Drive-backed scorecard with
  CSV export. It scores facilitators against the 15-criteria, 5-point
  Store Visit Evaluation Survey (5 Excellent .. 1 Poor) — the same
  survey that feeds SVMI_Project's KPI/risk system, but rolled up per
  facilitator instead of per store.

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

  Dashboard features: ranked scorecard table (sortable, rating-band
  pills, low-sample-size flags), evaluations-received and
  average-rating charts, a monthly activity heatmap, per-facilitator
  drill-down profiles, a "responses to review" table for averages
  below 3.00, month/brand filters, and CSV export.

  Department average for Jul-Sep 2026 was 4.80/5 (96.00%), which is
  what /index.html uses for the Coaching & Feedback slice of the
  illustrative total — swap in one facilitator's own row from the
  scorecard for their individual KRA score instead.

/pages/store-visit-compliance.html, /pages/staff-proficiency.html
  Executive-summary-only pages (KPI cards + formula/target), by
  design not linked to the underlying raw logs. Both are tracked in
  SVMI_Project's existing "[sys] STORE VISIT 2026" system, in the
  KPI Data sheet (Pilot) Drive folder — open that directly if you need
  the visit-by-visit or certification-by-certification records.

/pages/training-program-delivery.html, /pages/attendance.html
  Executive-summary pages that also link out to their underlying log
  sheets in the same Drive folder: "Training Program & Delivery
  Monitoring 2026" (session log: Session ID, date, program/module,
  training type, brand, store, facilitator(s), pax, duration, status,
  post-test average) and "TDD Team Attendance Monitoring 2026"
  (per-facilitator daily attendance/status/leave log) respectively.
  Both sheets already existed in the Drive folder when this was built
  (created via the linked Cowork session), so these pages link to them
  rather than creating duplicates.

/Facilitator_KPI_Scorecard_Demo.html
  The earlier (Jul-Aug) snapshot of the scorecard, kept for reference —
  it additionally declares a live "Refresh from Drive" capability that
  pages/coaching-feedback.html's static Jul-Sep export does not.

Google Drive
-------------
All five KRAs' underlying logs live in the "KPI Data sheet (Pilot)"
folder: https://drive.google.com/drive/folders/1YBnR_TIvEhNh4uDXyqyTy0RKejOFQbSq
  - Figaro Culinary Group - Store Visit Evaluation Survey Form (RESPONSE)
  - [sys] STORE VISIT 2026 (store visit + staff certification log)
  - Trainee Deployment Satisfaction Survey
  - Training Program & Delivery Monitoring 2026
  - Training Attendance Monitoring 2026 (trainee attendance at sessions)
  - TDD Team Attendance Monitoring 2026 (facilitator's own attendance —
    this is the one the Attendance KRA page links to)

Status / next steps
--------------------
This is a static, repo-tracked snapshot of the KRA scorecard system —
no build step, no Apps Script backend yet, no tests. If this needs to
run live against the Drive folder above the way SVMI_Project runs
against its Sheet (the "STORE VISIT KPI" menu / web app flow described
in SVMI_Project/README.txt and DEPLOY.md), the next piece of work is
an Apps Script (or Sheets-API) backend that reads all five sources and
recomputes the KRA numbers on /index.html and each /pages/*.html
automatically, plus a SVMI_Project/tests-style test suite — sharing the
survey-parsing/name-matching logic with SVMI_Project's existing
SVMKPI_* scripts rather than duplicating it.
