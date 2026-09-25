# Review 009 — Phase 1H-C Security Fix R2: MFA Now Applies to the Legacy `sl_isAdmin()` Path

**Date:** 2026-09-25
**Type:** Application code change, scoped narrowly to one gap:
`reviews/008-phase-1h-c-security-fix-r1.md` §6 disclosed, as a known
limitation, that "the 45+ pre-existing `sl_isAdmin()`-gated call sites
do not require MFA — that system was explicitly out of scope." A
follow-up review determined that this left the approved requirement,
"MFA is required for everyone," not globally enforced: an admin could
still satisfy `sl_isAdmin()` — and every one of the 45+ functions it
gates — with no MFA at all, a second, independent authorization path
around Security Fix R1's fix. This review records the correction. See
`DECISIONS.md` D-032 for the durable decision record.

---

## 1. Inspection performed before changing code

**Required verification:** does any protected legacy operation execute
when the user is authenticated, authorized by `sl_isAdmin()`, but has
NOT satisfied MFA? Answered by direct code inspection, not assumed:

- `sl_isAdmin()` (`SVMKPI_ACCESS.gs`) checked only SETTINGS!G list
  membership, with no MFA check of any kind, before this fix.
- Grepped every `.gs` file for `sl_isAdmin()` call sites: **45 call
  sites across 15 files** (`SVMKPI_CONFIG.gs`, `SVMKPI_STORE_CONFIG.gs`,
  `SVMKPI_COMPLIANCE_CONFIG.gs`, `SVMKPI_RISK_CONFIG.gs`,
  `SVMKPI_KPI_CONFIG.gs`, `SVMKPI_PURPOSE_CONFIG.gs`,
  `SVMKPI_REPORT_SNAPSHOT.gs`, `SVMKPI_ADMIN.gs` (`portal_*` wrappers +
  5 Sheets-menu handlers), `SVMKPI_SETTINGS_MIGRATION.gs`,
  `SVMKPI_VISITOR_CONFIG.gs`, `INPUT_PORTAL.gs`, `SVMKPI_LAYOUT.gs`,
  `SVMKPI_KPI_REBUILD.gs`, `SVMKPI_MASTER_REBUILD.gs`,
  `SVMKPI_STORE_MASTER.gs`, `SVMKPI_RISK.gs`) — every one of them calls
  `sl_isAdmin()` (or, for the 5 engine-level re-checks, the same
  function via a `typeof`-guarded call) with no independent logic of its
  own. **Every single call site follows the identical `if
  (!sl_isAdmin())` pattern** — confirmed programmatically as part of this
  fix's own test suite (`identity-legacy-admin-mfa.test.js`'s "static
  inspection" section greps every `.gs` file for a second admin-check
  function; none exists).
- Confirmed `refreshRiskEngine()`'s unattended-daily-trigger bypass
  (`__systemToken`, Phase 1H-B.1) is checked BEFORE, and independently
  of, `sl_isAdmin()` — `if (!isSystemTrigger && ... !sl_isAdmin())` — so
  strengthening `sl_isAdmin()` itself cannot affect the legitimate
  unattended trigger path.
- Confirmed no other independent legacy admin-check mechanism exists —
  `_SL_SECRET_.adminEmails()` is called only from inside `sl_isAdmin()`
  and the one-time `menuSetupAccessControl()` bootstrap (not a gate).

**Conclusion:** exactly one choke point, `sl_isAdmin()`, gates the
entire legacy surface — the same "one function, many callers" shape
Security Fix R1 found for the new identity surface's
`_identity_currentUserHasPermission_()`. Strengthening `sl_isAdmin()`
itself was therefore both necessary and sufficient; no call site needed
its own edit.

