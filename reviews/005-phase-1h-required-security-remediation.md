# Review 005 — Phase 1H-B.1: Required Pilot Security Remediation

**Date:** 2026-09-25
**Type:** Application code fix — the 3 Required findings from
`reviews/003-phase-1h-security-identity-audit.md` §H, carried forward in
`reviews/004-phase-1h-enterprise-identity-architecture.md` §11. **This is
a pilot-hardening fix only.** It does not touch authentication, does not
add a session mechanism, does not implement any part of the Phase 1H-B
enterprise identity architecture, and does not change the guest-password/
admin-email-list model itself (`DECISIONS.md` D-007 remains open).

---

## Finding 1 — `_getAdminEmails()`/`_getGuestPassword()` no access check of their own

**Implementation change** (`SVMI_Project/Apps Script/SVMKPI_ACCESS.gs`):
both functions used to be top-level function declarations, which
`google.script.run` exposes to any client by name regardless of the `_`
naming convention (this is a documented Apps Script platform behavior,
not specific to this codebase — see reviews/003 §H). Neither function can
safely carry its own `sl_isAdmin()` check: `sl_isAdmin()` itself depends
on reading the admin list (a check there would be circular), and
`_getGuestPassword()` must be readable *before* a visitor has proven
anything, since reading it **is** the password check
(`_handleWebAppRequest_()`).

The fix moves both into a plain object, `_SL_SECRET_ = { adminEmails,
guestPassword }`, instead of top-level functions. `google.script.run` can
only dispatch to a top-level function by name — a function that is a
property of an object, not a global function declaration, is
structurally unreachable through that calling convention. No shipped UI
ever called `_getAdminEmails`/`_getGuestPassword` via `google.script.run`
(confirmed in reviews/003), so this closes the RPC path at zero cost to
any legitimate caller — the two remaining internal call sites
(`sl_isAdmin()`, `_handleWebAppRequest_()`) call `_SL_SECRET_.adminEmails()`/
`_SL_SECRET_.guestPassword()` exactly as before, as ordinary in-script
function calls, unaffected by the change.

**Test coverage** (`SVMI_Project/tests/security-remediation.test.js`,
"REQUIRED FINDING 1" section, 8 assertions): confirms `_getAdminEmails`/
`_getGuestPassword` no longer exist as globals of any kind; confirms
`_SL_SECRET_` itself is not a function (so `google.script.run._SL_SECRET_()`
cannot even be attempted as a call) and that no top-level `adminEmails`/
`guestPassword` function exists either; confirms `sl_isAdmin()` and
`_handleWebAppRequest_()` still behave identically to before the fix
(admin/non-admin resolution, correct/incorrect password gating). No
secret value is printed anywhere in the test file or this report — the
test fixture uses an obviously-fake placeholder password string.

**Result:** Fixed. The raw admin email list and guest password are no
longer reachable via any `google.script.run` call, direct or otherwise.

**Remaining limitation:** this closes the *RPC* exposure only. Both
values remain plaintext in `SETTINGS` (readable by anyone with Sheet
access) and the guest password remains cached in browser `localStorage`
by design — those are the separate Recommended/Future items from
reviews/003 (guest-password hashing, an Admin Configuration screen for
admin access, D-007), explicitly out of scope for this task.

---

## Finding 2 — 5 report-rebuild engine functions have no admin check of their own

**Implementation change:** `buildExecutiveSummaryLayout()`
(`SVMKPI_LAYOUT.gs`), `buildKPI2026()` (`SVMKPI_KPI_REBUILD.gs`),
`rebuildDataSheetHeaders()` (`SVMKPI_MASTER_REBUILD.gs`), and
`rebuildStoreMasterInsight()` (`SVMKPI_STORE_MASTER.gs`) each now start
with:
```js
if (typeof sl_isAdmin === 'function' && !sl_isAdmin()) {
  throw new Error('Admin access required.');
}
```
reusing `sl_isAdmin()` exactly as the 45 existing `portal_*`/`cfg_*`/etc.
call sites already do — no new authorization primitive was introduced.
The `typeof` guard is the same soft-dependency pattern already
established in this codebase for `_cfg_syncLegacyMirror()`
(`ARCHITECTURE.md` §5): in the real deployed app all `.gs` files share
one project, so `sl_isAdmin` is always present and the check always
applies; the guard only matters for a test sandbox that never intended to
exercise auth at all, where it is a safe no-op.

