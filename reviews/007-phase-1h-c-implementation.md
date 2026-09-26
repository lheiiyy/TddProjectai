# Review 007 — Phase 1H-C: Implementation Record

**Date:** 2026-09-25
**Type:** Application code change. Implements the approved scope recorded
in `reviews/006-phase-1h-c-planning.md` and `DECISIONS.md` D-024–D-030.
Additive to the existing pilot — no existing authentication, authorization,
or business logic was modified or removed.

**⚠ PARTIALLY SUPERSEDED — see `reviews/008-phase-1h-c-security-fix-r1.md`.**
This review's §5 item 2 ("MFA is not a per-request re-check... nothing in
this phase re-prompts for a TOTP code on subsequent visits") described a
real gap the project owner then flagged as not satisfying the approved
"MFA is required for every Active user" requirement. `reviews/008`
records the fix: MFA is now a server-authoritative access requirement,
not enrollment-time proof alone. Everything else below is preserved
unedited as the historical record of what Phase 1H-C's initial
implementation pass actually delivered — read it alongside `reviews/008`,
not as a replacement for it.

---

## 1. What was built

**Registration → verification → approval → active**, enforced server-side
at every step (`IDENTITY_VALID_TRANSITIONS`, `SVMKPI_IDENTITY_CORE.gs`):
`registerUser(fullName, email, department)` (any syntactically valid
email — D-024) → a hashed, rate-limited, time-limited email OTP
(`MailApp`) → `verifyRegistrationEmail(email, code)` → `PENDING_APPROVAL`
→ an ADMIN-permissioned actor calls `approveRegistration()`/
`rejectRegistration()` → `ACTIVE`/`REJECTED`.

**RBAC + permissions + scope**, kept as three separate concepts
(`DECISIONS.md` D-026): `ADMIN`/`USER` roles, seeded and extensible by
adding a row; named permissions (`REGISTRATION_APPROVE`, `USER_MANAGE`,
`ROLE_ASSIGN`, `PERMISSION_ASSIGN`, `SCOPE_ASSIGN`, `IDENTITY_AUDIT_VIEW`)
resolved server-side as the union of role-derived and direct per-user
grants; `SYSTEM`/`REGION`/`STORE` access-scope grants
(`assignRole()`/`assignPermissions()`/`assignScope()`).

