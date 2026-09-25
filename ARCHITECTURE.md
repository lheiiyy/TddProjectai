# SVMI — Architecture

Scope: `SVMI_Project/` (live) and `database/` (future migration target).
See `PROJECT_MEMORY.md` for why these are the only two SVMI trees in this
repo, and `SVMI_Project/DEPLOY.md` for full operational/deployment detail
this file summarizes rather than repeats.

## 1. Runtime model (live system)

Google Apps Script bound to a Google Sheet, served two ways:
- Through the Sheet's own **custom menu** ("STORE VISIT KPI" → "Open
  Command Center"), for anyone with Sheet access.
- As a standalone **Web App** (`/exec` URL) — the only way to use it from
  a phone, since Apps Script menus don't run in the Sheets mobile apps.

`appsscript.json`:
```json
"webapp": { "executeAs": "USER_ACCESSING", "access": "ANYONE" }
```
`ANYONE` means "anyone with a Google account," not the public.
`USER_ACCESSING` means the script runs as the visiting account, which is
what makes `sl_getCurrentUser()`/the admin check reliable — but also means
every visitor needs their own Sheet access (Viewer to browse, Editor to
submit visits).

## 2. Access control — three independent layers

| Layer | Question | Configured via |
|---|---|---|
| Google sign-in | Real Google account? | `appsscript.json` |
| Guest password | Should this account use the app at all? | `SETTINGS!I2` (`SVMKPI_ACCESS.gs`) |
| Admin list | Should this account see the Admin tab? | `SETTINGS!G2:G` (`SVMKPI_ACCESS.gs`) |

Neither the guest-password gate nor the admin list has an in-app
Configuration screen today — both are edited by hand in the Sheet, or
bootstrapped once via the Sheets menu's "🔐 Set Up Access Control" item.
This is a known System Peripherals gap; see the "Known gaps" section of
`PROJECT_STATUS.md`.

`sl_isAdmin()` gates the Admin tab client-side for convenience only —
every server-side mutation re-checks it independently, so hiding a button
is never the real security boundary.

## 3. Portal structure (`SVMI_PORTAL.html`)

A single-page app, one `<script>` block, talking to the `.gs` files via
`google.script.run`. Slide-out nav drawer, current order:

1. **Reports** (default tab) — Executive Summary / KPI / Store Health, read-only
2. **Store Insights** — per-store profile, health score, insight text
3. **Unvisited This Month** — category-based compliance gaps
4. **Input Portal** — visit submission form
5. **Admin** (admin-gated; hidden entirely for non-admins) — five sub-tabs:
   - **Configuration** — versioned CRUD for all 7 `CONFIG_*` areas
   - **Audit** — append-only `CONFIG_AUDIT` log viewer
   - **Report Snapshots** — finalize/view frozen historical reports
   - **Tools** — rebuild/validation/maintenance actions (see §6) plus the
     one-time legacy-data migration tool
   - **Identity** (Phase 1H-C) — pending-registration approval/rejection,
     role/direct-permission/access-scope assignment — see §9a
6. **Account** (Phase 1H-C; always visible, not admin-gated —
   registration is exactly what a not-yet-approved person needs to
   reach) — registration, email-code verification, and self-service MFA
   enrollment; see §9a

There is no separate top-level "System Tools" tab anymore — it was folded
into Admin → Tools, and its former "Store & Roster Manager" card was
removed outright (Phase 1G; see `DECISIONS.md` D-005).

## 4. `.gs` file map (29 files)

