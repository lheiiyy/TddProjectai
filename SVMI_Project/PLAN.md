# SVMI — Fix & Improve Plan

Last updated: 2026-10-05 · Working branch: `svmi/phase-d3-insights` (PR #22)

**🚀 LIVE = version 23 (2026-10-04)** — same Web App URL. v23 = D.2 Unvisited/NAC by Store ID; reports switched to
the visit tables. v24 (D.3 Store Insights, PR #22): deploy started 2026-10-05 — `live-backup-20261004-pre-v24/` committed; Leo to confirm it's live.
Rollback sources: `live-backup-20261004-pre-v23/` (= v22) and older `live-backup-*` folders.
**v25 built (2026-10-06, branch `svmi/v25-fixes`): F1 + F2 of the 🐞 plan below — deploy next. Then F3+F4, F5…, then D.4.**
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
store" sits on loading/"Saving…"; existing records need an admin-only ✏️ edit option; review **all** Admin areas
(Configuration, Tools, Audit) for issues; add a **weekly history (Monday–Sunday)** to the Input Portal.

Order = biggest breakage first, one deploy per batch, same routine (tests → `-pre-vNN` backup → live → Leo checks →
PR → Leo merges). D.4/D.5 wait until these are done (functionality first).
C = confirmed by reading the code · S = suspected, confirm on live.

### Root cause shared by many admin screens

Apps Script cannot send a `Date` back to the page: if a server result contains one, the page receives **nothing**
(`null`). Several admin functions return raw dates from the sheets, so their screens spin forever, show "nothing
found", or report failure after a success. Fix once: every server result that goes to the page carries dates as text
(`yyyy-MM-dd` / `yyyy-MM-dd HH:mm`, Asia/Manila), plus a test that scans every page-facing result for Date objects.

### F0 — Measure before fixing speed (Leo, no deploy)

- Apps Script → **Executions** shows `[SVMI PERF] sl_getStoreData`, `sl_getComplianceGaps`, `sl_getVisitedThisMonth`,
  `sl_getStoreList`, `getStoreHealthReport` … in ms. Open each slow screen twice and note the ms; then System Tools →
  Report Source → **↩ Use MASTER_LOG**, repeat, then switch back (**▶ Use visit tables**). That answers "did the
  database change cause it" with numbers.
- Executions → the `store_create` run from the stuck add-store: finished / failed / timed out? CONFIG_STORES: was the
  store added anyway? (Then don't add it again — a retry creates a second Store ID.)
- MASTER_LOG_FIXES: any row with RowNum 2–13? (see F2.4 — the leaderboard)

**F0 result (Leo, live v24, 2026-10-05 12:32) — the visit tables are FASTER, not the cause:**

| Report | Visit tables | MASTER_LOG |
|---|---|---|
| Visited This Month (`sl_getVisitedThisMonth`) | 3.4 s | 7.0 s |
| Unvisited / NAC (`sl_getComplianceGaps`) | 4.9 s | 8.6 s |
| Store Health / KPI 2026 / Executive Summary | 1.9 / 4.3 / 4.3 s | 1.7 / 4.5 / 5.3 s (not switch-dependent) |

Even trivial calls take ~1.5–3 s (`sl_isAdmin` 2.2 s, `getAvailableReportingYears` 3.2 s, `admin_getAreaSchema` 1.6 s),
and the page fires several at once — that per-call overhead is a big share of the wait. F6 adds fewer round-trips.
Store Insights (`sl_getStoreData`) not measured yet. Switch was left on MASTER_LOG after the test — set it back to tables.
The stuck "add new store" **did save** (Leo, 2026-10-05) — the save worked, the screen after it didn't (F2.1).

### F1 — Input Portal + Unvisited filter → v25

| # | Bug | Cause (C) | Fix |
|---|-----|-----------|-----|
| F1.1 | 📅 date picker doesn't open; typing only | `openDatePicker()` calls `showPicker()`; browsers refuse it for date inputs inside a cross-origin iframe (every Apps Script web app); the fallback `click()` on a hidden `pointer-events:none` input does nothing | Real (transparent) date input placed **over the 📅 button**, so the user's own tap opens the calendar. Typing stays |
| F1.2 | Enter on Date Visited skips Visited By → Purpose | The date field's Enter keydown moves focus to Visited By; the **same** Enter's keyup then fires there (`comboKeyUp`, the Android fallback), sees an empty box, advances again | Keyup fallback only acts on an Enter whose keydown happened in the same field; Enter on an empty Visited By with no visitor chosen stays put |
| F1.3 | Unvisited: can't combine Monthly+Quarterly / Monthly+Semi | Pills are single-select, though the Required column filter already takes several values | Pills become on/off toggles on that same filter; "All Stores" clears; KPI cards/count follow |

### F2 — Admin → Configuration → v25 (with F1)

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| F2.1 | High (C) | **Store list, store detail/history and the refresh after a save return Dates** (`admin_listAllStores`, `admin_getConfigEntityDetail`, `admin_getRiskDetail`) → page gets null → spinner forever. Most likely why "add new store" looks stuck | Dates as text (root cause above); `if (!r)` guards with a real message |
| F2.2 | High (C) | Every store/visitor save, activate/deactivate and rollback runs a **full Store Health rebuild inside the save**; that rebuild re-reads CONFIG_PURPOSES + CONFIG_RISK ~9× **per store** (thousands of reads) → minutes / 6-min timeout | Save returns after CONFIG + SETTINGS are written; Store Health refreshed once afterwards (L4); risk weights/thresholds read once per rebuild |
| F2.3 | High (C) | A timed-out save is half-done (store written, Store Health sheet already cleared); **retry creates a duplicate store** — no name+brand check on create; both share one SETTINGS row | Reject a duplicate name+brand among current stores; build Store Health rows before clearing the sheet |
| F2.4 | High (C) | **Store Name Matching can overwrite Leo's leaderboard in MASTER_LOG I2:I13** — rows 2–13 have names (not Store IDs) in column I, so any map/merge/rename touching those visits writes a Store ID there. Old values are in MASTER_LOG_FIXES, so recoverable | Never write column I for rows 2–13 (those visits keep their Store ID in the tables only); restore from MASTER_LOG_FIXES if F0 finds hits |
| F2.5 | Med (C) | Editing a store jumps to a blank "Create New Store" form (looks lost → invites a duplicate) | Stay on the edited store |
| F2.6 | Med (C) | Editing an **inactive** store silently reactivates it (Status field starts blank = ACTIVE) | Edit form pre-filled from the current version; server keeps fields not changed |
| F2.7 | Med (C) | Activate / deactivate / rollback / status buttons have no loading state or double-click guard | Same `withButtonLoading` as Save |
| F2.8 | Med (C) | Store list reads CONFIG_STORES once **per store** | One read (`cfg_resolveAllAsOf`) |
| F2.9 | Med (C) | Brand dropdown only offers brands already in SETTINGS; brands/regions/categories hard-coded (`APPROVED_*`) — a new brand (e.g. first KOOBIDEH store) or region can't be added | Lists come from config (new Brands/Regions list in Admin); hard-coded lists only as fallback |
| F2.10 | Med (C) | A store with a **future** effective date never reaches SETTINGS (sync checks today only) → never in Store Health / Unvisited | Daily sync of stores whose version starts today |
| F2.11 | Low (C) | "Today" comes from the phone/PC clock, server uses Asia/Manila → today can count as "backdated" | Today from the server |
| F2.12 | Low (C) | Store dropdowns stay empty if their load fails (error swallowed) → "Missing Brand" | Show the error + retry |
| F2.13 | Low (S) | No lock on admin saves — two saves at once can write the same SETTINGS row | `LockService` around create + mirror |
| F2.14 | Low (C) | Visitors: Entity ID and Visitor Name can differ | Fill one from the other |
| F2.15 | — | Leo: ✏️ beside every existing record, admin only | ✏️ on each row of the store/visitor/purpose lists opens the pre-filled edit form (adds a new version, as now) |

**v25 — built 2026-10-06 (branch `svmi/v25-fixes`), not yet deployed.** Done:
F1.1 📅 date input on the icon · F1.2 Enter stops at Visited By (+ stays there while no visitor is picked) ·
F1.3 combinable pills · F2.1 dates as text: `svmiPlain_` + `<fn>_raw_` / page wrapper for the admin store list/detail,
risk detail, purposes, audit log, all Report Snapshot reads/finalize/supersede, getCurrentUser, pending registrations,
user detail, identity audit (also covers F4.1–F4.4) · F2.2 Store Health / KPI rebuild **queued** (one-off trigger ~1 min
later, `triggerQueuedRebuilds`, server token; inline only if triggers are unavailable) — decision L4 taken as the
recommended "background" · F2.3 no second **open** store with the same name + brand · F2.4 column I written only where
blank or already a Store ID · F2.5 stay on the edited record · F2.6 edit form pre-filled (inactive stays inactive; a brand
missing from the list is kept) · F2.7 one admin action at a time · F2.8 store list and name lookup read CONFIG_STORES once ·
F2.12 Brand/Region/Category load error shown · F2.15 ✏️ on every record row · F3.1 tool runner: no double run, empty reply
ends as an error.
**Found while testing (fixed in v25):** Store Name Matching's "MASTER_LOG changed" guard compared raw column I text
(the leaderboard names in rows 2–13) with the Store ID it had read, so any merge/map touching rows 2–13 aborted with
"MASTER_LOG changed while this ran — press Find again" after the CONFIG part was already saved.
Not in v25: F2.9 (brand/region lists from config), F2.10, F2.11, F2.13, F2.14 → with F3/F4.

### F3 — Admin → System Tools → v26

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| F3.1 | Med (C) | Tool runner: button stays clickable while running (double runs → two rebuilds clearing the same sheet); a null result leaves "⏳ Running…" forever | Disable until done; null guard |
| F3.2 | Med (C) | **Data Sheet Headers** blanks SETTINGS G1/I1 (ADMIN_EMAILS / GUEST_PASSWORD headers), shrinks those columns to 20 px (hides them), rewrites D2:D, and relabels MASTER_LOG I1 — card says "Data rows untouched" | Remove the SETTINGS part; hide the tool (retire with Phase E) |
| F3.3 | Med (S) | Validate MASTER_LOG: ~3 config reads per row → can time out; never checks Store ID | Read once; add Store ID check |
| F3.4 | Med (S) | Store Health / Store Master Insight format each row separately (~5k calls) → slow | One batched format call |
| F3.5 | Med (S) | Store Health rebuild has no lock; reports read during a rebuild see an empty sheet | Lock + write-then-swap |
| F3.6 | Low (S) | Migrate Legacy SETTINGS: no lock, can recreate a renamed store | Hide (C.1 is done) |
| F3.7 | Low (C) | Card texts out of date (Store Master Insight, Executive Summary sheet, KPI source); Report Source card doesn't show the current source | Update texts; show "Reports now read: …" on the card |
| F3.8 | Low (C) | Some callable functions skip the admin check: `buildRiskEngineSheet` (wipes STORE HEALTH), `store_recordUnmapped`, `_cfg_ensureSheet`, `_cfg_ensureAuditSheet` | Make them private (trailing `_`) or add `sl_isAdmin()` |

Verdicts: OK — Rebuild/Check Visit Tables, Compare Reports, Report Source, KPI 2026. Fix — Store Health, Validate,
Store Name Matching (F2.4). Retire later (Phase E) — Store Master Insight, Executive Summary sheet, Migrate Legacy
SETTINGS, Data Sheet Headers.

### F4 — Admin → Audit, Report Snapshots, Identity → v26 (with F3)

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| F4.1 | High (C) | **Audit log always looks empty** — rows carry Dates → page gets null → "No audit entries match" | Dates as text; filter + newest-first + cap (~500) on the server |
| F4.2 | High (C) | **Finalize Report succeeds but says "Finalization failed"**; retry → "already finalized" | Dates as text |
| F4.3 | High (C) | Snapshot list / snapshot detail / View Draft show nothing (Dates) | Dates as text |
| F4.4 | High (C) | Identity screens hang (Account panel, pending registrations, user detail — Dates) | Dates as text + null guards |
| F4.5 | High (C) | `handleExternalIdentityDisabled` can be called from any browser and can disable an account — no permission check | Make it private |
| F4.6 | Med (C) | Snapshot of a past year freezes the **latest** year's Executive Summary | Pass the year |
| F4.7 | Med (C) | Snapshots mix sources (store risk from MASTER_LOG by name, gaps from the tables) | Same source as the Reports tab (fits F6/F7) |
| F4.8 | Med (C) | Identity admin can never work for Leo: it needs an identity-ADMIN account and nothing creates the first one | Admin list (`sl_isAdmin`) counts as identity admin, or a one-time "make me identity admin" |
| F4.9 | Med (C) | Not audited at all: visit submissions, Store Name Matching MASTER_LOG rewrites, merges, Rebuild Visit Tables, report-source switch; IDENTITY_AUDIT has no viewer | One audit row per such action (SYSTEM area); edits/voids from F8 audited too |
| F4.10 | Low (C) | View Draft rewrites the shared EXECUTIVE SUMMARY sheet (screen says "never persisted"); finalize/supersede/approve have no loading guard | Draft computed in memory; button guards |
| F4.11 | Low (C) | Read functions without admin check: audit log, snapshot list/detail, draft | Add `sl_isAdmin()` |
| F4.12 | Note (C) | The web app runs as the deployer with anonymous access, so only the deployer's account is recognised (admin, identity, "who" in audit is blank for others) | Leo's decision L7 — stays as is until then |

### F5 — Input Portal weekly history (new) → v27

Leo (2026-10-05): a history list in the Input Portal covering **one week, Monday to Sunday**.
- "This week" panel under the form: Mon–Sun of the current week (Asia/Manila), newest first — date visited, store +
  brand, visitors, purpose, remarks. Count per day + week total.
- ◀ / ▶ to look at the previous week(s) — or this week only (L6b).
- Filter by visitor (pick your own name — the app can't tell who is typing, see F4.12).
- New submissions appear in the list right away (the queue already knows them).
- Admins see ✏️ / 🗑 on each row (F8); others read-only.
- Read from STORE_VISITS by Store ID (one week only → fast).

### F6 — Speed → v28

After F0's numbers:
1. Reports on the tables stop reading MASTER_LOG (year from the tables or sent by the page); CONFIG_STORES read once.
2. Short cache (CacheService, minutes) of loaded visits + store lookup; cleared on submit, edit/void, Rebuild Visit
   Tables, store config change.
3. Store Insights health for **one** store from the tables (D.4's first piece, pulled forward); risk config read once.
4. Store Insights store list loaded once per session.
5. Fewer round-trips: one combined call on page/tab open instead of several small ones (each costs ~1.5–3 s).
Target: each report under ~3 s on live data; before/after ms in `TESTING_LOG.md`.

### F7 — Past years in reports → v29

Today only Executive Summary has a Year; Visited / Unvisited send just a month; Store Insights is all-time; Store
Health and KPI 2026 have no year. Side bug (C): in January before any visit, "Current Month" = January of **last** year.
- Year dropdown (years with visits, from STORE_VISITS) beside Month for Visited, Unvisited, Store Insights ("All years"
  default), Store Health; KPI 2026 per L3. "Current Month" always = the real current month/year. Snapshots use it (F4.6).

### F8 — Edit / void visit records, admin only → v30

Leo: existing records editable, ✏️ beside each record, **admin only**.
- ✏️ / 🗑 beside each visit in the weekly history (F5), Store Insights' full visit list, and an admin **Visit Records**
  list (filter by store / date / visitor). Hidden from non-admins; every server function re-checks `sl_isAdmin()`.
- Edit: date, store (Store ID picker), visitors, purpose, remarks → saves to the MASTER_LOG row; old/new values + who +
  when + reason go to a new **VISIT_CORRECTIONS** sheet (and the audit, F4.9); the visit is replaced in STORE_VISITS /
  STORE_VISIT_VISITORS (its Visit ID changes, since IDs come from the row's content — same step).
- Delete = **void**: gone from every report, row stays in MASTER_LOG, listed in VISIT_CORRECTIONS, restorable.
  (Removing MASTER_LOG rows shifts row numbers.)
- Duplicate check on edit; Rebuild Visit Tables re-applies voids; Check Visit Tables lists voided visits separately.
- Never touches MASTER_LOG rows 2–13 column I (leaderboard).

### Decisions needed from Leo

| # | Question | Recommendation |
|---|----------|----------------|
| L1 | Delete a visit: void (hidden, restorable) or permanent? | Void |
| L2 | Reason required on every edit/void? | Yes, one line |
| L3 | KPI 2026: year dropdown, or fixed to 2026? | Year dropdown |
| L4 | Store Health refresh after an admin save: background (a minute later) or on next Store Health open? | Background |
| L5 | Order F1+F2 → F3+F4 → F5 → F6 → F7 → F8, then D.4/D.5 | As listed |
| L6a | Weekly history: by **date visited** or by **date submitted**? | Date visited, with submitted time shown |
| L6b | Weekly history: this week only, or ◀ ▶ to older weeks? | ◀ ▶ allowed |
| L7 | Deployment: keep "anyone, runs as deployer" (only you are recognised) or require Google sign-in so admins/visitors are known? | Decide before F4.8 |

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

34 files, 1,913 checks, all passing (`node tests/<file>.test.js`) — v25 added `tests/v25-fixes.test.js` (60).
`store-name-matching-ui.test.js` clicks through the real `SVMI_PORTAL.html` with the real `.gs` code
behind it (Playwright); the other portal tests use the demo page.
