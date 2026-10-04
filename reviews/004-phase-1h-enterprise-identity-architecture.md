# Review 004 — Phase 1H-B: Enterprise Identity & Access Architecture

**Date:** 2026-09-25
**Type:** Architecture/documentation record. **No application code, database
schema, deployment configuration, or production data was changed by this
review.** See Section 12 (Confirmation) below.

This review records the **approved target architecture** for SVMI's future
enterprise identity and access system, as directed by the project owner.
It does not implement any of it. The live pilot (`SVMI_Project/`) is
unchanged — see `reviews/003-phase-1h-security-identity-audit.md` for its
current, as-built security model.

---

## 1. Current-state security audit reference

The starting point for this architecture is
`reviews/003-phase-1h-security-identity-audit.md` (Phase 1H-A), which
established, from the actual code, that SVMI's pilot has:

- Two independent, stateless gates (Google sign-in; a single shared guest
  password in `SETTINGS!I2`) plus a per-call admin-email check
  (`SETTINGS!G2:G` via `sl_isAdmin()`) — no session mechanism at all.
- Email address as the sole identity key, with no immutable user ID, no
  account status, and no role granularity beyond admin/not-admin.
- No registration or approval workflow — access is Google-account-plus-
  shared-password only, active immediately, not admin-gated.
- No identity/access audit logging (`CONFIG_AUDIT` covers only
  configuration mutations, never auth events).
- 3 Required findings (two unguarded secret-returning functions, five
  unguarded rebuild-engine functions, a second unmonitored privilege
  boundary via the Sheets menu) that this review does **not** fix — see
  Section 11.

Everything below is the target this pilot is expected to eventually grow
into, not a description of what exists today.

## 2. Approved target identity architecture

Recorded as `DECISIONS.md` D-015 through D-023 (new entries this review
adds). Summary:

- **External authentication** (D-015): production authentication is
  delegated to an external, standards-based identity provider — OIDC as
  the primary protocol, SAML where a specific integration requires it.
  SVMI does not build or operate its own primary password database.
- **Authorization stays with SVMI** (D-016): the IdP proves who someone
  is; SVMI independently decides account status, role, permissions, and
  approval. Authentication success is not authorization.
- **Immutable identity** (D-017): the identity key is an internal,
  immutable User ID — not email. A user record carries that ID, the
  external IdP subject, current email, display name, account status, and
  role assignment.
- **Access request/approval** (D-018): authenticate → identity verified →
  request access → `PENDING_APPROVAL` → administrator review → `APPROVED`/
  `REJECTED` → `ACTIVE`. No self-service SVMI password, no automatic
  activation.
- **Account lifecycle** (D-019): `REQUESTED`, `VERIFIED`,
  `PENDING_APPROVAL`, `ACTIVE`, `SUSPENDED`, `DISABLED`, `REJECTED`.
  Historical business records are never affected by a later status change.
- **RBAC** (D-020): current roles `ADMIN`/`USER`; the architecture must
  allow more roles later without redesigning authentication.
- **MFA** (D-021): an identity-provider responsibility. Future policy:
  Admin accounts require MFA; user-role MFA policy is an open, separate
  future decision.
- **Credential separation** (D-022): SVMI never stores IdP passwords, MFA
  secrets, or OTP values; provider refresh tokens only if a future backend
  explicitly requires and can secure them — never in Sheets or ordinary
  configuration.
- **Identity/access audit domain** (D-023): a future audit trail for
  access-request/approval/login/logout/role-change/admin-change/MFA-state/
  privileged-operation events, kept conceptually separate from
  `CONFIG_AUDIT` (which is scoped to `CONFIG_*` configuration mutations
  only, per `DATA_MODEL.md` §3). Secrets are never logged, in either
  domain.

No identity provider, login technology, token format beyond "OIDC/SAML,
standards-based," or provider-specific claim has been chosen — see
Section 12.

## 3. Authentication vs authorization boundary

This is the central structural rule of the target architecture (D-016):
the identity provider answers "is this really the claimed person," and
that answer alone never implies "this SVMI account may do X." SVMI's own
account-status/role/permission state is checked independently, on every
privileged action — the same defense-in-depth discipline the pilot
already applies today via `sl_isAdmin()` (reviews/003 §C), intended to
carry forward rather than be replaced by IdP adoption, not weakened by it.

A verified IdP identity with no corresponding `ACTIVE` SVMI account (e.g.
still `PENDING_APPROVAL`, or `SUSPENDED`) has proved who they are and
still has no SVMI access.

## 4. User/account logical model

Target logical entity (name and exact schema are PENDING DECISION — see
`DATA_MODEL.md` §7 for how this maps toward, and diverges from, the
existing DEV-only Postgres tables):

| Attribute | Purpose |
|---|---|
| Internal User ID | Immutable, SVMI-owned identity key (D-017) |
| External Identity Provider subject | The IdP's own identifier for this person — mutable relative to the internal ID, not the identity key itself |
| Current email | Mutable contact/display attribute, not the identity key |
| Display name | Mutable |
| Account status | One of the D-019 lifecycle states |
| Role assignment | `ADMIN`/`USER` today, extensible (D-020) |

Historical business records (e.g. `MASTER_LOG` visit attribution) remain
intact regardless of a user's current account status — the same
historical-fact-vs-current-status separation already established for
Purposes (`DECISIONS.md` D-004), now extended to user accounts (D-019).

## 5. Registration/access-approval flow

```
Authenticate
    ↓
Identity verified            (proven by the external IdP)
    ↓
Request SVMI access
    ↓
PENDING_APPROVAL
    ↓
Administrator review
    ↓
APPROVED / REJECTED
    ↓
ACTIVE account when approved
```