| File | Role |
|---|---|
| `INPUT_PORTAL.gs` | Visit submission, duplicate-visit check; also now hosts the internal-only legacy-SETTINGS-mirror write primitives (`manageVisitor`/`managePurpose`/`portal_saveStore`/`portal_removeStore`) — no longer reachable from any UI, called only by the Configuration sync hooks below |
| `SVMKPI_CORE.gs` | Shared constants/enums, `MASTER_LOG` reader, validator, refresh engine |
| `SVMKPI_ACCESS.gs` | Guest password + admin list + current-user/admin-check RPCs |
| `SVMKPI_ADMIN.gs` | Sheets menu, Web App entry point (`doGet`/`doPost`) |
| `SVMKPI_ADMIN_API.gs` | Read-only aggregation for the Admin UI ("what exists" listings) |
| `SVMKPI_STORE_LOOKUP.gs` | Store profile/health/insight text, compliance gaps, unvisited-this-month |
| `SVMKPI_LAYOUT.gs` | Executive Summary sheet layout/formulas |
| `SVMKPI_KPI_REBUILD.gs` | KPI 2026-style weekly tracker sheet builder |
| `SVMKPI_MASTER_REBUILD.gs` | `MASTER_LOG`/`SETTINGS` header + formatting rebuild |
| `SVMKPI_RISK.gs` / `SVMKPI_RISK_LAYOUT.gs` | Store Health scoring engine + presentation |
| `SVMKPI_STORE_MASTER.gs` | Store Master Insight sheet builder |
| `SVMKPI_REPORTS.gs` | Read-only JSON for the Reports tab |
| `SVMKPI_CONFIG.gs` | Generic versioned-configuration engine (all 7 `CONFIG_*` areas) + `_cfg_syncLegacyMirror()` dispatcher |
| `SVMKPI_STORE_CONFIG.gs` | Store ID minting, CRUD, historical resolution, SETTINGS→Store-ID migration, `_storeSync_toSettings()` |
| `SVMKPI_VISITOR_CONFIG.gs` | Visitor operational-list query, migration, `_visitorSync_toSettings()` |
| `SVMKPI_PURPOSE_CONFIG.gs` | Purpose CRUD, configuration-status resolver, migration, `_purposeSync_toSettings()` |
| `SVMKPI_RISK_CONFIG.gs` | Versioned Risk thresholds/purpose-weight fallback chain |
| `SVMKPI_COMPLIANCE_CONFIG.gs` | Versioned per-category compliance cadence + period-to-date resolution |
| `SVMKPI_KPI_CONFIG.gs` | Versioned KPI target/weight storage (infrastructure only — see `PROJECT_STATUS.md`) |
| `SVMKPI_CALENDAR.gs` | Calendar-period (month/quarter/semi-annual) resolution |
| `SVMKPI_REPORTING_YEAR.gs` | Data-derived default reporting year (no manual annual rollover) |
| `SVMKPI_REPORT_SNAPSHOT.gs` | Finalize/supersede/freeze historical report snapshots |
| `SVMKPI_SETTINGS_MIGRATION.gs` | One-time, idempotent, admin-gated import of legacy `SETTINGS` data into `CONFIG_*` |
| `SVMKPI_IDENTITY_CORE.gs` | Phase 1H-C — `IDENTITY_*` sheet schema/access, permission resolution, identity/access audit writer (see §9a) |
| `SVMKPI_IDENTITY_REGISTRATION.gs` | Phase 1H-C — `registerUser()`, `verifyRegistrationEmail()` |
| `SVMKPI_IDENTITY_ADMIN.gs` | Phase 1H-C — approval/rejection, role/permission/scope assignment, suspend/reactivate/disable, external-disablement hook |
| `SVMKPI_IDENTITY_ACCESS.gs` | Phase 1H-C — `getCurrentUser()`/`getAccessState()`, the read side of the provider-neutral authentication boundary |
| `SVMKPI_IDENTITY_MFA.gs` | Phase 1H-C — native TOTP `enrollMfa()`/`verifyMfa()` |

`SVMI_Command_Center_Demo.html` is a **separate, standalone preview** —
not part of the Apps Script project, uses an in-memory data layer instead
of `google.script.run`. It's what `portal-ui.test.js`/`responsive-check.js`
actually drive (see `TESTING_LOG.md`); the real `SVMI_PORTAL.html` has no
browser-automation coverage of its own by design (documented in `DEPLOY.md`).

## 5. Configuration engine (`SVMKPI_CONFIG.gs`)

One generic, domain-agnostic versioning engine reused by all 7 areas
(`STORES`, `VISITORS`, `PURPOSES`, `RISK`, `COMPLIANCE`, `KPI`, `SYSTEM`).
Every configuration change is a new row in a `CONFIG_<AREA>` sheet, never
an edit — see `DATA_MODEL.md` for the exact envelope shape and
`DECISIONS.md` D-009 for why. `CONFIG_AUDIT` records every mutation;
`CONFIG_UNMAPPED_STORES` tracks historical store names the SETTINGS→Store-ID
migration couldn't confidently map.

**Legacy-mirror sync (Phase 1G):** `_cfg_syncLegacyMirror(area, entityId)`
is called after every successful Stores/Visitors/Purposes mutation
(create, activate, deactivate, rollback — all three mutation entry points
in `SVMKPI_CONFIG.gs`), and soft-dispatches (via `typeof` guards, so it's
a no-op when the area file isn't loaded) to that area's own
`_storeSync_toSettings()`/`_visitorSync_toSettings()`/`_purposeSync_toSettings()`.
Those reuse the original `INPUT_PORTAL.gs` write primitives internally.
This is the *only* thing that still writes to `SETTINGS` columns A–E/F/H —
see `DATA_MODEL.md` for exactly what remains authoritative there.

## 6. Admin → Tools (maintenance actions, not configuration)

Rebuild/refresh (Store Master Insight, Store Health, Executive Summary,
KPI 2026), validation (Validate `MASTER_LOG`), and repair (rebuild
`MASTER_LOG`/`SETTINGS` headers) actions — all admin-gated, all
independent of the Configuration engine's data (they operate on the
report sheets themselves), plus the one-time "Migrate Legacy Data" import
described in `DATA_MODEL.md`.

## 7. PostgreSQL migration path (`database/`) — DEV only

A from-scratch schema (`database/migrations/000`–`012`) mirroring the
Sheets model's own design principles (versioning envelope everywhere,
append-only correction, column-level grants enforcing which columns
`svmi_app` may mutate). Proven against a local, ephemeral DEV Postgres
instance only — **no persistent DEV instance, and no PROD instance, exists
yet.** A Phase 2 real-data dry run (pure-function reconciliation tooling,
zero database writes) is built and unit-tested against synthetic data,
paused because extracting real spreadsheet data would require either a
temporary export function pushed to the live production script (rejected
as a live-system risk) or a direct export from the project owner (the
chosen path, not yet provided). See `database/docs/05-environments.md` for
the DEV/PROD isolation model and `DATA_MODEL.md` for the schema summary.

