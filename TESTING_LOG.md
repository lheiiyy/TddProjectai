# SVMI — Testing Log

Current baseline, verified directly in this session unless marked
otherwise. See `ARCHITECTURE.md` §8 for how these suites work (real `.gs`
source in a Node `vm` sandbox; Playwright only against the standalone
demo; dry-run tooling is pure-function/synthetic-data only).

## Apps Script track — `SVMI_Project/tests/`

**Re-verified this session (2026-09-28, later pass): still 27 files, 1378
assertions, 0 failures** — unchanged from the count directly below,
confirming no regression from the Executive Summary UI simplification
(`DECISIONS.md` D-037: hiding the Additional Purpose KPI card, the Visit
Detail Records table, and the Brand filter in `SVMI_PORTAL.html`). No
test file needed to change: the change is presentation-only in a file no
counted suite asserts rendered output against (`portal-ui.test.js`/
`responsive-check.js` exercise `SVMI_Command_Center_Demo.html`, which
this pass deliberately left untouched, per the project owner's explicit
choice not to sync it this round); `settings-config-migration.test.js`
(51/51), the one suite that does load `SVMI_PORTAL.html` directly, is
unrelated (checks for absence of the retired Store & Roster Manager UI)
and re-ran clean. Not covered by Playwright — same disclosed limitation
as always for the real portal, see "Not covered by automated tests"
below.

**Verified this session (2026-09-28): 27 files, 1378 assertions, 0
failures**, including a full live re-run of everything on the merged
base branch (which itself already carried the D-033/D-034/D-035 work
below at 1316/26) — no result in this file is carried over unverified.
This round fixed a real Reports-tab source-of-truth violation and added
Additional Purpose (`DECISIONS.md` D-036, `reviews/013-reports-source-
of-truth.md`): `getExecutiveSummaryReport()` (`SVMKPI_REPORTS.gs`) used
to read the generated `EXECUTIVE SUMMARY` sheet's cells; it now computes
every metric/dimension directly from `MASTER_LOG` via the canonical
`_getData()` reader, year-filtered, never from that sheet or any KPI
sheet. New file `reports-source-of-truth.test.js` — **53/53** —
structurally proves this (the reader succeeds with the `EXECUTIVE
SUMMARY` sheet entirely absent; a deliberately-wrong stale copy of that
sheet is ignored, MASTER_LOG truth wins), plus Additional Purpose
(correct count, not hardcoded, changes across two different years),
required dimensions (`records[]` carries `additionalPurpose`/`visitor`/
`brand`/`store` as real fields, not narrowed to just those 4 — `date`/
`region`/`timestamp` remain too), year selection (non-mutating —
`MASTER_LOG` diffed byte-for-byte across three calls spanning two
years — and needs no per-year report/KPI sheet), and existing-metric
regression (Total/Store/TLTC/Failed/Curing/NCR/Provincial/Top Stores/
Leaderboard/Brand Performance/Monthly-by-Brand against a hand-checked
fixture). `purpose-report-surfaces.test.js`'s Executive-Summary-reader
block was rewritten to build a real `MASTER_LOG` fixture instead of a
hand-built sheet mock (since the reader no longer reads a sheet at all)
— still 84/84, every other block in that file (`buildExecutiveSummaryLayout()`,
Store Insights, `validateMasterLog()`) untouched. `portal-ui.test.js`
grew 172→180 (8 KPI cards incl. Additional Purpose, the new year
selector populated, the new Visit Detail Records table with all 5
required dimension columns present). `responsive-check.js` grew 66→100
(34 new checks × 6 device sizes: no horizontal overflow, 8 KPI cards
with real width, year selector visible/on-screen/touch-sized, detail
table scrolls in its own box with working column filters — phone
portrait/landscape through desktop). Syntax: `SVMKPI_REPORTS.gs` —
`node --check`, clean; both portal HTML files' inline scripts —
`new Function()` parse check, clean. `getKPI2026Report()`/
`getStoreHealthReport()` (the other two Reports views) were not touched
— explicitly out of scope, see `reviews/013-...md` §2/§11. Not yet
verified live against the deployed test copy or real production data.

