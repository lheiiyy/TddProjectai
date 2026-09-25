# SVMI — Project Status

Last updated: 2026-09-25, recording Phase 1H-B.1 — the fix for the 3
Required pilot security findings from Phase 1H-A (see
`reviews/005-phase-1h-required-security-remediation.md`). This is the
first application-code change since Phase 1G; everything from the System
Peripherals audit through Phase 1H-B was documentation/architecture only.
See `PROJECT_MEMORY.md` for orientation and `IMPLEMENTATION_LOG.md` for
the full phase-by-phase history behind this summary.

## What is SVMI?

A Google Sheets + Apps Script application for logging store visits and
administering the rules (risk scoring, compliance cadence, KPI tracking,
reporting) that govern how those visits are evaluated — with a growing,
versioned, audited Admin Configuration layer replacing informal
spreadsheet edits. See `REQUIREMENTS.md`.

## What architecture is currently live?

The Apps Script Web App in `SVMI_Project/Apps Script/` (see
`ARCHITECTURE.md`). `MASTER_LOG` (permanent visit history) and `SETTINGS`
(now a generated compatibility mirror for Stores/Visitors/Purposes, still
independently authoritative for admin access — see `DATA_MODEL.md`) are
the live storage. **No PostgreSQL database is live for the application** —
`database/` is a DEV-only, unproven-in-production migration target.

## What has been completed

**Apps Script track** (chronological; full detail in `IMPLEMENTATION_LOG.md`):
Phase 0/0.5 hardening → Phase 1A configuration engine → Phase 1B Store ID
identity → Phase 1C reporting-year abstraction → Phase 1D Risk/Compliance/KPI
configuration → Phase 1E report snapshots → Phase 1F Admin/Snapshot UI →
**Phase 1G: Admin Configuration made the sole authoritative path for
Stores/Visitors/Purposes; "Store & Roster Manager" removed** → a read-only
System Peripherals architectural audit → **Phase 1H-A: a read-only
authentication/identity/authorization audit** (see
`reviews/003-phase-1h-security-identity-audit.md`) → **Phase 1H-B: the
approved target enterprise identity/access architecture recorded** (see
`reviews/004-phase-1h-enterprise-identity-architecture.md`) →
**Phase 1H-B.1: the 3 Required pilot security findings from Phase 1H-A
fixed** (see `reviews/005-phase-1h-required-security-remediation.md` —
full detail in "What has been completed" → Security/identity track,
below). **The application did not change between Phase 1G and Phase
1H-B.1** — the System Peripherals audit, Phase 1H-A, and Phase 1H-B were
documentation/audit/architecture-only; Phase 1H-B.1 is the first code
change since Phase 1G, and it is a scoped pilot-hardening fix, not the
Phase 1H-B enterprise architecture itself.

**Documentation track** (also complete, both passes pushed):
1. **Documentation foundation** (commit `a84074b`) — created the 8 root
   docs (`PROJECT_MEMORY.md` through `TESTING_LOG.md`) plus
   `reviews/001-workflow-documentation-compliance.md`, none of which
   existed before.
2. **Documentation reconciliation** (commit `f96b2d8`) — created
   `CLAUDE.md`; established the Documentation Authority Model in
   `PROJECT_MEMORY.md`; reconciled the three legacy docs the first pass
   had flagged but not fixed (`SVMI_Project/DEPLOY.md`,
   `SVMI_Project/README.txt`, `database/dryrun/README.md`).
3. **Workflow-readiness gap-fix** — a follow-up audit found
   `PROJECT_STATUS.md` and `IMPLEMENTATION_LOG.md` had not been updated
   after pass 2 landed, producing a real conflicting-source-of-truth
   gap; this pass corrects both and adds
   `reviews/002-documentation-reconciliation.md`, the review artifact
   pass 2 itself should have produced. See that review and
   `reviews/001-...md` (preserved unedited as the historical record of
   the first pass) for full detail.

