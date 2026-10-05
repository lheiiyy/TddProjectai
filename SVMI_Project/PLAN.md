# SVMI — Fix & Improve Plan

Last updated: 2026-10-05 · Working branch: `svmi/phase-d3-insights` (PR #22)

**🚀 LIVE = version 23 (2026-10-04)** — same Web App URL. v23 = D.2 Unvisited/NAC by Store ID; reports switched to
the visit tables. v24 (D.3 Store Insights) is built in PR #22, not yet deployed (no `-pre-v24` backup in the repo).
Rollback sources: `live-backup-20261004-pre-v23/` (= v22) and older `live-backup-*` folders.
**Next: the 🐞 Bug & fix plan below (2026-10-05), then D.4.**
Rule for now: **functionality first.** Security is parked (except admin access).
Live backups (`live-backup-*`) are the safe fallback — never edited.

## Important: source of truth

`main`'s `Apps Script/` was **older than live**. This branch rebuilt
`Apps Script/` from `live-backup-20260930-pre-secfix/` (latest live backup,
incl. identity/MFA, MASTER_LOG Executive Summary, nav-perf fix) and applied
the changes below on top. `.clasp.json` now targets the **test copy**
(`1UU582…`) — it previously pointed at the **live** script (`1QHH…`).

D-039 (CONFIG_AUDIT writer made private), deployed to live after that
backup from `claude/svmi-reports-source-of-truth`, is now ported in too.
Code compared against that branch: the only differences are this plan's
changes (#5, #6, #7, #9) plus `appsscript.json`.

**Manifest:** keep live's. Before pushing, copy `appsscript.json` from a fresh
`clasp pull` of live over ours (records disagree on which setting live has).

## 🔴 Fix

| # | Item | Status |
|---|------|--------|
| 1 | Compliance rule not switching after store category change | ✅ Test bug (UTC "today" + expired dates); app logic correct |
| 2 | Visitor config rollback crash | ✅ Same stale-date test bug |
| 3 | Wrong effective date in audit / migration | ✅ Test compared in UTC; data correct |
| 4 | "Visits This Month" table empty | ✅ Demo data had no visits early in month; test updated for live `{resolved, unmapped}` shape |
| 5 | Admin access | ✅ Code: added admin guard to `rebuildMasterLogHeaders`, `rebuildSettingsHeaders`, `regenerateReportSheet`. ⏳ **Verify on test copy** (see below) |

## 🟡 Improve

| # | Item | Status |
|---|------|--------|
| 6 | Reports Executive Summary from MASTER_LOG | ✅ Already on live (D-036/D-037). Added test (31 checks). Fixed leaderboard double-count when a name repeats in one row (`ANN\|ANN`) |
| 7 | Measure load speed on real data | 🟡 Timing logs added to 8 server functions — read `[SVMI PERF]` lines in Apps Script → Executions |
| 8 | Deployment setting mismatch | ✅ Docs now match live (`USER_DEPLOYING` + `ANYONE_ANONYMOUS`); manifest unchanged |
| 9 | Escaping in portal | ✅ Load-error message escaped; visitor colors sanitized |
| 10 | Project status doc | ✅ This file |

## 🔵 Round 2 (from live check, 2026-10-03) — deployed in v13

| # | Item | Status |
|---|------|--------|
| 11 | Visited By: type + Enter does nothing (phones) | ✅ `keyup` fallback for Android keyboards that send Enter as keyCode 229; Enter also works if the list was closed. Applied to Store, Visitor, Purpose, Store Insights search |
| 12 | Executive Summary slow (`[SVMI PERF] 5108 ms`) | ✅ MASTER_LOG read 3× → 1×; purpose check read PURPOSES+KPI+RISK config per purpose → 1 PURPOSES read. Same results. Re-measure after deploy |

## 🐞 Bug & fix plan (from Leo's live check, 2026-10-05)

Leo's report: Store Insights / Unvisited / other reports are slow (did the table switch cause it?); reports can't go
back to past years; no way to edit/delete a wrong visit record; Unvisited tier pills can't be combined; Input Portal
date picker doesn't open (typing only) and Enter on the date jumps past Visited By; Admin → Configuration "add new
store" sits on "Saving…"; existing records need an admin-only ✏️ edit option.

Order = smallest/safest first, one deploy per batch, same deploy routine (tests → `-pre-vNN` backup → live → Leo checks → PR → Leo merges).
D.4/D.5 wait until F1–F3 are done (functionality first).

### F0 — Measure before fixing speed (no deploy needed)

Every slow report is already timed: Apps Script → **Executions** shows `[SVMI PERF] sl_getStoreData`,
`sl_getComplianceGaps`, `sl_getVisitedThisMonth`, `sl_getStoreList`, `getStoreHealthReport` … in ms.
Leo: open each slow screen twice, note the ms; then System Tools → Report Source → **↩ Use MASTER_LOG**, repeat, and switch
back (**▶ Use visit tables**). That A/B answers "did the database change cause it" with numbers, not guesses.

What the code already shows:
- Live (v23) Store Insights still reads MASTER_LOG — it is slow for the old reasons: one lookup reads all of MASTER_LOG,
  SETTINGS and the compliance/risk config and scores **every** store's health just to show one.
- With the tables switch on, Visited / Unvisited read STORE_VISITS + STORE_VISIT_VISITORS + CONFIG_STORES (twice for
  Unvisited) **and still** MASTER_LOG's date column (`getDefaultReportingYear()`, because the page sends no year).
  So the switch added reads instead of replacing them. D.3 (v24) adds the same for Store Insights.
- Nothing is cached between calls: every tab open / filter change re-reads every sheet.

### F1 — Input Portal + Unvisited filter (small, low risk) → v25

| # | Bug | Cause found in code | Fix |
|---|-----|--------------------|-----|
| F1.1 | 📅 date picker doesn't open; typing only | `openDatePicker()` calls `showPicker()` on a hidden date input. Browsers refuse `showPicker()` for date inputs inside a cross-origin iframe — which is how every Apps Script web app runs — and the fallback `click()` on a hidden, `pointer-events:none` input does nothing | Put the real (transparent) date input **over the 📅 button** so the user's own tap opens the native calendar — no `showPicker()` needed. Typing MM/DD/YYYY stays as is |
| F1.2 | Enter on Date Visited skips Visited By, lands on Purpose | Enter's keydown on the date field moves focus to Visited By; the **same** Enter's keyup then fires on Visited By (the Android Enter fallback `comboKeyUp`), sees an empty box and advances again | The date field marks that Enter as handled (`_comboEnterAt`), and the keyup fallback only acts on an Enter whose keydown happened in that same field. Also: Enter on an empty Visited By with **no** visitor chosen stays put |
| F1.3 | Unvisited: can't combine Monthly + Quarterly / Monthly + Semi | Pills are single-select (`setFilter`), although the Required column filter underneath already supports several values | Pills become on/off toggles feeding that same filter: Monthly+Quarterly, Monthly+Semi, any mix; "All Stores" clears. KPI cards and count follow the selection |

Tests: portal tests for the date proxy placement, the Enter sequence (keydown on date → keyup on Visited By must not
advance), and multi-select pills.

### F2 — Admin → Configuration: "add new store" stuck on Saving → v25 (same batch if it's small)

Cause found in code: one store save = write CONFIG_STORES → mirror to SETTINGS → **full Store Health rebuild**
(`refreshRiskEngine()`, a whole MASTER_LOG scan + rewrite of the Store Health sheet) inside the same call. The button
waits for all of it; on live data this can take minutes or hit Apps Script's 6-minute limit.
First check (Leo, 2 min): Executions → the `store_create` run — finished, failed, or timed out? And CONFIG_STORES —
was the store added anyway (then it must not be added a second time)?

Fix:
- Save returns as soon as CONFIG_STORES + SETTINGS are written; Store Health is marked "needs refresh" and rebuilt
  once later (time trigger a minute later, or the next Store Health open), not inside the save.
- Button shows a clear result: saved / failed with the reason / "still working — check the list before retrying".
- Guard against a double add of the same name + brand on retry.
- Same treatment for Visitors and Purposes saves (they share the mirror-then-rebuild pattern).

### F3 — Speed → v26

After F0's numbers:
1. Reports switched to tables stop reading MASTER_LOG: the reporting year comes from the visit tables (or the page
   sends it — see F4), CONFIG_STORES is read once per call.
2. Short cache (CacheService, a few minutes) of the loaded visits + store lookup, cleared on every submission,
   edit/delete (F5), Rebuild Visit Tables and store config change. Repeat opens / filter changes become near-instant.
3. Store Insights: health for **one** store from the tables instead of scoring every store from MASTER_LOG — this is
   D.4's first piece, pulled forward.
4. Page side: the store list for Store Insights is loaded once per session, not per tab open.
Target: each report under ~3 s on live data; record before/after ms in `TESTING_LOG.md`.

### F4 — Past years in reports → v27

Today: only Executive Summary has a Year dropdown. Visited This Month and Unvisited send only a month (the year is
"latest year with data"), Store Insights is all-time, Store Health and KPI 2026 take no year.
Side bug: in January of a new year with no visits yet, "Current Month" resolves to **January of last year**.
Fix:
- One Year dropdown (years that have visits, from STORE_VISITS) next to the Month dropdown, used by Visited This
  Month, Unvisited and Store Insights (Store Insights: "All years" default + one year).
- Store Health gets a Year (as of the end of that year for past years).
- KPI 2026: a year dropdown too, or keep it 2026-only — Leo's decision (below).
- "Current Month" always means the real current month and year.

### F5 — Edit / delete visit records, admin only → v28

Leo (2026-10-05): existing records must be editable; ✏️ edit icon beside each record; **admin only**.
Design (MASTER_LOG stays the audit trail):
- ✏️ beside each visit in Store Insights' visit list (full list for the store, filterable by year — not only the last
  few) and in a **Visit Records** list (filter by store / date / visitor) for admins; hidden from non-admins, and every
  server function re-checks admin (`sl_isAdmin()`), not just the page.
- Edit: date, store (Store ID picker), visitors, purpose, remarks. Saves to the MASTER_LOG row, writes the old and
  new values + who + when + reason to a new **VISIT_CORRECTIONS** sheet, and replaces that visit in STORE_VISITS /
  STORE_VISIT_VISITORS (its Visit ID changes because IDs come from the row's content — handled in the same step).
- Delete = **void**, not row removal: the visit drops out of every report, the row stays in MASTER_LOG and is listed in
  VISIT_CORRECTIONS with the reason; an admin can restore it. (Removing MASTER_LOG rows shifts row numbers — that is
  why the hand-deleted test row showed up in Check Visit Tables.)
- Duplicate check runs again on edit (same store + date + visitor).
- Rebuild Visit Tables must re-apply voids (so a rebuild can't bring a voided visit back); Check Visit Tables reports
  voided visits separately.
- Admin → Configuration's existing store/visitor/purpose records already edit by adding a new version; after F2 they
  get the same ✏️ next to each row so editing doesn't start from the "new" form.

### Decisions needed from Leo

| # | Question | Recommendation |
|---|----------|----------------|
| L1 | Delete: void (hidden from reports, restorable) or permanent? | Void |
| L2 | Reason required on every edit/void? | Yes, one line |
| L3 | KPI 2026: add a year dropdown, or keep it fixed to 2026? | Year dropdown |
| L4 | Store Health refresh after an admin save: background (a minute later) or on next Store Health open? | Background |
| L5 | Order: F1+F2 → F3 → F4 → F5, then D.4/D.5 | As listed |

## 🧱 Phase C — visit tables in Google Sheets (live in v14)

Decision 2026-10-03: stay in Google Sheets, but with proper tables; MASTER_LOG becomes the audit trail.
Design: [`PHASE_C_TABLES.md`](PHASE_C_TABLES.md) (mirrors `database/migrations/008_store_visits.sql`).

| Step | Status |
|---|---|
| `STORE_VISITS` + `STORE_VISIT_VISITORS`, stable content-derived Visit IDs | ✅ built (`SVMKPI_TABLES.gs`) |
| System Tools → Rebuild Visit Tables / Check Visit Tables | ✅ built |
| Input Portal dual-write (never blocks a submission) | ✅ built (one line in `INPUT_PORTAL.gs`) |
| Tests | ✅ `tests/visit-tables.test.js` (48 checks) |
| Deploy, run Rebuild once, then Check | ✅ v14, 2026-10-03: **In sync — 1,136 visits, 1,248 visitor links**; rebuild took ~18 s |
| C.1 Data cleanup before Phase D | ✅ 2026-10-04 (v15–v18): every visit has a Store ID; closed stores created; Figaro Sta. Maria merged; 16+ stores given the same name as the other brand's store (Leo: "naka set na tamang store names") |
| Phase D: reports read the tables instead of MASTER_LOG | 🟡 D.1 Visited This Month + D.2 Unvisited/NAC live (v23, switched to visit tables 2026-10-04); D.3 Store Insights built (v24); next D.4 Store Health |
| Phase E: MASTER_LOG audit-trail only | ⏳ later |

### C.1 — status 2026-10-04

- Re-running *Migrate Legacy SETTINGS Data* (2026-10-03) took visits with no Store ID from **230 → 22**
  and cleared the unknown-visitor note.
- The 22 visits are 11 names: SHANGRILA (10), VERSAILLES (2), GLORIETTA (2), VICTORY MALL PASAY, VLI CUBAO,
  VLI PASAY, URDANETA FIGARO, MANULIFE 1, MANULIFE 2, STA. MARIA, and SM SAN PEDRO (Leo reconciled it
  to SAN PEDRO by hand).
- Leo: the leftover names are **closed stores** → *New store — closed*. URDANETA FIGARO is its own Figaro
  store (URDANETA is the Angel's Pizza one).
- Leo: Figaro **SANTA MARIA** and **STA MARIA** are **one store** → *Merge*, one name plain **STA. MARIA**
  (no "(F)" — the Brand column filters). Angel's Pizza STA. MARIA stays a separate store with the same name.
- **Same name across brands (decision 2026-10-04, Leo: option B):** the Input Portal now submits the picked
  **Store ID**; the duplicate check, MASTER_LOG column I and the resolver use it. Reports/SETTINGS mirror treat a
  name as the key unless two brands share it, then NAME+BRAND (`svmiStoreKey_`, SVMKPI_CORE.gs). Store Name
  Matching only refuses a name already used by a store of the SAME brand. Branch `svmi/store-id-identity`
  (on top of `svmi/store-name-matching`). **Live as v16 (2026-10-04)**; v15 = Store Name Matching alone.
- Leo: several stores were given a slightly different spelling only to avoid the clash (e.g. "STA. MARIA (F)").
  Store Name Matching **section 4 — Same name as another brand's store** lists each one with the other brand's
  spelling (pre-ticked when they differ only by "(F)"/FIGARO/punctuation) and renames the store + its past
  MASTER_LOG rows (brand and Store ID unchanged). A store already changed today can be renamed tomorrow
  (one config version per day). Branch `svmi/same-name-rename` → v17.
- Leo: must scale — one name can belong to 3+ brands. Tested: portal, SETTINGS mirror, Visited/Unvisited/NAC,
  Store Health, Store Insights, visit tables and section 4 with SM NORTH × Angel's Pizza / Figaro / Tien Ma's.
  Brand tags ("(F)", "TM", "AP", …) are one table, `SMT_BRAND_TAGS` (SVMKPI_STORE_MATCH.gs).
  Still not scalable without code: the brand list itself (`APPROVED_BRANDS`); two stores of the SAME brand can't
  share a name (by design).
- Tool: **Admin → Tools → Store Name Matching** (v15, `SVMKPI_STORE_MATCH.gs`, design in
  [`PHASE_C_TABLES.md`](PHASE_C_TABLES.md#c1--store-name-matching-admin--tools)). Find → check each choice →
  Preview → Apply. Run it when nobody is submitting visits. Afterwards Check Visit Tables should show 0 visits
  with no Store ID.
- Also worth fixing with the tool's section 3: the typo **SAN MIGUEL (F))** → SAN MIGUEL (F).

### C.1 — data notes from the first Check (2026-10-03, kept for history)

- **230 visits with no Store ID.** Names shown are almost all S–W (Shangrila, Tien Mas Makati/Retiro, Timog,
  Trinoma, UN Ave Shell, V Mapa, Valenzuela, Veloce, WM North EDSA). Live has **no `CONFIG_UNMAPPED_STORES` tab**,
  which the SETTINGS → Configuration migration only creates when it finishes — so the original migration most
  likely stopped partway through the store list (the code notes it used to time out; fixed by D-034/D-035).
  Phase D takes brand/region from CONFIG_STORES via Store ID, so these must be mapped first.
  **Fix:** Admin → Tools → *Migrate Legacy SETTINGS Data* (existing, additive, skips what exists) →
  *Rebuild Visit Tables* → *Check Visit Tables*. Whatever is still unmapped after that is a real typo or a
  store missing from SETTINGS, and will be listed in `CONFIG_UNMAPPED_STORES`.
- **Visitors not in CONFIG_VISITORS:** CHEF ARVIN, CHA, LEOREYY. The same migration adds names from the
  SETTINGS!F roster; any left over need Leo's call (real person → add in Admin → Configuration → Visitors;
  typo → decide how to map).
- Live has no `CONFIG_COMPLIANCE`, `CONFIG_RISK` or `CONFIG_KPI` tabs, so NAC cadence, Store Health thresholds
  and KPI targets run on the built-in defaults. Fine for now; set them in Admin → Configuration when the rules change.

Also confirmed 2026-10-03: the PostgreSQL design in `database/` still runs end-to-end on PostgreSQL 16
(12 migrations, fixture import, 29/29 validation, 158/158 dry-run checks). Setup note: `pgcrypto` must be
enabled by a superuser before migrations, and the importer must run as `svmi_migrator`.

## ⚙️ Configuration checklist (what must be set up)

| Where | What | Needed for |
|---|---|---|
| SETTINGS!G2:G | Admin emails (one per row) — **must include the deployer's account** | System Tools, config editing |
| SETTINGS!I2 | Guest password (blank = no password) | Portal lock screen |
| CONFIG_STORES | Every store: name, brand, region, category, status | Input Portal list, compliance, risk |
| CONFIG_VISITORS | Every visitor name | Visited By list, leaderboard |
| CONFIG_PURPOSES | Purposes beyond the 4 built-in ones (+ optional risk weight) | Purpose list, reports |
| CONFIG_COMPLIANCE | One rule per store category (NCR, NEAR / FAR / FLIGHT PROVINCIAL): cadence + required visits | Unvisited / NAC |
| CONFIG_RISK | Low / Medium / High thresholds | Store Health tiers |
| CONFIG_KPI | KPI targets per purpose / visitor | KPI report |

Known gaps (not configurable yet):
- **Brands and regions are hard-coded** (`APPROVED_BRANDS` / `APPROVED_REGIONS` in SVMKPI_CORE.gs). A 6th brand
  needs a code change, otherwise its visits are left out of the brand sections of reports.
- Store category list is also hard-coded (`APPROVED_CATEGORIES`).
- `DATA_YEAR = 2026` in SVMKPI_CORE.gs is unused (dead code) — safe, can be removed later.

## ⏸️ Parked — security (after everything works)

- Server-side password check on every data function
- Guest password stored in browser localStorage
- Turn MFA enforcement on (`IDENTITY_MFA_ENFORCED`)
- Deployment setting itself (`USER_DEPLOYING` + anonymous) — see #5 check

## Live checklist (after v12 deploy)

1. Reports → Executive Summary loads; numbers look right for 2026
2. Unvisited / NAC, Store Insights, Visits This Month load
3. Executions → note `[SVMI PERF] … ms` for each screen (#7)
4. **#5:** open as a SETTINGS!G admin who is *not* the deployer — do System
   Tools work? With `USER_DEPLOYING`, likely only the deployer is seen as admin.
5. Submit one test visit through Input Portal

## Tests

33 files, 1,853 checks, all passing (`node tests/<file>.test.js`).
`store-name-matching-ui.test.js` clicks through the real `SVMI_PORTAL.html` with the real `.gs` code
behind it (Playwright); the other portal tests use the demo page.
