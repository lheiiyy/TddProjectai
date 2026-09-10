# TL Tracker — install guide

One form, usable two ways: from the desktop Sheets menu (a popup dialog), and as a plain phone-browser link with a PIN screen, so trainers don't need the Sheets app at all. Inside, four switchable modes: **🆕 New Entry**, **✅ Certify**, **👕 Uniform**, and **📦 Stock**. Built fresh for what the spreadsheet needs, and fixes the 5 issues from the original review: fragile fixed-column writes, deadlines corrupted into percentages, name-only duplicate detection, failing grades getting lost, and inconsistent store-name spelling.

**Do this on the `[cowork] Team Leader Monitoring` copy first**, not the live sheet — try it out, then move it over once you're happy.

## 1. Open the script editor
In the spreadsheet: **Extensions → Apps Script**.

## 2. Add the code
- If there's already a `Code.gs`, delete its contents and paste in this project's `Code.gs`.
- Click the **+** next to Files → **HTML** → name it exactly `TLForm` → paste in `TLForm.html`'s contents.
- Save (Ctrl/Cmd+S or the disk icon).

## 3. Set up the sheets
Back in the spreadsheet, reload the page. A **🍕 TL Tracker** menu appears (first load may take a few seconds, and Google will ask you to authorize the script — approve it, it only touches this spreadsheet).

Run **🍕 TL Tracker → Set Up Sheets (first-time only)**. This creates three tabs:

**MASTER_LOG** — one row per trainee:
```
Timestamp | Date of Entry | Batch # | Mother Store | Full Name | Mother Station |
Support Store | Status | Uniform Release | Entry By | ISTV Grade | TechVal FP |
TechVal PM | TL-Entry Food Prep Exam | TL-Entry Pizza Maker Exam | TL Entry Average |
Certification Deadline | Cert By | Date Certified | Certification Grade | Exam Grade |
Average | Final Status
```

**UNIFORM_LOG** — one row per piece of uniform handed out (stock going *out* to trainees):
```
Timestamp | TL Key | Full Name | Mother Store | Size | Quantity | DR # | Given By | Notes
```
(`TL Key` is bookkeeping the script uses to match a release back to the right MASTER_LOG row — the sheet hides that column automatically.)

**UNIFORM_INVENTORY** — one row per delivery received from the supplier (stock coming *in*):
```
Timestamp | Size | Qty Received | Delivery Ref | Logged By
```
This is what lets the **📦 Stock** tab and the Summary tab compute stock on hand (Delivered minus Issued) instead of it being guessed.

If you already have MASTER_LOG data to migrate in, copy it under those headers — order doesn't matter, the script looks columns up by name.

## 4. Set the access PIN
Run **🍕 TL Tracker → Set / Change Access PIN**, enter a 4+ character PIN. This is what actually gates the phone link — anyone with the URL reaches the PIN screen, but only the PIN gets them into the form. Change it any time by running this again.

## 5. Deploy as a phone-friendly web app
In the Apps Script editor: **Deploy → New deployment**.
- Type: **Web app**
- Execute as: **Me**
- Who has access: **Anyone**
- Click **Deploy**, authorize if asked, then copy the web app URL it gives you.

You can always find that URL again from **🍕 TL Tracker → Show Phone App Link**.

On a phone: open that URL in the browser, enter the PIN, and use the browser's **"Add to Home Screen"** option so it sits on the home screen like a normal app icon.

**Whenever you edit `Code.gs` or `TLForm.html`,** go back to **Deploy → Manage deployments → pencil icon → New version → Deploy**. Editing the files alone does not update the live phone link — only a new version does.

## 6. Use it