**Documentation foundation and reconciliation are both complete.**
`CLAUDE.md` now exists at the repo root.

**Security/identity track:**
1. **Phase 1H-A — Authentication/Identity/Authorization audit**
   (`reviews/003-phase-1h-security-identity-audit.md`) — traced the full
   login → session → authorization flow, inventoried all 45
   server-gated privileged functions plus every function found NOT
   gated, the guest-password/admin-email secret lifecycle, and mapped
   current concepts against a future Identity-Provider/role/permission
   model. Found 3 Required findings, 4 Recommended, 3 Future, and 3
   Unknown/Not-Verifiable-From-Repository items — see that review for
   full detail. Audit only — nothing was fixed at the time.
2. **Phase 1H-B — Enterprise identity & access architecture (approved
   target, not implemented)**
   (`reviews/004-phase-1h-enterprise-identity-architecture.md`) — records
   the project owner's approved target architecture: authentication
   delegated to an external OIDC/SAML identity provider, authorization
   kept independent and SVMI-owned, an immutable internal User ID as the
   identity key, a request/approval workflow with a 7-state account
   lifecycle, extensible RBAC beyond today's ADMIN/USER, MFA as an
   IdP-layer responsibility (mandatory for Admins), strict credential
   separation, and a dedicated identity/access audit domain. Recorded as
   `DECISIONS.md` D-015–D-023. Architecture recorded only — nothing was
   implemented, no identity provider was chosen, and Phase 1H-C has not
   started.
3. **Phase 1H-B.1 — Required pilot security remediation** (code change;
   `reviews/005-phase-1h-required-security-remediation.md`) — fixed all 3
   Phase 1H-A Required findings without touching authentication, sessions,
   or the enterprise architecture: `_getAdminEmails()`/`_getGuestPassword()`
   are no longer top-level functions (`google.script.run` can no longer
   reach them at all, closing the secret-exposure path — `SVMKPI_ACCESS.gs`);
   the 5 report-rebuild engines (`buildExecutiveSummaryLayout`,
   `buildKPI2026`, `rebuildDataSheetHeaders`, `rebuildStoreMasterInsight`,
   `refreshRiskEngine`) now each re-check `sl_isAdmin()` themselves,
   independent of their `portal_*` wrapper, with a capability-token
   exception for the one legitimate unattended caller (the daily Store
   Health trigger); the 5 Sheets-menu rebuild/validate handlers now
   require `sl_isAdmin()` too, closing the second privilege boundary.
   34 new focused tests (`security-remediation.test.js`) plus the full
   existing 1095-assertion suite, all passing — **1129 assertions across
   24 files, 0 failures.** See that review for the finding-by-finding
   mapping, remaining limitations, and full regression result.

**Database track**: PostgreSQL DEV schema (13 migrations + rollback
scripts), proven against a local ephemeral instance, including verified
column-level grant enforcement. Phase 2 real-data migration dry-run
tooling (Store/Visitor/Purpose identity reconciliation, operational
readiness, snapshot/integrity validation) built and unit-tested against
synthetic data — **158/158 passing** as of this check.

## What is currently being worked on

Nothing is mid-implementation. Phase 1G, all three documentation passes,
the Phase 1H-A security audit, the Phase 1H-B target-architecture record,
and the Phase 1H-B.1 pilot-hardening fix above are all complete, verified,
and pushed. Phase 1H-C (implementing any part of the Phase 1H-B
enterprise architecture) has not been started — it explicitly awaits
project-owner review and scoping decisions.

## What remains unresolved

**Security/identity — the 3 Phase 1H-A Required findings are fixed**
(Phase 1H-B.1, `reviews/005-phase-1h-required-security-remediation.md`).
What remains, per that review's own "remaining limitations" for each
finding, and the Recommended/Future/Unknown items `reviews/003` §H never
asked this task to fix:
- The guest password and admin email list remain plaintext in `SETTINGS`
  (readable by anyone with Sheet access) and the guest password remains
  cached in browser `localStorage` by design — closing the RPC path
  (Phase 1H-B.1) did not change this.