**Central-enforcement safety check (required before choosing an
implementation):** the obvious central-enforcement approach — make
`sl_isAdmin()` require a satisfied, unexpired MFA credential from the
NEW identity system (`_identity_hasSatisfiedMfa_()`, keyed by
`IDENTITY_USERS.userId`) — was inspected and found unsafe:
`enrollMfa()`/`verifyMfa()` (that system's own self-service MFA
functions) both require an `ACTIVE` `IDENTITY_USERS` record, and a
SETTINGS!G admin is not necessarily registered there. Worse: there is no
bootstrap mechanism that creates the FIRST `ACTIVE`+`ADMIN`+
MFA-satisfied identity-system user — that system's own
`approveRegistration()` requires an already-`ACTIVE`,
already-MFA-satisfied approver holding `REGISTRATION_APPROVE`, a
circular dependency with no seed anywhere in the codebase (confirmed:
grepped for `bootstrap`/`seedFirstIdentityAdmin`/`menuSetupIdentity`-
style functions; none exist, unlike the legacy system's own
`menuSetupAccessControl()` first-admin seeding). Gating `sl_isAdmin()`
on that system would have **permanently locked out every existing
admin**, with no interactive way back in — the opposite of "the
smallest safe change necessary." This is exactly the kind of unsafe
central-enforcement case the task's own guidance anticipated ("if
central enforcement is not safe, identify the smallest reusable
helper") — see §2 for the helper actually built.

## 2. What changed

**`SVMKPI_ACCESS.gs`** — new SECTION 5:
- `_isOnLegacyAdminList_(email)`: the exact pre-R2 `sl_isAdmin()` logic
  (SETTINGS!G membership, nothing else), extracted unchanged so
  `enrollAdminMfa()`/`verifyAdminMfa()` can gate on list membership
  ALONE — gating self-enrollment on "already MFA-satisfied" would make
  first enrollment impossible (the same circularity §1 rejected, just
  one level down).
- `sl_isAdmin()` now requires `_isOnLegacyAdminList_(email)` **AND**
  `_identity_hasSatisfiedMfa_(_legacyAdminMfaKey_(email))`
  (`typeof`-guarded — see §3). No parameters, so nothing for an RPC
  caller to spoof.
- `_legacyAdminMfaKey_(email)`: `'LEGACY_ADMIN:' + email`, a
  `PropertiesService`/`IDENTITY_MFA`-sheet key namespace that can never
  collide with a real `USR-<uuid>` identity User ID.
- `_legacyAdminMfaRow_(email)`: reuses the `IDENTITY_MFA` sheet/schema
  (no new sheet).
- `enrollAdminMfa()` / `verifyAdminMfa(code)`: self-service, legacy-admin
  equivalents of `enrollMfa()`/`verifyMfa()` (SVMKPI_IDENTITY_MFA.gs),
  reusing the exact same TOTP primitives (RFC 6238, same anti-replay via
  `LAST_USED_STEP`) and the exact same `PropertiesService`-backed
  satisfaction gate (`_identity_markMfaSatisfied_`/
  `_identity_hasSatisfiedMfa_`/`_identity_clearMfaSatisfaction_`,
  `SVMKPI_IDENTITY_CORE.gs` §6.5, unmodified) — gated on
  `_isOnLegacyAdminList_()` only. Both write to `IDENTITY_AUDIT` via the
  existing `_identity_writeAudit_()`, using the synthetic key as
  actor/target; never a secret value.
- `sl_getAdminMfaStatus()`: read-only, reveals only the CALLER's own
  `{onAdminList, mfaEnrolled, mfaSatisfied}` — never the underlying
  admin list to anyone, admin or not.

**`SVMI_PORTAL.html`** — a new, minimal admin-MFA banner (top of page,
hidden unless the signed-in Google account is on the admin list AND MFA
is not yet satisfied), driving `enrollAdminMfa()`/`verifyAdminMfa()`
through the same visual pattern the Account tab's MFA area already
established. This is not cosmetic: without it, R2 would have shipped a
security fix with no interactive way for any legacy admin to ever
complete it, locking every one of them out.

**No other file changed.** No `.gs`/`.html` file outside these two was
touched. `database/migrations/013_identity_extension.sql`: not touched
— the legacy admin MFA bridge is pilot-side (`PropertiesService` +
`IDENTITY_MFA` sheet reuse) with no new schema shape, same reasoning
Security Fix R1 gave for its own gate.

## 3. Security model change

| Before this fix | After this fix |
|---|---|
| `sl_isAdmin()` returned `true` for any SETTINGS!G-listed email, no MFA check | `sl_isAdmin()` also requires a satisfied, unexpired, server-side MFA credential (`_legacyAdminMfaKey_`-scoped) |
| A SETTINGS!G admin could call any of the 45+ gated functions with zero MFA | The identical gate check (`sl_isAdmin()`) now blocks all 45+ until MFA is satisfied |
| No self-service MFA path existed for the legacy admin mechanism | `enrollAdminMfa()`/`verifyAdminMfa()`, self-service, list-membership-gated |
| Security Fix R1's MFA gate covered only the new identity surface | Both authorization paths now independently require MFA — still two independent systems (D-026 unchanged), each now MFA-gated on its own terms |

