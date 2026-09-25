# Review 008 — Phase 1H-C Security Fix R1: MFA Is Now an Enforced Access Requirement

**Date:** 2026-09-25
**Type:** Application code change, scoped narrowly to one gap:
`reviews/007-phase-1h-c-implementation.md` disclosed that MFA was
enrollment-time proof of possession only, not a per-request re-check —
which did not satisfy the approved requirement, "MFA is required for
every Active user." This review records the fix. See `DECISIONS.md`
D-031 for the durable decision record.

---

## 1. Inspection performed before changing code

Re-read, as instructed: `SVMKPI_IDENTITY_ACCESS.gs` (`getCurrentUser()`/
`getAccessState()` — the read side), `SVMKPI_IDENTITY_MFA.gs`
(enrollment/verification, TOTP primitives), `SVMKPI_IDENTITY_CORE.gs`
(`_identity_currentUserHasPermission_()` — the one function every
protected identity operation already called), `SVMKPI_IDENTITY_ADMIN.gs`
(all 8 permission-gated functions), and the Phase 1H-B.1 security
mechanisms (`SVMKPI_ACCESS.gs`, `sl_isAdmin()`) to confirm they were
architecturally independent of the identity surface and therefore
correctly out of scope for this fix.

**Finding:** exactly one choke point, `_identity_currentUserHasPermission_()`,
was already called by every protected identity function
(`approveRegistration`, `rejectRegistration`, `assignRole`,
`assignPermissions`, `assignScope`, `suspendAccount`, `reactivateAccount`,
`disableAccount`, `identityAudit_list`, and `identityAdmin_getUserDetail`'s
multi-permission check). This made the smallest-possible fix straightforward:
strengthen that one function; no protected function needed its own edit.

