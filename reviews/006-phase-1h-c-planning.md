# Review 006 — Phase 1H-C: Planning Record

**Date:** 2026-09-25
**Type:** Planning record, produced before any Phase 1H-C code change, per
that task's own "Required first action" gate. Decisions referenced below
(`DECISIONS.md` D-024–D-030) are recorded separately; this review is the
narrative plan, not a duplicate of them.

---

## 1. Scope, as approved

Implement now: registration, email OTP verification, pending approval,
admin approval/rejection, an individual user model, account lifecycle,
ADMIN/USER foundation, a permissions foundation, a configurable
system/region/store scope foundation, an MFA foundation, an
identity/access audit boundary, a provider-neutral authentication
boundary, a migration-compatible logical data model, and a responsive
registration/admin UI.

Deferred: specific external IdP selection, OIDC/SAML implementation,
provider-specific token/claims mapping, production external IdP cutover,
PostgreSQL production cutover, additional business roles beyond
ADMIN/USER, unrelated refactoring.

## 2. Resolved tension (not a blocking contradiction)

**MFA vs. D-022.** D-022 says SVMI must not store MFA secrets — written
for the target state where an external IdP owns authentication. Phase
1H-C requires MFA for all `ACTIVE` users while explicitly deferring IdP
selection, so SVMI has no one else to delegate secret custody to yet.
Resolved as D-028: native TOTP now, secret isolated in its own sheet
(never in a general user-listing read path), explicitly documented as a
temporary bridge exception — the same disclosed-limitation posture
already used for the plaintext guest password (`reviews/003`). D-022
remains the target-state rule once an IdP is adopted.

**No other blocking contradiction was found.** Two disclosed limitations
are recorded (D-025's Google-sign-in correlation constraint, D-028's MFA
secret custody) — both are documented trade-offs within the approved
scope, not open questions requiring further approval before starting.

## 3. Existing mechanisms — retained, replaced, bridged

| Mechanism | Disposition |
|---|---|
| Google sign-in (`appsscript.json` `access:"ANYONE"`) | **Retained**, unchanged — outer Web-App access gate (D-025) |
| Guest password (`SETTINGS!I2`, `_handleWebAppRequest_`) | **Retained**, unchanged — approval message explicitly forbids removing it "merely to make the new architecture appear complete" |
| Admin email list (`SETTINGS!G2:G`, `sl_isAdmin()`) | **Retained**, unchanged — continues gating all 45+ existing `CONFIG_*`/rebuild-engine/menu operations (Phase 1H-B.1). **Bridged**, not replaced: the new `IDENTITY_*` permission model is additive: it governs the NEW registration/approval/role/scope/MFA surface only. Rewiring the 45 existing call sites onto permissions is explicitly out of scope (unrelated refactoring). |
| `_SL_SECRET_` (Phase 1H-B.1) | **Retained**, unchanged |
| `Session.getActiveUser()`/`sl_getCurrentUser()` | **Retained**, unchanged as the Google-identity primitive; the **new** `getCurrentUser()` service operation is a distinct function that additionally resolves an `IDENTITY_USERS` row by email (D-025) |
| `CONFIG_AUDIT` | **Retained**, unchanged — continues logging only `CONFIG_*` mutations (D-023/D-029: identity events get their own, separate log) |

Nothing existing is silently changed. No file outside the new
identity-specific ones and their direct integration point (`onOpen()`
menu, `SVMI_PORTAL.html` nav) is touched.

## 4. New logical data model — pilot storage (Google Sheets)

Following the same append-only, typed-column discipline `SVMKPI_CONFIG.gs`
already established for `CONFIG_*` (not reusing its versioning envelope
verbatim — a user account is a stateful entity with lifecycle transitions,
not a "new version per change" configuration record, so it gets its own,
simpler shape):

| Sheet | Purpose | Key columns |
|---|---|---|
| `IDENTITY_USERS` | One row per person | User ID (`USR-<uuid>`, immutable), Full Name, Email, Department, Account Status, Auth Provider, Auth Subject, Email Verified At, Created At, Last Status Change At/By |
| `IDENTITY_VERIFICATION` | Pending email-OTP state | User ID, Code Hash (never plaintext), Expires At, Attempts |
| `IDENTITY_ROLES` | Role catalog | Role ID, Role Name, Description — seeded ADMIN, USER |
| `IDENTITY_PERMISSIONS` | Permission catalog | Permission Key, Description |
| `IDENTITY_ROLE_PERMISSIONS` | Role → Permission grants | Role ID, Permission Key |
| `IDENTITY_USER_ROLES` | User → Role grants | User ID, Role ID, Granted At/By |
| `IDENTITY_USER_SCOPE` | User → Scope grants | User ID, Scope Type (SYSTEM/REGION/STORE), Scope Value, Granted At/By |
| `IDENTITY_MFA` | TOTP enrollment (D-028) | User ID, Status, Secret (isolated sheet), Enrolled At |
| `IDENTITY_AUDIT` | Append-only event log (D-029) | Timestamp, Event Type, Actor User ID, Target User ID, Details (never a secret) |

