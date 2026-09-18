# Deploying SVMI

Two ways to get the code into Google Apps Script: `clasp push` (one command)
or pasting files by hand (no setup, but tedious).

---

## Which sheet does this push to?

`Apps Script/.clasp.json` holds the target Script ID. It currently points at:

| | |
|---|---|
| **Target** | `Copy of sys.STORE VISIT 2026` — the test copy |
| **Script ID** | `1UU582VPImQRpvQCtNHLOjmp6_0MBN5v0XA9Z1OJPnxpjDEz8NswYTVLb` |

That default is deliberate. The live sheet (`sys.STORE VISIT 2026`) is owned by
someone else, and a stray `clasp push` against it would overwrite their script.
To deploy to a different sheet, change the `scriptId` — get it from that sheet's
**Extensions → Apps Script → ⚙ Project Settings → Script ID**.

**`clasp push` overwrites the online files with the local ones.** If anyone has
been editing in the browser, run `clasp pull` first or you will discard their work.

---

## Deploying from your own machine

One-time setup:

1. Enable the API: <https://script.google.com/home/usersettings> → **Google Apps Script API** → **On**
2. Install [Node.js](https://nodejs.org) (LTS), then:
   ```
   npm install -g @google/clasp
   clasp login
   ```

Then, any time:

```
cd "SVMI_Project/Apps Script"
clasp push
```

`clasp pull` brings browser-side edits back down into the repo.

---

## Deploying from a Claude Code web session

`.claude/hooks/session-start.sh` runs at session start and prepares the
container: it installs clasp and restores the OAuth credential from an
environment variable. After that, `clasp push` works in-session.

### Setting the credential

The hook reads **`CLASPRC_JSON_B64`** — base64 of your local `~/.clasprc.json`.
It is base64 rather than raw JSON because the environment-variable field parses
`KEY=value` lines, and raw JSON braces and quotes break that.

After `clasp login` on your machine, in **PowerShell**:

```powershell
$b=[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.clasprc.json")); "CLASPRC_JSON_B64=$b" | Set-Clipboard
```

On macOS or Linux:

```bash
echo "CLASPRC_JSON_B64=$(base64 -w0 ~/.clasprc.json)" | pbcopy   # or xclip -selection clipboard
```

Neither command prints anything — the value goes straight to the clipboard.
Paste it into the environment variable settings for this repo's Claude Code
environment, then **start a new session**; environment changes do not reach
sessions that are already running.

`CLASPRC_JSON` (unencoded) also works if your settings field accepts raw JSON.

### Match your clasp version

The session hook installs **clasp v3** (3.4.1 at the time of writing). The
credential file's internal format changed between v2 and v3, so a
`.clasprc.json` produced by a local clasp v2 may not be readable by the v3 in
the container. Check yours with `clasp --version`; if it reports v2, upgrade
with `npm install -g @google/clasp@latest`, run `clasp login` again, and re-copy
the value.

### Verifying it arrived

```
printenv CLASPRC_JSON_B64 | wc -c     # low thousands = set, 0 = not set
clasp show-authorized-user            # confirms the credential actually works
```

---

## Security

Read this before setting the credential.

- `~/.clasprc.json` contains an OAuth **refresh token**. Refresh tokens do not
  expire on their own — they work until revoked.
- The token is **not scoped to one spreadsheet**. clasp's default scopes cover
  your Drive files, script projects and deployments. Anything holding it can act
  as you across those.
- **Never paste it into a chat, issue, commit or email.** Use the clipboard
  commands above so the value is never displayed.
- **It is deliberately not in this repo**, and `.gitignore` excludes
  `.clasprc.json` so it cannot be committed by accident.
- **Revoke any time:** <https://myaccount.google.com/permissions> → **clasp** →
  **Remove access**. Do this immediately if it is ever exposed.
- **Safest setup:** a throwaway Google account that owns only the test copy.
  Then a leak costs one test spreadsheet rather than your whole Drive.

---

## Publishing the Web App

`clasp push` uploads code but does **not** publish a new version of a running
Web App. After pushing, either:

- **In the editor:** Deploy → Manage deployments → pencil icon → New version → Deploy
- **Or:** `clasp deploy`

Until you do, the `/exec` URL keeps serving the previous version.

The Web App matters because **Apps Script custom menus and dialogs do not run in
the Google Sheets mobile apps** — the `/exec` URL is the only way to use the
Command Center from a phone.

---

## Navigation

The portal's five sections (Input Portal, Store Insights, Unvisited This
Month, Reports, System Tools) live in a slide-out drawer, not a side-by-side
tab bar. A single burger button (☰) in the tab bar shows the current
section's name; clicking it slides the drawer in from the left with a
dimming scrim behind it, and it closes on selecting an item, pressing
Escape, or clicking the scrim. The drawer's menu order is Reports, Store
Insights, Unvisited This Month, Input Portal, System Tools — Input Portal
still loads by default when the app opens; only the list order changed.

---

## Annual rollover

**As of Phase 1C, there is no annual rollover step.** `DATA_YEAR`
(`SVMKPI_CORE.gs`) is a legacy compatibility constant only — nothing in the
live KPI/risk/compliance calculation path reads it anymore. The reporting
year every calculation actually uses is resolved at call time by
`getDefaultReportingYear()` (`SVMKPI_REPORTING_YEAR.gs`), which is the
LATEST calendar year actually present in `MASTER_LOG`'s Date Visited
column — re-derived from live data on every call, never a static literal
someone has to remember to bump. See "Phase 1C" below for the full design.

In practice this means: once a visit dated in the new year lands in
`MASTER_LOG`, every default-year calculation (Store Health, Unvisited This
Month's compliance windows, a KPI rebuild run with no explicit year) starts
using that new year automatically, with no code change and no constant to
edit.

Two things that used to require a manual bump now happen automatically:

- **The KPI sheet name** — `_kpiSheetName(year)` (`SVMKPI_KPI_REBUILD.gs`)
  returns `'KPI ' + year`, where `year` defaults to
  `getDefaultReportingYear()`. Running "Rebuild KPI 2026" once 2027 data
  exists creates/reuses a `KPI 2027` tab automatically — no constant to
  bump first. Note this REUSES one sheet per rebuild, it does not keep
  multiple years' sheets alive simultaneously as permanent snapshots (that
  kind of archival behavior is a later, explicitly deferred phase — see
  "Reporting Year vs. Report Snapshot Version" below).
- **The portal's top-bar year** — the "Store Visit Monitoring Initiative ·
  2026 · …" subtitle and the Unvisited tab's month label both read
  `sl_getDataYear()`, which itself now returns `getDefaultReportingYear()`.

What still needs a manual look: menu items, tool labels and confirmation
dialogs that say "KPI 2026" by name (e.g. "Rebuild KPI 2026") are just
display text — cosmetic, not wired to any year constant — and are fine to
leave as a familiar label or reword at your discretion; the underlying
`buildKPI2026()`/`getKPI2026Report()` functions behind those labels are
year-neutral regardless of what the button says (see "Phase 1C" below).

---

## Access control

Three layers, each answering a different question:

| Layer | Question it answers | Where it's configured |
|---|---|---|
| Google sign-in | Is this a real Google account? | `appsscript.json` |
| Guest password | Should this account be using the app at all? | `SETTINGS!I2` |
| Admin list | Should this account see System Tools at all? | `SETTINGS!G2:G` |

### 1. Google sign-in

`Apps Script/appsscript.json` sets:

```json
"webapp": {
  "executeAs": "USER_ACCESSING",
  "access": "ANYONE"
}
```

- **`access: "ANYONE"`** — despite the name, this means **"Anyone with a
  Google account"**, not the public. Every visitor must sign in with Google
  before anything loads. (The fully-public option is `"ANYONE_ANONYMOUS"` —
  not used here.)
- **`executeAs: "USER_ACCESSING"`** — the script runs as whoever is actually
  using it, not as whoever deployed it. This is what makes `sl_getCurrentUser()`
  (the "👤 Signed in as …" line, and the admin check below) reliable.

**The trade-off:** because it runs as the visiting account, that account needs
its *own* access to this Spreadsheet — Share it with each visitor (Viewer is
enough to browse, Editor if they submit visits through Input Portal), or with
a Google Group that covers everyone who should use it. Skip this and a
visitor sees the portal load, then every data call fails with a permission
error. `executeAs: "USER_DEPLOYING"` (the old setting) avoids that sharing
step by running everything as whoever deployed it — simpler, but every visit
is then indistinguishable from every other, and `sl_getCurrentUser()` returns
`''` (which also disables the admin list below — see its note there).
Changing either value takes a **new deployment version** (Deploy → Manage
deployments → pencil icon → New version → Deploy, or `clasp deploy`) to take
effect — pushing the code alone is not enough.

### 2. Guest password

A shared password, checked **before the portal's HTML is ever served** —
`doGet()`/`doPost()` route through `_handleWebAppRequest_()`
(`SVMKPI_ACCESS.gs`), which serves `SVMI_LOCK.html` (a small password form)
instead of `SVMI_PORTAL.html` until the password matches `SETTINGS!I2`. A
correct submit gets remembered in the browser's `localStorage`, so it's a
one-time prompt per browser, not per visit — and because it's a server-side
gate, a browser that never enters the password never receives the code that
could call `google.script.run` at all, not just a UI that hides the button.