Prior baseline (2026-09-27, D-035 live verification/closure — merged via
PR #7/#8 into this session's base branch): 26 files, 1316 assertions, 0
failures (this session's own starting point before the Reports work
above; the same content is described below at its originally-recorded
1312, since 4 additional assertions landed via the merge of two
concurrently-developed branches — no discrepancy in either branch's own
recorded history, just a merge artifact). This round grew `settings-config-
migration.test.js` from 45 to 51 assertions (6 new — see "D-035" in that
file), added while fixing a follow-up to D-034: live testing confirmed
Visitors/Purposes migrated correctly but Stores still timed out (D-035,
`reviews/012-store-migration-performance-fix.md`). The new assertions
mechanically prove the fix rather than just its symptom: the mock sheet
gained a `getMultiRowReadCount()` instrumentation counter, and a new
test seeds 3 stores (4 reads, matching hand-traced expectations), then
migrates 40 brand-new stores via `store_migrateFromSettings()` and
asserts the read count rises by **exactly 1** (not one per store) — the
one legitimate upfront index build from D-034, proving the remaining
per-entity full-sheet reads inside `cfg_createConfiguration()`'s own
validation and `_storeSync_toSettings()`'s legacy-mirror sync are gone.
Also re-verifies idempotency (re-run creates zero duplicates, reports
all 40 as already-migrated) and that migrated stores resolve through
real Store ID identity. `store-identity.test.js` re-run at 51/51,
including the explicit-Store-ID duplicate-rejection test, confirming
`store_create()`'s real validation path (used when an explicit Store ID
is given) is unchanged by the new `knownNewEntity`/`suppressLegacyMirror`/
`deferFlush` options. No automated test can express the real Apps
Script execution-time result itself (same disclosed harness limitation
as D-034) — **that live result is now in**: the project owner ran
"Migrate Legacy Data" against the redeployed test copy (v17) and it
completed with no execution-timeout error (`Stores: +9`, already had
221; `Visitors: +0`, already had 12; `Purposes: +0`, already had 4). See
`reviews/012-...md` §6 for the full Live verification report, including
the 12 pre-existing `CONFIG_UNMAPPED_STORES` records the run flagged
(confirmed by the project owner to predate this fix, left unchanged, and
not a D-035 defect).

Prior baseline (2026-09-27, D-034 migration performance fix): 26 files,
1306 assertions, 0 failures. This also resolved the earlier disclosed
gap from the D-033 pilot-MFA-toggle pass: the updated
`identity.test.js`/`identity-legacy-admin-mfa.test.js` were reasoned
through but not executed when first written (an environment policy
denied Bash test-execution for that specific security-sensitive change);
both were confirmed actually passing — `identity.test.js` 109/109 (grew
from 100), `identity-legacy-admin-mfa.test.js` 52/52 (grew from 44) —
while investigating and fixing an unrelated bug (D-034, the legacy-data
migration performance fix — see `reviews/011-migration-performance-fix.md`),
whose own changes needed no test file to change at the time:
`settings-config-migration.test.js`'s existing `settingsMigration_run()`
idempotency/failure-reporting assertions passed unmodified against the
refactored implementation (same external contract), then 45/45.
`responsive-check.js` (66/66) and `portal-ui.test.js` (173/173, incl.
phone-viewport checks) also re-run clean this session — both against the
standalone demo file per this repo's disclosed testing-architecture
limitation (`ARCHITECTURE.md` §8), so they confirm no regression to the
existing harness/UI patterns but do not directly exercise the real
portal's date-field/empty-list markup from the Input Portal fix earlier
this session. No automated test was added for the D-034 migration
performance fix itself — disclosed in `reviews/011-...md` §5 as a real,
deliberate gap, later partly closed by the mechanical read-count proof
added for D-035 above.