Each sheet maps 1:1 to a future Postgres table (D-030), matching the
existing `CONFIG_*` ↔ migration-file convention.

## 5. Postgres migration — `013_identity_extension.sql` (D-030)

Extends (does not edit) `002_users_roles.sql`: adds `account_status`,
`email_verified_at`, and `auth_subject` nullability adjustments to
`users`; adds `permissions`, `role_permissions`, `user_scope`,
`identity_audit_log` tables; seeds `USER` into `roles`. DEV-only, not
applied to any live database in this phase (no persistent DEV/PROD
instance exists — `ARCHITECTURE.md` §7); validated by inspection and by
this repository's existing SQL-syntax conventions, not by an actual
`psql` run (none available in this environment) — reported honestly as
**NOT RUN AGAINST A LIVE DATABASE**, consistent with how earlier phases
report unverifiable-here facts.

## 6. Service layer (Apps Script) — new files

- `SVMKPI_IDENTITY_CORE.gs` — sheet accessors, `IDENTITY_AUDIT` writer,
  `_identity_hashCode_()`, shared validation.
- `SVMKPI_IDENTITY_REGISTRATION.gs` — `registerUser()`,
  `verifyRegistrationEmail()`.
- `SVMKPI_IDENTITY_ADMIN.gs` — `listPendingRegistrations()`,
  `approveRegistration()`, `rejectRegistration()`, `assignRole()`,
  `assignPermissions()`, `assignScope()`, plus suspend/reactivate/disable.
- `SVMKPI_IDENTITY_ACCESS.gs` — `getCurrentUser()`, `getAccessState()` —
  the provider-neutral authentication boundary's read side.
- `SVMKPI_IDENTITY_MFA.gs` — `enrollMfa()`, `verifyMfa()`.

All mutation functions: fail closed by default; never trust a
client-supplied role/permission/scope/approval value (every check re-reads
`IDENTITY_*` sheets server-side); write an `IDENTITY_AUDIT` row on every
state change; return only the fields the frontend contract needs — never
a raw sheet row, never a secret.

## 7. Frontend — `SVMI_PORTAL.html` / `SVMI_LOCK.html`

- A registration view (name/email/department + OTP step), reachable
  without an existing admin-approved account — added as a new
  pre-portal screen alongside the existing lock-screen flow, not
  replacing it (D-025).
- A new "Identity" sub-tab under Admin (alongside Configuration/Audit/
  Report Snapshots/Tools), admin-permission-gated: pending-registration
  queue, approve/reject, role/permission/scope assignment.
- All calls go through the named logical operations
  (`google.script.run.registerUser(...)`, etc.) — no Sheet/row/column
  name ever appears in client-side code, per the frontend/service
  boundary rule.
- Responsive: reuses the existing CSS breakpoints already covering
  desktop/tablet/phone (`SVMI_PORTAL.html`'s existing `.nav-item`/
  `.admin-sub` responsive rules), verified with the existing Playwright
  responsive pattern (`responsive-check.js`, 6 device profiles) — against
  `SVMI_Command_Center_Demo.html`, consistent with this repo's own
  documented, deliberate scope boundary for browser-automation coverage
  (`ARCHITECTURE.md` §8) — real-portal manual verification noted, not
  claimed as automated.

## 8. Integration impact

- **Zero change** to any existing `CONFIG_*`, `MASTER_LOG`, `SETTINGS`,
  reporting, or risk-scoring code path.
- **Zero change** to `appsscript.json` (no new OAuth scope needed —
  `MailApp.sendEmail()`, used for the OTP email, is available under Apps
  Script's default authorization, not a new scope grant).
- `onOpen()` menu gets one new item ("👤 Identity Admin" or similar) —
  the only touch to `SVMKPI_ADMIN.gs`.
- Test suite gains new files; the existing 1129-assertion baseline is
  re-run unchanged as regression (Phase 1H-B.1's own pattern).

## 9. Documentation impact (after implementation)

`PROJECT_STATUS.md`, `IMPLEMENTATION_LOG.md`, `TESTING_LOG.md` updated;
`REQUIREMENTS.md`/`ARCHITECTURE.md`/`DATA_MODEL.md` get delta sections
(not rewrites) for the new identity surface, mirroring how Phase 1H-B's
target-architecture sections were added; completion recorded in
`reviews/007-phase-1h-c-implementation.md` once code lands.

---

## Confirmation

This review records planning only. No application code, schema, or
deployment configuration was changed by this review. Implementation
proceeds next in this same task, per the approval message's own gating
instruction ("do not implement code until the above planning record and
implementation plan are complete").