**Session-mechanism check (the task's explicit stop condition):** this
pilot has no session mechanism (confirmed unchanged since Phase 1H-A).
Building one was out of scope. `PropertiesService.getUserProperties()`
was identified as a safe, minimal, native Apps Script primitive that
does NOT require inventing a session: it is server-side storage Apps
Script itself scopes to the executing Google identity — the same trust
primitive `Session.getActiveUser()` already provides everywhere in this
codebase — never a client-held token, cookie, or anything readable/
writable by browser code. It carries exactly one fact (MFA satisfied
until time T), never role/permission/identity data (all of that
continues to be re-read fresh from the `IDENTITY_*` sheets on every
call). This is not a general session and is not treated or described as
one anywhere in code or docs. No STOP condition was triggered.

## 2. What changed

**`SVMKPI_IDENTITY_CORE.gs`** — new §6.5: `_identity_markMfaSatisfied_()`,
`_identity_hasSatisfiedMfa_()` (fails closed: missing/malformed/expired
→ false), `_identity_clearMfaSatisfaction_()`, all backed by
`PropertiesService.getUserProperties()`, with a 12-hour TTL
(`IDENTITY_MFA_GATE_TTL_MINUTES`, a tunable policy constant, not itself
a security boundary). `_identity_currentUserHasPermission_()` now
delegates to a new `_identity_authorizeCurrentUser_(permissionKey)`,
which requires — in order — a linked identity, `ACTIVE` status, a
satisfied MFA credential, and the specific permission; returns a
specific, safe-to-surface denial reason for each failure mode.

**`SVMKPI_IDENTITY_ADMIN.gs`** — all 8 permission-gated functions
(`listPendingRegistrations`, `approveRegistration`, `rejectRegistration`,
`suspendAccount`, `reactivateAccount`, `disableAccount`, `assignRole`,
`assignPermissions`, `assignScope`) and `identityAudit_list()`
(`SVMKPI_IDENTITY_CORE.gs`) switched from the boolean
`_identity_currentUserHasPermission_()` check to
`_identity_authorizeCurrentUser_()`, surfacing the specific reason
("MFA verification required." vs. "Permission required: X.") instead of
a single generic message — purely a clarity improvement; the underlying
gate is the same function either way.

**`SVMKPI_IDENTITY_MFA.gs`** — `verifyMfa()` now marks the MFA-satisfied
credential on every successful verification (first-time enrollment
completion and every later re-verification alike), and gained anti-replay
protection: each TOTP time-step may satisfy at most one `verifyMfa()`
call (`IDENTITY_MFA_COL.LAST_USED_STEP`, monotonically enforced — a step
at or before the last-used one is refused, matching standard TOTP
anti-replay practice, RFC 6238 §5.2). `enrollMfa()` (fresh or reset)
clears any standing satisfaction, so a stale credential from an old
secret can never carry over to a new one.

**`SVMKPI_IDENTITY_ACCESS.gs`** — `getAccessState()` now reports
`mfaSatisfied` and `accountStatus` separately from `isActive`, which now
requires both `ACTIVE` status AND a satisfied MFA credential — matching
the approved requirement literally ("only after successful MFA may the
user establish an authenticated SVMI access state"). Still explicitly
informational only; the real gate remains
`_identity_authorizeCurrentUser_()`.

**`SVMI_PORTAL.html`** — the Account tab's MFA area now has three states
(not enrolled / enrolled-but-not-satisfied, prompting for a fresh code /
satisfied), reading `getAccessState()`'s new `mfaSatisfied` field. No
markup outside this one area changed.

**`database/migrations/013_identity_extension.sql`**: not touched — the
`identity_mfa` table already had room for this via its existing columns
plus the new `identity_mfa.secret`/status tracking; the anti-replay
"last used step" and satisfaction-window concepts are pilot-side
(`PropertiesService`) and Apps-Script-specific, with no Postgres
equivalent required for a logical-model match (a future real backend
would implement the equivalent via a session/token expiry column, a
distinct design decision left for Phase 1H-D+, not invented here).

## 3. Security model change

| Before this fix | After this fix |
|---|---|
| `_identity_currentUserHasPermission_()` checked: linked identity, `ACTIVE` status, permission | Same function (now via `_identity_authorizeCurrentUser_()`) also requires a satisfied, unexpired, server-side MFA credential |
| `verifyMfa()` success only flipped `IDENTITY_MFA.status` to `ENROLLED` | `verifyMfa()` success also marks the time-bounded satisfaction credential every protected function now checks |
| A TOTP code was valid for reuse throughout its ±1-step window | A given time-step can satisfy at most one `verifyMfa()` call (anti-replay) |
| `getAccessState().isActive` meant "`ACTIVE` account status" | `isActive` means "`ACTIVE` status AND MFA satisfied"; `accountStatus` is reported separately |

Never trusted, confirmed by test: client-supplied `mfaVerified`, role,
permission, or account-status values (no protected function accepts or
inspects any such argument); browser `localStorage` (never read by any
identity function); hidden form fields (irrelevant — every check is
server-side, re-resolving the actor from `Session.getActiveUser()`).

## 4. Tests added

`SVMI_Project/tests/identity.test.js` — expanded from 62 to **100
assertions**, all passing. New coverage, matching the 10 required items
exactly:

1. **R1.1** — an ACTIVE, correctly-permissioned admin who has not
   completed MFA is rejected by all 6 representative protected functions
   tested, with a message specifically naming MFA (not permission), and
   the target account is confirmed unmodified.
2. **R1.2** — an ACTIVE, MFA-satisfied, correctly-permissioned admin
   succeeds; MFA satisfaction alone is confirmed NOT to grant a
   permission the user doesn't separately hold.
3. **R1.3** — an invalid TOTP code is rejected and does not mark
   satisfaction.
4. **R1.4** — the MFA-satisfied credential's expiry is simulated
   directly via the same `PropertiesService` key the real code reads;
   access is refused once expired, and restored by a fresh
   re-verification against the same enrolled secret (no reset needed).
5. **R1.5** — replaying the exact same TOTP code a second time is
   rejected with a distinct "already been used" message, and recorded as
   a failed verification.
6. **R1.6** — a spoofed extra argument claiming MFA/role/permission/
   status is confirmed to have no effect; also confirms structurally
   that no file outside `SVMKPI_IDENTITY_MFA.gs` ever references
   `PropertiesService`.
7. **R1.7** — a fully-authorized admin can still perform every
   permission-gated action; a plain, MFA-satisfied `USER` is still
   correctly denied `ADMIN`-only actions (permission checks, unchanged).
8. **R1.8** — `getAccessState()`/`getCurrentUser()` never return the TOTP
   secret.
9. **R1.9** — the verification code and the TOTP secret never appear in
   any `IDENTITY_AUDIT` row.
10. **R1.10** — the full regression suite (below).

Existing tests in the same file were updated (not weakened) to complete
the real `enrollMfa()`→`verifyMfa()` flow for every admin/actor setup —
a new shared `makeAdmin()`/`completeMfaEnrollment()` test helper — since
those tests now exercise the actual required flow rather than a
shortcut.

## 5. Full test results

- `identity.test.js`: **100/100.**
- Full existing suite (24 other files, including
  `security-remediation.test.js`, unaffected by this fix): all green.
  **Total: 1229 assertions across 25 files, 0 failures** (`identity.test.js`
  grew from 62 to 100 assertions within the same file; no new test file
  was added this pass).
- `database/dryrun/dryrun.test.js`: **158/158**, unaffected.
- Responsive check (same ad hoc, uncommitted Playwright script as
  `reviews/007`'s, re-run against the real `SVMI_PORTAL.html`): 18/18
  structural/layout checks pass at phone/tablet/desktop widths. **Caveat:**
  this offline check stubs `google.script.run` as a no-op, so
  `getAccessState()` never actually resolves and the new three-state MFA
  prompt UI itself was not visually exercised by this run — only the
  surrounding tab/panel structure was confirmed unaffected. The MFA
  prompt markup was verified by direct code reading, not a live
  screenshot.

**⚠ PARTIALLY SUPERSEDED — see `reviews/009-phase-1h-c-security-fix-r2.md`.**
§6's disclosed limitation "the 45+ pre-existing `sl_isAdmin()`-gated call
sites do not require MFA — that system was explicitly out of scope" was
then flagged as leaving the approved "MFA is required for everyone"
requirement not globally enforced (a second, MFA-independent
authorization path). `reviews/009` records the fix: `sl_isAdmin()` itself
now also requires a satisfied MFA credential, via a dedicated legacy-
admin MFA bridge. Everything else in this review is preserved unedited
as the historical record of what Security Fix R1 actually delivered —
read it alongside `reviews/009`, not as a replacement for it.

## 6. Remaining transitional limitations (unchanged or newly disclosed)

- **Still transitional (unchanged, per explicit instruction not to
  "fix"):** identity correlation still depends on registering with the
  same email as the Google account reaching this pilot deployment
  (D-025). This was not addressed and Google Workspace was not made a
  requirement — any syntactically valid email may still register.
- **Still a documented bridge (D-028, unchanged):** the TOTP secret is
  stored natively in `IDENTITY_MFA.secret`, pending external IdP
  selection. This fix did not convert that temporary bridge into a
  claimed-permanent architecture — the provider-neutral boundary is
  unchanged, and D-028's own status/rationale is untouched.
- **New, disclosed by this fix:** the 12-hour MFA-satisfaction TTL is a
  policy choice, not independently re-derived from any specific approved
  number — tune it via `IDENTITY_MFA_GATE_TTL_MINUTES` if a different
  window is later required, per a new decision.
- **New, disclosed by this fix:** satisfaction is scoped to the Google
  identity via `PropertiesService`, not to a specific browser/device/tab
  — the same Google account satisfying MFA in one browser is considered
  satisfied in another concurrent session on the same account. This
  matches the pilot's pre-existing lack of any browser/device-scoped
  session concept generally, not a new gap introduced here.
- **Unaffected by design:** the 45+ pre-existing `sl_isAdmin()`-gated
  call sites (Phase 1G/1H-B.1) do not require MFA — that system was
  explicitly out of scope, per D-026's "two systems coexist" decision,
  unchanged by this fix.

---

## Confirmation

No external identity provider was chosen or integrated. No OIDC/SAML
code was written. No PostgreSQL production cutover occurred. No general
session mechanism was added — `PropertiesService`-backed MFA
satisfaction carries exactly one bounded fact, not identity/role/
permission state. No unrelated module was refactored. `.clasp.json` was
not touched.
