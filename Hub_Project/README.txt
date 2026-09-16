TRAINING & DEVELOPMENT HUB — PROJECT FILES
============================================

What this is: a small, standalone Google Apps Script Web App that acts
as the front door for Figaro Coffee Group Training & Development's
tools. It is NOT bound to any Spreadsheet — it holds no store data,
trainee data, or visit data of its own. It only gates entry with a
password, then shows a landing page with two cards linking out to
each sub-system's own, separately deployed Web App:

  - SVMI Command Center (../SVMI_Project) — store visit monitoring
  - TL Tracker           (../TLM_Project)  — team leader monitoring

Each sub-system keeps its own access control on top of this Hub's
gate (SVMI's guest password + admin list, TL Tracker's PIN) — this
Hub's password only controls whether a visitor sees the two links at
all, not what either sub-system lets them do once they click through.

/Apps Script/
  Code.gs           doGet()/doPost() entry points, the password gate,
                     and the setupHub_* functions used to configure it.
  HUB_LOGIN.html     Password form, shown until the Hub password
                     matches (or none is set up yet).
  HUB_LANDING.html   The landing page itself: "Signed in as …" +
                     "Sign out" in the top bar, then two cards (SVMI /
                     TL Tracker) each linking to that sub-system's
                     deployed URL.
  appsscript.json    Project manifest (timezone + web app access
                     settings — same executeAs/access pattern as SVMI).
  .clasp.json.example
                     Rename to .clasp.json and fill in a real Script
                     ID once one exists — see DEPLOY.md.

To use it for real, see DEPLOY.md for the full walkthrough:
create a new (non-Sheet-bound) Apps Script project, paste in the
three files above, deploy as a Web App, then run the two setupHub_*
functions once from the Apps Script editor to set the Hub password
and point the two cards at SVMI's and TL Tracker's own deployed URLs.