**Account lifecycle** (D-027's 6-state list): `PENDING_VERIFICATION` →
`PENDING_APPROVAL` → `ACTIVE` → (`SUSPENDED`|`DISABLED`), plus
`REJECTED`. Every transition goes through
`_identity_transitionStatus_()`, which refuses anything not explicitly
listed — verified directly (an attempt to approve a still-unverified
registration fails; `DISABLED`/`REJECTED` are terminal).

**MFA foundation** (D-028): native TOTP (RFC 6238, `Utilities.
computeHmacSha1Signature`), required for all `ACTIVE` users,
self-service `enrollMfa()`/`verifyMfa()`. A documented, temporary
exception to D-022 — see §6.

**Identity/access audit** (D-023/D-029): `IDENTITY_AUDIT`, append-only,
separate from `CONFIG_AUDIT`. Every mutating identity function writes a
row before returning success; verified by test that no secret value
(verification code, TOTP secret) is ever present in any row.

**Offboarding hook**: `handleExternalIdentityDisabled(authProvider,
authSubject)` — disables the matching account. Not called by anything
today (no external IdP integrated); documented as the integration point
a future IdP webhook would use.

**Frontend**: an always-visible "Account" tab (registration, email
verification, MFA enroll/verify, status display) and an Admin → Identity
sub-tab (pending-registration queue with approve/reject, user lookup with
role/permission/scope assignment and suspend/reactivate/disable), both in
`SVMI_PORTAL.html`. Every button calls exactly one named service function
via the existing `callServer()` helper — no Sheet, row, or column name
appears in client-side code.

**Logical data model**: 9 new `IDENTITY_*` pilot sheets, mirrored
column-for-column by `database/migrations/013_identity_extension.sql`
(extends, does not edit, `002_users_roles.sql` — D-030).

---

## 2. Files changed

**Application code (new):**
`SVMI_Project/Apps Script/SVMKPI_IDENTITY_CORE.gs`,
`SVMKPI_IDENTITY_REGISTRATION.gs`, `SVMKPI_IDENTITY_ADMIN.gs`,
`SVMKPI_IDENTITY_ACCESS.gs`, `SVMKPI_IDENTITY_MFA.gs`.

**Application code (modified):** `SVMI_Project/Apps Script/SVMI_PORTAL.html`
(new nav item, two new tab sections, ~340 lines of new JS — all additive;
no existing markup/function removed or changed).

**Database (new):** `database/migrations/013_identity_extension.sql`,
`database/rollback/013_identity_extension.rollback.sql`.

**Database (modified):** `database/migrations/002_users_roles.sql`
(header comment only — a pointer to `013`, per D-030's append-only
discipline; no DDL changed), `database/scripts/harden_grants.sql`
(append-only enforcement for `identity_audit_log`, same pattern as
`audit_logs`).

**Tests (new):** `SVMI_Project/tests/identity.test.js` (62 assertions).

**Documentation:** this review; `PROJECT_STATUS.md`;
`IMPLEMENTATION_LOG.md`; `TESTING_LOG.md`; delta sections in
`REQUIREMENTS.md` §3a, `ARCHITECTURE.md` §4/§9/§9a, `DATA_MODEL.md` §7;
`DECISIONS.md` D-024–D-030 (recorded in the planning step,
`reviews/006`).

**Untouched:** every `SVMKPI_ACCESS.gs`/`SVMKPI_CONFIG.gs`/report-engine/
risk-engine file; `appsscript.json` (no new OAuth scope — `MailApp` needs
none beyond default authorization); `SVMI_Command_Center_Demo.html`;
`.clasp.json`; all 45+ existing `sl_isAdmin()` call sites.

---

## 3. Architecture / data / integration / security impact

**Architecture:** additive only. The pilot's outer access gate (Google
sign-in + guest password, `SVMKPI_ACCESS.gs`) and the `sl_isAdmin()`-gated
Configuration/rebuild/audit surface (Phase 1G/1H-B.1) are completely
unchanged — confirmed by the full existing 1129-assertion suite passing
unmodified. The new identity surface is a second, independent permission
system (D-026): holding `SETTINGS!G` admin status grants nothing in
`IDENTITY_*`, and vice versa.

**Data:** 9 new pilot Sheets, created lazily on first use
(`_identity_ensureSheet_()`, same get-or-create convention as
`SVMKPI_CONFIG.gs`). No existing sheet (`MASTER_LOG`, `SETTINGS`,
`CONFIG_*`) was read, written, or restructured. The Postgres extension
(`013_identity_extension.sql`) was applied end-to-end against a local
ephemeral Postgres 16 instance alongside `000`-`012`, inspected via `\d`,
rolled back cleanly, and the throwaway database dropped — proven locally,
not deployed anywhere (same standard as `000`-`012`).

**Integration:** `onOpen()`/`doGet()`/`doPost()` (`SVMKPI_ADMIN.gs`) were
not touched — the Account/Identity tabs are reached through the existing
`SVMI_PORTAL.html` shell, behind the existing gates. `getCurrentUser()`
correlates identity by matching `Session.getActiveUser().getEmail()`
against `IDENTITY_USERS.email` (D-025's disclosed hosting-layer
constraint — see §6).

**Security:** every mutating function re-verifies the actor's permission
server-side (`_identity_currentUserHasPermission_()`), resolved from the
actor's own server-verified Google identity — never from a client-supplied
`userId`/role/permission argument. Verified directly by test: a
permission-less `ACTIVE` user cannot grant itself a role (no
self-escalation), cannot approve registrations, and a spoofed token
cannot substitute for the real MFA-trigger capability token. Verification
codes are hashed at rest and rate-limited (5 attempts); the TOTP secret
is isolated in its own sheet, never returned by any read function after
initial enrollment.

---