Never trusted, confirmed by test: client-supplied MFA/admin/role state
(`sl_isAdmin()` takes no parameters at all); forged `PropertiesService`
keys under an unrelated namespace (`SVMI_MFA_SATISFIED_UNTIL_USR-fake-
admin`, a bare `mfaVerified`/`isAdmin` key) have no effect — only the
exact `LEGACY_ADMIN:<email>` key, settable only via a real
`verifyAdminMfa()` success, is ever consulted; spoofed extra fields on a
protected operation's own arguments (no function accepts an MFA/role/
status flag).

**Typeof guard, not a silent bypass:** the new check inside
`sl_isAdmin()` is `typeof _identity_hasSatisfiedMfa_ === 'function' &&
!_identity_hasSatisfiedMfa_(...)`. If the identity subsystem
(`SVMKPI_IDENTITY_CORE.gs`) is somehow not loaded, this degrades to the
pre-R2 admin-list-only check rather than throwing. This mirrors an
**already-established, pre-existing precedent** in this exact codebase
(`typeof sl_isAdmin === 'function'` guards in `SVMKPI_LAYOUT.gs` etc.,
whose own comment states: "in the real deployed app all files share one
project, so sl_isAdmin is always present and this check always
applies"). In the real Apps Script deployment every `.gs` file is
combined into one project — there is no scenario where
`SVMKPI_IDENTITY_CORE.gs` exists in the repo but isn't loaded at
runtime. The guard exists solely so isolated unit-test sandboxes (most
of which stub `sl_isAdmin` directly and never invoke the real
implementation at all — confirmed: only `security-remediation.test.js`
and this fix's own new test file load the real `SVMKPI_ACCESS.gs`) don't
throw a `ReferenceError` for a dependency they never intended to
exercise. Proven directly by test (R2.12, §4).

## 4. Tests added

New file `SVMI_Project/tests/identity-legacy-admin-mfa.test.js` — **44
assertions, 0 failures.** Maps to the 6 required proof points, each
exercised against 4 representative real protected legacy functions
spanning 4 different categories (`store_create` — Store configuration;
`cmp_create` — Compliance configuration; `finalizeReport` — Report
snapshot admin; `portal_rebuildStoreHealth` — System Tools), plus a
static-inspection check that no second admin-check mechanism exists
anywhere in the codebase:

1. **R2.1** — an admin-listed user who has not completed MFA is
   rejected by all 4 representative operations, with the exact "Admin
   access required." message, before any of the operation's own logic
   runs.
2. **R2.2** — the same operations, once MFA is satisfied, are
   confirmed to pass the `sl_isAdmin()` gate (proven via the absence of
   the gate-rejection message — the operations then either succeed or
   fail on an unrelated, later dependency, which itself proves they got
   past the gate).
3. **R2.3** — an invalid TOTP code is rejected; `sl_isAdmin()` remains
   false.
4. **R2.4** — the satisfaction credential's expiry is simulated
   directly via the same `PropertiesService` key
   (`_identity_mfaGatePropertyKey_(_legacyAdminMfaKey_(email))`) the
   real code reads; access is refused once expired.
5. **R2.5** — replaying the exact same TOTP code a second time is
   rejected with the distinct "already been used" message.
6. **R2.6** — `sl_isAdmin()` takes no parameters at all; forged
   `PropertiesService` keys under unrelated namespaces, and spoofed
   extra fields on a protected operation's own arguments, are confirmed
   to have no effect on any of the 4 representative operations.
7. **R2.7 / R2.7b** — a user never on the admin list is still rejected
   (independent of MFA), including from `enrollAdminMfa()` itself; the
   Phase 1H-B.1 guest-password/admin-email findings remain intact and
   unaffected.
8. **R2.8** — `sl_getAdminMfaStatus()` never returns the TOTP secret; a
   fresh re-enrollment issues a genuinely new secret, not the original
   re-exposed.
9. **R2.9** — neither the TOTP secret nor a submitted code ever appears
   in any `IDENTITY_AUDIT` row, across both a successful and a failed
   `verifyAdminMfa()` call.
10. **R2.10** — `sl_getAdminMfaStatus()` reveals nothing about
    admin-list membership to a non-admin caller (exact-shape check on
    the returned object).
11. **R2.11** — static-source confirmation that
    `refreshRiskEngine()`'s system-trigger bypass short-circuits before
    ever reaching `sl_isAdmin()`.
12. **R2.12** — `sl_isAdmin()` degrades gracefully (no throw) when the
    identity subsystem isn't loaded, per §3's typeof-guard precedent.

`security-remediation.test.js` (Phase 1H-B.1's own 34 assertions) was
**not modified** and re-run unchanged as regression — it never loads the
identity files, so the new MFA check is the documented no-op described
in §3, and its existing assertion "sl_isAdmin() still returns true for a
real admin email" continues to pass exactly as before this fix.

## 5. Full test results

- `identity-legacy-admin-mfa.test.js`: **44/44** (new file).
- Full existing suite (25 pre-existing files, including
  `identity.test.js`'s 100 and `security-remediation.test.js`'s 34,
  unmodified): all green. **Total: 1273 assertions across 26 files, 0
  failures.**
- `database/dryrun/dryrun.test.js`: **158/158**, unaffected (this
  track's code was not touched).
- Syntax: `SVMKPI_ACCESS.gs` and `SVMI_PORTAL.html`'s main `<script>`
  block (now ~141,472 chars) parse cleanly under `new Function()`
  extraction (`DEPLOY.md`'s "Checks before you push" convention); the
  pre-existing, unrelated scriptlet block-0 syntax error noted in
  `reviews/007`/`reviews/008` is unchanged.
- Responsive/UI: the new admin-MFA banner was verified by direct code
  reading and the syntax check above, consistent with this repository's
  disclosed limitation (no committed browser-automation coverage of the
  real `SVMI_PORTAL.html` — `ARCHITECTURE.md` §8, unchanged by this
  fix). Not visually exercised live in this environment.

## 6. Remaining transitional limitations (unchanged, or newly disclosed)

- **Unchanged (D-025, D-028):** the new identity system's own
  Google-correlation and native-TOTP-storage limitations are untouched
  by this fix — it operates entirely on the pre-existing legacy path.
- **Unchanged (D-026):** the two authorization systems remain fully
  independent — this fix made BOTH require MFA, but did not unify their
  role/permission resolution. A legacy admin's `sl_isAdmin()`
  MFA-satisfied standing does not grant, and is not derived from,
  anything in the new identity/permission system, and vice versa.
- **New, disclosed by this fix (D-032):** the legacy admin MFA bridge
  and the new identity system's MFA gate are two entirely separate
  credentials — a person who is both a legacy admin AND a new-identity
  ACTIVE user must satisfy MFA on each path independently (once per
  path, each with its own 12-hour TTL). This is a direct consequence of
  keeping the two systems independent (D-026) and was not merged, per
  the task's explicit instruction not to select an IdP or otherwise
  redesign the identity system.
- **New, disclosed by this fix:** `enrollAdminMfa()`/`verifyAdminMfa()`
  reuse the `IDENTITY_MFA` sheet for storage, with rows keyed by a
  synthetic `'LEGACY_ADMIN:<email>'` string rather than a real
  `IDENTITY_USERS` User ID — an intentional reuse-not-duplicate choice,
  not a data-model unification; those rows are not real identity-system
  users and should not be treated as such by any future tooling that
  reads that sheet.
- **Unaffected by design:** `refreshRiskEngine()`'s unattended daily
  trigger (`__systemToken`) continues to run with no MFA check of any
  kind, exactly as before — it is not an interactive session and has no
  human present to prompt.

---

## Confirmation

No external identity provider was chosen or integrated. No OIDC/SAML
code was written. No PostgreSQL production cutover occurred. Google
Workspace was not made a requirement. No existing `sl_isAdmin()`-gated
behavior, admin-list logic, or Phase 1H-B.1 protection was removed or
weakened — `_isOnLegacyAdminList_()` is the exact pre-R2 check,
unchanged, and `security-remediation.test.js` passes unmodified. No
unrelated module was refactored. `.clasp.json` was not touched.
