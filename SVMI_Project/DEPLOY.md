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
  since it's a live formula that recalculates on its own.
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

Nothing updates live — Executive Summary/KPI 2026/Store Health only ever
show a snapshot from their last rebuild, whether the underlying change came
from Store & Roster Manager or an actual visit submission. Once rebuilt:

- **Store** add/edit only affects **Store Health** (which is seeded from
  `SETTINGS`) — Executive Summary and KPI 2026 aren't store-indexed. Editing
  a store's brand/region does **not** retroactively relabel visits already
  in `MASTER_LOG` under the old value; only new submissions pick up the edit.
- **Visitor Roster** removal only affects **KPI 2026** (the only report
  indexed by roster) — and it's handled safely: `buildKPI2026()` appends
  anyone with real `MASTER_LOG` history who's since been removed from the
  roster as an extra row (their name written as a plain literal instead of
  a live `SETTINGS!F` formula, since there's no roster row left to point
  to), so **their historical numbers are never lost**, even after the
  active roster changes out from under them. `getKPI2026Report()` reads
  row-by-row off the actual sheet rather than re-deriving the visitor count
  from `SETTINGS!F`, for the same reason — it can't fall out of sync with
  what the rebuild actually wrote. `tests/kpi-roster-history.test.js`
  covers this end-to-end (a real `.gs` test, not the demo mock).
- **Purpose List** changes carry no historical-loss risk either way — see
  the note above; a purpose that's since been removed from the list simply
  can't be picked again going forward, but visits already logged under it
  keep whatever score/count they already had.

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
```

The first two suites exercise the preview's in-memory sample data, not a
real spreadsheet — they catch UI/layout regressions, not data-correctness
issues. `risk-scoring.test.js` and `kpi-roster-history.test.js` are the
exception: they run actual `.gs` functions directly (against a mocked
Sheet/Range, not a mock of the *business logic*), so they do catch
data-correctness bugs (this is how the "never-visited stores silently
scored better than overdue ones" regression was caught before a push, not
after).
`onOpen()`, the menu, and a real deploy via `clasp push` have since been
verified against the Copy; still worth trying anything new there before the
live sheet.