`refreshRiskEngine()` (`SVMKPI_RISK.gs`) needed a different treatment: it
is the one engine with a legitimate unattended caller — the daily
`triggerRefreshDashboard()` time trigger (`SVMKPI_ADMIN.gs`), which runs
with no interactive Google sign-in to check `sl_isAdmin()` against.
Rather than weaken the check or trust a caller-supplied flag (explicitly
forbidden — see Security Rules below), the fix adds a second parameter,
`__systemToken`, compared against `_SYSTEM_TRIGGER_TOKEN_` — an
unguessable value generated fresh each script execution (`Utilities.getUuid()`),
never sent to any client, never logged. Only `triggerRefreshDashboard()`
holds it (defined in the same file, passed at the one legitimate call
site). This is a capability token, not a client-supplied "isAdmin" flag:
no RPC caller can supply the correct value without already having
server-side code execution, which is a different threat model entirely.

**Test coverage** ("REQUIRED FINDING 2" sections, 15 assertions): for
each of the 4 straightforward engines — direct unauthorized call throws;
a spoofed `{isAdmin:true}` argument does not bypass the check (the check
runs before the argument is ever inspected); an authorized admin is not
blocked by the gate (existing behavior preserved — full business-logic
correctness for these engines remains the responsibility of the existing
suites, `purpose-report-surfaces.test.js`/`kpi-purpose-config.test.js`/
etc., re-run unchanged as regression below); a sandbox that never loaded
`SVMKPI_ACCESS.gs` at all is unaffected (typeof-guard). For
`refreshRiskEngine()`: unauthorized direct call rejected; authorized
admin succeeds; a spoofed object and a guessed string both fail to
substitute for the real token; the simulated daily-trigger call (holding
the actual token) succeeds with no admin session.

**Result:** Fixed for direct/RPC invocation. `buildExecutiveSummaryLayout`,
`buildKPI2026`, `rebuildDataSheetHeaders`, `rebuildStoreMasterInsight`,
and `refreshRiskEngine` all now reject a non-admin caller server-side,
independent of whether the call arrived through their `portal_*` wrapper.

**Remaining limitation:** `validateMasterLog()` (`SVMKPI_CORE.gs`) was
explicitly *not* given its own check — it was flagged Low risk in
reviews/003 (read-only) and was not one of the 5 Required-finding
engines; only its Sheets-menu path is addressed, under finding 3 below.

---

## Finding 3 — Sheets-menu handlers rely on Sheet sharing, not `SETTINGS!G`

**Implementation change** (`SVMKPI_ADMIN.gs`): `menuRebuildDashboard()`,
`menuRefreshStoreHealth()`, `menuRebuildKPI2026()`,
`menuRebuildDataHeaders()`, and `menuValidateMasterLog()` each now call a
small shared helper, `_menuRequireAdmin_(ui)`, as their first line —
`sl_isAdmin()`, with an `ui.alert('Access Denied', ...)` in place of the
JSON rejection the `portal_*` wrappers return, matching this file's own
UI-driven idiom rather than inventing a new one. A rejected call returns
immediately, before the underlying engine is ever reached, and never
reaches `_adminError()` (which is for genuine runtime errors, not
authorization rejections).

This is deliberately **on top of**, not a replacement for, finding 2's
per-engine checks: `menuRefreshStoreHealth()` calls the now-gated
`refreshRiskEngine()`, so a non-admin is stopped by either layer — the
same "double-gated" defense-in-depth posture this codebase already uses
elsewhere (e.g. `store_create()` is gated both directly and via
`cfg_createConfiguration()`, reviews/003 §D).

**Test coverage** ("REQUIRED FINDING 3" section, 11 assertions): each of
the 5 menu handlers, called by a non-admin, shows the "Access Denied"
alert and never reaches its underlying engine (verified via a call
counter on a stubbed engine, not the real business logic — kept focused
on the authorization boundary); each still runs normally end-to-end for
an admin (engine called exactly once, no denial alert); `triggerRefreshDashboard()`
— a separate entry point from the menu handlers — is confirmed unaffected
by this menu-level change.