- `validateMasterLog()` still has no admin check of its own (it was Low
  risk/read-only, not a Required finding); only its Sheets-menu path
  (`menuValidateMasterLog`) is now gated.
- `menuSetupAccessControl()` (the one-time admin-bootstrap menu item) is
  still intentionally ungated — gating it would be self-defeating, since
  it is how the first admin gets seeded.
- No audit trail exists for authentication events, admin-list changes, or
  password rotations (Recommended item 6, `reviews/003`).
- The guest password is a single shared secret with no per-user binding,
  rate limiting, or lockout (Recommended item 7).
- Everything in `reviews/003`'s Future/Unknown-Verification sections
  (real Identity Provider, server-side sessions, structured security
  audit log, exact OAuth scopes/deployment facts) — unchanged, and
  explicitly out of scope for both Phase 1H-B.1 and the still-pending
  Phase 1H-C.

**System Peripherals (Phase 1G follow-up, see `reviews/001`/`002`):**
- **No Admin Configuration screen for admin access** — guest password
  (`SETTINGS!I2`) and admin email list (`SETTINGS!G2:G`) are edited only
  by direct cell edit or a one-time Sheets-menu bootstrap (D-007).
- **Approved Brands/Regions/Categories are hardcoded** JS constants with
  no configuration screen; Brand is additionally embedded in Executive
  Summary's fixed row layout (D-013).
- **`CONFIG_KPI` is unwired** — target/weight/type fields are stored,
  validated, and editable, but no KPI calculation reads any of them.
- **`CONFIG_RISK`'s Low Threshold is a dead field** — stored and
  validated, never compared against by the scoring algorithm.
- **Two dropdown-sourcing rules disagree within the same Admin Store
  form**: Region/Category use the full approved list; Brand uses only
  "brands currently in use by some store," inherited unmodified from the
  removed Store & Roster Manager.
- **Store Category and Compliance's category key are only loosely
  linked** — nothing enforces that a Compliance rule's category string
  corresponds to a selectable Store category.
- Legacy dead code: `_countIfs()` and the `DATA_YEAR` literal it uses have
  no live caller.

## What is explicitly deferred

- **Phase 1H-C — implementing the Phase 1H-B enterprise identity
  architecture** (choosing an identity provider, building
  registration/login/approval UI, real user IDs, roles/permissions,
  sessions, an identity/access audit trail) — explicitly not started;
  awaits project-owner review of
  `reviews/004-phase-1h-enterprise-identity-architecture.md` and its
  `PENDING DECISION` list (§12) per that review's own stop condition.
- Moving admin access into `CONFIG_SYSTEM` (D-007).
- Making Brand/Region/Category admin-configurable (D-013) — deferred
  until after the admin-access gap, given Brand's larger blast radius.
- Wiring `CONFIG_KPI` into an actual calculation.
- A real PostgreSQL production deployment or any real-data migration
  (D-011) — paused pending a direct data export from the project owner.
- A separate `location_id` concept (D-002).

## Immediate next task

**Project-owner review of
`reviews/004-phase-1h-enterprise-identity-architecture.md`.** The 3
Required pilot security findings that were the one concrete blocker
named in that review's §11 are now fixed (Phase 1H-B.1,
`reviews/005-...md`) — Phase 1H-C (implementing any part of the
enterprise identity architecture) still awaits project-owner review of
`reviews/004`'s `PENDING DECISION` items (§12: identity provider choice,
token format, additional roles, non-admin MFA policy, exact schema), per
that review's own stop condition. This supersedes the previously-stated
next step (an Admin Configuration screen for admin access,
`reviews/001`/`002`, `DECISIONS.md` D-007) only in sequencing — that item
remains valid and relevant. No Phase 1H-C application work has begun.
