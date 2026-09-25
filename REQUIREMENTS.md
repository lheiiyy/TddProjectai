# SVMI — Requirements

**No original requirements document exists in this repository.** The
requirements below are reconstructed from the live implementation
(`SVMI_Project/Apps Script/*`), `SVMI_Project/DEPLOY.md`, and
`SVMI_Project/README.txt` — they describe what the system demonstrably
does today, not a separately-authored specification. Treat this file as
a description of established behavior, not as license to add anything
not already implemented.

## 1. Core functional requirements (implemented)

- **Log a store visit** — Store, Date Visited, one or more Visitors,
  Purpose, optional Remarks, submitted through Input Portal.
- **Prevent duplicate visits** — an exact-duplicate submission (same
  store, date, and any overlapping visitor) is rejected server-side.
- **Track visit compliance** — per-store, per-category expected visit
  cadence, with a gaps view ("Unvisited This Month").
- **Score store risk** — "Store Health": a per-store risk score derived
  from visit frequency and QA/MS outcome history, with a decaying penalty
  for failures.
- **Track a weekly KPI tracker** — visit counts by visitor, by
  week/period, for a given reporting year.
- **Executive reporting** — a summary view (brand × month visit counts,
  purpose breakdown) read-only from the Web App.
- **Freeze historical reports** — finalize a year's reports into an
  immutable snapshot; correct via supersede, never edit (D-009).
- **Administer Stores/Visitors/Purposes** — create, rename (Store only),
  activate/deactivate, with an effective date and a recorded reason, and
  full version history (D-005).
- **Administer Risk/Compliance/KPI rules** — versioned thresholds/weights
  and per-category cadence rules.
- **Audit every configuration change** — actor, action, before/after
  values, effective date, reason.
- **Roll back a configuration entity** to a prior version (as a new
  version, never an edit).
- **Gate access** — Google sign-in, a shared guest password, and a
  separate admin email list controlling who sees the Admin tab.
- **Run on mobile** — the Web App URL, since Apps Script menus don't run
  in the Sheets mobile apps.

## 2. Non-functional requirements (implemented, and load-bearing — see `DECISIONS.md`)

- **Historical immutability** — `MASTER_LOG` is append-only; a
  configuration change is always a new version, never an edit to an
  existing row; a report snapshot, once finalized, is never edited.
- **Effective-dating** — every configuration change has an Effective From
  (and optional Effective To); "what applied on date D" is always
  resolvable from history, not just "what applies now."
- **No cross-entity inheritance** — a purpose with no configuration has
  none; it is never defaulted from another purpose (D-010).
- **Year isolation** — a reporting year's calculations never leak into or
  out of another year; the "current" year is derived from data, not a
  manual constant (D-008).
- **Defense-in-depth authorization** — every server-side mutation
  re-checks admin status itself; client-side hiding is convenience only.
- **Single authoritative write path** per entity type — no two ways to
  create/edit the same Store/Visitor/Purpose (D-005).
- **No production-data risk during migration work** — the PostgreSQL
  track never touches real data without an explicit, deliberate export
  (D-011).

## 3. Future enterprise identity/access requirements (approved target — Phase 1H-B, not yet implemented)

**Not implemented today.** These are the approved target requirements for
SVMI's future enterprise identity system, recorded per the project
owner's Phase 1H-B direction (`DECISIONS.md` D-015–D-023,
`reviews/004-phase-1h-enterprise-identity-architecture.md`). They
describe what SVMI's identity/access model is meant to become, not
current behavior — see Section 1 above ("Gate access") for what exists
today.

- **Delegate authentication to an external, standards-based identity
  provider** (OIDC primary, SAML where required) — SVMI does not
  maintain its own primary password database (D-015).
- **Keep authorization independent of authentication** — a verified
  external identity does not by itself grant SVMI access; SVMI owns
  account status, role, permissions, and approval (D-016).
- **Key user identity by an immutable internal User ID**, not email
  (D-017).
- **Require a request/approval workflow** before an account becomes
  active — no self-service SVMI password, no automatic activation
  (D-018).
- **Support an explicit account lifecycle** (`REQUESTED`/`VERIFIED`/
  `PENDING_APPROVAL`/`ACTIVE`/`SUSPENDED`/`DISABLED`/`REJECTED`) without
  ever affecting historical business records tied to that user (D-019).
- **Support extensible role-based access control** beyond today's
  `ADMIN`/`USER`, without redesigning authentication to add a role
  (D-020).
- **Treat MFA as an identity-provider responsibility**, mandatory for
  Admin accounts in production (D-021).
- **Never store IdP passwords, MFA secrets, or OTP values in SVMI**;
  refresh tokens only if a future backend explicitly requires and can
  secure them (D-022).
- **Maintain a separate identity/access audit trail** (access
  requests/approvals, login/logout, role/status changes, MFA state,
  privileged-operation allow/deny), distinct from `CONFIG_AUDIT`, and
  never logging secret values (D-023).

Which identity provider, exact token format, additional roles, non-admin
MFA policy, and exact schema are explicitly **not** decided by this list
— see `reviews/004-...md` §12 for the full PENDING DECISION set.

## 4. Explicitly out of scope / deferred (see `PROJECT_STATUS.md` for the full current list)

- Admin Configuration screen for admin access (guest password / admin
  email list) — not yet built (D-007).
- Admin Configuration for Approved Brands/Regions/Categories — still
  hardcoded (D-013).
- Any KPI calculation that actually consumes `CONFIG_KPI`'s target/weight
  fields — infrastructure exists, nothing reads it yet.
- A real PostgreSQL production deployment, or any migration of real SVMI
  data into it — DEV-schema-only today.
- A separate `location_id` concept independent of (Location, Brand)
  identity (D-002).
