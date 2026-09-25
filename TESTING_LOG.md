# SVMI — Testing Log

Current baseline, verified directly in this session unless marked
otherwise. See `ARCHITECTURE.md` §8 for how these suites work (real `.gs`
source in a Node `vm` sandbox; Playwright only against the standalone
demo; dry-run tooling is pure-function/synthetic-data only).

## Apps Script track — `SVMI_Project/tests/`

**Verified this session: 25 files, 1191 assertions, 0 failures** (Phase
1H-C added `identity.test.js`, 62 assertions; the other 24 files/1129
assertions — including Phase 1H-B.1's `security-remediation.test.js` — are
the unchanged pre-existing baseline, re-run as regression).

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
| `identity.test.js` | **Phase 1H-C** — registration/email-OTP verification (incl. attempt lockout), approval/rejection (permission-gated, fails closed, no self-escalation), account-lifecycle transition validity, role/direct-permission/scope assignment, suspend/reactivate/disable, the external-disablement offboarding hook, MFA TOTP enrollment/verification (real RFC 6238 round-trip + clock-drift tolerance), and confirms no secret value ever appears in `IDENTITY_AUDIT` | 62 (added this session) |
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
| `settings-config-migration.test.js` | **Phase 1G** — CONFIG_* → SETTINGS mirror sync (create/deactivate/rename), legacy-purpose fallback, `getSidebarData()` sourcing from CONFIG_*, migration idempotency, no-SRM-reference check | 34 |
| `store-identity.test.js` | Store ID identity/immutability, historical resolution, migration + UNMAPPED tracking, security | 51 |
| `store-lookup-date-handling.test.js` | Date-handling consistency across `SVMKPI_STORE_LOOKUP.gs` call sites | — |
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
- `.gs` syntax validity (`new Function()` extraction) and the portal's
  `<script>` block are checked manually before each push, per
  `DEPLOY.md`'s "Checks before you push" — not wired into an automated
  CI step in this repository.
