# Review 003 — Phase 1H-A Security & Identity Audit

**Type:** Read-only security/architecture audit. **Not** an implementation
review — no application code, configuration, credentials, deployment
settings, schema, or data were changed. See Section J.

**Date:** 2026-09-25
**Scope:** `SVMI_Project/Apps Script/` — authentication, identity,
authorization, session/access state, and privileged-access architecture,
as it exists today, plus what it implies for a future Identity
Provider → API → PostgreSQL architecture.
**Predecessor context:** `DECISIONS.md` D-007 already flagged that the
guest password and admin email list have no Admin Configuration screen;
this audit goes deeper into the mechanism itself, independent of that
gap.

---

## A. Executive Summary (plain language)

SVMI's current access model is **two independent gates plus one
per-function check**, all evaluated fresh on every request — there is no
session token, no cookie, and no cached authorization state anywhere in
the app's own code:

1. **Google sign-in** (enforced by Google, before any SVMI code runs) —
   proves *who* someone is.
2. **A single shared "guest password"**, stored in a spreadsheet cell —
   gates whether a signed-in Google account receives the app's HTML/JS at
   all. It is coarse (one password for everyone) and is not re-checked
   after the page loads.
3. **An admin email allow-list**, also a spreadsheet cell range — checked
   **again, independently, inside every privileged server function**,
   fresh on every call. Removing someone from this list takes effect on
   their very next privileged call, with no logout needed.

