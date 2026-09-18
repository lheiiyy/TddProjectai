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

`DATA_YEAR` (`SVMKPI_CORE.gs`) is the single source of truth for the
reporting year — every date calculation (Unvisited This Month's window, the
KPI 2026 report's P{period}W{week} labels, Store Health's cadence math) reads
from it, so bumping that one constant is enough to make the underlying
numbers correct for the new year.

Two things follow that constant automatically, so nothing else needs
editing by hand:

- **The KPI sheet name** — `_kpiSheetName()` (`SVMKPI_KPI_REBUILD.gs`)
  returns `'KPI ' + DATA_YEAR`, not a hardcoded `'KPI 2026'`. The next
  "Rebuild KPI 2026" after a `DATA_YEAR` bump creates a fresh `KPI 2027` tab
  rather than continuing to write into the old year's sheet — last year's
  tab is left behind as-is, as a historical record.
- **The portal's top-bar year** — the "Store Visit Monitoring Initiative ·
  2026 · …" subtitle reads the same `dataYear` value the Unvisited tab's
  month label already uses (via `sl_getDataYear()`), instead of a static
  string.

What still needs a manual look after bumping `DATA_YEAR`: menu items, tool
labels and confirmation dialogs that say "KPI 2026" by name (e.g. "Rebuild
KPI 2026") are just display text — cosmetic, not wired to `DATA_YEAR` — and
are fine to leave as a familiar label or reword at your discretion.

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
```

The first two suites exercise the preview's in-memory sample data, not a
real spreadsheet — they catch UI/layout regressions, not data-correctness
issues. `risk-scoring.test.js`, `kpi-roster-history.test.js`,
`roster-auto-refresh.test.js`, `store-remove-history.test.js`,
`canonical-risk-engine.test.js`, `submission-lock.test.js`,
`date-parsing.test.js`, `store-lookup-date-handling.test.js`,
`duplicate-prevention.test.js`, and `config-service.test.js` are the
exception: they run actual `.gs`
functions directly (against a mocked Sheet/Range, not a mock of the
*business logic*), so they do catch data-correctness bugs (this is how the
"never-visited stores silently
scored better than overdue ones" regression was caught before a push, not
after).
`onOpen()`, the menu, and a real deploy via `clasp push` have since been
verified against the Copy; still worth trying anything new there before the
live sheet.