The user never creates or manages an SVMI-specific password at any step
(D-015, D-022). This directly replaces the pilot's current behavior,
where any Google-account holder who also has the shared guest password
reaches the full non-admin application immediately, with no request or
approval step at all — flagged as a pilot gap in Section 11.

## 6. RBAC model

Two roles exist today in the pilot (admin / not-admin, via
`SETTINGS!G2:G` membership) and in the target model (`ADMIN`/`USER`,
D-020). The target model's requirement is structural, not a role list
expansion: role must be a data attribute on the account record, evaluated
at authorization time, independent of however authentication happens — so
that adding a third role later never requires touching the authentication
layer. No additional roles beyond `ADMIN`/`USER` are defined by this
review; that remains PENDING DECISION (Section 12) for whoever designs
the Phase 1H-C implementation.

## 7. MFA responsibility

MFA is entirely an identity-provider concern (D-021) — SVMI is not
expected to implement its own second-factor verification code at any
point. The one settled policy point: Admin accounts require MFA in
production. Whether/how MFA applies to `USER`-role accounts is explicitly
left open, to be decided separately once an IdP is chosen and its policy
capabilities are known.

## 8. Audit/security model

Target identity/access audit coverage (D-023): access requested, identity
verified, access approved, access rejected, login success/failure,
logout, account suspended/reactivated/disabled, role assigned/changed,
administrator added/removed, MFA state changes, privileged operation
allowed/denied. This is a distinct audit domain from `CONFIG_AUDIT` (which
remains scoped to `CONFIG_*` configuration mutations only — unchanged by
this review). Secrets must never appear in either audit trail, matching
the pilot's already-verified behavior (reviews/003: `CONFIG_AUDIT` and
`Logger.log` both confirmed clean of secret values today).

## 9. Pilot-to-future migration boundary

The current Apps Script/Sheets implementation is explicitly transitional
and was **not** redesigned by this review. The boundary is: the pilot's
authentication/authorization mechanism (Google sign-in + guest password +
`SETTINGS!G2:G` admin list) continues operating as-is until a Phase 1H-C
implementation decision is made and approved separately; this review only
records what that future replaces it with and why.

## 10. Provider-neutral integration boundary

Target system boundary, provider-agnostic by design so the specific IdP
can change without redesigning SVMI's business modules:

```
Web Frontend
      ↓
Identity Provider           (OIDC / SAML — which provider is PENDING DECISION)
      ↓
Authentication
      ↓
API / Backend
      ↓
SVMI User Identity          (internal User ID + IdP subject, D-017)
      ↓
Account Status              (D-019 lifecycle)
      ↓
RBAC / Permissions          (D-020)
      ↓
PostgreSQL / Business Data
```

The "Authentication" and "Identity Provider" layers are kept behind a
logical boundary from "API / Backend" onward specifically so a future
provider swap does not require redesigning the SVMI User Identity,
Account Status, RBAC, or business-data layers underneath it.

## 11. Current pilot findings that remain unresolved

Unchanged from `reviews/003-phase-1h-security-identity-audit.md` Section
H — nothing has been fixed by this review. Restated here because the
target architecture makes clear which pilot behaviors it is meant to
eventually replace, not because their status has changed:

- **`_getAdminEmails()` / `_getGuestPassword()` have no access check of
  their own** — directly callable by any signed-in user who has loaded
  the real portal page.
- **Five report-rebuild engine functions have no admin check of their
  own** — only their `portal_*` wrappers do.
- **The Sheets-menu rebuild handlers reach the same engine functions
  through a second, independent privilege boundary** (Google Sheet
  sharing), never checked against `SETTINGS!G`.

Additionally, informed by the target architecture above, two structural
pilot gaps not previously called out as "Required" in reviews/003 are
worth naming explicitly as **candidate scope for a future, separately
approved Phase 1H-C implementation task** (not started, not decided here):

- The pilot has no request/approval step (Section 5) — any account with
  the shared guest password gets full non-admin access immediately.
- The pilot's guest password is a single shared secret with no per-user
  identity behind the non-admin gate at all — the target model's
  per-account lifecycle has no pilot equivalent today.

None of these are fixed by this review. Whether, when, and in what order
to address them is a Phase 1H-C decision the project owner has not yet
made.

## 12. Explicit items requiring a later implementation decision

Marked `PENDING DECISION` per this task's instructions — none of these
are chosen, assumed, or implied by this review:

- Which identity provider to use.
- Specific login technology/flow beyond "OIDC primary, SAML where
  required."
- Exact token format/claims beyond the standards named above.
- Provider-specific claims mapping.
- Production deployment details for any future backend/API.
- Any pricing assumption.
- Any migration date or timeline.
- Whether/how refresh tokens are stored, if a future backend requires
  them (D-022).
- MFA policy for `USER`-role accounts (D-021).
- Role definitions beyond `ADMIN`/`USER` (D-020).
- Exact schema for the target logical user/account model (`DATA_MODEL.md`
  §7), including how or whether it reuses the existing unwired
  `database/migrations/002_users_roles.sql` tables.
- Storage mechanism for the future identity/access audit domain (D-023).
- Order, scope, and timing of any Phase 1H-C implementation task —
  including which of the Section 11 pilot findings, if any, must be fixed
  before the pilot continues in its current form.

---

## Confirmation

No application code, authentication code, authorization code, login UI,
Apps Script deployment, `SETTINGS`, Script Properties, Google Sheets data,
database schema, production credentials, or production configuration was
modified by this review. No identity provider was chosen or integrated.
No registration/login/approval UI was created. Phase 1H-C (implementing
any part of this architecture) has not started.
