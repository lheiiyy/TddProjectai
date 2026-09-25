# SVMI — Project Status

Last updated: 2026-09-25, recording **Phase 1H-C Security Fix R2: MFA now
also applies to the pre-existing `sl_isAdmin()` legacy admin path**, not
just the new identity/permission surface — closing the dual-
authorization-path gap `reviews/008-phase-1h-c-security-fix-r1.md`
itself disclosed as a remaining limitation. See
`reviews/009-phase-1h-c-security-fix-r2.md` (this fix) and
`DECISIONS.md` D-032. Security Fix R1 (MFA enforced for the new identity
surface's `ACTIVE` users, `reviews/008`, `DECISIONS.md` D-031) and Phase
1H-C's broader scope remain as recorded in `reviews/006`/`reviews/007`
(`DECISIONS.md` D-024–D-030) — registration/email-verification,
mandatory admin approval, ADMIN/USER-plus-extensible roles, permissions,
system/region/store scope, native MFA, and a separate identity/access
audit domain; external IdP selection and PostgreSQL cutover remain
explicitly deferred. See `PROJECT_MEMORY.md` for orientation and
`IMPLEMENTATION_LOG.md` for the full phase-by-phase history behind this
summary.

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
foundation implemented** (see `reviews/007-phase-1h-c-implementation.md`)
→ **Phase 1H-C Security Fix R1: MFA enforced server-side as an actual
access requirement for the new identity surface** (see
`reviews/008-phase-1h-c-security-fix-r1.md`) → **Phase 1H-C Security Fix
R2: MFA also enforced on the pre-existing `sl_isAdmin()` legacy admin
path** (see `reviews/009-phase-1h-c-security-fix-r2.md` — full detail in
"What has been completed" → Security/identity track, below). The System
Peripherals audit, Phase 1H-A, and Phase 1H-B were documentation/audit/
architecture-only; **Phase 1H-B.1, Phase 1H-C, Security Fix R1, and
Security Fix R2 are the four application-code changes since Phase 1G** —
Phase 1H-B.1 a scoped pilot-hardening fix, Phase 1H-C new additive
identity infrastructure alongside the unchanged pilot access gate
(D-025), Security Fix R1 a scoped correction closing a gap Phase 1H-C's
own review had disclosed, Security Fix R2 a scoped correction closing a
gap Security Fix R1's own review had disclosed.

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
   `SYSTEM`/`REGION`/`STORE` scope; native TOTP MFA foundation; a
   separate `IDENTITY_AUDIT` log (D-023/D-029); an always-visible
   "Account" tab and an Admin → Identity sub-tab in `SVMI_PORTAL.html`,
   both calling only named service functions, never a Sheet/row directly.
   New `database/migrations/013_identity_extension.sql`, verified
   end-to-end against a local ephemeral Postgres instance. This pass's
   own review disclosed that MFA was enrollment-time proof only, not yet
   an enforced access requirement — closed by item 5 below.
5. **Phase 1H-C Security Fix R1 — MFA enforced as an actual access
   requirement** (code change; `reviews/008-phase-1h-c-security-fix-r1.md`,
   `DECISIONS.md` D-031) — `_identity_authorizeCurrentUser_()`
   (`SVMKPI_IDENTITY_CORE.gs`), the single choke point every protected
   identity function already called, now also requires a satisfied,
   unexpired MFA credential — server-side, `PropertiesService`-backed
   (scoped to the executing Google identity, never client-readable/
   writable), bounded to 12 hours, re-checked on every call, carrying no
   role/permission/identity data (explicitly not a general session).
   `verifyMfa()` gained anti-replay protection (a given TOTP time-step
   satisfies at most one call). `getAccessState().isActive` now requires
   both `ACTIVE` status and MFA satisfaction, matching the approved
   requirement literally. No session mechanism was built; no external
   IdP was chosen; no unrelated module was touched. 38 new tests
   (`identity.test.js` grew from 62 to 100 assertions) covering all 10
   required proof points (unauthorized-without-MFA rejected,
   authorized-with-MFA succeeds, invalid/expired/replayed codes
   rejected, spoofed client state has no effect, existing permission
   checks intact, secrets never returned/logged) plus the full existing
   suite, all passing — **1229 assertions across 25 files, 0 failures**
   (`identity.test.js`'s own count grew within the same file; no new
   test file was added this pass).
   Responsive checks re-run against the real portal, all passing (with a
   disclosed caveat — see that review). This pass's own review disclosed,
   as a known limitation rather than an oversight, that the 45+
   pre-existing `sl_isAdmin()`-gated call sites remained a second,
   MFA-independent authorization path — closed by item 6 below.
6. **Phase 1H-C Security Fix R2 — MFA now applies to the legacy
   `sl_isAdmin()` path too** (code change;
   `reviews/009-phase-1h-c-security-fix-r2.md`, `DECISIONS.md` D-032) —
   `sl_isAdmin()` (`SVMKPI_ACCESS.gs`), the single function every one of
   the 45+ pre-existing SETTINGS!G-gated call sites across 16 files
   already calls, now requires BOTH admin-list membership AND a
   currently satisfied MFA credential. Confirmed by full-codebase
   inspection to be the ONLY legacy authorization mechanism in this
   pilot — no second independent admin-check function exists anywhere —
   so strengthening this one function closed the gap for all 45+ call
   sites with zero edits to any of them. New self-service
   `enrollAdminMfa()`/`verifyAdminMfa()` (reusing the same TOTP and
   `PropertiesService`-backed satisfaction-gate primitives Security Fix
   R1 built, under a distinct `'LEGACY_ADMIN:<email>'` key namespace, no
   new sheet added) let a legacy admin complete this requirement WITHOUT
   needing a record in the new identity system — deliberately NOT
   unified with that system's own MFA gate, because no bootstrap path
   exists yet to create its first `ACTIVE`+`ADMIN`+MFA-satisfied user,
   and unifying them would have risked locking out every existing admin
   permanently (see `DECISIONS.md` D-032 for the full analysis).
   `refreshRiskEngine()`'s unattended-daily-trigger bypass is unaffected
   (it never reaches `sl_isAdmin()` when the system-trigger token
   matches). `SVMI_PORTAL.html` gained a minimal admin-MFA banner
   (enroll/verify) so legacy admins have an actual way to satisfy the
   requirement. 44 new tests (`identity-legacy-admin-mfa.test.js`, a new
   file) covering all 6 required proof points against 4 representative
   protected operations spanning 4 different categories (Store
   configuration, Compliance configuration, Report snapshot admin,
   System Tools) plus the full existing suite, all passing — **1273
   assertions across 26 files, 0 failures**. See that review for full
   detail, remaining transitional limitations, and regression results.

**Database track**: PostgreSQL DEV schema (13 migrations + rollback
scripts), proven against a local ephemeral instance, including verified
column-level grant enforcement. Phase 2 real-data migration dry-run
tooling (Store/Visitor/Purpose identity reconciliation, operational
readiness, snapshot/integrity validation) built and unit-tested against
synthetic data — **158/158 passing** as of this check.

## What is currently being worked on

Nothing is mid-implementation. Phase 1G, Phase 1H-A, Phase 1H-B, Phase
1H-B.1, Phase 1H-C, Phase 1H-C Security Fix R1, and Phase 1H-C Security
Fix R2 are all complete, tested, documented, and pushed. Phase 1H-D/
whatever comes next (external IdP selection, or further identity-surface
work) has not been scoped — see "Immediate next task."

## What remains unresolved

**Security/identity — the 3 Phase 1H-A Required findings are fixed**
(Phase 1H-B.1), **the registration/approval/RBAC/scope/MFA foundation is
implemented** (Phase 1H-C), **MFA is now an enforced, server-side access
requirement for the new identity surface** (Security Fix R1,
`reviews/008-phase-1h-c-security-fix-r1.md`), **and that same MFA
requirement now also applies to the pre-existing `sl_isAdmin()` legacy
admin path** (Security Fix R2,
`reviews/009-phase-1h-c-security-fix-r2.md`). What remains, per that
review's own disclosed limitations and the Recommended/Future/Unknown
items `reviews/003` §H never asked any of these tasks to fix:
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
- **Disclosed by design (D-025):** `getCurrentUser()`/`getAccessState()`
  correlate identity by matching the visiting Google account's email
  against `IDENTITY_USERS.email` — a person registering with a different
  email than the Google account they use to reach this pilot deployment
  will not resolve to their SVMI identity here. Unchanged by Security Fix
  R1.
- **Disclosed by design (D-028, unchanged by Security Fix R1):** the
  TOTP secret is stored natively in `IDENTITY_MFA.secret` (no external
  IdP exists yet to own it), a temporary, documented exception to D-022.
- **New, disclosed by Security Fix R1 (D-031):** the MFA-satisfied
  credential is scoped to the Google identity via `PropertiesService`,
  not to a specific browser/device/tab — the same account satisfying MFA
  in one browser is considered satisfied in a concurrent session on the
  same account. The 12-hour satisfaction window
  (`IDENTITY_MFA_GATE_TTL_MINUTES`) is a tunable policy choice, not
  independently re-derived from any specific approved number. MFA is
  required to establish/renew authenticated access; it is not equivalent
  to requiring a fresh TOTP code before every individual operation
  (clarified by D-032, applies to both MFA paths).
- **New, disclosed by Security Fix R2 (D-032):** the legacy admin MFA
  bridge (`enrollAdminMfa()`/`verifyAdminMfa()`) is deliberately separate
  from the new identity system's own MFA — a legacy admin's MFA standing
  does not carry over to the new identity surface, and vice versa,
  exactly mirroring D-026's "two independent systems" decision for
  authorization itself. Same `PropertiesService`-scoping and 12-hour-TTL
  caveats as D-031 apply to this bridge too.
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
- A general session mechanism — Security Fix R1's MFA-satisfaction
  credential is deliberately narrow (one bounded fact, `PropertiesService`-
  backed), not a session; building an actual session remains out of
  scope (`reviews/008` §1).
- Rewiring the 45+ existing `sl_isAdmin()`-gated call sites onto the new
  Phase 1H-C permission model — the two systems intentionally coexist
  (D-026); doing so would be unrelated refactoring. (Security Fix R2 made
  both paths require MFA — that is not the same as unifying them; role/
  permission resolution on the two paths remains fully independent.)
- Moving admin access into `CONFIG_SYSTEM` (D-007).
- Making Brand/Region/Category admin-configurable (D-013) — deferred
  until after the admin-access gap, given Brand's larger blast radius.
- Wiring `CONFIG_KPI` into an actual calculation.
- A real PostgreSQL production deployment or any real-data migration
  (D-011) — paused pending a direct data export from the project owner.
- A separate `location_id` concept (D-002).

## Immediate next task

**Project-owner review of `reviews/009-phase-1h-c-security-fix-r2.md`**
(and `reviews/007`/`reviews/008` alongside it) and a decision on what
comes next: either (a) select an external identity provider and scope
the OIDC/SAML integration behind the provider-neutral boundary Phase
1H-C built, or (b) address one of the still-open System Peripherals items
below (an Admin Configuration screen for admin access, `reviews/001`/
`002`, `DECISIONS.md` D-007) first. No application work has begun on
either.