This model is coherent and, for the two things it was explicitly designed
to protect (configuration mutations and report rebuilds triggered through
the shipped UI), it works correctly and is defense-in-depth in most
places. The audit found two categories of finding that matter before an
enterprise deployment: (1) two "private" helper functions that return the
guest password and the full admin email list have **no access check of
their own** and are technically callable directly by anyone who has ever
loaded the real portal page (Section H, Required); and (2) a second,
independent privilege boundary (Google Sheet Editor/Viewer sharing) can
trigger the same destructive rebuild operations as the admin-gated Web
App buttons, without ever consulting the admin email list (Section D/H).
Neither is a defect in the sense of "does the wrong thing when used as
designed" — both are consequences of Apps Script's platform model
(`google.script.run` exposes every server function by name, and Sheet
menus run under Sheet-sharing permissions, not the app's own admin list)
that the current design did not fully close.

---

## B. Current Authentication Flow

```
Browser
  ↓  Google sign-in (enforced by Google before ANY SVMI code runs;
  ↓  appsscript.json: access:"ANYONE" = "anyone with a Google account")
doGet(e) / doPost(e)                              [SVMKPI_ADMIN.gs]
  ↓
_handleWebAppRequest_(e)                          [SVMKPI_ACCESS.gs]
  ↓  reads e.parameter.pw (URL query on GET, form body on POST)
  ↓  compares (trimmed) against _getGuestPassword() = SETTINGS!I2
  ├─ match, or no password configured yet → serve SVMI_PORTAL.html
  │    (template-evaluated; the just-entered password is written back
  │    into the page as `enteredPassword`)
  └─ no match → serve SVMI_LOCK.html (password form only)
  ↓
Browser receives either the real app or the lock screen.
  On the real app, an inline script writes `enteredPassword` into
  localStorage['svmi_pw'] in PLAINTEXT (SVMI_PORTAL.html:517).
  On the lock screen, a saved localStorage value is auto-resubmitted
  once (SVMI_LOCK.html); a wrong/rotated password clears it and shows
  the form instead of looping.
```

- **Login entry points:** the Web App URL (`doGet`) and the lock form's
  submit (`doPost`); also the in-Sheet "Open Command Center" menu item
  (`openUnifiedPortal`), which bypasses the password check entirely —
  see Section C, it relies on the Sheet's own share permissions instead.
- **Credential submission:** password field, POSTed from `SVMI_LOCK.html`
  (`method="POST"`). The server also accepts it via GET query parameter
  (`e.parameter.pw`), per the doGet/doPost code path and its own comment
  — the shipped UI never constructs such a URL, but the server does not
  reject one.
- **Password handling:** trimmed, compared as a plain string
  (`pw.trim() === required`) — no hashing, no rate limiting, no lockout.
- **Identity determination:** `Session.getActiveUser().getEmail()` — see
  Section C.
- **Authentication state:** none, server-side (Section F). Client-side:
  `localStorage['svmi_pw']`, indefinitely, until a rotation fails once.
- **Logout:** no app-level logout exists. A user leaves the app by
  closing the tab or signing out of Google itself; the remembered
  password in localStorage is never cleared by any user action other
  than a failed resubmission after rotation.
- **Reauthentication:** only forced by rotating `SETTINGS!I2` — the next
  full page load for that browser fails once, clears localStorage, and
  shows the lock form again.
- **Password storage location:** `SETTINGS!I2`, one plaintext cell, no
  hashing.
- **Password exposure risks:** see Section E and the Required finding in
  Section H (the `_getGuestPassword()` direct-call path). The password is
  also, by design, written into the served page and into
  browser-local storage in plaintext — an accepted trade-off in the
  code's own comments ("kept in the Spreadsheet so it's easy to rotate"),
  not an oversight, but worth stating plainly for the enterprise design.

---

## C. Current Authorization Flow

```
Any privileged server function (config mutation, rebuild, migration,
snapshot finalize/supersede)
  ↓
sl_isAdmin()                                       [SVMKPI_ACCESS.gs]
  ↓
sl_getCurrentUser() = Session.getActiveUser().getEmail()
  ↓  '' (no email visible) → false, immediately (fail closed)
  ↓
_getAdminEmails() = SETTINGS!G2:G, lowercased/trimmed, read fresh
  ↓
email present in that list?  → true / false
  ↓
Function proceeds only if true; otherwise returns
  { success:false, message:'Admin access required.' } and does nothing.
```

Client-side, `loadAdminStatus()` calls `sl_isAdmin()` once on load and
`applyAdminGating(isAdmin)` hides/shows admin-only buttons and the whole
Admin tab — **fail-closed on RPC failure** (`applyAdminGating(false)` in
the `withFailureHandler`). This client-side gate is consistently
described in the code's own comments as convenience only, and for every
function reachable through the shipped UI, that claim holds: the actual
`portal_*`/`cfg_*`/`store_*`/`purpose_*`/`risk_*`/`cmp_*`/`kpi_*`
functions **each re-check `sl_isAdmin()` themselves**, first line, before
doing anything (45 call sites — see Section D). No test of this claim
failed; `tests/admin-api.test.js`'s own "SECURITY" section exercises this
directly (Section on Testing below).

**Two exceptions to "the client-side gate is only convenience," found in
this audit:**

1. Five report-rebuild **engine** functions
   (`buildExecutiveSummaryLayout`, `refreshRiskEngine`, `buildKPI2026`,
   `rebuildDataSheetHeaders`, `rebuildStoreMasterInsight`) have **no
   `sl_isAdmin()` check of their own** — only their `portal_*` wrappers
   do. The shipped client only ever calls the wrapper. But because
   `google.script.run` exposes every top-level function in the project
   by name (a documented Apps Script platform behavior, not specific to
   this codebase), a signed-in user who has already loaded the real
   portal page could call the unwrapped engine function directly (e.g.
   via the browser console) and it would run with no admin check at all.
   `validateMasterLog` is in the same structural position but is
   read-only, so the impact there is materially lower.
2. `_getAdminEmails()` and `_getGuestPassword()` (Section H) — same
   platform mechanism, higher-severity outcome, since these return
   secrets rather than trigger a rebuild.

---

## D. Privileged Function Inventory

45 functions across 13 files call `sl_isAdmin()` and return
`{success:false, message:'Admin access required.'}` when it is false —
**every one of these was verified server-side gated**, not
client-side-only. Grouped by area (full list is mechanical — grep
`sl_isAdmin()` across `SVMI_Project/Apps Script/*.gs` for the exhaustive
enumeration):

| Area | Functions | Requires auth? | Requires admin? | Server-side check? | Risk if bypassed |
|---|---|---|---|---|---|
| Legacy-mirror sync (internal only, Phase 1G) | `manageVisitor`, `managePurpose`, `portal_saveStore`, `portal_removeStore` (`INPUT_PORTAL.gs`) | Yes | Yes | Yes, each | Low — not reachable from shipped UI at all; writes only the SETTINGS compatibility mirror |
| Report/sheet rebuilds (wrappers) | `portal_rebuildExecutiveSummary`, `portal_rebuildStoreHealth`, `portal_rebuildKPI2026`, `portal_rebuildDataHeaders`, `portal_rebuildStoreMaster`, `portal_validateMasterLog` (`SVMKPI_ADMIN.gs`) | Yes | Yes | Yes, each | Medium — wrappers are safe; see the unwrapped-engine exception above |
| Configuration engine | `cfg_createConfiguration`, `_cfg_setStatus` (activate/deactivate), `cfg_rollbackConfiguration` (`SVMKPI_CONFIG.gs`) | Yes | Yes | Yes, each | High if bypassed — this is the sole write path for Stores/Visitors/Purposes (`DECISIONS.md` D-005); not found bypassable |
| Store configuration | `store_create`, `store_update`, `_store_setOperationalStatus` (activate/deactivate), `store_reconcileUnmapped`, `store_migrateFromSettings` (`SVMKPI_STORE_CONFIG.gs`) | Yes | Yes | Yes, each (also double-gated via `cfg_createConfiguration`) | Low — defense in depth |
| Visitor configuration | `visitor_migrateFromSettings` (`SVMKPI_VISITOR_CONFIG.gs`) | Yes | Yes | Yes | Low |
| Purpose configuration | `purpose_create`, `purpose_update`, `purpose_activate`, `purpose_deactivate`, `purpose_rollback`, `purpose_migrateFromSettings` (`SVMKPI_PURPOSE_CONFIG.gs`) | Yes | Yes | Yes, each | Low |
| Risk configuration | `risk_create`, `risk_activate`, `risk_deactivate`, `risk_rollback` (`SVMKPI_RISK_CONFIG.gs`) | Yes | Yes | Yes, each | Low |
| Compliance configuration | `cmp_create`, `cmp_update`, `cmp_activate`, `cmp_deactivate`, `cmp_rollback` (`SVMKPI_COMPLIANCE_CONFIG.gs`) | Yes | Yes | Yes, each | Low |
| KPI configuration | `kpi_create`, `kpi_update`, `kpi_activate`, `kpi_deactivate`, `kpi_rollback` (`SVMKPI_KPI_CONFIG.gs`) | Yes | Yes | Yes, each | Low (also unwired to any calculation — `DECISIONS.md`) |
| Report snapshots | `finalizeReport`, `supersedeReportSnapshot` (`SVMKPI_REPORT_SNAPSHOT.gs`) | Yes | Yes | Yes, each | High if bypassed — would break the immutable-snapshot guarantee (`DECISIONS.md` D-009); not found bypassable |
| Legacy-data migration | `settingsMigration_run` (`SVMKPI_SETTINGS_MIGRATION.gs`) | Yes | Yes | Yes | Low — additive only, idempotent |

**Not admin-gated, by design (operational, not privileged):**
`getSidebarData`, `getStoreDetails`, `processSubmissionAsync`,
`checkDuplicateVisit` (`INPUT_PORTAL.gs`); all 8 `admin_*` read-only
aggregators (`SVMKPI_ADMIN_API.gs`, explicitly documented as
"same trust level as `getStoreHealthReport()`"); the various report/lookup
read functions (`SVMKPI_REPORTS.gs`, `SVMKPI_STORE_LOOKUP.gs`). These are
intentionally open to any authenticated, guest-password-holding user —
consistent with the two-tier model this app documents (operational vs.
admin), not a gap.

**Not admin-gated, found by this audit, NOT reachable from the shipped
UI, reachable only by a direct RPC/menu call:**

| Function | Reachable via | Server-side admin check? | Risk if invoked by a non-admin |
|---|---|---|---|
| `buildExecutiveSummaryLayout`, `refreshRiskEngine`, `buildKPI2026`, `rebuildDataSheetHeaders`, `rebuildStoreMasterInsight` | Direct `google.script.run` call (not shipped in any button); also indirectly via the Sheets-menu handlers below | No | Medium — overwrites report sheets from source data; no data loss, but unauthorized writes and possible resource/quota consumption |
| `validateMasterLog` | Same as above | No | Low — read-only |
| `menuRebuildDashboard`, `menuRefreshStoreHealth`, `menuRebuildKPI2026`, `menuRebuildDataHeaders`, `menuValidateMasterLog` (`SVMKPI_ADMIN.gs`) | Google Sheets custom menu (**requires Sheet Editor/Viewer access, a separate permission from `SETTINGS!G`**) | No — these call the engine functions above directly | Medium — same as above; gated only by Sheet-sharing, not the admin email list. **This is the "two different sources control the same behavior" case**: `SETTINGS!G` gates the Web App path, Sheet-sharing gates the menu path, to the same underlying operations. |
| `_getAdminEmails`, `_getGuestPassword` | Direct `google.script.run` call | No | **High** — see Section H, Required finding |

---

## E. Credential / Secret Inventory

| Location | What | Authoritative? | Exposed? | Protected? |
|---|---|---|---|---|
| `SETTINGS!I2` | Guest password (plaintext) | Yes | To the server, and to the client for the browser that unlocked it | Not hashed; readable by anyone with Sheet access; no dedicated Admin Configuration screen (D-007) |
| `SETTINGS!G2:G` | Admin email list | Yes | To the server; **also to any client via `_getAdminEmails()`, unguarded (Section H)** | No access check of its own; readable by anyone with Sheet access |
| Browser `localStorage['svmi_pw']` | Guest password, plaintext | No — derived/cached copy | To that browser only | Not encrypted (localStorage never is); persists until a rotation fails once |
| `SVMI_PORTAL.html` served page (`enteredPassword` template var) | Guest password, plaintext, momentarily in page source | No — transient, written once into localStorage and not referenced again | To that browser's page source at load time | N/A — by design, see Section B |
| Source code (`.gs`/`.html`) | No hardcoded secrets found | — | — | Confirmed clean — no API keys, tokens, or passwords in source |
| Script Properties / User Properties | **Not used anywhere in this codebase** | — | — | N/A |
| CacheService | **Not used anywhere in this codebase** | — | — | N/A |
| `Logger.log` / exception logging (Stackdriver) | Confirmed — no code path logs the password, the admin list, or the raw request-parameter object (`e`) | — | — | Clean |
| `CONFIG_AUDIT` | Actor email, action, before/after config *values* (never passwords — this sheet has no relationship to auth data) | Yes, for config history | To any admin viewing the Audit tab | N/A — not a secret store |
| API/RPC responses (other than `_getAdminEmails`/`_getGuestPassword`) | No response payload found that returns the password or the raw admin list | — | — | Clean |

---

## F. Session / Access-State Analysis

**There is no session mechanism in this application's own code.** No
`PropertiesService`, no `CacheService`, no cookies, no tokens are used
anywhere (confirmed by direct search across every `.gs` file).
`LockService` exists but is a concurrency mutex for visit submission and
report finalize/supersede, unrelated to authentication.

What exists instead:
- **Google's own sign-in session** — entirely outside this app's control;
  governed by Google's infrastructure, not by any SVMI code. "Logout"
  from SVMI's perspective does not exist as a concept; a user's Google
  session persists per Google's own rules.
- **The guest-password gate** — evaluated only at `doGet`/`doPost` (i.e.,
  only on a fresh page load), never on individual `google.script.run`
  calls. Once a page is loaded, RPC calls do not re-check it. This is
  documented, intentional design ("gates which HTML gets served... not
  individual google.script.run calls").
- **The admin check** — evaluated fresh, live, on every single
  privileged call, with no caching at any layer.

**Answering the audit's explicit question — can a user who was
previously authorized continue performing privileged operations after
their authorization should have been revoked?**
**No, not for the admin-gated functions in Section D's first table.**
Removing an email from `SETTINGS!G` takes effect on that user's very
next privileged call; there is nothing to invalidate because nothing is
cached. This is a genuine strength of the current design.

Two caveats:
- This guarantee does **not** extend to the unguarded engine/menu
  functions in Section D's second table, which have no revocation
  concept to speak of because they have no check at all.
- Revoking guest-password access (rotating `SETTINGS!I2`) does **not**
  immediately revoke an already-loaded browser tab's ability to keep
  calling admin-gated RPCs, if that user is still an admin — rotation
  only blocks a *future* full page load, not an open one. This matters
  operationally (an open tab keeps working after rotation) but does not
  weaken the admin check itself, which is independent of the password.
- **Concurrent sessions / replay:** the guest password is a shared
  secret with no session binding — the same password value can be reused
  from any number of browsers/devices simultaneously; there is no
  mechanism to detect or limit this, by design (it is meant to be shared
  among legitimate field staff).

---

## G. Deployment Security (repository-verifiable facts only)

From `SVMI_Project/Apps Script/appsscript.json`:

```json
{
  "timeZone": "Asia/Manila",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_ACCESSING", "access": "ANYONE" }
}
```

- **Web App access mode:** `"ANYONE"` — despite the name, this means
  "anyone with a Google account," not the public; Google's own sign-in
  is required before any request reaches this app's code. (`"ANYONE_ANONYMOUS"`,
  the actually-public option, is not set.)
- **Execution identity:** `"USER_ACCESSING"` — each request runs as the
  visiting Google account, not as whoever deployed the script. This is
  what makes `Session.getActiveUser()` return the real visitor's email.
  A side effect: every visitor needs their own Viewer/Editor access to
  the bound Spreadsheet, or their data calls fail with a permission
  error (documented in `SVMI_Project/DEPLOY.md`).
- **OAuth scopes:** **no `oauthScopes` array is declared** — the
  manifest uses Apps Script's auto-detect mode. The exact scope set
  actually requested at authorization time is determined by Google's
  tooling from the APIs the code calls (`SpreadsheetApp`, `HtmlService`,
  `Session`, `ScriptApp` for the daily trigger) and **cannot be fully
  enumerated from the repository alone.** `NOT VERIFIABLE FROM REPOSITORY`.
- **No `MailApp`, `UrlFetchApp`, `DriveApp`, or `GmailApp` usage** exists
  anywhere in the codebase — no external network calls, no email sending,
  no Drive access beyond the bound Spreadsheet itself.
- **Exception logging:** `STACKDRIVER` — uncaught exceptions are logged
  to Google Cloud's logging backend. This captures crashes, not
  deliberate security events (a failed guest-password attempt does not
  throw, so it is not logged this way either — see Section on Audit
  Logging below).
- **Actual live deployment version, deployment ID, who currently holds
  deploy/owner access to the Apps Script project, and the exact granted
  OAuth scope list:** `NOT VERIFIABLE FROM REPOSITORY` — these are
  properties of the live Google Cloud/Apps Script project, not of the
  checked-in source.

---

## Audit Logging (scope item 10)

`CONFIG_AUDIT` (`SVMKPI_CONFIG.gs`'s `_cfg_writeAudit()`) is the only
audit-log mechanism in the codebase. It is called **exclusively** from
`cfg_createConfiguration`, `_cfg_setStatus`, `cfg_rollbackConfiguration`,
`finalizeReport`, and `supersedeReportSnapshot` — i.e., **only
Configuration-area business mutations and report-snapshot lifecycle
events.** It records actor (`sl_getCurrentUser()`), area, entity, action,
before/after values, effective dates, and reason.

**It does not, and structurally cannot from its current call sites,
record:**
- Successful or failed authentication attempts (guest-password checks
  are not routed through it at all).
- Admin-list changes (`SETTINGS!G` is edited as a raw cell, never through
  a function that calls `_cfg_writeAudit`).
- Guest-password rotations (same reason).
- Any event from the unguarded engine/menu functions in Section D.

**Secrets in logs:** confirmed clean — no code path passes the password,
the admin list, or the raw request-parameter object into `Logger.log`,
`console.log`, `_cfg_writeAudit`, or `_adminError`.

**A related identity gap found while tracing this:** `processSubmissionAsync`
(the visit-submission writer) never calls `sl_getCurrentUser()` or
`Session.getActiveUser()` — a submitted visit's "Visited By" field is
whatever name(s) the submitter typed/selected, not derived from their own
signed-in identity. `MASTER_LOG` therefore has no server-verified link
between a visit row and the Google account that actually submitted it.

---

## H. Security Findings

### Required
1. **`_getAdminEmails()` and `_getGuestPassword()` have no access check
   of their own and return sensitive data.** Any signed-in user who has
   loaded the real portal page once (i.e., anyone who has the guest
   password) can call either directly via `google.script.run` — a
   documented Apps Script platform capability, not an app-specific bug —
   and receive the current guest password and/or the full admin email
   list. Neither function's name-prefix convention (`_`) provides any
   actual access restriction on this platform.
2. **Five report-rebuild engine functions have no admin check of their
   own** (`buildExecutiveSummaryLayout`, `refreshRiskEngine`,
   `buildKPI2026`, `rebuildDataSheetHeaders`, `rebuildStoreMasterInsight`)
   — reachable directly via `google.script.run` by any guest-password
   holder, bypassing the `portal_*` wrapper's admin check entirely.
3. **Two independent privilege boundaries control the same destructive
   operations**: the Web App path (`portal_*`, gated by `SETTINGS!G`) and
   the Sheets-menu path (`menuRebuild*`/`menuValidate*`, gated only by
   Google Sheet Editor/Viewer sharing) both reach the same underlying
   engine functions. A person with Sheet Editor access but not on the
   admin list can run them from the menu with no check at all.

### Recommended
4. No Admin Configuration screen exists for admin access (`DECISIONS.md`
   D-007) — carried forward from the prior audit, directly relevant here.
5. `MASTER_LOG` visit rows are not attributed to a verified signed-in
   identity (see Audit Logging section above) — worth deciding
   deliberately for an enterprise system where accountability matters.
6. No audit trail exists for authentication events, admin-list changes,
   or password rotations — only configuration-data mutations are logged.
7. The guest password is a single shared secret with no per-user
   binding, rate limiting, or lockout — acceptable for a small-team pilot,
   not for a larger population.

### Future (appropriate for the enterprise/PostgreSQL architecture, not the pilot)
8. Replace the guest password + admin-email-list model with a real
   Identity Provider, issued session tokens, and a role/permission table
   — see Section I.
9. Server-side session with explicit expiry/invalidation, replacing
   reliance on Google's own sign-in session lifetime plus per-call
   re-checks.
10. Structured security-event audit log (auth success/failure,
    permission changes, account status changes) separate from the
    business-configuration audit log.

### Unknown / Needs Verification
11. Exact OAuth scopes actually granted at deployment time (Section G).
12. Current live deployment version, who holds Apps Script project owner
    access, and whether `menuSetupAccessControl` has ever been re-run
    (which could add multiple admins over time) — none of this is
    verifiable from the repository.
13. Whether any Google Workspace-level audit log (outside this app's own
    code) separately records `doGet`/`doPost` invocations or Apps Script
    execution history — plausible via Google Cloud, but not something
    this repository can confirm.

---

## I. Enterprise Target Considerations

Mapping today's concepts to the target model
(`Identity Provider → Authentication → SVMI User Identity → Account
Status → Role → Permissions → API authorization → PostgreSQL/data
access`) — **assessment only, nothing implemented:**

| Target concept | Current SVMI equivalent | Fit |
|---|---|---|
| Immutable User ID | None — identity is a Google email string, used directly as the lookup key everywhere (`SETTINGS!G` membership, `CONFIG_AUDIT`'s actor field) | Gap — an email is not immutable (accounts get renamed/reissued); would need a real user ID, with email as one attribute of it. `database/migrations/002_users_roles.sql` already has a `users` table with this shape, unwired to the live app (D-011). |
| External identity/provider ID | Google's own account identity, consumed only as an email string via `Session.getActiveUser()` | Partial — Google Workspace could plausibly BE the IdP going forward, but today nothing stores a provider-issued subject ID, only the email. |
| Account status | None — presence on `SETTINGS!G` is binary admin/not-admin; there is no separate "active/suspended/pending" concept for any user, admin or not | Gap |
| Role | Exactly one role exists: admin (on `SETTINGS!G`) vs. everyone else (implicitly "operational user") | Gap for anything beyond a two-tier model; `database/migrations/002_users_roles.sql`'s `roles`/`user_roles` tables are unwired DEV-only schema (D-011) |
| Permissions | Not modeled at all — "admin" is all-or-nothing across every privileged function in Section D | Gap — no per-function or per-area permission granularity exists today |
| Registration state | None — see Section on Registration below | Gap |
| Approval state | None | Gap |
| MFA state | None — entirely delegated to whatever Google's own sign-in enforces for that account; SVMI has no MFA concept of its own | Gap, likely acceptable to continue delegating to the IdP |
| Session state | None (Section F) — would need a real concept for API-token-based auth | Gap |
| Audit events | Configuration mutations only (see Audit Logging section); no auth/permission/account-status events | Gap |

**What the current system would need before it could support the target
flow:** a real user-identity table (not email-as-key), a role/permission
model beyond binary admin/not-admin, an account-status field, session
issuance and expiry, and a security-event audit log distinct from
`CONFIG_AUDIT`. The DEV-only Postgres schema already has `users`,
`user_roles`, `roles` tables (`database/migrations/002_users_roles.sql`)
that were designed with this direction in mind, per `DATA_MODEL.md` —
they are unwired to anything live today.

---

## Registration / Approval (scope item 13)

**`NO USER REGISTRATION / APPROVAL WORKFLOW CURRENTLY IDENTIFIED.`**

There is no self-service sign-up anywhere in this codebase. Access is
granted entirely out-of-band: an existing admin manually adds a row to
`SETTINGS!G` (for admin access) or shares the guest password (for
operational access) and/or grants Viewer/Editor on the Spreadsheet itself.
`menuSetupAccessControl()` only bootstraps the *first* admin from
whoever runs it; it is not a registration flow for subsequent users.

**What would need to change to support
`Registration → Email verification → Pending approval → Admin
approval/rejection → Active account`:** an account-status field (none
exists today — see Section I), a registration entry point (none exists),
an approval action for admins (none exists — admins today only ever edit
`SETTINGS!G` directly), and email-verification capability (no `MailApp`
usage exists anywhere in the codebase today — see Section G). None of
this is designed here; this section only states the gap.

---

## J. Explicit Non-Goals / Confirmation

**No application code, configuration, credentials, deployment settings,
database schema, or production/live data were changed during this
audit.** Specifically not touched: authentication code, authorization
code, `SETTINGS`, Script Properties, User Properties, `appsscript.json`,
`.clasp.json`, any `.gs`/`.html` file, and no database migration/schema
file. This review, and the documentation updates listed in the
accompanying commit, are the only changes made.

No new setting (`CONFIG_ACCESS` or otherwise) was created. No fix was
applied to any finding above — every item in Section H is reported, not
remediated. Phase 1H-B (enterprise identity architecture design) is
explicitly out of scope for this review and was not started.
