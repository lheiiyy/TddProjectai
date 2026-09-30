---
name: testing
description: How to test SVMI changes — the Node vm-sandbox suites that run the real .gs code, the Playwright suites against the standalone demo, the database dry-run tests, and syntax checks. Use when adding or changing any behavior, before calling work done, and when recording a new test baseline.
---

# Testing

## One command

```bash
bash SVMI_Project/tests/run-all.sh            # syntax checks + every suite, under TZ=UTC
SVMI_SKIP_BROWSER=1 bash SVMI_Project/tests/run-all.sh   # no Playwright available
```

Baseline (2026-09-30): **30 files, 1644 assertions, 0 failures** = the
28-file / 1386-assertion Apps Script suite + `responsive-check.js` (100)
+ `dryrun.test.js` (158). `TESTING_LOG.md` is the authority for the
current number — update it, don't trust this line if they differ.

There is **no package.json, no test runner, no linter, no CI.** Each file
is a standalone Node script with a tiny `check()`/`eq()` harness that
prints `✓`/`✗` and exits non-zero on failure. Don't introduce Jest/Mocha
or a package manager without an owner decision.

**Time zone:** run under `TZ=UTC` (the script does). In `Asia/Manila`,
`risk-config.test.js` and `store-identity.test.js` each fail one
assertion because they compare dates through `toISOString()` — a test
fragility logged in `TESTING_LOG.md`, not yet fixed.

## What each layer covers

| Layer | Files | How | Use for |
|---|---|---|---|
| Unit / integration (server) | `SVMI_Project/tests/*.test.js` (except `portal-ui`) | Loads the **real** `.gs` sources into a Node `vm` context with the Apps Script services the code needs (`SpreadsheetApp`, `Session`, `Utilities`, and where relevant `LockService`, `PropertiesService`, `MailApp`) mocked, sheets held in memory | Every server-side behavior: business rules, validation, authorization gates, versioning, migrations, reports |
| "API" tests | same files | Call the public function exactly as `google.script.run` would (string/number args, assert on the returned envelope) | Every new or changed endpoint in `API_CONTRACT.md` — including the **denied** path for a non-admin / unauthorized caller |
| Component / E2E (UI) | `portal-ui.test.js`, `responsive-check.js` | Playwright (`chromium`) against `SVMI_Command_Center_Demo.html` and its mock backend; 6 device profiles | Demo-level UI behavior and layout only |
| Real-portal smoke | `settings-config-migration.test.js` | Loads `SVMI_PORTAL.html` as text | Structural checks (e.g. retired UI stays gone) |
| Database tooling | `database/dryrun/dryrun.test.js` | Pure functions, synthetic fixtures, no DB | Reconciliation/identity logic |
| Live DB | `database/validation/*.js` | Needs a real Postgres | Not part of the automated run; say so if not executed |

**Not covered by automation** (be explicit in your summary when it
matters): the real `SVMI_PORTAL.html` in a browser, the live Sheet, real
data volumes beyond the scale fixtures, and deployed behavior.

## Writing a test

1. Find the closest existing file for the area (names map to features:
   `store-identity`, `report-snapshot`, `identity`, …) and extend it. Add
   a new `<feature>.test.js` only for a genuinely new area.
2. Copy that file's sandbox setup — which `.gs` files it loads and which
   services it mocks. Load only the files the code under test needs.
3. Dates inside the sandbox come from the sandbox's own realm
   (`const SDate = vm.runInContext('Date', sandbox)`); an outer `Date`
   is not `instanceof` the inner one (`risk-scoring.test.js` header).
4. Assert on behavior and on the envelope (`success`, `message`, fields),
   and on what was written to the mocked sheets.
5. For every gated function test both the allowed and the denied caller.
6. For a bug fix, write the failing assertion first, watch it fail, then
   fix (regression test).
7. Avoid hardcoded "today" dates — a literal date that slides into the
   past broke `admin-api.test.js` once (`TESTING_LOG.md`). Use the
   function's own default or a date computed relative to now.
8. For scale-sensitive code (`MASTER_LOG` scans, migrations), extend
   `store-scale.test.js` / the scale fixtures — the 6-minute Apps Script
   limit is a real failure mode (D-034/D-035).

## Playwright

Resolved from `playwright` or `/opt/node22/lib/node_modules/playwright`.
Screenshots go to `$SVMI_TEST_OUT`. If neither is present, the suites
exit 2 — skip them with `SVMI_SKIP_BROWSER=1` and state that the UI
suites weren't run. Do not add Playwright to the repo without asking.

## Recording results

A run whose result should persist (new baseline, new file, new failure)
gets a dated `TESTING_LOG.md` entry: files, assertions, failures, what
changed, and anything not run. Update the per-file table there when a
file's count changes.