**Result:** Fixed. The Sheets-menu path and the Web App path now enforce
the *same* `SETTINGS!G` admin boundary for all 5 operations — a person
with Sheet Editor access but not on the admin list can no longer run any
of them from the menu.

**Remaining limitation:** `menuSetupAccessControl()` (the one-time
bootstrap menu item) was intentionally left untouched — it is how the
*first* admin gets seeded before any admin list exists, so gating it on
`sl_isAdmin()` would be self-defeating. This is unchanged from before
this task and was not part of any Required finding.

---

## Security Rules — how each was honored

- **Server-side authorization is authoritative** — every check added is
  a real, unconditional server-side `sl_isAdmin()` call (or the
  capability-token check for the one unattended-trigger case); no
  client-side hide/disable was added or relied on.
- **Never trust client-supplied role/admin flags** — verified directly by
  the "spoofed `{isAdmin:true}` argument" and "spoofed object/guessed
  string token" tests; every rejection test passes an attacker-controlled
  argument specifically designed to look like a bypass, and none work.
- **Never trust client-supplied email as proof of identity** — unchanged;
  identity still comes only from `sl_getCurrentUser()` →
  `Session.getActiveUser().getEmail()`, never touched by this task.
- **Fail closed on missing/invalid authorization** — every new check
  defaults to rejecting; the one intentional exception (the system
  trigger token) fails closed too, to `sl_isAdmin()`, whenever the token
  doesn't match exactly.
- **Preserve existing application/service boundaries** — no new file, no
  new CONFIG area, no new externally-callable RPC surface was added; the
  only new top-level functions are `_menuRequireAdmin_()` (an internal
  helper, mirrors an existing pattern) and none for finding 1 (the fix
  there *removes* two top-level functions rather than adding any).
- **Do not introduce unrelated refactoring** — every change is scoped
  exactly to the 3 findings; no unrelated code was touched, renamed, or
  reformatted.

---

## Tests and regression

- New file: `SVMI_Project/tests/security-remediation.test.js` — **34
  assertions, 0 failures**, covering all 6 required proof points from the
  task brief (unauthorized rejected; authorized admin succeeds; spoofed
  client flags cannot bypass; rebuild engines cannot be called directly
  without authorization; secret-returning functions do not expose secrets
  to unauthorized callers; Sheets-menu pathways cannot bypass the
  boundary).
- Full existing regression suite re-run unchanged, **24 files (23
  pre-existing + this one), 1129 assertions total, 0 failures** — see
  `TESTING_LOG.md` for the updated baseline and per-file counts.
- `database/dryrun/dryrun.test.js` re-run unchanged: **158/158 passing**
  (this track's application code was not touched by this task at all).

---

## Confirmation

No authentication mechanism, session mechanism, RBAC model, user schema,
PostgreSQL authentication, or registration/login UI was added or
redesigned. No identity provider was chosen. No `CONFIG_ACCESS` was
created. `SETTINGS!G2:G`/`SETTINGS!I2` remain the authoritative admin
list/guest password, exactly as before (`DECISIONS.md` D-007 unchanged).
The Phase 1H-B target architecture (`reviews/004-...md`) was not
implemented by this task — this was pilot hardening only, per the task's
own explicit scope rule.

**Files changed (application code):**
`SVMI_Project/Apps Script/SVMKPI_ACCESS.gs`,
`SVMI_Project/Apps Script/SVMKPI_ADMIN.gs`,
`SVMI_Project/Apps Script/SVMKPI_LAYOUT.gs`,
`SVMI_Project/Apps Script/SVMKPI_KPI_REBUILD.gs`,
`SVMI_Project/Apps Script/SVMKPI_MASTER_REBUILD.gs`,
`SVMI_Project/Apps Script/SVMKPI_STORE_MASTER.gs`,
`SVMI_Project/Apps Script/SVMKPI_RISK.gs`.

**Files added (tests):** `SVMI_Project/tests/security-remediation.test.js`.

**Files changed (documentation):** `PROJECT_STATUS.md`,
`IMPLEMENTATION_LOG.md`, `TESTING_LOG.md`, this review.