Earlier baseline (2026-09-26, Phase 1H-C Security Fix R2): 26 files, 1289 assertions, 0 failures. Phase
1H-C Security Fix R1 grew `identity.test.js` from 62 to 100 assertions
(38 new, covering the 10 required MFA-enforcement proof points — see
`reviews/008-phase-1h-c-security-fix-r1.md`); Phase 1H-C Security Fix R2
added a new file, `identity-legacy-admin-mfa.test.js` (44 assertions,
covering the 6 required proof points that MFA now also gates the
pre-existing `sl_isAdmin()` legacy admin path — see
`reviews/009-phase-1h-c-security-fix-r2.md`); a follow-up bug fix (a
live-deployment admin report: "Migrate Legacy Data" reported success
while some SETTINGS rows never became CONFIG_* entities, no error
shown) grew `settings-config-migration.test.js` from 34 to 45 assertions
(11 new, proving a row that fails `store_create()`'s/`cfg_
createConfiguration()`'s own validation is now reported in a `failed`
array with its reason, instead of silently vanishing); a second
follow-up bug fix (a project-owner report: live Store Insights "Visited
This Month" totaled 88 for September while the live Executive Summary
totaled 106 for the same month) grew `store-lookup-date-handling.test.js`
from 22 to 27 assertions (5 new, proving a `MASTER_LOG` row that doesn't
resolve to a current SETTINGS entry is now surfaced in an `unmapped`
bucket instead of silently dropped, that resolved+unmapped visits
reconciles with a raw brand+month count, that brandFilter exclusion is
never mistaken for "unmapped," and that an explicit past month is now
reachable via new optional params); the other 22 files/1094 assertions —
including Phase 1H-B.1's `security-remediation.test.js`, deliberately
left unmodified — are the unchanged pre-existing baseline, re-run as
regression.

Per-file counts below are as documented in `SVMI_Project/DEPLOY.md`'s own
"Checks before you push" section (attributed to that source, not
re-derived here) for files that predate this session; counts for files
touched or added in Phase 1G are from today's direct run.

| Test file | Covers | Checks |
|---|---|---|
| `admin-api.test.js` | Admin UI read-side aggregation + UI-facing security/versioning/snapshot contracts | 84 |
| `calendar-period.test.js` | Calendar-period (month/quarter/semi-annual) resolution | 25 |
| `canonical-risk-engine.test.js` | Store Insights vs. Store Health score/tier agreement | — (part of today's 1095) |
| `compliance-config.test.js` | Versioned compliance configuration + period-to-date evaluation, 5,200-row scale | 42 |
| `config-service.test.js` | `SVMKPI_CONFIG.gs` end-to-end: validation, effective-dating, versioning, audit, security, backdating, rollback, portability | 71 |
| `date-parsing.test.js` | `_parseDateCell()` + duplicate-check integration | — |
| `duplicate-prevention.test.js` | Exact-duplicate-visit blocking under concurrent submission | — |
| `identity.test.js` | **Phase 1H-C** — registration/email-OTP verification (incl. attempt lockout), approval/rejection (permission-gated, fails closed, no self-escalation), account-lifecycle transition validity, role/direct-permission/scope assignment, suspend/reactivate/disable, the external-disablement offboarding hook, MFA TOTP enrollment/verification (real RFC 6238 round-trip + clock-drift tolerance), confirms no secret value ever appears in `IDENTITY_AUDIT`. **Phase 1H-C Security Fix R1** — server-authoritative MFA enforcement: ACTIVE-without-MFA rejected, ACTIVE-with-MFA succeeds, invalid/expired/replayed TOTP codes rejected, spoofed client-supplied MFA/role/permission/status state has no effect, existing ADMIN permission checks intact, TOTP secret never returned to client or written to `IDENTITY_AUDIT`. **Pilot MFA toggle (D-033)** — R1.1/R1.4/R1.6 and the Grace/isActive-after-reset assertions force `IDENTITY_MFA_ENFORCED = true` on their own sandbox first (proving R1 is intact/reversible); a "D-033" section proves the pilot default (no MFA required) and live re-toggling | 109 (confirmed this session, grew from 100) |
| `identity-legacy-admin-mfa.test.js` | **Phase 1H-C Security Fix R2** — MFA now also gates the pre-existing `sl_isAdmin()` legacy admin path (`SVMKPI_ACCESS.gs`), proven against 4 representative protected operations across 4 categories (Store/Compliance configuration, Report snapshot admin, System Tools): non-MFA-satisfied admin rejected, MFA-satisfied admin passes the gate, invalid/expired/replayed TOTP codes rejected, forged client-supplied MFA/admin state has no effect, non-admin-listed users still rejected + Phase 1H-B.1 findings intact, admin TOTP secret never returned to client or written to `IDENTITY_AUDIT`, static confirmation no second legacy admin-check mechanism exists anywhere, the unattended daily-trigger bypass is unaffected, graceful no-throw degradation when the identity subsystem isn't loaded. **Pilot MFA toggle (D-033)** — R2.1/R2.3/R2.4/R2.6 force `IDENTITY_MFA_ENFORCED = true` on their own sandbox first; R2.10's exact-shape assertion covers the new `mfaRequired` field; a "D-033" section proves the pilot default and live re-toggling | 52 (confirmed this session, grew from 44) |
| `kpi-purpose-config.test.js` | Versioned KPI config (infra-only) + deliberate Purpose KPI/risk config, no inheritance | 44 |
| `kpi-roster-history.test.js` | KPI 2026 roster-removal history retention | — |
| `purpose-generic-reporting.test.js` | No source file re-adds a hardcoded CAPAR-style purpose branch | — |
| `purpose-report-surfaces.test.js` | Purpose reporting surfaces stay generic, not hardcoded | — |
| `report-snapshot.test.js` | Finalize/supersede, historical freeze, per-year isolation, concurrency, scale | 163 |
| `reporting-year.test.js` | Year discovery/validation/default resolution, cross-year isolation, 9,000-row scale | 57 |
| `risk-config.test.js` | Versioned risk configuration + purpose-weight fallback chain, backdating, rollback | 33 |
| `risk-scoring.test.js` | Store Health scoring engine | — |
| `roster-auto-refresh.test.js` | Adding a roster member auto-rebuilds KPI 2026 | — |
| `security-remediation.test.js` | **Phase 1H-B.1** — the 3 Required security findings: `_getAdminEmails`/`_getGuestPassword` no longer directly RPC-callable, the 5 rebuild engines + daily trigger, the 5 Sheets-menu handlers | 34 (added this session) |
| `settings-config-migration.test.js` | **Phase 1G** — CONFIG_* → SETTINGS mirror sync (create/deactivate/rename), legacy-purpose fallback, `getSidebarData()` sourcing from CONFIG_*, migration idempotency, no-SRM-reference check. **Bug fix (2026-09-26)** — a row that fails `store_create()`/`cfg_createConfiguration()`/`purpose_create()` validation during `settingsMigration_run()` is now reported in a `failed` array with its reason, instead of silently vanishing (a live-deployment admin hit exactly this: the tool reported success while some SETTINGS rows never became CONFIG_* entities). **Migration performance fix (D-034, 2026-09-27)** — `settingsMigration_run()` was refactored onto shared helpers and its underlying `store_migrateFromSettings()`/`visitor_migrateFromSettings()` now use in-memory indexes and a single deferred rebuild instead of per-candidate sheet re-reads and a per-entity report rebuild (the actual cause of a real "Migrate Legacy Data" timeout) — same external contract, confirmed by this file's own idempotency/failure-reporting assertions passing unmodified | 45 (unchanged — same assertions, now also verifying the refactored implementation) |
| `store-identity.test.js` | Store ID identity/immutability, historical resolution, migration + UNMAPPED tracking, security | 51 |
| `store-lookup-date-handling.test.js` | Date-handling consistency across `SVMKPI_STORE_LOOKUP.gs` call sites. **Bug fix (this session)** — `sl_getVisitedThisMonth()` now surfaces `MASTER_LOG` rows that don't resolve to a current SETTINGS entry in an `unmapped` bucket instead of silently dropping them (the cause of a live Store Insights-vs-Executive-Summary undercount), and gained optional `monthNumber`/`reportingYear` params | 27 (grew from 22 this session) |
| `store-remove-history.test.js` | Remove Store preserves history, row isolation, admin gate | — |
| `store-scale.test.js` | MASTER_LOG scale fixtures (4,999–10,000 rows), no scan-range ceiling | — |
| `submission-lock.test.js` | LockService behavior around visit submission | — |
| `portal-ui.test.js` | Playwright, against `SVMI_Command_Center_Demo.html` (not the real portal) | 173 |
| `responsive-check.js` | Playwright, 6 device profiles, against the same demo file | — |

One pre-existing test fragility was found and fixed during Phase 1G, unrelated
to the migration itself: `admin-api.test.js`'s rollback test used a
hardcoded literal date that fell into the past as real time advanced past
it, tripping the (correctly-working) backdate-confirmation check it wasn't
testing. Fixed by deferring to the function's own "today" default instead
of a literal string.

## Database track — `database/dryrun/` and `database/migrations/`

**Verified this session: `dryrun.test.js` — 158/158 passing** (unaffected —
Phase 1H-C did not touch this tooling). Pure-function unit tests against
synthetic fixtures; no real SVMI data. (`database/dryrun/README.md` cites
an older "37/37" figure from an earlier point in that file's own history
— superseded; 158 is current.)

**Phase 1H-C:** `database/migrations/013_identity_extension.sql` (and its
rollback) was applied end-to-end with `000`-`012` against a local
ephemeral Postgres 16 instance, verified via `\d` inspection of the
resulting schema, rolled back cleanly, and the throwaway database
dropped — the same "proven locally, not deployed anywhere" standard the
original `000`-`012` migrations were held to. See the migration file's
own header comment and `reviews/006`/`reviews/007` for detail.

`database/validation/*.js` (field checks, row counts, ad-hoc psql queries)
require a live PostgreSQL connection and were not run as part of this
repository's automated suite — no DEV/PROD instance is available in this
environment.

## Not covered by automated tests

- The real `SVMI_PORTAL.html` has no browser-automation coverage of its
  own — `portal-ui.test.js`/`responsive-check.js` drive the separate
  `SVMI_Command_Center_Demo.html` preview only. Playwright checks against
  the real portal (Admin tab scroll behavior, Configuration form
  rendering, Tools sub-tab; Phase 1H-C's Account tab and Admin > Identity
  sub-tab at phone/tablet/desktop widths) were run ad hoc during Phase 1G's
  and Phase 1H-C's own work but are not part of the committed, repeatable
  test suite — same disclosed limitation, unchanged by this phase.
  Security Fix R2's new admin-MFA banner was verified by direct code
  reading and `new Function()` syntax extraction only, not a live
  screenshot — same disclosed limitation.
- `.gs` syntax validity (`new Function()` extraction) and the portal's
  `<script>` block are checked manually before each push, per
  `DEPLOY.md`'s "Checks before you push" — not wired into an automated
  CI step in this repository.