- **🆕 New Entry** — saves a new row as PROBATIONARY, deadline set automatically to entry date + 3 months. Grading is grouped the way it's actually assessed:
  - **Technical Validation** — Food Prep %, Pizza Maker %
  - **Exam Grade** — Pizza Maker %, Food Prep %
  - **Store Grade** — one overall score from the store (this is the old sheet's "ISTV Grade," relabeled)

  A running average updates live from the four Technical Validation + Exam Grade fields as you type (Store Grade is tracked separately, not folded into that average — matching how the original sheet kept it apart). There's also an optional **Initial Uniform Size + Qty + DR #** right in this form for whatever gets issued on day one; leave it blank if nothing's being handed out yet. Store, station, batch, and trainer-name fields autocomplete from what's already in the sheet. Blocks re-adding someone who already has an open record at the same store with the same entry date.

- **✅ Certify** — pick a trainee from a dropdown of everyone currently PROBATIONARY or EXTENDED. Selecting one shows a card with their current status and deadline before you touch anything. Set the new status; "Cert By" is required for any final outcome so every closed record says who closed it. Choosing EXTENDED reveals an optional exact-date override — leave it blank and the deadline pushes 2 months automatically. FAILED, QUIT, and DISQUALIFIED still save whatever grade was entered.

- **👕 Uniform** — the dedicated place to log uniform releases, separate from certification status. Pick *any* trainee — probationary, extended, certified, whoever — pick a size, quantity, optional DR #, and who gave it out. Selecting a trainee shows their full uniform history first, so whoever's handing out the next piece can see what this person already has. Every release gets its own row in UNIFORM_LOG (queryable by size, by DR #, by person) and also rolls a short summary into MASTER_LOG's "Uniform Release" cell so a glance at the main log still shows the latest.

- **📦 Stock** — logs deliveries received from the supplier (size, quantity, an optional delivery reference, and who logged it) into UNIFORM_INVENTORY, and shows a live Delivered / Issued / On Hand table underneath so anyone about to hand out a piece can see what's actually left before promising it.

Other menu items (desktop only):
- **Refresh Store Summary** — recomputes active-TL-per-store, status totals, uniform pieces given out by size, stock on hand by size, *and* a DR #-by-store lookup table, all from the actual data on a "Summary" tab — instead of a manual formula that can throw `#ERROR!`.
- **Show Phone App Link** — re-displays the deployed URL.
- **Set / Change Access PIN** — update the PIN anytime; existing phones stay unlocked until someone taps "🔒 Lock" or clears their browser data.

## What's new in this version
- **Dedicated uniform tracking.** Its own UNIFORM_LOG tab (one row per piece, with size/qty/DR#/who), its own tab in the form, a per-trainee history so you can see what's already been given before handing out more, and a size-by-size total on the Summary tab — instead of one free-text cell getting overwritten every time.
- **Stock on hand.** A new UNIFORM_INVENTORY tab plus a **📦 Stock** tab in the form for logging supplier deliveries; the Summary tab now shows Delivered / Issued / On Hand per size, computed instead of hand-tallied.
- **DR # by store.** The Summary tab now lists every DR # logged against each store, pulled straight from UNIFORM_LOG's own DR # field — replaces the old sheet's manually-maintained DR#-by-store table.
- **Grading fields relabeled and regrouped** to match how it's actually assessed: Technical Validation (Food Prep, Pizza Maker), Exam Grade (Pizza Maker, Food Prep), and Store Grade, as three clear sections instead of five flat fields.
- Everything from the previous version is unchanged underneath: phone access via the PIN-gated web app link, concurrency-safe writes, mobile-tuned layout, autocomplete fields, live average preview, the trainee summary card, and the deadline-override option.

## Notes
- Grades are entered as plain numbers (e.g. `93`), stored as the percentage format Sheets expects.
- Store names are auto-normalized (trimmed, single-spaced, upper-cased) on save.
- If you later add a column to either sheet, nothing breaks — the script finds columns by header text, not position.
- "Anyone" access means anyone with the link can reach the PIN screen (not the data) — if that's ever a concern, Google Workspace accounts (not personal Gmail) can restrict "Who has access" to your organization instead, removing the need for a PIN altogether. Ask if you want that path explored.