Run **STORE VISIT KPI → 🔐 Set Up Access Control** from the Sheets menu once
to turn this on — it's off (no password required) until then, so the app
never locks everyone out before you've set it up. That same menu item
generates a random password into `SETTINGS!I2` and shows it once in a dialog;
change it any time by editing that cell directly. Rotating it signs out every
browser that had the old one remembered (they'll see the lock screen again).

### 3. Admin list (all of System Tools)

`SETTINGS!G2:G` holds one admin email per row. `sl_isAdmin()` checks the
signed-in email (from layer 1) against that list. **Every** System Tool —
all six cards, not just the three destructive ones — hides its button in
the UI for anyone not on the list. That hiding is a convenience only: each
of the six `portal_*` handlers (`portal_rebuildStoreMaster`,
`portal_rebuildStoreHealth`, `portal_rebuildExecutiveSummary`,
`portal_rebuildKPI2026`, `portal_validateMasterLog`,
`portal_rebuildDataHeaders`) calls `sl_isAdmin()` again itself before doing
anything, since a hidden button doesn't stop a direct call to the function.
The same **🔐 Set Up Access Control** menu item seeds whoever runs it as
the first admin, so there's always at least one.

**To restrict System Tools to a single account**, run 🔐 Set Up Access
Control once (or confirm it's already run), then open `SETTINGS!G` and make
sure that column has exactly one row — the one account that should have
access — with any other admin emails removed. `sl_isAdmin()` reads that
column fresh on every check, so this takes effect immediately, no
redeploy needed.

Everything else — Input Portal, Store Insights, Unvisited This Month, and
the Reports tab — stays open to anyone who gets past the password; System
Tools is the only tab gated by the admin list.

---

## Reports tab

A 5th portal tab showing **Executive Summary**, **KPI 2026**, and **Store
Health** read-only, straight from the Web App — no more opening the actual
Spreadsheet just to check a number. `SVMKPI_REPORTS.gs` reads whatever is
already in those three sheets (they're still built the same way they always
were — `buildExecutiveSummaryLayout()`, `buildKPI2026()`, `refreshRiskEngine()`
via System Tools or the Sheets menu) and returns it as JSON; this tab never
writes anything. If a sheet doesn't exist yet, its report shows an error
naming which System Tool to run first.

- **KPI 2026** shows both a monthly-totals table and a per-week table
  labeled **P{period}W{week}** — period = calendar month (P1 = January),
  week = a continuous count across the whole year (P1W1 is the year's
  first week; if January has 5 weeks, February's first real week is
  P2W6, not "P2W1"). Same Sun–Sat week boundaries as the sheet's own
  W1–W5 columns; a short month's unused W5 slot (a disabled static 0 in
  the sheet, not real data) is skipped rather than mislabeled.
- **Store Health** uses the same header filter/sort engine as the
  Unvisited This Month and Store Insights tables — every column has a
  ▼ filter button and is sortable by clicking its label.

---

## Store & Roster Manager

A 7th System Tools card (admin-only, same as the other six) for editing
`SETTINGS` directly from the Web App instead of opening the spreadsheet by
hand:

- **Store** — search an existing store (auto-fills its current
  Brand/Region/Category) or type a brand-new name, pick Brand/Region/
  Category, and Save. `portal_saveStore()` (`INPUT_PORTAL.gs`) updates the
  matching row's B/C/E columns, or appends a new row and writes its column D
  validation formula — an edit to an existing row leaves column D alone
  since it's a live formula that recalculates on its own. **Remove Store**
  (with a confirm prompt) clears only that row's own A/B/C/D/E cells via
  `portal_removeStore()` — cols F (Visitor Roster) and H (Purpose List) sit
  in the same sheet but are unrelated parallel lists, so removal never
  touches them even when they happen to share the removed store's row.
  This only hides the store from future selection; it never touches
  `MASTER_LOG`, so every past visit stays fully intact (see below).
- **Visitor Roster** — the same add/remove backed by `manageVisitor()` that
  Input Portal's "⚙ Manage Roster" panel already uses (`SETTINGS` col F);
  this card is just a second place to reach it.
- **Purpose List** — add/remove entries in `SETTINGS` col H via the new
  `managePurpose()`, the same list `getSidebarData()` already reads into
  Input Portal's Purpose dropdown. Adding a purpose beyond the original
  four (`STORE VISIT`/`TLTC`/`FAILED QA/MS`/`CURING/SUPPORT`) lets visits
  log under it immediately, but it won't be broken out separately in
  Executive Summary/KPI 2026's purpose tables or Store Health's risk
  scoring — those still key off the fixed four in `APPROVED_PURPOSES`
  (`SVMKPI_CORE.gs`). It'll still count toward every *total* those reports
  show; it just won't get its own row/score.

`sl_getStoreFormOptions()` (`SVMKPI_STORE_LOOKUP.gs`) supplies the form's
Brand/Region/Category dropdowns — brands from `sl_getBrandList()` (already
in use), regions/categories from the fixed `APPROVED_REGIONS`/
`APPROVED_CATEGORIES` enums (`SVMKPI_CORE.gs`).

### What happens to the reports when you add/remove data

Less manual than it looks, but not everything is truly live:

- **Executive Summary already updates itself for ordinary visits.** Its
  numbers are native Sheets formulas over whole `MASTER_LOG` columns
  (`COUNTIF(MASTER_LOG!G:G,...)`, etc.) — Google Sheets recalculates those
  the moment a new row lands, with no rebuild needed. "Rebuild Executive
  Summary" is only for fixing the sheet's layout/formatting, not for
  picking up new data.
- **KPI 2026 is the same for anyone already on the roster** — their
  SUMPRODUCT formulas recalculate automatically for a new visit too. The
  one case that needs help is a **brand-new** roster member: there's no
  formula row for them until one exists, so `manageVisitor('add', ...)`
  (`INPUT_PORTAL.gs`) now rebuilds the KPI 2026 sheet right away, *if it
  already exists*, whenever someone new is added — via Store & Roster
  Manager or Input Portal's own "⚙ Manage Roster" panel, either one. That
  rebuild only runs on this relatively rare add-a-person action, never on
  an ordinary visit submission.
- **Store** add/edit works the same way for **Store Health**: its scores
  are plain computed values (the cadence/decay logic isn't expressible as
  a Sheets formula), so nothing about them recalculates on its own.
  `portal_saveStore()` now calls `refreshRiskEngine()` right after a
  successful save, *if the Store Health sheet already exists* — so a new
  or edited store shows up without a manual "Rebuild Store Health" click.
  Editing a store's brand/region does **not** retroactively relabel visits
  already in `MASTER_LOG` under the old value; only new submissions pick
  up the edit.
- **An ordinary visit submission through Input Portal does not trigger any
  of these rebuilds.** Executive Summary and KPI 2026 (for existing
  roster members) don't need it — their formulas already picked it up.
  Store Health does still need one, deliberately not automatic here: doing
  a full risk-engine rebuild (scans every `MASTER_LOG` row, rescoring every
  store) on every single visit would add real latency to the one action
  field users do most often. Run "Rebuild Store Health" by hand after a
  batch of new visits, or ask if you'd like that traded off instead —
  it's a real option, just not the default.
- **Store removal** is handled safely regardless: `_computeStoreRisk()`
  (`SVMKPI_RISK.gs`) seeds itself from `SETTINGS` first, then falls back to
  `MASTER_LOG` rows for any store no longer in `SETTINGS` — so a removed
  store keeps showing up in Store Health with every historical visit, its
  brand/region falling back to whatever `MASTER_LOG` recorded, and only its
  Category degrading to `—`/`UNKNOWN` (no cadence target) since `MASTER_LOG`
  never records category. Nothing is ever dropped, only relabeled generic.
  `tests/store-remove-history.test.js` covers both halves of this: that
  `portal_removeStore()` only clears its own row's columns (never a
  same-row visitor/purpose entry) and that `_computeStoreRisk()` keeps the
  removed store's history with a degraded category.
- **Visitor Roster removal** is handled safely regardless: `buildKPI2026()`
  appends anyone with real `MASTER_LOG` history who's since been removed
  from the roster as an extra row (their name written as a plain literal
  instead of a live `SETTINGS!F` formula, since there's no roster row left
  to point to), so **their historical numbers are never lost**, even after
  the active roster changes out from under them. `getKPI2026Report()` reads
  row-by-row off the actual sheet rather than re-deriving the visitor count
  from `SETTINGS!F`, for the same reason — it can't fall out of sync with
  what the rebuild actually wrote. `tests/kpi-roster-history.test.js` and
  `tests/roster-auto-refresh.test.js` cover this end-to-end (real `.gs`
  tests, not the demo mock, since the demo's simplified heuristic doesn't
  model the rebuild-snapshot architecture at all).
- **Purpose List** changes carry no historical-loss risk either way — a
  purpose that's since been removed from the list simply can't be picked
  again going forward, but visits already logged under it keep whatever
  score/count they already had. Adding a purpose beyond the original four
  still won't get its own row anywhere (Executive Summary's purpose table
  and Store Health's scoring both stay keyed to the fixed four in
  `APPROVED_PURPOSES`) — no rebuild changes that, it's a fixed-layout
  limitation, not a timing one.

---

## Phase 0 hardening (pre-work for configuration-driven administration)

A user-supplied addendum asked for a much larger rearchitecture — a
configuration service, year-neutral reporting, versioned risk/compliance/
KPI rules, an audit log, rollback, and a year-rollover workflow. Before any
of that, a research pass identified five smaller, independent gaps worth
fixing first since every later phase builds on top of them:

- **`manageVisitor()` is now admin-gated.** Input Portal's own non-admin
  "⚙ Manage Roster" quick panel (which used to justify leaving this
  function ungated) has been removed entirely — the admin-only System
  Tools "Store & Roster Manager" card is now its only caller, so it checks
  `sl_isAdmin()` itself like its siblings (`managePurpose()`,
  `portal_saveStore()`, `portal_removeStore()`). Roster management is now
  exclusively a System Tools action.
- **One canonical risk engine, not two.** Store Insights' single-store
  health card used to run its own independent "Bible §6" formula
  (`SL_RISK`/`_sl_computeHealth()`, retired) that could score the exact
  same store completely differently than the Store Health sheet — most
  visibly, a never-visited store scored HIGH here (a days-since/30
  penalty) but only the modest "no history" +3 there. Both now go through
  `_computeStoreRisk()` (SVMKPI_RISK.gs) via the new
  `_sl_computeCanonicalHealth()` helper (SVMKPI_STORE_LOOKUP.gs).
