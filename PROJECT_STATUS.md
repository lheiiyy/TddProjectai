# SVMI — Project Status

Last updated: 2026-09-25, recording that **Phase 1H-C is implemented**:
registration/email-verification, mandatory admin approval,
ADMIN/USER-plus-extensible-roles, permissions, system/region/store scope,
native MFA, and a separate identity/access audit domain — external IdP
selection and PostgreSQL cutover remain explicitly deferred. See
`reviews/007-phase-1h-c-implementation.md` (implementation record) and
`reviews/006-phase-1h-c-planning.md` (the plan it followed); new
decisions `DECISIONS.md` D-024–D-030. See `PROJECT_MEMORY.md` for
orientation and `IMPLEMENTATION_LOG.md` for the full phase-by-phase
history behind this summary.

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
fixed** (see `reviews/005-phase-1h-required-security-remediation.md`) →
**Phase 1H-C: the registration/approval/RBAC/scope/MFA identity
foundation implemented** (see
`reviews/007-phase-1h-c-implementation.md` — full detail in "What has
been completed" → Security/identity track, below). The System
Peripherals audit, Phase 1H-A, and Phase 1H-B were documentation/audit/
architecture-only; **Phase 1H-B.1 and Phase 1H-C are the two application-
code changes since Phase 1G** — Phase 1H-B.1 a scoped pilot-hardening
fix, Phase 1H-C new additive identity infrastructure alongside the
unchanged pilot access gate (D-025).

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
   existing 1095-assertion suite, all passing.
4. **Phase 1H-C — Registration/approval/RBAC/scope/MFA identity
   foundation** (code change; `reviews/007-phase-1h-c-implementation.md`,
   `DECISIONS.md` D-024–D-030) — implemented, additively, alongside the
   unchanged pilot access gate: `registerUser()`/`verifyRegistrationEmail()`
   (email OTP, hashed, rate-limited); mandatory admin approval
   (`PENDING_VERIFICATION`→`PENDING_APPROVAL`→`ACTIVE`/`REJECTED`,
   transitions enforced server-side); `ADMIN`/`USER` roles extensible via
   data, not code; permissions resolved server-side as role-derived ∪
   direct grants, never trusted from the client; configurable
   `SYSTEM`/`REGION`/`STORE` scope; native TOTP MFA (a documented,
   temporary exception to D-022 — D-028); a separate `IDENTITY_AUDIT` log
   (D-023/D-029); an always-visible "Account" tab and an Admin → Identity
   sub-tab in `SVMI_PORTAL.html`, both calling only named service
   functions, never a Sheet/row directly. New `database/migrations/
   013_identity_extension.sql`, verified end-to-end against a local
   ephemeral Postgres instance. 62 new tests (`identity.test.js`,
   including a real TOTP round-trip and a check that no secret ever
   appears in the audit log) plus the full existing suite, all passing —
   **1191 assertions across 25 files, 0 failures.** Responsive checks run
   ad hoc against the real portal (phone/tablet/desktop), all passing.
   External IdP selection/integration and PostgreSQL production cutover
   remain not implemented. See that review for full detail, disclosed
   limitations, and regression results.

**Database track**: PostgreSQL DEV schema (13 migrations + rollback
scripts), proven against a local ephemeral instance, including verified
column-level grant enforcement. Phase 2 real-data migration dry-run
tooling (Store/Visitor/Purpose identity reconciliation, operational
readiness, snapshot/integrity validation) built and unit-tested against
synthetic data — **158/158 passing** as of this check.

## What is currently being worked on

Nothing is mid-implementation. Phase 1G, Phase 1H-A, Phase 1H-B, Phase
1H-B.1, and Phase 1H-C are all complete, tested, documented, and pushed.
Phase 1H-D/whatever comes next (external IdP selection, or further
identity-surface work) has not been scoped — see "Immediate next task."

## What remains unresolved

**Security/identity — the 3 Phase 1H-A Required findings are fixed**
(Phase 1H-B.1) **and the registration/approval/RBAC/scope/MFA foundation
is implemented** (Phase 1H-C, `reviews/007-phase-1h-c-implementation.md`).
What remains, per that review's own disclosed limitations and the
Recommended/Future/Unknown items `reviews/003` §H never asked either task
to fix:
- The guest password and admin email list remain plaintext in `SETTINGS`
  (readable by anyone with Sheet access) and the guest password remains
  cached in browser `localStorage` by design — unchanged by either
  Phase 1H-B.1 or Phase 1H-C (the Phase 1H-C scope explicitly forbade
  removing it "merely to make the new architecture appear complete").
- `validateMasterLog()` still has no admin check of its own (it was Low
  risk/read-only, not a Required finding); only its Sheets-menu path
  (`menuValidateMasterLog`) is now gated.
- `menuSetupAccessControl()` (the one-time admin-bootstrap menu item) is
  still intentionally ungated — gating it would be self-defeating, since
  it is how the first admin gets seeded.
- No audit trail exists for *the pilot's own* authentication events,
  admin-list changes, or password rotations (Recommended item 6,
  `reviews/003`) — the new `IDENTITY_AUDIT` log (Phase 1H-C) covers only
  the new identity surface, not `sl_isAdmin()`/guest-password events.
- The guest password is a single shared secret with no per-user binding,
  rate limiting, or lockout (Recommended item 7).
- **New in Phase 1H-C, disclosed by design (D-025/D-028):**
  `getCurrentUser()`/`getAccessState()` correlate identity by matching
  the visiting Google account's email against `IDENTITY_USERS.email` — a
  person registering with a different email than the Google account they
  use to reach this pilot deployment will not resolve to their SVMI
  identity here. MFA is enrollment-time proof of possession only, not a
  per-request re-check (no session mechanism exists). The TOTP secret is
  stored natively (no external IdP exists yet to own it), a temporary
  exception to D-022.
- Everything in `reviews/003`'s Future/Unknown-Verification sections
  (a real, selected Identity Provider; server-side sessions; exact OAuth
  scopes/deployment facts) — unchanged, and explicitly out of scope for
  Phase 1H-B.1 and Phase 1H-C alike.

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

- **Choosing a specific external identity provider, OIDC/SAML
  implementation, provider-specific token/claims mapping, and production
  IdP cutover** — explicitly deferred by the approved Phase 1H-C scope
  itself (`reviews/006`/`reviews/007`, `DECISIONS.md` D-024). Phase 1H-C
  implemented SVMI's own registration/approval/RBAC/scope/MFA foundation
  behind a provider-neutral boundary instead, without picking a provider.
- Additional business roles beyond `ADMIN`/`USER`, and non-admin MFA
  policy — both explicitly left `PENDING DECISION` by Phase 1H-C's own
  scope (`reviews/006` §12/`reviews/007`).
- A session mechanism — Phase 1H-C's MFA is enrollment-time proof of
  possession only, by explicit design (see "What remains unresolved").
- Rewiring the 45+ existing `sl_isAdmin()`-gated call sites onto the new
  Phase 1H-C permission model — the two systems intentionally coexist
  (D-026); doing so would be unrelated refactoring.
- Moving admin access into `CONFIG_SYSTEM` (D-007).
- Making Brand/Region/Category admin-configurable (D-013) — deferred
  until after the admin-access gap, given Brand's larger blast radius.
- Wiring `CONFIG_KPI` into an actual calculation.
- A real PostgreSQL production deployment or any real-data migration
  (D-011) — paused pending a direct data export from the project owner.
- A separate `location_id` concept (D-002).

## Immediate next task

**Project-owner review of `reviews/007-phase-1h-c-implementation.md`**
and a decision on what comes next: either (a) select an external
identity provider and scope the OIDC/SAML integration behind the
provider-neutral boundary Phase 1H-C built, or (b) address one of the
still-open System Peripherals items below (an Admin Configuration screen
for admin access, `reviews/001`/`002`, `DECISIONS.md` D-007) first. No
application work has begun on either.