## 4. Test results

- **New:** `SVMI_Project/tests/identity.test.js` — **62 assertions, 0
  failures.** Covers registration validation, email-OTP verification
  (correct/incorrect/lockout/replay), permission-gated approval/rejection
  (including "no linked identity" and "no permission" rejection paths),
  lifecycle-transition validity, role/direct-permission/scope grant and
  revoke (including effective-permission union), suspend/reactivate/
  disable, the external-disablement hook, a real TOTP enroll→verify
  round-trip (using the actual RFC 6238 implementation, not a stub) with
  clock-drift tolerance, and confirms no secret value ever appears in
  `IDENTITY_AUDIT`.
- **Full regression:** all 24 pre-existing files re-run unchanged —
  **1191 assertions across 25 files, 0 failures.**
- **Database:** `database/dryrun/dryrun.test.js` — 158/158, unaffected
  (this track's code was not touched). `013_identity_extension.sql` +
  rollback applied/verified/rolled back against a local ephemeral
  instance (§3).
- **Responsive:** an ad hoc Playwright check (not part of the committed
  suite — same disclosed limitation as the real portal's existing lack of
  committed browser-automation coverage, `ARCHITECTURE.md` §8) was run
  directly against the real `SVMI_PORTAL.html` at phone (375×812), tablet
  (768×1024), and desktop (1440×900) widths: the Account tab and the
  Admin → Identity sub-tab render with no horizontal overflow and all key
  controls visible at every width — 18/18 checks passed.
- **Syntax:** every new/changed `.gs` file and the portal's main
  `<script>` block parse cleanly under `new Function()` (`DEPLOY.md`'s
  "Checks before you push" convention).

---

## 5. Known limitations (disclosed, not hidden)

1. **Identity correlation (D-025).** `getCurrentUser()`/`getAccessState()`
   resolve "who is this" by matching the visiting Google account's email
   against `IDENTITY_USERS.email`. Registering with a different email
   than the Google account used to reach this pilot deployment means
   `getCurrentUser()` will not resolve that person's SVMI identity here —
   a consequence of the pilot's Apps Script Web App hosting (unchanged,
   out of scope to alter), not a restriction the data model or
   registration form themselves impose.
2. **MFA is not a per-request re-check (D-028).** No session mechanism
   exists (building one was explicitly out of scope), so `verifyMfa()`
   proves possession at enrollment time; nothing in this phase re-prompts
   for a TOTP code on subsequent visits.
3. **MFA secret storage (D-028).** `IDENTITY_MFA.secret` is stored
   natively in a Sheet cell — a documented, temporary exception to D-022,
   parallel to the guest password's own plaintext storage
   (`reviews/003`). Isolated from every general read path, but not
   encrypted at rest (Sheets cannot do so).
4. **Approval does not auto-grant a role.** `approveRegistration()`
   moves an account to `ACTIVE` but grants no role — a second,
   independent `assignRole()` call is needed before the person has any
   permission. This was a deliberate choice (D-026: approval and
   role-granting are two distinct admin actions, not one bundled
   default), not an oversight; it means a newly `ACTIVE` account is
   fully functional-but-permission-less until an admin assigns a role.
5. **No two-system unification.** The pre-existing `sl_isAdmin()`
   surface and the new permission system are independent by design
   (D-026) — an existing admin does not automatically gain any new
   identity-admin permission. Unifying them was explicitly out of scope
   (unrelated refactoring).
6. **`appsscript.json` unverified live.** As with every prior phase, this
   review inspected the manifest file in the repository; it did not (and
   cannot, from this environment) verify the live deployment's actual
   granted OAuth scopes — `MailApp.sendEmail()` is believed to work under
   default authorization based on Apps Script's documented behavior, not
   confirmed against a live deployment.

---

## Confirmation

No existing authentication, authorization, session, or business-logic
code was modified. No external identity provider was chosen or
integrated. No OIDC/SAML code was written. No PostgreSQL production
cutover occurred. `.clasp.json` was not touched — nothing was pushed to
any live Google Sheet as part of this task.
