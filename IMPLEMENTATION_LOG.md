# SVMI — Implementation Log

Chronological summary. Full design rationale for each phase lives in
`SVMI_Project/DEPLOY.md`'s own per-phase sections and `database/dryrun/README.md`;
this file is the durable index, not a replacement. Commit hashes are from
`git log` on this branch's history.

## Apps Script track (`SVMI_Project/`)

| Date | Commit | Phase | Summary |
|---|---|---|---|
| 2026-09-16 | `8b29274` | — | Store & Roster Manager added to System Tools (direct-to-SETTINGS editor — later removed, see Phase 1G) |
| 2026-09-18 | `4432660` | Phase 0 | Hardening ahead of configuration-driven administration |
| 2026-09-18 | `5023fe0` | Phase 0.5 | Closed Phase 0's own verification gaps |
| 2026-09-18 | `720809d` | Phase 1A | Configuration data model, versioning, and audit foundation (`SVMKPI_CONFIG.gs`) — purely additive infrastructure, nothing wired to it yet |
| 2026-09-18 | `931d6b3` | Phase 1B | Immutable Store ID identity + historical store-attribute resolution; SETTINGS→Store-ID migration tooling built (not yet wired to a UI) |
| 2026-09-18 | `1fe5784` | Phase 1C | Reporting-year abstraction — year-neutral KPI/report APIs, removed manual annual rollover (D-008) |
| 2026-09-18 | `ac12efa` | Phase 1D | Versioned Risk + Compliance + KPI configuration + calendar cadence |
| 2026-09-18 | `cb973a8` | Phase 1E | Historical report snapshots + per-year report sheets |
| 2026-09-18 | `f09d317` | Phase 1E (fix) | Freeze Executive Summary/KPI in every snapshot (completeness fix) |
| 2026-09-19 | `398c2e5` | Phase 1F | Snapshot and Configuration Administration UI (the Admin tab) |
| 2026-09-19 | `51b9163`–`9adff00` | Phase 2A/2A.2–2A.5 | Canonical Store/Visitor identity reconciliation tooling; **Store identity = Location + Brand confirmed against real data (D-001)**; administrative-confirmation discipline established (D-012) — *this is `database/dryrun/` tooling, not an Apps Script change* |
| 2026-09-19 | `a12820a`–`ed646c3` | Phase 2C | Purpose operational readiness (CAPAR → inactive-not-selectable, D-004); Executive Summary + Store Insights made purpose-dynamic; Purpose Breakdown's old top-4 limit removed |
| 2026-09-19/23 | (this session) | Phase 1G | Removed "Store & Roster Manager"; Admin → Configuration made the sole authoritative path for Stores/Visitors/Purposes; `SVMKPI_VISITOR_CONFIG.gs` and `SVMKPI_SETTINGS_MIGRATION.gs` added; `_cfg_syncLegacyMirror()` keeps `SETTINGS` A–E/F/H in sync; `getSidebarData()` reads `CONFIG_*` directly; Admin Configuration UI gained per-field explanations and guided Store dropdowns (see `DECISIONS.md` D-005/D-006) |
| 2026-09-23 | (this session) | Audit | Read-only System Peripherals architectural audit — findings recorded in `PROJECT_STATUS.md` and `reviews/` |
| 2026-09-25 | (this session) | Phase 1H-A | Read-only authentication/identity/authorization audit — traced login/session/authorization flow, inventoried all 45 server-gated privileged functions plus every function found NOT gated, the guest-password/admin-email secret lifecycle, and mapped current concepts against a future Identity-Provider/role/permission model. Findings recorded in `reviews/003-phase-1h-security-identity-audit.md`. Audit only — no finding was fixed at the time. |
| 2026-09-25 | (this session) | Phase 1H-B | Recorded the project owner's approved target enterprise identity/access architecture: external OIDC/SAML authentication delegated to an identity provider, authorization kept independent and SVMI-owned, an immutable internal User ID as identity key, a request/approval workflow with a 7-state account lifecycle, extensible RBAC beyond ADMIN/USER, MFA as an IdP-layer responsibility, strict credential separation, and a dedicated identity/access audit domain. Recorded in `reviews/004-phase-1h-enterprise-identity-architecture.md` and `DECISIONS.md` D-015–D-023. Architecture record only — nothing was implemented; no identity provider was chosen; Phase 1H-C has not started. |
| 2026-09-25 | (this session) | Phase 1H-B.1 | **Fixed the 3 Phase 1H-A Required security findings** — the first application-code change since Phase 1G. `_getAdminEmails()`/`_getGuestPassword()` (`SVMKPI_ACCESS.gs`) are no longer top-level functions, closing the `google.script.run` secret-exposure path. `buildExecutiveSummaryLayout`, `buildKPI2026`, `rebuildDataSheetHeaders`, `rebuildStoreMasterInsight`, and `refreshRiskEngine` each now re-check `sl_isAdmin()` directly, independent of their `portal_*` wrapper (`refreshRiskEngine` also gets a capability-token exception for the unattended daily trigger). The 5 Sheets-menu rebuild/validate handlers (`SVMKPI_ADMIN.gs`) now require `sl_isAdmin()` too, closing the second privilege boundary. No authentication, session, or RBAC redesign; the Phase 1H-B enterprise architecture was not implemented. 34 new tests (`security-remediation.test.js`) plus the full existing suite, all passing. Findings recorded in `reviews/005-phase-1h-required-security-remediation.md`. |
| 2026-09-25 | (this session) | Phase 1H-C | **Implemented the approved registration/approval/RBAC/scope/MFA identity foundation** (`DECISIONS.md` D-024–D-030, `reviews/006-phase-1h-c-planning.md`). New: `SVMKPI_IDENTITY_CORE.gs` (schema/sheet-access/permission-resolution/audit), `SVMKPI_IDENTITY_REGISTRATION.gs` (`registerUser()`/`verifyRegistrationEmail()`, email OTP via `MailApp`), `SVMKPI_IDENTITY_ADMIN.gs` (`approveRegistration()`/`rejectRegistration()`/`assignRole()`/`assignPermissions()`/`assignScope()`/suspend/reactivate/disable/`handleExternalIdentityDisabled()`), `SVMKPI_IDENTITY_ACCESS.gs` (`getCurrentUser()`/`getAccessState()`), `SVMKPI_IDENTITY_MFA.gs` (native TOTP `enrollMfa()`/`verifyMfa()`, a documented temporary exception to D-022 — see D-028). New IDENTITY_* pilot sheets, mirrored by `database/migrations/013_identity_extension.sql` (verified end-to-end against a local ephemeral Postgres instance, then rolled back). `SVMI_PORTAL.html` gained an always-visible "Account" tab (registration/verification/MFA self-service) and an Admin → Identity sub-tab (approval, role/permission/scope assignment) — both call only the named service functions, never a Sheet/row directly; the new permission system is additive and does not touch `sl_isAdmin()` or the 45+ existing gated call sites (D-026). External IdP selection, OIDC/SAML, and PostgreSQL production cutover remain deferred, per the approved scope. 62 new tests (`identity.test.js`, incl. a real TOTP round-trip and a check that no secret ever appears in `IDENTITY_AUDIT`) plus the full existing suite, all passing — 1191 assertions across 25 files. This pass's own review disclosed MFA was enrollment-time proof only, not yet an enforced access requirement — closed by the next row. Recorded in `reviews/007-phase-1h-c-implementation.md`. |
| 2026-09-25 | (this session) | Phase 1H-C Security Fix R1 | **MFA is now an enforced, server-authoritative access requirement for ACTIVE users** (`DECISIONS.md` D-031, `reviews/008-phase-1h-c-security-fix-r1.md`). `_identity_authorizeCurrentUser_()` (`SVMKPI_IDENTITY_CORE.gs`) — the single choke point every protected identity function already called — now also requires a satisfied, unexpired MFA credential, backed by `PropertiesService.getUserProperties()` (scoped to the executing Google identity, never client-readable/writable; a bounded 12-hour window; carries no role/permission/identity data — explicitly not a general session). `verifyMfa()` (`SVMKPI_IDENTITY_MFA.gs`) now marks this credential on success and gained anti-replay protection (a TOTP time-step satisfies at most one call). `getAccessState().isActive` (`SVMKPI_IDENTITY_ACCESS.gs`) now requires both ACTIVE status and MFA satisfaction. `SVMI_PORTAL.html`'s Account tab gained a third MFA state (enrolled-but-not-yet-satisfied, prompting for a fresh code). No session mechanism was built; no external IdP was chosen; no unrelated module was touched. `identity.test.js` grew from 62 to 100 assertions (38 new, covering all 10 required proof points) plus the full existing suite, all passing — 1229 assertions across 25 files (`identity.test.js`'s own count grew within the same file; no new test file was added). This pass's own review disclosed the 45+ pre-existing `sl_isAdmin()`-gated call sites remained a second, MFA-independent authorization path — closed by the next row. Recorded in `reviews/008-phase-1h-c-security-fix-r1.md`; `reviews/007` annotated with a pointer, not rewritten. |
| 2026-09-25 | (this session) | Phase 1H-C Security Fix R2 | **MFA now also applies to the pre-existing `sl_isAdmin()` legacy admin path** (`DECISIONS.md` D-032, `reviews/009-phase-1h-c-security-fix-r2.md`). `sl_isAdmin()` (`SVMKPI_ACCESS.gs`) — the single function every one of the 45+ pre-existing SETTINGS!G-gated call sites across 16 files already calls, confirmed by full-codebase inspection to be the ONLY legacy authorization mechanism in this pilot — now also requires a satisfied, unexpired MFA credential, closing the gap Security Fix R1's own review disclosed. New self-service `enrollAdminMfa()`/`verifyAdminMfa()` reuse the exact same TOTP (RFC 6238, anti-replay) and `PropertiesService`-backed satisfaction-gate primitives Security Fix R1 built, under a distinct `'LEGACY_ADMIN:<email>'` key namespace and reusing the existing `IDENTITY_MFA` sheet — deliberately NOT unified with the new identity system's own MFA gate, since no bootstrap path exists to create that system's first `ACTIVE`+`ADMIN`+MFA-satisfied user (unifying them would have permanently locked out every existing admin). `_isOnLegacyAdminList_()` preserves the exact pre-R2 admin-list check, unchanged; `refreshRiskEngine()`'s unattended-trigger bypass is unaffected. `SVMI_PORTAL.html` gained a minimal admin-MFA banner (enroll/verify) so legacy admins have an actual way to satisfy the requirement. New file `identity-legacy-admin-mfa.test.js` — 44 assertions covering all 6 required proof points against 4 representative protected operations across 4 categories — plus the full existing suite, all passing: 1273 assertions across 26 files. `security-remediation.test.js` (Phase 1H-B.1's own 34 assertions) was not modified and re-run unchanged. Recorded in `reviews/009-phase-1h-c-security-fix-r2.md`; `reviews/008` annotated with a pointer, not rewritten. |

**The application did not change between Phase 1G and Phase 1H-B.1.** The
System Peripherals audit, Phase 1H-A, and Phase 1H-B (three of the nine
rows above) were documentation/audit/architecture-only work — no
`.gs`/`.html` file was touched by any of them. **Phase 1H-B.1, Phase
1H-C, Phase 1H-C Security Fix R1, and Phase 1H-C Security Fix R2 are the
four code changes since Phase 1G** — see those rows above and
`reviews/005-...md`/
`reviews/007-...md`/`reviews/008-...md`/`reviews/009-...md` for exactly
which files and why.

## Documentation track (spans `SVMI_Project/`, `database/`, and the repo root)

| Date | Commit | Pass | Summary |
|---|---|---|---|
| 2026-09-23 | `a84074b` | Documentation foundation | Created the 8 root docs (`PROJECT_MEMORY.md` through `TESTING_LOG.md`) and `reviews/001-workflow-documentation-compliance.md` — none existed before. Flagged, but did not fix, staleness in `SVMI_Project/DEPLOY.md`, `SVMI_Project/README.txt`, and `database/dryrun/README.md`. |
| 2026-09-23 | `f96b2d8` | Documentation reconciliation | Created `CLAUDE.md`; established the Documentation Authority Model in `PROJECT_MEMORY.md`; **fixed** the three files pass 1 had only flagged — added historical/superseded banners to `SVMI_Project/DEPLOY.md`'s Store & Roster Manager/Navigation/Admin-list sections, corrected `SVMI_Project/README.txt`'s file count and tab description, corrected `database/dryrun/README.md`'s test count. |
| 2026-09-24 | (this session) | Workflow-readiness gap-fix | A follow-up readiness audit found this file's own "What is superseded" section (since retitled "Legacy-documentation staleness — found, then resolved," below) and `PROJECT_STATUS.md` had not been updated after pass 2 landed, so both still claimed the pass-1 files were "not corrected" — a real conflicting-source-of-truth defect. Corrected both, and added `reviews/002-documentation-reconciliation.md` (the review artifact pass 2 should have produced). |

## Database track (`database/`)

| Date | Commit | Summary |
|---|---|---|
| 2026-09-19 | `95fa4e5` | PostgreSQL DEV schema + migration/rollback scripts, proven against a local ephemeral instance |
| 2026-09-19 | `e1a81ca` | Phase 2 dry-run tooling scaffolding (pure functions, synthetic data, no live database) |
| 2026-09-19 | `51b9163`–`278d44a` | Phase 2A/2A.2 — canonical Store/Visitor identity + the Location+Brand rule (D-001) |
| 2026-09-19 | `eb8ba93`–`82af2b1` | Phase 2A.3–2A.5 — EXISTING/NEW/HUMAN_REVIEW classification, operational status, administratively-confirmed merges |
| 2026-09-19 | `f7cb12d` | Visitor identity reconciliation, mirroring the Store pattern |
| 2026-09-19 | `9adff00`–`ed646c3` | Cross-source Purpose reconciliation (CAPAR) + operational readiness |
| 2026-09-25 | (this session) | Phase 1H-C — `013_identity_extension.sql` (+ rollback): account-lifecycle/email-verification/MFA columns on `users`; `permissions`, `role_permissions`, `user_permissions`, `user_scope`, `identity_audit_log` tables; `roles` seeded with `USER` alongside `002`'s `ADMIN`. Applied end-to-end with `000`-`012` against a local ephemeral instance, then rolled back — same "proven locally" standard as the original migrations. No PostgreSQL production cutover. |

**Status: paused** (real-data migration track only — the identity schema
above is DEV-only forward architecture, same as `002`-`012`). The dry-run
tooling is complete and unit-tested
against synthetic data; it has not been run against real SVMI data, and
no production Postgres instance exists (D-011). Next step on this track
is a real data export from the project owner — not something an AI
session should attempt to obtain itself.

## Legacy-documentation staleness — found, then resolved

Both items below were **found** during the Documentation foundation pass
(`a84074b`) and **fixed** during the Documentation reconciliation pass
(`f96b2d8`), two separate commits — see the Documentation track table
above. Current state (verified, not carried over from either pass's own
notes):

- `SVMI_Project/DEPLOY.md`'s "Store & Roster Manager" section described a
  tool that no longer exists as of Phase 1G (superseded by `DECISIONS.md`
  D-005). It now carries an explicit `⚠ HISTORICAL — NO LONGER CURRENT`
  banner pointing to `DECISIONS.md` D-005/D-006 and `ARCHITECTURE.md` §5;
  the section's rationale is preserved underneath the banner, not deleted.
  The same pass added equivalent correction banners to that file's
  Navigation and Admin-list sections, which had the same problem.
- `SVMI_Project/README.txt` said "10 .gs files"; there are 24 as of
  Phase 1G. It now states 24, with a note explaining the correction, and
  points to `ARCHITECTURE.md` §4 instead of re-listing every file.

`database/dryrun/README.md`'s stale "37/37" test-count claim (found in
the same first pass, not listed above since it isn't an Apps Script doc)
was corrected the same way in `f96b2d8` — see `TESTING_LOG.md` for the
current, verified count (158/158) rather than trusting any one doc's own
inline figure.