## 8. Testing architecture

- **`SVMI_Project/tests/*.test.js`** — loads the REAL `.gs` source files
  into a Node `vm` sandbox with `SpreadsheetApp`/`Session`/`Utilities`
  mocked, and asserts against actual function behavior. No transpilation,
  no rewriting.
- **`portal-ui.test.js` / `responsive-check.js`** — Playwright, but against
  `SVMI_Command_Center_Demo.html` (the standalone preview), not the real
  portal — a deliberate, documented scope choice (`DEPLOY.md`).
- **`database/dryrun/dryrun.test.js`** — pure-function unit tests for the
  Phase 2 reconciliation tooling, entirely synthetic data, no database
  connection.
- **`database/validation/*.js`** — require a live Postgres connection; not
  exercised by this repository's own automated test run.

See `TESTING_LOG.md` for current pass counts.

## 9. Target enterprise identity & access architecture (Phase 1H-B — approved; foundation implemented in Phase 1H-C)

This section records the approved target for a future enterprise
identity system, per `DECISIONS.md` D-015–D-023 and
`reviews/004-phase-1h-enterprise-identity-architecture.md`. **As of
Phase 1H-C, the "SVMI User Identity"/"Account Status"/"RBAC / Permissions"
layers of the diagram below are live** — see §9a. The "Identity
Provider"/"Authentication"/"API / Backend" layers above them, and the
"PostgreSQL / Business Data" layer below, remain not-yet-implemented
target items (D-024: SVMI's own registration/verification currently
occupies the "Identity Provider" slot; Sections 1–8 above describe the
unchanged pilot storage/access gate this sits behind — D-025).

Target system boundary (provider-neutral by design, so the identity
provider can change without redesigning SVMI's business modules):

```
Web Frontend
      ↓
Identity Provider     (OIDC primary, SAML where required — which provider is PENDING DECISION)
      ↓
Authentication
      ↓
API / Backend
      ↓
SVMI User Identity    (immutable internal User ID + IdP subject — D-017)
      ↓
Account Status        (REQUESTED/VERIFIED/PENDING_APPROVAL/ACTIVE/SUSPENDED/DISABLED/REJECTED — D-019)
      ↓
RBAC / Permissions    (ADMIN/USER today, extensible — D-020)
      ↓
PostgreSQL / Business Data
```

Key structural rule (D-016): authentication (the IdP layer, proving
identity) and authorization (everything from "SVMI User Identity" down,
owned by SVMI) are independent — a verified IdP identity with no
`ACTIVE` SVMI account still has no access. This is the same
defense-in-depth principle the current pilot already applies via
`sl_isAdmin()` (§2 above), intended to carry forward rather than be
replaced.

See `reviews/003-phase-1h-security-identity-audit.md` for the pilot's
current, as-built model this replaces, and `reviews/004-...md` §12 for
the full list of items left `PENDING DECISION` (provider choice, token
format, role list beyond ADMIN/USER, MFA policy for non-admin users,
exact schema, migration timing).

## 9a. Phase 1H-C implementation — what's live

Registration → email-OTP verification → mandatory admin approval →
`ACTIVE`, RBAC (roles + role-permissions + direct per-user permissions),
configurable `SYSTEM`/`REGION`/`STORE` access scope, native TOTP MFA, and
a separate `IDENTITY_AUDIT` log — all built as pilot-storage `IDENTITY_*`
Sheets (`SVMKPI_IDENTITY_CORE.gs` §1, mirrored by
`database/migrations/013_identity_extension.sql`) plus 5 service files
(§4 above) and two `SVMI_PORTAL.html` additions: an always-visible
"Account" tab (self-service registration/verification/MFA) and an
Admin → Identity sub-tab (approval, role/permission/scope assignment).

This is deliberately **additive**, not a replacement: the pilot's
existing Google-sign-in + guest-password gate (§2 above) and
`sl_isAdmin()`-gated operations (Phase 1H-B.1) are completely unchanged.
The new `_identity_hasPermission_()` check is independent of
`sl_isAdmin()` — an existing `SETTINGS!G` admin does not automatically
hold any new identity-admin permission, and vice versa (D-026).

**Disclosed limitations** (see `DECISIONS.md` D-025/D-028 and
`reviews/007-phase-1h-c-implementation.md` for full detail):
`getCurrentUser()`/`getAccessState()` correlate "who is this" by matching
the visiting Google account's email against `IDENTITY_USERS.email` — a
person who registers with a different email than the Google account they
use to reach this pilot deployment will not resolve to their SVMI
identity here. MFA is enrollment-time proof of possession only, not a
per-request re-check (no session mechanism exists, and building one was
out of scope) — see `SVMKPI_IDENTITY_MFA.gs`'s own header comment. The
TOTP secret is stored natively (D-028), a temporary, documented exception
to D-022, since no external IdP exists yet to own it instead.