- **No more 5,000-row ceiling.** Four generated-formula/conditional-format
  spots (`SVMKPI_KPI_REBUILD.gs`'s weekly SUMPRODUCTs, `SVMKPI_LAYOUT.gs`'s
  Visitor Leaderboard, `SVMKPI_MASTER_REBUILD.gs`'s brand color-coding)
  hardcoded `MASTER_LOG!...$5000` — a visit logged past row 5000 silently
  fell outside all of them. Replaced with one shared
  `MASTER_LOG_MAX_ROW` constant (SVMKPI_CORE.gs, currently 200,000) —
  comfortably past any realistic visit volume, so a rebuild is never
  required again just because the log grew.
- **`processSubmissionAsync()` now locks its MASTER_LOG write** via
  `LockService.getScriptLock()` (10s timeout), so two near-simultaneous
  submissions can never interleave. A busy lock fails cleanly ("Server is
  busy processing another submission…") rather than risking a corrupted
  write; the lock is always released, even if the write itself throws.
- **One shared date parser.** `_parseDateCell()` (SVMKPI_CORE.gs) replaces
  three independent date-parsing implementations that had quietly drifted
  apart — `processSubmissionAsync()`'s write-side manual split,
  `_getData()`'s read-side fallback (the only one of the three that never
  routed through the script timezone), and `checkDuplicateVisit()`'s own
  rebuild. All three now call the same function, which also strips any
  time-of-day component to local midnight (a Sheets cell that somehow
  carries a time no longer causes two same-day visits to compare as
  different `.getTime()` values elsewhere in the project).

None of this changes what an ordinary visit submission looks like from the
Input Portal side — these are all internal consistency/robustness fixes,
covered by `canonical-risk-engine.test.js`, `submission-lock.test.js`, and
`date-parsing.test.js` (new), plus updated assertions in
`roster-auto-refresh.test.js` and `portal-ui.test.js`.

---

## Phase 0.5 — the two gaps Phase 0's own verification found

A read-only audit of Phase 0 (before starting the larger configuration-driven
rearchitecture) found two things Phase 0 hadn't actually finished, despite
being adjacent to what it did fix. Both are closed now:

- **`SVMKPI_STORE_LOOKUP.gs` now uses `_parseDateCell()` everywhere too.**
  Seven independent `dateRaw instanceof Date ? ... : null` checks — in
  `sl_getStoreData()` (row sort, last-visit display, recent-visits list),
  `sl_getVisitedThisMonth()`, `sl_getUnvisitedThisMonth()`, and
  `sl_getComplianceGaps()` — silently dropped any MASTER_LOG row whose date
  cell wasn't already a Sheets-coerced `Date` object, even though
  `processSubmissionAsync()`/`_getData()`/`checkDuplicateVisit()` would have
  parsed the exact same string-valued cell correctly. A visit could show up
  correctly in Store Health/Executive Summary/KPI 2026 while silently
  missing from Store Insights, Visited/Unvisited This Month, or Compliance
  Gaps — same underlying row, different reports disagreeing. All seven now
  call `_parseDateCell()`. Covered by
  `tests/store-lookup-date-handling.test.js` (native Date, valid string,
  invalid string, and blank date, across all four functions).
- **Duplicate visits are now actually blocked, not just warned about.**
  `checkDuplicateVisit()` remains exactly what it was — a separate,
  unlocked, advisory pre-submit RPC with its own broader "any visit to this
  store in the last 7 days" heads-up. It was never the mechanism that could
  enforce a real duplicate rule, since it never blocked anything and wasn't
  re-checked at write time. The actual enforcement now lives inside
  `processSubmissionAsync()`'s `LockService`-protected section, via the new
  `_findExactDuplicateVisitor()`: after acquiring the lock, it re-reads
  MASTER_LOG fresh and rejects the submission if any existing row has the
  same Store (normalized name — see note below) + the same calendar
  Date Visited + at least one Visitor in common with the incoming
  submission. A multi-visitor submission (`"LEO | YANA"`) is blocked the
  moment *either* name collides with an existing same-store/date row, not
  only when the whole visitor list matches — the risk this guards against
  (one person's visit logged twice) exists per-visitor, independent of who
  else is on the submission. Because the check and the write share one lock
  acquisition, two submissions racing each other can never both succeed —
  whichever one's lock is granted second is guaranteed to see the first
  one's commit before it decides. Covered by
  `tests/duplicate-prevention.test.js`: exact duplicate blocked; same store
  + different visitor allowed; same store/visitor + different date allowed;
  different store + same visitor/date allowed; multi-visitor partial-overlap
  blocked; and a same-store/visitor/date pair submitted twice in a row
  (the standard way to test lock-serialized atomicity without real OS
  threads) resulting in exactly one row, never two.

  **Interim identity note:** the duplicate check matches stores by
  normalized *name*, not by an immutable Store ID — Store ID doesn't exist
  yet (that's a future migration). This is a deliberate, disclosed choice:
  identity is already name-based everywhere else in the app today, so
  nothing regresses; it just doesn't yet carry the immutable-ID guarantee,
  which doesn't exist anywhere yet either. Re-key this to Store ID once
  that migration lands.

The demo (`SVMI_Command_Center_Demo.html`) mirrors the duplicate-blocking
rule in its own `processSubmissionAsync()` mock for behavioral parity — the
demo has no real concurrency to guard (single browser tab), so this exists
purely so the preview demonstrates the same business rule as the live app.

---

## Phase 1A — configuration data model, versioning, and audit foundation

**Status: foundation only.** `SVMKPI_CONFIG.gs` is new, self-contained
infrastructure — nothing in `INPUT_PORTAL.gs` or the existing
`SVMKPI_*.gs` business logic (risk engine, KPI rebuild, reports, Store &
Roster Manager) reads from or writes to any `CONFIG_*` sheet yet. Wiring
the real engines to consume this is later Phase 1 sub-phases' job; this
phase only had to prove the model itself is sound.

### Configuration areas

Seven business-configuration areas, each its own dedicated sheet (created
on first use, never pre-existing in a fresh spreadsheet), plus one audit
log:

| Area | Sheet | Entity ID (interim) | Domain fields |
|---|---|---|---|
| Stores | `CONFIG_STORES` | normalized Store Name | Store Name, Brand, Region, Category |
| Visitors | `CONFIG_VISITORS` | normalized Visitor Name | Visitor Name |
| Purposes | `CONFIG_PURPOSES` | normalized Purpose Name | Purpose Name |
| Risk | `CONFIG_RISK` | `DEFAULT` (one global rule set, matching today's actual architecture) | Low/Medium/High thresholds, 4 purpose weights |
| Compliance | `CONFIG_COMPLIANCE` | normalized Category (e.g. `NCR`) | Cadence Type, Cadence Days, Period Definition (placeholder — see below), Grace Days |
| KPI | `CONFIG_KPI` | admin-chosen KPI key | KPI Name, Target Value, Weight, Purpose Reference |
| System | `CONFIG_SYSTEM` | admin-chosen setting key | Setting Value, Setting Label |
| Audit | `CONFIG_AUDIT` | — (not versioned itself; append-only log) | see below |

**Interim identity note** (same disclosed tradeoff as Phase 0.5's
duplicate-visit check): Store/Visitor/Purpose entities are keyed by
normalized *name* for now, not an immutable ID — that migration is a
later Phase 1 sub-phase. Nothing regresses; identity is already
name-based everywhere else in the app today.

**`CONFIG_COMPLIANCE`'s "Period Definition" column is a deliberate,
unpopulated placeholder.** Whether a calendar-period compliance rule means
"at least one visit in the current period," "...in the previous period,"
"...period-to-date," or something else is a genuine business ambiguity
the master plan explicitly flagged as needing a stop-and-report rather
than an invented answer. Phase 1A defines where that decision will live;
it does not make the decision.

**`CONFIG_SYSTEM` ships with zero populated rows.** Per the
business-vs-technical split already established in the Phase 0
verification report, nothing currently qualifies as a new genuinely
business-configurable system setting that isn't either developer-only
(row-range constants, lock timeouts — stay as code) or already living in
`SETTINGS` (admin emails, guest password — moving those now would be an
unrequested migration). The schema exists so a real future setting has a
principled home; `settingKey` is a fixed, code-known identifier, not a
free-form admin-typed field, so this never becomes a generic key/value
editor.

### Versioning model

Every configuration area shares one envelope (columns A–I of its sheet):
Version ID, Entity ID, Version #, Effective From, Effective To, Status
(`ACTIVE`/`INACTIVE`), Created At, Created By, Reason. Domain-specific
fields follow at column J onward, each its own typed column — never a
JSON blob or generic key/value pair, so each sheet maps cleanly to one
future relational table if this ever moves to PostgreSQL.

**A configuration "change" is always a new row, never an edit to an old
one** — except a version's own Status, which can flip between
`ACTIVE`/`INACTIVE` (via activate/deactivate) without touching any other
field, itself audited. This is what makes history reproducible without a
separate "history" table: the `CONFIG_*` sheet already *is* its own
history.

**Effective dating / historical resolution:** `cfg_resolveConfigurationAsOf(area, entityId, date)`
is the one centralized place this logic lives — no future consumer should
ever re-derive "what applied on this date" itself. Among all `ACTIVE`
versions for an entity where `EffectiveFrom <= date` and (`EffectiveTo`
is blank or `date <= EffectiveTo`), it returns the one with the latest
`EffectiveFrom` (ties broken by highest version number). An open-ended
version answers for every date from its `EffectiveFrom` onward until a
*later* version's `EffectiveFrom` supersedes it for those later dates —
nothing is ever written back to the earlier row to make that happen. This
was a deliberate choice over having each new version edit the *previous*
version's `EffectiveTo` on creation, which would itself be an in-place
edit to an otherwise-closed historical row.

### Backdating

`cfg_createConfiguration()` (and `cfg_rollbackConfiguration()`, which is
itself a new-version creation) detects `EffectiveFrom < today` and
refuses the mutation (`requiresBackdateConfirmation: true`) unless the
caller passes `options.backdateConfirmed === true` **and** a non-empty
`reason`. This is the literal mechanism behind "never silently backdate."

### Audit log

Every successful mutation (`CREATE`/`ACTIVATE`/`DEACTIVATE`/`ROLLBACK`)
writes exactly one append-only row to `CONFIG_AUDIT`: timestamp, actor,
area, entity ID, action, previous value, new value, effective from/to,
reason, version. A rejected/invalid mutation writes nothing. Previous/New
Value are compact human-readable snapshots (`key=value; key=value`) of
the domain fields — the one place this model uses a serialized string
rather than typed columns, and deliberately so: it's an audit log's diff
display, not a live configuration table, which is exactly the pattern
real relational audit-log schemas use.

### Rollback

`cfg_rollbackConfiguration(area, entityId, targetVersionId, reason, effectiveFromStr, options)`
never deletes or edits anything — rolling back a current v3 to v1's
values creates v4 (copying v1's field values), while v1–v3 remain exactly
as they were and stay fully queryable. The rollback itself is audited as
a `ROLLBACK` action, and both the new version's own Reason column and its
audit entry record which version was restored.

### Admin authorization

Every mutation (`cfg_createConfiguration`, `cfg_activateConfiguration`,
`cfg_deactivateConfiguration`, `cfg_rollbackConfiguration`) checks
`sl_isAdmin()` (the existing SVMKPI_ACCESS.gs function — no new role
model) as its first statement, server-side, independent of anything the
client sends. No `cfg_*` function reads a client-supplied "admin"/"role"
field from its payload — there is no such field to spoof. Read-only
access (`cfg_getConfiguration`, `cfg_resolveConfigurationAsOf`,
`cfg_getAuditLog`) is not admin-gated, matching this app's existing
convention for read paths (e.g. `sl_getStoreData()`).

### Configuration service API

`SVMKPI_CONFIG.gs` — `cfg_getConfiguration`, `cfg_resolveConfigurationAsOf`,
`cfg_createConfiguration`, `cfg_activateConfiguration`,
`cfg_deactivateConfiguration`, `cfg_rollbackConfiguration`,
`cfg_validateConfiguration`, `cfg_getAuditLog`, plus internal (`_cfg_*`)
sheet/version-read/row-building helpers. This is the only place any
future code should read or write a `CONFIG_*` sheet — no `.gs` file
should ever open one directly, the same discipline `SVMKPI_CORE.gs`'s
`_getData()` already established for `MASTER_LOG`.

Covered end-to-end by `tests/config-service.test.js` (71 checks): creation
validation, effective-dating/resolution (before/on/after/boundary/
overlap/adjacent), versioning (1st/2nd/multiple/historical/current),
audit (actor/previous/new/reason/no-audit-on-failure), security
(non-admin rejected/admin succeeds/payload-spoofing doesn't bypass),
backdating (blocked/confirmed-no-reason-still-blocked/confirmed-with-
reason-succeeds/future-needs-no-confirmation), rollback
(no-deletion/new-version/historical-still-queryable), activate/
deactivate, and portability (every assertion addresses a version by its
Version ID/Entity ID, never by array or row position).

---

## Phase 1B — immutable Store identity + historical store attributes

Phase 1A built a generic, area-agnostic configuration engine. Phase 1B is
the first real consumer of it for an *identity*-bearing entity: it makes
**Store ID** — not Store Name — the authoritative, immutable key for a
store, and makes every store attribute (name, brand, region, category,
operational status) reproducible as of any historical date.

### Store ID design

`SVMKPI_STORE_CONFIG.gs`'s `_store_generateId()` mints `'STR-' +
Utilities.getUuid()`. A UUID was chosen deliberately over a sequential
counter: minting one needs no shared/locked state (a "next number" scheme
would race under concurrent creates), it's independent of row position and
name by construction, and it's a standard choice for a future PostgreSQL
primary key. Once minted, a Store ID is never reassigned:
`store_update()` explicitly rejects any call whose `fields.storeId`
disagrees with the ID being updated — retargeting is defined as creating a
*different* store, never an operation this API performs. There is no
"rename this ID" or "merge two IDs" function; none should ever be added
without a new, deliberate design step (that's out of this phase's scope).

### CONFIG_STORES: Store ID as the Entity ID

`CFG_AREA_SCHEMAS.STORES` (Phase 1A) is reused as-is — no schema rewrite —
with Store ID now passed as the versioning envelope's Entity ID (previously
this was an interim, disclosed gap using Store Name). A new non-required
domain field, `status` ("Store Status" — `ACTIVE`/`INACTIVE`), was added to
the schema; it is effective-dated exactly like Category, Brand, Region, or
Name. **This `status` field is a different concept from the versioning
envelope's own `Status` column**: the envelope's Status says whether a
given *version row* counts during resolution at all (its ACTIVE/INACTIVE
lifecycle); this new field is the *store's own* operational business
state. Both happen to use the same two string values, which is exactly why
the code comments call this out explicitly wherever it could be confused.

### Store-specific API (`SVMKPI_STORE_CONFIG.gs`)

Built on top of — never duplicating — `SVMKPI_CONFIG.gs`:

- `store_create(fields, effectiveFromStr, reason, options, explicitStoreId?)` —
  mints (or, only from the migration path below, accepts) a Store ID;
  rejects if that ID already has any version.
- `store_update(storeId, fields, effectiveFromStr, reason, options)` — adds
  a new version. Takes the **full field set** for the new version (same
  contract as `store_create`), not a partial patch — a caller that wants to
  change one field must merge it onto the currently-resolved fields first,
  exactly as `_store_setOperationalStatus()` does internally.
- `store_activate(storeId, reason, effectiveFromStr, options)` /
  `store_deactivate(...)` — thin wrappers that flip `status` via a new
  version.
- `resolveStoreAsOf(storeId, dateStr)` — **the** authoritative historical
  resolver; every future consumer that needs "what were this store's
  attributes on this date" calls this, never re-derives it from
  `CONFIG_STORES` rows directly.
- `store_getById(storeId)` — `resolveStoreAsOf` as of today.
- `store_isOperational(storeId, dateStr)` / `store_getOperationalList(dateStr)` —
  the operational-screen view: **active-only**, sorted by name. This is
  the one place inactive stores are filtered out — they are never globally
  hidden from the underlying data, only from this specific "what should an
  operator pick from today" view. A historical query must use
  `resolveStoreAsOf`/`store_getById` directly, which always resolves an
  inactive store's attributes regardless of its current status.
- `store_resolveIdByCurrentName(storeName)` — exact-match-only lookup from
  a name (as known *today*) to a Store ID; used by the Input Portal
  submission path (still name-based on the client) and by the duplicate-
  detection fallback below.

All mutating functions check `sl_isAdmin()` as their first statement,
server-side — the same double-gate pattern as Phase 1A (`store_*` and the
underlying `cfg_*` call it independently), never trusting a client-supplied
role/admin field (there is no such field read anywhere in this path).

### MASTER_LOG: additive Store ID column, no schema rewrite

`INPUT_PORTAL.gs` gained one new column, `I = Store ID` (`COL_STORE_ID`),
written alongside the existing `C = Store` name column — the name column is
kept exactly as-is for backward compatibility and legacy rows. At
submission time, `processSubmissionAsync()` resolves
`store_resolveIdByCurrentName(payload.store)` **inside** the lock; if
`CONFIG_STORES` has no matching entry yet (i.e. migration hasn't run in
this environment), the resolution returns `null`, the Store ID column is
written blank, and the system behaves exactly as Phase 0.5 did — this
means Phase 1B ships with **zero behavior change** for any environment
where `store_migrateFromSettings()`/`store_create()` has never been run.

### Duplicate-visitor handling: partial-accept (supersedes Phase 0.5)

Phase 0.5 blocked a whole submission if *any* visitor on it was already
recorded. Phase 1B changes this to **partial acceptance**: duplicate
identity is (Store ID, falling back to Store Name if no ID resolves) +
Visitor + calendar date, evaluated **per individual visitor**. Already-
recorded visitors are silently excluded from the row written; genuinely
new visitors on the same submission are still recorded. If literally every
submitted visitor was already recorded, the submission still returns
`success:true, allDuplicates:true` with no row written — this was never
treated as an error condition, just a no-op.

The lookup (`_findRecordedVisitors()`) still runs inside the same
LockService critical section Phase 0.5 established, with the same
validate → lock → re-read MASTER_LOG → decide → write → release ordering
— only the *decision* logic changed (from "any match blocks everything" to
"match per visitor, split new vs. already-recorded"). It reads the whole
log via `getLastRow()`/`getRange()` on every call — there is no fixed
row-range constant in this path, verified at up to 10,000 fixture rows (see
Store ID + scale tests below) with the target duplicate row deliberately
placed last, the position a reintroduced ceiling would most likely miss.

### Migration + UNMAPPED tracking

`store_migrateFromSettings(settingsStores, masterLogRows)` is a one-time,
admin-gated, per-environment operation (not something designed to be run
repeatedly against the same data): it mints a Store ID for every current
`SETTINGS` store, effective from the *earliest* MASTER_LOG visit date found
for that name (or today, if none) — never an invented date — and maps
historical MASTER_LOG Store-Name references to those IDs **only on an
exact normalized-name match**. Anything that doesn't match exactly (a
typo, a since-renamed store not in current `SETTINGS`, anything even
subtly different) is never guessed: it's recorded via
`store_recordUnmapped()` into a new `CONFIG_UNMAPPED_STORES` sheet — one
row per *distinct* unmapped name (not per MASTER_LOG row, since a name is
very likely to repeat at real data scale), tracking occurrence count and
first/last-seen dates, with the original name text preserved unaltered.
`store_reconcileUnmapped(unmappedId, resolvedStoreId, notes)` is the one
safe mutation this data model supports today — marking an entry
`RECONCILED` with who decided what and why. It deliberately does **not**
retroactively rewrite any MASTER_LOG row or create a backfill; that is a
separate, later, deliberate operation, not an automatic side effect. A
full reconciliation UI is out of this phase's scope.

### Reporting Year vs. Configuration Version vs. Report Snapshot Version

Three distinct concepts, not yet all built — worth keeping straight before
any future phase touches reporting:

- **Reporting Year** — which calendar year of MASTER_LOG data a report
  covers. Still hardcoded in several places (`DATA_YEAR`, `KPI_YEAR`, etc.
  — a pre-existing Phase 0 finding, unchanged by Phase 1B) and out of this
  phase's scope to fix.
- **Configuration Version** — what Phase 1A/1B actually versions: a
  specific effective-dated set of field values for one configuration
  entity (a store, a risk rule, etc.), identified by Version ID.
- **Report Snapshot Version** — NOT built in this phase. A future concept
  for freezing which configuration versions and which data were used to
  produce a specific historical report run, so that report can be
  regenerated identically later even after configuration has since
  changed. Phase 1B's resolvers (`resolveStoreAsOf`, etc.) are the
  building block this would need, but no snapshot mechanism exists yet.

### Tests

`tests/store-identity.test.js` (51 checks) — Store ID uniqueness/
row-independence/survives-rename/immutability-enforced/duplicate-ID-
rejected; historical attribute resolution (initial/future/before-on-after
a boundary/name+brand+region changes/inactive-store-still-resolvable);
operational visibility (active listed/inactive excluded/inactive still
historically resolvable); migration (unambiguous match/near-miss typo
never fuzzy-matched/no-SETTINGS-entry still tracked/reconciliation);
security (non-admin rejected on every mutation/spoofed payload field
ignored/Store-ID-retarget rejected even for an admin).

`tests/duplicate-prevention.test.js` (rewritten, 33 checks) — the four
worked examples from the partial-accept spec, different-Store-ID is never
a duplicate, different-date is never a duplicate, backward compatibility
with no `CONFIG_STORES` data at all, and both single- and multi-visitor
concurrency races.

`tests/store-scale.test.js` (20 checks, new) — 4,999 / 5,000 / 5,001 /
10,000 MASTER_LOG data rows, duplicate target row placed last, proving the
Store-ID-aware lookup still finds it (and still correctly records a
genuinely new visitor) at every size — no scan-range ceiling reintroduced.

`tests/submission-lock.test.js` (updated) — re-verified against the
rewritten `processSubmissionAsync()`, now loading `SVMKPI_CONFIG.gs`/
`SVMKPI_STORE_CONFIG.gs` into its sandbox alongside `INPUT_PORTAL.gs`.

---

## Phase 1C — reporting-year abstraction + year-neutral KPI/report APIs

Phase 1B made Store ID the authoritative store identity. Phase 1C does the
same kind of thing for the calendar: it removes `2026` as a hardcoded
business assumption from every live calculation and replaces it with an
explicit, runtime `year` parameter, backed by a small centralized service
that discovers "which years actually have data" straight from `MASTER_LOG`.

### Reporting Year, precisely

**Reporting Year** is the calendar year a report/query is computed for.
For this phase it's always derived directly from an event's own **Event
Date** (the Date Visited on a MASTER_LOG row) — there is no fiscal-year
logic, and no change to the calendar-period cadence rules themselves (that
redesign, if it ever happens, is a separate later phase).

This is one of four related-but-distinct concepts in this project now; the
others are:

- **Configuration Version** (Phase 1A/1B) — a specific effective-dated set
  of field values for one configuration entity (a store, a risk rule,
  etc.), identified by Version ID. A report for Reporting Year 2026 can
  still consume whichever Configuration Version was effective at each
  event's own date — Phase 1C doesn't change how configuration is
  selected; it only makes the YEAR the calculation runs for explicit.
  Actually *consuming* configuration versions inside KPI/risk/compliance
  math is Phase 1D's job, not done here.
- **Report Snapshot Version** — NOT built yet. A future concept for
  freezing which configuration versions and which data produced a specific
  historical report run, so it can be reproduced identically later even
  after configuration/data have since changed. Phase 1C's year-neutral
  resolvers are the building block a snapshot mechanism would need, but no
  freezing/snapshot-version/report-archival behavior exists yet — nothing
  in this project is a "frozen historical report" as of this phase.

### The reporting-year service (`SVMKPI_REPORTING_YEAR.gs`, new)

One centralized place for "which years exist" and "is this a valid year" —
every other module calls into it rather than re-deriving/parsing years on
its own:

- **`getAvailableReportingYears()`** — scans `MASTER_LOG`'s Date Visited
  column via the existing `_parseDateCell()` and returns the DISTINCT
  calendar years found among valid, parseable dates, **ascending**
  (`[2026, 2027, 2029]`). Never invents a year that falls between two years
  that do have data (2026+2029 present but no 2028 rows → `[2026, 2029]`,
  never `[2026, 2027, 2028, 2029]`). Malformed/blank dates are silently
  skipped, matching every other date-handling path in this project.
  Missing/empty `MASTER_LOG` returns `[]` rather than throwing.
  **Ordering note for a future UI dropdown:** this function's own contract
  is always ascending; a caller wanting "latest first" reverses the array
  itself (`.slice().reverse()`) rather than this function changing its
  contract per-caller.
- **`normalizeReportingYear(year)`** — accepts a numeric year (`2026`) or
  an equivalent numeric string (`"2026"`) and returns a plain integer;
  anything else (`null`, `undefined`, `"hello"`, `"20XX"`, a decimal like
  `2026.5`, an out-of-[1900,2999]-range value) returns `null`. Never
  silently coerces or floors an unrelated value into a year.
- **`validateReportingYear(year)`** — `true` iff `normalizeReportingYear`
  would succeed.
- **`getDefaultReportingYear()`** — the year used whenever a caller omits
  one explicitly: the LATEST year in `getAvailableReportingYears()`, or
  (only if `MASTER_LOG` has no valid dates at all) today's real calendar
  year. This is the one deliberate policy choice Phase 1C had to make (spec
  §13's "acceptable defaults" list) — documented here rather than left
  implicit, and re-derived from live data every call, so an omitted year
  can never keep secretly meaning `2026` just because an old constant said
  so.

### DATA_YEAR / KPI_YEAR: no longer authoritative

`DATA_YEAR` (`SVMKPI_CORE.gs`) still exists as a literal `2026`, but as of
this phase **nothing in the live calculation path reads it directly**.
`KPI_YEAR` never existed as a separate top-level constant — it was always
a local alias for `DATA_YEAR` inside `buildKPI2026()`, and that local is
now the resolved `year` parameter instead. An explicitly-requested year is
never overridden by either constant; the only thing `DATA_YEAR` still
affects is `debugConstants()`'s log line and the long-dead, never-called
`_countIfs()` helper (see "Hardcoded-year inventory" below) — nothing a
real user-facing calculation depends on.

### Year-neutral KPI/report functions

Every function below now takes an **explicit, optional `year` parameter**,
defaulting to `getDefaultReportingYear()` — the SAME implementation runs
for any year; only the event population it counts changes:

| Function | File | What changed |
|---|---|---|
| `_computeStoreRisk(data, today, year)` | `SVMKPI_RISK.gs` | YTD/monthly-purpose scoring now scoped to `year`; compliance (days-since-visit vs. cadence) was always year-independent and is untouched |
| `populateRiskEngine(sheet, data, year)` / `refreshRiskEngine(year)` | `SVMKPI_RISK.gs` | thread `year` down to `_computeStoreRisk()` |
| `sl_getComplianceGaps(brandFilter, monthNumber, reportingYear)` | `SVMKPI_STORE_LOOKUP.gs` | month/quarter/6-month windows anchor to `reportingYear` instead of `DATA_YEAR` |
| `buildKPI2026(year)` / `_kpiSheetName(year)` | `SVMKPI_KPI_REBUILD.gs` | rebuilds the `"KPI <year>"` sheet for any requested year — reuses/renames the ONE sheet, doesn't keep multiple years' sheets alive at once |
| `getKPI2026Report(year)` | `SVMKPI_REPORTS.gs` | reads the `year`-named sheet; week labels (`_weekRanges(year, month)`) and the response's `year` field both follow the parameter |
| `buildExecutiveSummaryLayout(year)` | `SVMKPI_LAYOUT.gs` | the title cell and the two year-bound formula groups (Monthly by Brand, Brand Performance peak month) use `year` |
| `sl_getDataYear()` | `SVMKPI_CORE.gs` | now returns `getDefaultReportingYear()` instead of the `DATA_YEAR` literal — same name/contract, real data-driven answer |

**Naming note:** `buildKPI2026`/`getKPI2026Report`/`_kpiSheetName` keep
their historical names rather than being renamed to something like
`buildKPIReport`/`getKPIReport` — renaming would mean touching every menu
item, portal button, and `SVMI_PORTAL.html` call site that already
references them by name, which is a larger, unrelated change than this
phase calls for. What matters per the phase's own framing ("the underlying
implementation itself must become year-neutral, not a thin wrapper hiding
a hardcoded implementation") is satisfied: there is exactly ONE
implementation per function, parameterized, not a wrapper-per-year.

None of this touches the actual KPI/risk/compliance business rules
themselves — weights, thresholds, cadence windows, purpose scores, and the
Store-ID/Store-Name identity model (Phase 1B) are all unchanged. The only
behavior change is that the calculation can now be explicitly told which
year to run for.

### Default-year behavior

Before this phase, every calculation implicitly meant "whatever
`DATA_YEAR` says" — effectively always `2026` until someone remembered to
bump it. As of Phase 1C: omitting `year` anywhere in the table above means
"the latest year actually present in `MASTER_LOG`" (`getDefaultReportingYear()`),
falling back only to today's real calendar year if `MASTER_LOG` has no
valid dates at all. This was chosen as the least-disruptive option from
the spec's own acceptable list — it reproduces today's fixture/live-data
behavior exactly (currently `2026`) while auto-advancing once next year's
data exists, with no code change required.

### UI year-selector contract

`getAvailableReportingYears()` is client-callable via `google.script.run`,
giving the UI everything it needs to eventually populate a reporting-year
picker: an ascending, deduplicated array straight from live data. No
frontend selector was added in this phase — neither `SVMI_PORTAL.html` nor
the Demo previously had one, and adding a new picker control would be a UI
addition beyond "establish the backend contract" (the phase's own scope
boundary explicitly discourages a UI redesign here). The Demo's
`SVMI_Command_Center_Demo.html` also keeps its own self-contained,
hardcoded-2026 sample dataset untouched — it's a synthetic in-memory
preview environment with no real `MASTER_LOG`, closer to a worked example
than live backend code.

### Hardcoded-year inventory (what was found, what changed)

- `SVMKPI_CORE.gs`'s `DATA_YEAR = 2026` — kept as a legacy constant (no
  longer read by any live calculation); `sl_getDataYear()` now delegates
  to `getDefaultReportingYear()`.
- `SVMKPI_CORE.gs`'s `_countIfs()` still reads `DATA_YEAR` directly — this
  function is dead code (confirmed via a full-project grep: it's never
  called anywhere, a leftover from the removed `populate*` engine) and was
  left untouched rather than refactoring code with zero runtime effect.
- `SVMKPI_KPI_REBUILD.gs` (`KPI_YEAR` local alias, `_kpiSheetName()`),
  `SVMKPI_REPORTS.gs` (`getKPI2026Report()`), `SVMKPI_RISK.gs`
  (`evaluationYear`), `SVMKPI_STORE_LOOKUP.gs`
  (`sl_getComplianceGaps()`'s window boundaries), `SVMKPI_LAYOUT.gs`
  (`buildTitle()`, `_buildESFormulas()`'s Monthly-by-Brand and Brand
  Performance peak-month formulas) — all converted from reading `DATA_YEAR`
  directly to an explicit `year` parameter, per the table above.
- `sl_getVisitedThisMonth()`/`sl_getUnvisitedThisMonth()`
  (`SVMKPI_STORE_LOOKUP.gs`) were NOT touched — they were never
  `DATA_YEAR`-hardcoded to begin with; they already compute "this calendar
  month" from `new Date()` directly, a genuinely different (and
  year-agnostic-by-design) concept from a selectable reporting year.
- `SVMI_Command_Center_Demo.html`'s several `DATA_YEAR = 2026`/`year = 2026`
  copies are its own self-contained synthetic sample dataset (documentation/
  example tier, not live backend code) and were left as-is.
- Literal `"2026"` occurrences in comments, menu-item labels ("Rebuild KPI
  2026"), and confirmation-dialog text are cosmetic display strings, not
  wired to any runtime year value — left as familiar labels.

### Store ID compatibility

Phase 1B made Store ID the authoritative store identity for `CONFIG_STORES`
and added a Store ID column to `MASTER_LOG`, but explicitly did NOT rewrite
the pre-existing risk/compliance engines (`_computeStoreRisk()`,
`sl_getComplianceGaps()`) — those still group by Store NAME, a
characteristic that predates Phase 1B and was a deliberate scope boundary
("do not rewrite the risk engine"). Phase 1C's year-neutrality change is
orthogonal to store identity entirely: it doesn't touch how either function
keys its per-store map, and does nothing to regress Phase 1B's Store ID
column or `INPUT_PORTAL.gs`'s duplicate-detection Store ID resolution,
which remain fully intact. Converting Risk/Compliance to a Store-ID-keyed
model is real future work (Phase 1D territory: "risk configuration
consumption," "compliance configuration consumption"), not something this
phase does.

### Tests

`tests/reporting-year.test.js` (57 checks, new) — year discovery (one/
multiple/nonconsecutive years, duplicate events collapsing to one entry,
empty/missing `MASTER_LOG`, malformed dates, the `2026-12-31`/`2027-01-01`
boundary), year validation/normalization (numeric, string, invalid string,
`null`, `undefined`, decimal, out-of-range, object), default-year
resolution (latest-available vs. empty-log fallback), year-neutral
`_computeStoreRisk()` across 2026/2027/2028 fixtures, cross-year isolation
for both `_computeStoreRisk()` and `sl_getComplianceGaps()` (a 2026 event
never counts toward a 2027 report and vice versa), `buildKPI2026(year)`/
`getKPI2026Report(year)`/`_kpiSheetName(year)` for two different explicit
years, a hand-computed 2026 regression check (exact `basePurposeScore`/
`activeFailedPenalty`/`purposeScore` values, not just "a result exists"),
and a 9,000-row multi-year scale fixture proving discovery/filtering never
reintroduces a row-count ceiling.

Six pre-existing test files (`risk-scoring.test.js`,
`store-remove-history.test.js`, `roster-auto-refresh.test.js`,
`kpi-roster-history.test.js`, `canonical-risk-engine.test.js`,
`store-lookup-date-handling.test.js`) needed a one-line update each — a
`getDefaultReportingYear` stub (or, for the two that already load real
`SVMKPI_CORE.gs` against a working `MASTER_LOG` mock, the real
`SVMKPI_REPORTING_YEAR.gs` service) — since `_computeStoreRisk()`/
`buildKPI2026()`/`sl_getComplianceGaps()` now call it when no year is
passed. Every one of those files' existing assertions pass completely
unchanged otherwise — this is the "2026 regression comparison" the phase
explicitly asked for: the refactored implementation produces the exact
same output for the exact same 2026 fixtures.

Full suite after Phase 1C: **523/523** unit checks (14 files) + **66/66**
responsive-layout checks, zero regressions.

---

## Phase 1D — versioned Risk + Compliance + KPI configuration + calendar cadence

Phase 1C made the reporting YEAR explicit and configuration-driven-in-
spirit. Phase 1D makes the actual business RULES — risk thresholds/
weights, compliance cadence, KPI weights/targets, Purpose behavior —
genuinely configurable and historically reproducible through Phase 1A's
versioning engine, **without rewriting any existing calculation
algorithm**. Every new resolver falls back to the exact pre-Phase-1D
hardcoded constant whenever no configuration version has been created
yet, so this phase ships with **zero behavior change** until an admin
actually creates a CONFIG_RISK/CONFIG_COMPLIANCE/CONFIG_KPI/CONFIG_PURPOSES
version.

### Calendar-period model (`SVMKPI_CALENDAR.gs`, new)

SVMI's compliance cadence is CALENDAR periods (month/quarter/half-year),
never a rolling N-day window — `resolveCalendarPeriod(date, periodFamily)`
is the one centralized resolver every other module calls into. Only the
three families the app's existing behavior actually needs are implemented:

| Family | Example | Boundaries |
|---|---|---|
| `MONTH` | September 2026 | 1st → last day of that calendar month |
| `QUARTER` | Q3 2026 | 1st day of quarter → last day of quarter |
| `SEMI_ANNUAL` | H2 2026 | Jul 1 → Dec 31 (calendar half-year) |

Returns `{periodId, periodStart, periodEnd, year}`, or `null` for an
invalid date or an unrecognized family — never guesses.

**Behavior change from pre-Phase-1D**: the old "Flight Provincial" window
in `sl_getComplianceGaps()` (`SVMKPI_STORE_LOOKUP.gs`) was a ROLLING 6
calendar months ending at the reference month — itself a rolling-window
model, the same category of thing Phase 1D's business decision rules out.
It is now the calendar half-year (Jan–Jun / Jul–Dec) containing the
reference month. No existing test asserted the old rolling window, so
this was a safe, deliberate change — not an accidental regression.

### Period-to-date compliance

`sl_getComplianceGaps(brandFilter, monthNumber, reportingYear,
evaluationDateStr)` (Phase 1D's 4th parameter) now evaluates
**period-to-date**: for the calendar period containing the reference
month, qualifying MASTER_LOG activity is counted from the period's START
through the **evaluation date** — never past it, even if the period
itself hasn't finished yet.

```
Evaluation date: 2026-09-18
2026-09-05 → included    2026-09-17 → included
2026-09-18 → included    2026-09-19 → EXCLUDED (after the evaluation date)
```

**Default evaluation-date behavior** (documented, never silent): if
`evaluationDateStr` is omitted —
- a SPECIFIC month/year WAS requested → defaults to that period's own
  END (evaluates it as fully elapsed — this exactly reproduces every
  pre-Phase-1D call's behavior, since none of them clipped to "today" at
  all);
- NO month/year was requested either (a genuinely "current period, right
  now" query) → defaults to today.

An explicit historical `evaluationDateStr` never gets silently replaced
by today's date.

### Compliance configuration (`SVMKPI_COMPLIANCE_CONFIG.gs`, new)

`CONFIG_COMPLIANCE`'s Entity ID is CATEGORY (e.g. `NCR`, `FAR PROVINCIAL`)
— cadence is genuinely a per-category rule in the existing app, not a
per-store one. Two new/newly-real fields:

- **`periodDefinition`** — Phase 1A left this an unused placeholder; it's
  now populated automatically (never independently hand-edited) from
  `cadenceType` via `_cal_familyFromCadenceType()`, so the two columns
  can never drift apart.
- **`requiredCount`** — how many qualifying visits the period requires
  (the spec's own worked example: "2026 = 1 visit/period, 2027 = 2
  visits/period"). Optional; defaults to 1 (the existing "at least one
  visit" behavior) when blank.

`cmp_getCadenceDays(category, dateRef)` is a drop-in, config-driven
replacement for the old `_sl_getCadenceDays()` lookup table — same "0 =
unrecognized" contract — used by the risk engine's own (unchanged)
rolling-day compliance check (see "Risk configuration" below). Falls back
to `CMP_DEFAULT_RULES` (copied exactly from the old hardcoded
`RISK_CADENCE` map and `sl_getComplianceGaps()`'s old category branches)
when no CONFIG_COMPLIANCE version exists.

### Risk configuration (`SVMKPI_RISK_CONFIG.gs`, new)

Connects the EXISTING canonical `_computeStoreRisk()` (`SVMKPI_RISK.gs`)
— unchanged algorithm — to versioned thresholds and per-purpose weights.
No second risk engine was created.

- `resolveRiskConfigurationAsOf(dateStr)` — `lowThreshold`/
  `mediumThreshold`/`highThreshold`, replacing `_sl_riskTier()`'s hardcoded
  5/10 cutoffs. Global (Entity ID = `DEFAULT`) — there is no per-store
  dimension in the existing risk algorithm, so this resolver deliberately
  takes no `storeId` (inventing an unused parameter would misrepresent
  behavior that doesn't exist).
- `risk_resolvePurposeWeight(purposeName, dateStr)` — the one genuinely
  per-entity dimension, resolved via a documented 3-step fallback chain:
  1. `CONFIG_PURPOSES.riskWeight` for that purpose (deliberate, Phase 1D's
     no-inheritance path — see "Purpose configuration" below);
  2. `CONFIG_RISK`'s matching legacy named field (`weightFailedQaMs`
     etc. — the pre-existing 4-field shape from Phase 1A's schema);
  3. `RISK_PURPOSE_SCORE`'s hardcoded constant (`SVMKPI_RISK.gs`) — the
     ultimate fallback pre-migration.
  A purpose with none of the three returns `null` — no weight at all,
  never a different purpose's number.

`_sl_computeMonthlyPurposeScores(monthBuckets, monthLimit, dateRef)`
resolves each purpose's weight ONCE per call, as of the overall evaluation
date — not re-resolved per historical month within the same YTD roll-up.
**Documented limitation**: the existing `monthBuckets` aggregation already
collapses individual events into per-month counts before scoring ever
sees them, so true per-EVENT historical weight resolution (a visit
counted under whichever weight was effective on ITS OWN date, even within
one YTD calculation spanning a rule change) isn't achievable without
restructuring that aggregation — out of this phase's scope (connect
existing algorithm to config, not redesign it).

### KPI weight/target configuration (`SVMKPI_KPI_CONFIG.gs`, new) — a documented gap

**No KPI weight/target/scoring algorithm exists anywhere in the current
app** — `buildKPI2026()`/`getKPI2026Report()` are a pure visit-count
tracker (confirmed absent since the original Phase 0 audit and Phase 1A's
own schema comment). Per Phase 1D's own "no business-rule invention"
constraint, this file builds ONLY the configuration storage/validation/
effective-dated-resolution layer — `kpi_create`/`kpi_update`/
`resolveKPIConfigurationAsOf(kpiId, dateStr)` — and does **not** wire a
weight or target into any live calculation, because none exists to
consume one. `buildKPI2026()`/`getKPI2026Report()` remain completely
untouched by this file's existence (verified directly: the same tracker
produces identical results for 2026/2027/2028 whether or not a CONFIG_KPI
row exists).

Validation discovered from the (nonexistent) consuming algorithm, so kept
deliberately generic rather than invented: `weight` must be numeric (no
"must sum to 100" rule — nothing requires that); `targetType` is one of
`NUMERIC`/`PERCENTAGE`/`COUNT` (a minimal closed set covering plausible
future needs, not a fabricated meaning for any specific KPI); a
`PERCENTAGE` target must be 0–100.

### Purpose configuration dependencies (`SVMKPI_PURPOSE_CONFIG.gs`, new)

Creating a new Purpose (a `CONFIG_PURPOSES` version) does **not**
automatically give it KPI or risk behavior.
`purpose_getConfigurationStatus(purposeName, dateStr)` distinguishes:

- **`exists`** — a resolvable `CONFIG_PURPOSES` version, OR (backward
  compatibility) membership in the 4 original `APPROVED_PURPOSES`
  (`SVMKPI_CORE.gs`), which have always been usable without ever needing
  a `CONFIG_PURPOSES` row.
- **`active`** — same as `exists` today; there's no separate "exists but
  inactive" state beyond the envelope's own ACTIVE/INACTIVE lifecycle,
  which resolution already filters on.
- **`hasKpiConfig`** — any `CONFIG_KPI` version's `purposeRef` (as of the
  date) names this purpose. Purely structural (a config row exists), not
  "is being applied in a calculation" — see the KPI section above.
- **`hasRiskConfig`** — `risk_resolvePurposeWeight(...) !== null`. The 4
  legacy purposes report `true` here via the hardcoded/legacy fallback
  chain (they genuinely do have risk configuration, just not a deliberate
  `CONFIG_PURPOSES.riskWeight`); a brand-new purpose reports `false` until
  one is deliberately set.
- **`valid`**/**`incomplete`** — `valid` requires exists + both configs
  present; `incomplete` is `exists` without both. A purpose is never
  silently upgraded from incomplete to valid.

No automatic inheritance anywhere: creating "Purpose #5" never copies
Purpose #1–4's weights, targets, or any other configuration.

### Store ID as the configuration-resolution identity

Neither `CONFIG_RISK` (global singleton) nor `CONFIG_COMPLIANCE` (keyed by
Category) was ever Store-Name-keyed — the Phase 1D requirement is about
the RESOLUTION PATH: `resolveComplianceConfigurationAsOf(storeId, dateStr)`
resolves the store's CATEGORY as of that date via Phase 1B's
`resolveStoreAsOf()` FIRST (a store's category is itself effective-dated
and can change over time), then resolves that category's rule — Store
Name is never consulted anywhere in the chain. `sl_getComplianceGaps()`
resolves each store's rule via `store_resolveIdByCurrentName()` → Store
ID → `resolveComplianceConfigurationAsOf()`, falling back to a raw
SETTINGS category lookup only when the Store ID doesn't resolve yet
(same graceful-degradation pattern Phase 1B established).

### Historical configuration resolution + effective-date/backdate handling

Every new resolver follows the same Phase 1A pattern: `entity/rule + date
→ applicable configuration version`, never "the current active rule."
Immediate (`Effective From = today`) and future-dated changes are allowed
outright; a backdated change (`Effective From < today`) requires
`options.backdateConfirmed === true` AND a non-empty reason, or is
rejected with `requiresBackdateConfirmation: true` — identical to Phase
1A's existing contract, reused as-is (no second backdate-handling
mechanism was built).

### Audit + rollback

Every successful Risk/Compliance/KPI/Purpose mutation writes one
append-only `CONFIG_AUDIT` row via Phase 1A's existing
`cfg_createConfiguration()`/`_cfg_writeAudit()` — actor, area, entity,
action, previous/new value snapshot, effective dates, reason, version. A
backdated mutation's reason is exactly what a human typed (the same "why"
Phase 1A already captures); nothing here adds a second audit mechanism.
`risk_rollback()`/`cmp_rollback()`/`kpi_rollback()`/`purpose_rollback()`
are thin wrappers over Phase 1A's existing `cfg_rollbackConfiguration()`
— restoring an old version creates a NEW version (never edits or deletes
history), and both the new version's Reason field and its audit entry
name which version was restored.

### Reporting Year vs. Configuration Version — not interchangeable

Phase 1C's Reporting Year answers "which year's event population is being
reported." Configuration effective date answers "which business rules
were applicable at the relevant calculation date." **A reporting year
never automatically selects one configuration version for the whole
year** — a risk-threshold or compliance-requirement change can land in
the MIDDLE of a reporting year, and every resolver here takes an explicit
date (not a year) for exactly that reason. `resolveRiskConfigurationAsOf`/
`resolveComplianceConfigurationAsOf`/`resolveKPIConfigurationAsOf` all
accept a specific calculation/evaluation DATE, never a bare year — an
operational/current calculation uses whatever is effective on today's
date; a historical calculation uses whatever was effective on the
historical date being evaluated. Current configuration is never silently
substituted for historical configuration, or vice versa.

**Report Snapshot Version remains deferred to Phase 1E.** This phase
establishes correct DYNAMIC configuration resolution (ask "what applied
on date D" and get the right answer, every time, computed fresh) — it
does NOT freeze/finalize any report's result. Nothing in SVMI is a
"frozen historical report" as of Phase 1D; re-running the same query
against the same date always re-resolves configuration live. Freezing
that answer into an immutable, retrievable snapshot is Phase 1E's job.

### Tests

`tests/calendar-period.test.js` (25 checks, new) — MONTH/QUARTER/
SEMI_ANNUAL first/middle/last day, period transitions, leap-year
boundaries, invalid period definitions, historical/future evaluation
dates.

`tests/compliance-config.test.js` (42 checks, new) — period-to-date
compliant/insufficient/excludes-after-evaluation-date, the spec's own
2026=1-visit/2027=2-visits worked example, future rule non-interference,
effective-date boundaries, inactive/overlapping/missing configuration,
Store ID resolution (category changes over time, Store Name changes and
lookalike names don't break identity, Store ID stability), security
(non-admin, spoofed payload fields, no audit-success on invalid input),
backdating, rollback, and a 5,200-row multi-year/multi-store scale
fixture.

`tests/risk-config.test.js` (33 checks, new) — unchanged output under
default config, configured threshold/weight changes taking effect,
historical/future configuration resolution (the spec's 2026=A/2027=B risk
example), backdating, rollback, confirmation that no second risk engine
exists, the full purpose-weight fallback chain, and security.

`tests/kpi-purpose-config.test.js` (44 checks, new) — KPI creation/
validation (weight/targetType/PERCENTAGE-range)/historical resolution/no
duplicates/missing-configuration safety, the visit-count tracker proven
untouched across 2026/2027/2028, Purpose exists/active/hasKpiConfig/
hasRiskConfig for both a legacy and a brand-new purpose, deliberate KPI
and risk configuration, no-inheritance between two independently-created
purposes, and security for both services.

`tests/store-lookup-date-handling.test.js` and `tests/reporting-year.test.js`
were updated (each now also loads `SVMKPI_CALENDAR.gs` and, where they
exercise `sl_getComplianceGaps()`, `SVMKPI_COMPLIANCE_CONFIG.gs`) — every
pre-existing assertion in both still passes unchanged.

Full suite after Phase 1D: **667/667** unit checks (18 files) + **66/66**
responsive-layout checks, zero regressions.

---

## Phase 1E — historical report snapshots + per-year report sheets

**Files:** new `Apps Script/SVMKPI_REPORT_SNAPSHOT.gs`; new
`tests/report-snapshot.test.js` (89 checks); additive-only changes to
`Apps Script/SVMKPI_CONFIG.gs` (two new `CFG_ACTION` values —
`FINALIZE`/`SUPERSEDE` — and a `CFG_AREA.REPORT` audit tag; nothing
existing changed shape).

**The core rule:** a finalized historical report must never silently
change because configuration or source data changes later. Two distinct
modes:

- **DRAFT** — `getDraftReport(year, evaluationDateStr)`. Always a fresh,
  dynamic calculation using whatever configuration/data currently
  applies as of `evaluationDate`. Never persisted. Viewing it never
  finalizes anything.
- **FINALIZED** — a persisted, immutable `REPORT_SNAPSHOTS` row. Every
  retrieval API (`getReportSnapshot()`, `getReportSnapshotByVersion()`,
  `getLatestFinalizedReportSnapshot()`) reads the stored frozen result —
  **none of them ever recalculate**.

**What "the existing report engine" means here** (inspected before
writing anything): `_computeStoreRisk(data, evaluationDate, year)`
(`SVMKPI_RISK.gs`) is a pure function with no sheet writes and already
takes an explicit evaluation date — called directly, never through
`populateRiskEngine()`/`refreshRiskEngine()` (which hardcode `new
Date()` and write to the live STORE HEALTH sheet). `sl_getComplianceGaps
(null, null, year, evaluationDateStr)` (`SVMKPI_STORE_LOOKUP.gs`) is
already a pure, evaluation-date-aware reader (Phase 1D) and is called
as-is. Neither has any side effect on a live presentation sheet.
Executive Summary / KPI 2026 have **no** pure-calculation equivalent —
they are native Sheets formulas written into the ONE shared
`EXECUTIVE SUMMARY`/`KPI <year>` sheet. Rebuilding those as a side
effect of finalizing a report would be a surprising mutation of a
shared, cross-year sheet, and neither value is configuration-sensitive
anyway (both are raw MASTER_LOG event counts, untouched by Risk/
Compliance/KPI configuration). So: if that year's sheets already exist
(built through the normal, pre-existing "Rebuild Dashboard"/"Rebuild
KPI" workflow), their current values are read read-only and frozen in;
if not, the snapshot's `executiveSummary`/`kpi` sections are `null` with
an explanatory note. This is the one documented scope limitation of this
phase.

**Report Snapshot entity** (`REPORT_SNAPSHOTS` sheet, explicit headers,
never a row-number identity): Snapshot ID (`REPORT-<year>-v<n>`, e.g.
`REPORT-2026-v1` — same `AREA-ENTITY-vN` convention as every `CONFIG_*`
version ID), Reporting Year, Snapshot Version (sequential **per
reporting year**, never one global counter — 2027's counter starts at 1
independently of how many versions 2026 has), Status
(`FINALIZED`/`SUPERSEDED`; `DRAFT` exists in the enum for schema
completeness but no production code path ever writes it — see below),
Created/Finalized At + By, Evaluation Date, Reason, Supersedes Snapshot
ID, Calculation Timestamp, Configuration Provenance (typed where
possible — Risk Config Version ID/Source; a narrow per-category JSON
list for Compliance, since compliance genuinely resolves multiple
versions, never pretended to be one; a documented text note for KPI/
Purpose/Store, where "one version for the whole report" isn't a
meaningful concept), and the frozen Result (JSON — the one place a
serialized blob is used, the same precedent `CONFIG_AUDIT`'s own
Previous/New Value columns already established for exactly this kind of
computed, read-only artifact; still fully PostgreSQL-migration-friendly
as a `jsonb` column).

**Why this does NOT reuse `cfg_createConfiguration()`:** that function
models configuration effective-dating and an ACTIVE/INACTIVE envelope —
neither fits a report snapshot's evaluation date (a different concept
from "effective from") or its DRAFT/FINALIZED/SUPERSEDED status model,
and it has no mechanism to enforce "at most one FINALIZED snapshot per
year." `SVMKPI_REPORT_SNAPSHOT.gs` is its own small, dedicated,
LockService-protected persistence routine that borrows
`cfg_createConfiguration()`'s naming convention, its audit sheet/writer
(`_cfg_writeAudit()`/`cfg_getAuditLog()`, reused exactly — see Audit
below), and its admin gate (`sl_isAdmin()`) — without overloading that
function's parameters to mean something they don't.

**Finalization** — `finalizeReport(year, evaluationDateStr, reason,
options)`. Validates admin + year + evaluation date + a mandatory
reason; calculates via the engines above (a calculation failure creates
no snapshot); rejects a genuinely empty year (item 34 — no stores AND no
visit history at all; a year with real stores but zero visits is still
legitimate, reportable data, e.g. "every store is a compliance gap," and
is NOT rejected); only succeeds if no FINALIZED snapshot already exists
for that year (a second finalize attempt is rejected and told to use
`supersedeReportSnapshot()` instead — there is no other way to create
version 2+ for a year).

**Correction / supersession** — `supersedeReportSnapshot(year,
previousSnapshotId, evaluationDateStr, reason, options)`. Requires a
correction reason; verifies the previous snapshot is currently
FINALIZED (re-verified fresh, INSIDE the lock — see Concurrency);
creates the next version FINALIZED, flips **only** the previous
snapshot's Status cell to SUPERSEDED (its Result JSON and every other
column are never touched again), and writes one audit entry recording
the old→new relationship. The old snapshot's frozen result remains
retrievable forever via `getReportSnapshot()`/`getReportSnapshotByVersion()`.

**Immutability:** there is no `updateSnapshot()`/generic mutator
anywhere in this file. The only way a FINALIZED snapshot's status ever
changes after creation is the supersession flow above flipping the
*previous* one to SUPERSEDED — never its own fields, and never any
finalized snapshot's Result JSON, ever.

**Concurrency:** both `finalizeReport()` and `supersedeReportSnapshot()`
follow validate → calculate → acquire `LockService.getScriptLock()` →
**re-read** existing snapshots for that year → decide (no-existing-
finalized / previous-is-finalized) → allocate the next version → persist
→ release lock. The decisive check is always a fresh read taken *after*
the lock is acquired, never a pre-lock read — this is what makes two
racing `finalizeReport()` calls for a brand-new year resolve to exactly
one success (the loser's fresh, in-lock read sees the winner's row
already there), and what makes two racing `supersedeReportSnapshot()`
calls against the same previous snapshot resolve to exactly one success
(the loser's fresh read sees the previous snapshot already flipped to
SUPERSEDED by the winner). Lock contention (`tryLock` fails) returns a
clean "server busy" failure with nothing persisted.

**Per-year report sheets** — `REPORT_<year>` (e.g. `REPORT_2026`), same
`_report_sheetName(year)`-style single-implementation convention as
`_kpiSheetName()`; never a `buildReport2026()`/`buildReport2027()` per
year. `regenerateReportSheet(year)` rebuilds it **entirely from
`getLatestFinalizedReportSnapshot(year)`'s stored result** — never from
live MASTER_LOG/CONFIG/store attributes, which is the direct proof that
snapshot storage, not the sheet, is the canonical frozen artifact (if
the sheet is deleted, regenerating it never recalculates anything).
Deliberately simple, values-only formatting — visual parity with
EXECUTIVE SUMMARY/STORE HEALTH's styling is explicitly out of scope for
this backend-infrastructure phase. The sheet always represents the
*latest* finalized snapshot (the same single-shared-sheet-per-concept
convention this project already uses for EXECUTIVE SUMMARY/KPI/STORE
HEALTH, rather than inventing one sheet per version) — every historical
version remains fully preserved and independently retrievable through
`REPORT_SNAPSHOTS` regardless of what the sheet currently shows.
`finalizeReport()`/`supersedeReportSnapshot()` call it automatically,
best-effort (a rendering hiccup never turns a successful finalize into a
reported failure — the logical snapshot is already durable by that
point).

**Reporting Year vs. Configuration Version vs. Snapshot Version — three
distinct concepts, never collapsed:** Reporting Year answers "which
year's event population." Configuration Version answers "which business
rule applied on a given date" (and a configuration change can land
mid-year — Phase 1D's own warning, still true here). Snapshot Version
answers "which frozen calculation of a report, for a given year, is
authoritative" — and it is **numbered independently of both**, sequential
per reporting year, never derived from a configuration version or a
calendar year's own number.

**Why Report Snapshot Version remained deferred until now:** Phase 1C's
own DEPLOY.md section named it as a third concept, distinct from
Reporting Year and Configuration Version, that Phase 1C/1D deliberately
did not build. This phase (1E) is that deferred piece — the backend
mechanism above is now complete. What's still genuinely out of scope,
deferred to Phase 1F: a snapshot-management UI, a rollback-to-a-prior-
snapshot UI, and a general report/configuration admin dashboard — only
the UI layer remains deferred, not any further backend concept.

**Tests** (`tests/report-snapshot.test.js`, 89 checks): basic
finalization + identity; a second finalize for an already-finalized
year is rejected; the mandatory historical-freeze scenario (finalize,
change risk config, retrieve v1 — byte-for-byte unchanged, provenance
included); draft-vs-finalized separation (same year/date, draft reflects
new config, finalized doesn't); full correction/supersession flow
(reason required, old snapshot unchanged + SUPERSEDED, new snapshot
FINALIZED + latest, both retrievable, audit records the relationship);
rejecting a supersede of an already-superseded/unknown snapshot; a
synthetic-DRAFT-row test proving "latest finalized" is never "highest
version number"; multi-year isolation (2026/2027/2028, same
implementation, no cross-year contamination, correct per-year sheet
names); configuration-provenance capture and its own freeze test;
security (non-admin, spoofed `isAdmin`/`role` in `options`, invalid
input, a calculation failure, and a simulated persistence failure — none
of these ever create a snapshot or an audit-success record); concurrency
(lock contention, two racing finalizes, two racing supersedes — always
exactly one winner, never a duplicate or lost version); the empty-year
safeguard (a truly empty year rejected; a year with real stores but zero
visits correctly accepted); and a 5,200+-row, multi-year, multi-store,
multi-config-version scale fixture (71ms).

Full suite after Phase 1E: **756/756** unit checks (19 files) + **66/66**
responsive-layout checks, zero regressions.

---

## Checks before you push

No linter, but three checks are worth running:

```bash
# every .gs file parses as valid JavaScript
for f in "SVMI_Project/Apps Script"/*.gs; do
  node -e "new Function(require('fs').readFileSync('$f','utf8'))" || echo "FAILED: $f"
done

# drive the standalone preview in a headless browser
node SVMI_Project/tests/portal-ui.test.js

# same preview across 6 device profiles - phone/tablet, portrait/landscape,
# desktop - checking touch-target sizing, no horizontal overflow, and that
# nothing (dropdowns, filter popovers) gets clipped off-screen
node SVMI_Project/tests/responsive-check.js

# unit tests for the Store Health scoring engine (SVMKPI_RISK.gs) — runs
# the REAL Apps Script code (not a mock) in a Node vm sandbox with
# SpreadsheetApp/SHEET/DATA_YEAR stubbed; no browser involved
node SVMI_Project/tests/risk-scoring.test.js

# same real-.gs-in-a-sandbox approach for buildKPI2026()/getKPI2026Report()
# (SVMKPI_KPI_REBUILD.gs/SVMKPI_REPORTS.gs) — covers the "removed roster
# member keeps their historical numbers" guarantee described above
node SVMI_Project/tests/kpi-roster-history.test.js

# covers the "adding a roster member rebuilds KPI 2026 automatically"
# guarantee (INPUT_PORTAL.gs's manageVisitor(), against a writable
# Sheet/Range mock shared with SVMKPI_KPI_REBUILD.gs/SVMKPI_REPORTS.gs)
node SVMI_Project/tests/roster-auto-refresh.test.js

# covers "Remove Store": portal_removeStore() only clears its own row's
# columns (never a same-row visitor/purpose entry), is admin-gated, and
# _computeStoreRisk() keeps a removed store's full history with its
# category degraded to "—" instead of dropping the store entirely
node SVMI_Project/tests/store-remove-history.test.js

# covers the risk-engine consolidation: Store Insights' single-store
# health card (sl_getStoreData()/_sl_computeCanonicalHealth(),
# SVMKPI_STORE_LOOKUP.gs) and the Store Health sheet
# (_computeStoreRisk(), SVMKPI_RISK.gs) must always agree on the exact
# same score/tier for the same store — they used to run two independent
# formulas that could silently disagree
node SVMI_Project/tests/canonical-risk-engine.test.js

# covers the LockService fix around processSubmissionAsync()'s MASTER_LOG
# write: a normal submission still succeeds and releases the lock;
# contention (tryLock fails) reports a clean "server busy" failure
# without writing anything; a write failure mid-lock still releases it
node SVMI_Project/tests/submission-lock.test.js

# covers _parseDateCell() (SVMKPI_CORE.gs), the one shared date parser
# that replaced three independent implementations, plus
# checkDuplicateVisit()'s integration with it
node SVMI_Project/tests/date-parsing.test.js

# Phase 0.5: covers the 7 SVMKPI_STORE_LOOKUP.gs date-handling call sites
# (sl_getStoreData()'s sort/last-visit/recent-visits, sl_getVisitedThisMonth(),
# sl_getUnvisitedThisMonth(), sl_getComplianceGaps()) now all going through
# _parseDateCell() — native Date, valid string, invalid string, and blank
# date, proving all four functions treat them identically
node SVMI_Project/tests/store-lookup-date-handling.test.js

# Phase 0.5: covers exact-duplicate blocking inside processSubmissionAsync()'s
# lock — exact duplicate rejected; same store+different visitor allowed;
# same store/visitor+different date allowed; different store+same
# visitor/date allowed; multi-visitor partial overlap blocked; and two
# submissions racing each other never both create the same visit
node SVMI_Project/tests/duplicate-prevention.test.js

# Phase 1A: covers SVMKPI_CONFIG.gs end-to-end — creation validation,
# effective-dating/resolution, versioning, audit, admin security,
# backdating, rollback, activate/deactivate, and portability (71 checks)
node SVMI_Project/tests/config-service.test.js

# Phase 1B: Store ID identity/immutability, historical attribute resolution,
# operational-vs-historical visibility, SETTINGS->Store ID migration +
# UNMAPPED tracking, and admin security on every store mutation (51 checks)
node SVMI_Project/tests/store-identity.test.js

# Phase 1B: 4,999/5,000/5,001/10,000-row MASTER_LOG fixtures proving the
# Store-ID-aware duplicate lookup never reintroduces a scan-range ceiling
node SVMI_Project/tests/store-scale.test.js

# Phase 1C: reporting-year discovery/validation/default resolution,
# year-neutral _computeStoreRisk()/sl_getComplianceGaps()/buildKPI2026()/
# getKPI2026Report() across 2026/2027/2028, cross-year isolation, a
# hand-computed 2026 regression check, and a 9,000-row multi-year scale
# fixture (57 checks)
node SVMI_Project/tests/reporting-year.test.js

# Phase 1D: resolveCalendarPeriod() — MONTH/QUARTER/SEMI_ANNUAL boundaries,
# transitions, leap years, invalid period definitions (25 checks)
node SVMI_Project/tests/calendar-period.test.js

# Phase 1D: versioned compliance configuration + period-to-date
# evaluation, Store ID resolution, security, 5,200-row scale fixture (42 checks)
node SVMI_Project/tests/compliance-config.test.js

# Phase 1D: versioned risk configuration feeding the unchanged canonical
# risk engine — thresholds, purpose-weight fallback chain, backdating,
# rollback, security (33 checks)
node SVMI_Project/tests/risk-config.test.js

# Phase 1D: versioned KPI weight/target configuration (infrastructure
# only — documented no-consumer gap) + deliberate Purpose KPI/risk
# configuration with no automatic inheritance (44 checks)
node SVMI_Project/tests/kpi-purpose-config.test.js

# Phase 1E: historical report snapshots — finalize/supersede, the
# historical-freeze + draft-vs-finalized + correction tests, per-year
# isolation, configuration provenance, security, concurrency (racing
# finalize/supersede calls), the empty-year safeguard, and a 5,200-row
# scale fixture (89 checks)
node SVMI_Project/tests/report-snapshot.test.js
```

The first two suites exercise the preview's in-memory sample data, not a
real spreadsheet — they catch UI/layout regressions, not data-correctness
issues. `risk-scoring.test.js`, `kpi-roster-history.test.js`,
`roster-auto-refresh.test.js`, `store-remove-history.test.js`,
`canonical-risk-engine.test.js`, `submission-lock.test.js`,
`date-parsing.test.js`, `store-lookup-date-handling.test.js`,
`duplicate-prevention.test.js`, `config-service.test.js`,
`store-identity.test.js`, `store-scale.test.js`,
`reporting-year.test.js`, `calendar-period.test.js`,
`compliance-config.test.js`, `risk-config.test.js`,
`kpi-purpose-config.test.js`, and `report-snapshot.test.js` are the
exception: they run actual `.gs`
functions directly (against a mocked Sheet/Range, not a mock of the
*business logic*), so they do catch data-correctness bugs (this is how the
"never-visited stores silently
scored better than overdue ones" regression was caught before a push, not
after).
`onOpen()`, the menu, and a real deploy via `clasp push` have since been
verified against the Copy; still worth trying anything new there before the
live sheet.
