# SVMI — Decisions

Durable architectural/business decisions. A future AI session must not
reverse a `Status: Settled` decision without an explicit new instruction
from the project owner acknowledging the reversal. This is a record of
*what was decided*, not a transcript of how — see `IMPLEMENTATION_LOG.md`
and `SVMI_Project/DEPLOY.md` for the reasoning in full.

---

### D-001 — Store identity = Location + Brand
**Status:** Settled
**Decision:** A store's canonical identity is the pair (physical Location,
Brand), not Location alone and not Brand alone. `canonical key =
NORMALIZED_LOCATION|NORMALIZED_BRAND`.
**Rationale:** Confirmed against real production data during the Phase 2A
migration dry run — the same physical location legitimately hosts more
than one brand (e.g. one town with both a FIGARO and an ANGEL'S PIZZA
location).
**Impact:** Two brands at one location are always two separate Stores,
each with its own Store ID. Never merge them on physical co-location
alone, and never fuzzy/similarity-match location names to decide identity.

### D-002 — No separate `location_id` (for now)
**Status:** Settled (scope boundary, not a rejection)
**Decision:** Store ID stays attached directly to the (Location, Brand)
operational identity. A future schema MAY introduce a separate
`location_id` to represent "this physical site" independent of which
brand operates there, but that is explicitly out of scope for the current
phase.
**Rationale:** Avoids inventing a second identity table before there's a
concrete need for it.
**Impact:** Do not add a `location_id`-style concept without a new,
explicit decision to do so.

### D-003 — Visitor and Purpose identity = normalized name (interim)
**Status:** Settled, interim
**Decision:** Unlike Store (which has an immutable `STR-<uuid>` Store ID),
Visitor and Purpose entities are keyed by their own normalized (trimmed,
uppercased) name. There is no immutable ID scheme for either yet.
**Rationale:** Matches the pre-existing SETTINGS-era identity model for
these two; inventing a new ID scheme was explicitly deferred rather than
done speculatively.
**Impact:** A Visitor or Purpose cannot be "renamed" — a different name is
a different entity. A future immutable-ID migration for these two is a
distinct, not-yet-scheduled decision.

### D-004 — CAPAR (and any purpose like it): historically preserved, operationally inactive
**Status:** Settled
**Decision:** A purpose with real historical `MASTER_LOG` usage but no
deliberate KPI/Risk configuration record is `INACTIVE_NOT_SELECTABLE` —
its historical rows and workbook presence are never invalidated by that
status, and its absence from the legacy `APPROVED_PURPOSES` list is never
treated as evidence the historical records themselves are wrong.
**Rationale:** Keeps "did this happen" (historical fact) and "is this
ready for the reporting pipeline" (operational readiness) as two separate
questions, never collapsed into one.
**Impact:** Never auto-activate a purpose from historical usage alone;
never treat a purpose's historical rows as invalid because it isn't
currently configured.

### D-005 — Admin → Configuration is the sole authoritative path for Stores/Visitors/Purposes
**Status:** Settled (Phase 1G)
**Decision:** The "Store & Roster Manager" System Tools card — the
previous direct-to-`SETTINGS` editor for Stores/Visitors/Purposes — has
been removed entirely. Admin → Configuration (backed by
`CONFIG_STORES`/`CONFIG_VISITORS`/`CONFIG_PURPOSES`) is the only place any
of the three is created, renamed, activated, or deactivated.
**Rationale:** Two competing editors for the same data invite drift and
undermine the versioning/audit guarantees Configuration provides.
**Impact:** Do not add a second editing surface for Stores/Visitors/Purposes.
The four legacy write functions in `INPUT_PORTAL.gs` still exist, but only
as internal plumbing called by the Configuration sync hooks — never
reachable from any client-side path.

### D-006 — SETTINGS is a generated compatibility mirror, never authoritative again (for Stores/Visitors/Purposes)
**Status:** Settled (Phase 1G)
**Decision:** `SETTINGS` columns A–E/F/H are regenerated automatically from
`CONFIG_STORES`/`CONFIG_VISITORS`/`CONFIG_PURPOSES` on every mutation; no
new feature may write to them as an independent source of truth.
**Rationale:** Several existing report builders (Store Health, Executive
Summary, KPI 2026) read `SETTINGS` directly, including via live cell-
reference formulas — rewriting all of them to read `CONFIG_*` directly was
judged higher-risk than keeping a correctly-synced mirror.
**Impact:** `SETTINGS` columns G (admin emails) and I (guest password) are
**not** covered by this decision — they remain independently authoritative
(see D-007). Do not assume "the whole SETTINGS sheet is now a disposable
mirror."

### D-007 — Guest password and admin email list stay in SETTINGS, out of CONFIG_SYSTEM
**Status:** Settled for now — flagged as a gap, not closed
**Decision:** `SETTINGS!I2` (guest password) and `SETTINGS!G2:G` (admin
emails) were deliberately NOT moved into `CONFIG_SYSTEM` during Phase 1G.
**Rationale:** Out of scope for the Stores/Visitors/Purposes migration;
moving authentication-adjacent values needed its own deliberate review,
not a side effect of an unrelated migration.
**Impact:** No Admin Configuration screen exists for admin access today —
identified as the highest-priority System Peripherals gap (see
`PROJECT_STATUS.md`). `CONFIG_SYSTEM`'s schema exists and is ready to hold
this once a decision is made to move it.

### D-008 — Reporting year is data-derived, no manual annual rollover
**Status:** Settled (Phase 1C)
**Decision:** The "current" reporting year for any calculation is the
latest calendar year actually present in `MASTER_LOG`'s Date Visited
column (`getDefaultReportingYear()`), re-derived on every call — never a
static constant someone has to remember to bump each January.
**Rationale:** The old `DATA_YEAR` literal required a manual code change
every year and was a recurring source of stale-year bugs.
**Impact:** `DATA_YEAR` is a legacy compatibility constant only — do not
wire new code to it. Cosmetic labels ("KPI 2026") are fine to leave as
display text; the functions behind them are year-neutral regardless.

### D-009 — Report snapshots are immutable once finalized; correction = supersede
**Status:** Settled (Phase 1E)
**Decision:** Finalizing a report for a year freezes it permanently.
Correcting it never edits the frozen row — it creates a new snapshot
explicitly linked as superseding the old one.
**Rationale:** Same append-only-correction discipline used everywhere else
in the configuration model, applied to reporting.
**Impact:** Never add an "edit snapshot" path. A duplicate finalize for an
already-finalized year must be rejected, not silently overwritten.

### D-010 — No cross-purpose or cross-entity inheritance of configuration, ever
**Status:** Settled
**Decision:** A purpose's KPI/Risk configuration is looked up by its own
exact key only. A purpose with no configuration has none — it is never
defaulted from another purpose's values, from legacy behavior, or from
its own historical usage.
**Rationale:** Explicit business rule, restated and re-verified across
every phase (Risk, KPI, and the Phase 2 dry-run reconciliation tooling all
independently enforce and test it).
**Impact:** Any future "smart default" or "inherit from similar purpose"
feature would reverse this decision — do not add one without an explicit
new decision overriding D-010.

### D-011 — PostgreSQL migration: DEV/PROD strictly isolated; no production data touched without an explicit real export
**Status:** Settled
**Decision:** DEV and PROD Postgres environments use entirely separate
credentials and roles, never shared. Real SVMI data is only ever obtained
via a direct export/CSV from the project owner — never by pushing a
temporary export function to the live production Apps Script project.
**Rationale:** The latter would be a real (even if reverted) change to a
production system; the former has zero production risk.
**Impact:** No AI session should attempt to extract real data from the
live script to unblock Phase 2 — wait for the owner to provide it.

### D-012 — Administrative confirmation is always kept separate from automatic evidence
**Status:** Settled
**Decision:** Across Store, Visitor, and Purpose identity reconciliation,
an automatically-detected match (e.g. `EXACT_MATCH`) is never conflated
with an explicitly-declared administrative decision (e.g. "treat this as
the same Store"). Both are recorded, but under different, non-overlapping
fields/labels.
**Rationale:** So the evidence trail never claims a match was "discovered"
when it was actually declared by a human, and vice versa.
**Impact:** Any reconciliation logic must accept administrative
confirmation only as an explicit, separate input — never infer it from
data alone.

### D-013 — Approved Brands/Regions/Categories remain hardcoded (current state, not a final answer)
**Status:** Open / acknowledged gap
**Decision:** `APPROVED_BRANDS`/`APPROVED_REGIONS`/`APPROVED_CATEGORIES`
(`SVMKPI_CORE.gs`) remain JavaScript constants, not Admin Configuration
data, as of Phase 1G.
**Rationale:** Brand in particular is structurally embedded in Executive
Summary's fixed per-brand row layout — making it configurable is a larger,
riskier change than the Stores/Visitors/Purposes migration and was
deliberately not attempted opportunistically.
**Impact:** Adding a new brand/region/category today requires a code
change and redeploy. Flagged in the System Peripherals audit
(`reviews/`) as a candidate for a future phase, in dependency order after
the admin-access gap (D-007).

### D-014 — One authoritative document per category; no duplicate authorities
**Status:** Settled (governance)
**Decision:** Each documentation category (context, status, requirements,
architecture, data model, decisions, implementation history, testing
history, reviews, AI operating rules, and the two deployment-procedure
authorities) has exactly one authoritative document. When an older
supporting document disagrees with its category's authority, the older
document is corrected or explicitly marked historical — never left to
stand as a second, conflicting source.
**Rationale:** A future AI session must be able to determine project
state from the repository alone; two documents claiming the same
authority (or one silently going stale while another is updated) breaks
that guarantee.
**Impact:** The full authority table lives in `PROJECT_MEMORY.md` — not
repeated here. Do not create a new root document that duplicates an
existing category's role; update the existing authority instead. See
`CLAUDE.md` for the operating rules this decision implies (read
`PROJECT_STATUS.md` first, consult only the relevant document, record
meaningful changes where they belong).

---

## Phase 1H-B — Enterprise identity & access architecture (target, not yet implemented)

The following decisions (D-015–D-023) record the **approved target**
identity/access architecture per the project owner's Phase 1H-B
direction. None of them describe the current pilot — see
`reviews/003-phase-1h-security-identity-audit.md` for that — and none of
them has been implemented. They govern a future Phase 1H-C implementation
task, not yet started or scoped. Full narrative:
`reviews/004-phase-1h-enterprise-identity-architecture.md`.

### D-015 — Future authentication is delegated to an external identity provider
**Status:** Settled (target architecture — Phase 1H-B; not yet implemented)
**Decision:** Production SVMI authentication will be delegated to an
external, standards-based identity provider. Target protocols: OIDC
(primary), SAML where a specific integration requires it. SVMI will not
build or maintain its own primary password database.
**Rationale:** Removes SVMI from directly storing/verifying user
passwords; closes the class of risk the pilot's single shared plaintext
guest password represents (`reviews/003` §E).
**Impact:** No SVMI-specific password field belongs in any future schema.
Which specific provider is used is **PENDING DECISION** — do not select
or integrate one without a new decision recording that choice.

### D-016 — Authentication is distinct from SVMI authorization
**Status:** Settled (target architecture)
**Decision:** Successful authentication (the IdP proving who someone is)
does not by itself grant SVMI access. SVMI independently controls account
status, role, permissions, application access, and approval.
**Rationale:** Keeps "is this really the person" (an IdP concern)
separate from "should this SVMI account be allowed to do X right now" (an
SVMI concern) — the same single-authoritative-path discipline as
D-005/D-006, applied to identity/access.
**Impact:** A future backend must not treat "IdP login succeeded" as
equivalent to "user is `ACTIVE` and permitted." Every privileged
operation still needs its own SVMI-side authorization check, not just a
valid IdP session — carrying forward, not replacing, the defense-in-depth
pattern already used for `CONFIG_*` mutations (`sl_isAdmin()`).

### D-017 — Immutable internal User ID as the identity key, not email
**Status:** Settled (target architecture)
**Decision:** Future logical user identity requires: an immutable
internal User ID, an external Identity Provider subject/identifier,
current email, display name, account status, and role assignment. Email
is not the permanent identity key.
**Rationale:** Email can change; the pilot's `sl_isAdmin()` looks up
admin status by raw email string on every call, with no immutable ID
behind it — flagged as an enterprise-migration gap in `reviews/003` §I.
**Impact:** Any future schema/migration introducing real user accounts
must include an immutable internal ID distinct from email, with the
external IdP subject as a separate field. The existing DEV-only
`users`/`user_roles`/`roles` tables (`database/migrations/002_users_roles.sql`)
are unwired infrastructure that has not yet been audited against this
specific requirement — see `DATA_MODEL.md` §7.

### D-018 — Access request/approval workflow required before ACTIVE
**Status:** Settled (target architecture)
**Decision:** Target flow: Authenticate → Identity verified → Request
SVMI access → `PENDING_APPROVAL` → Administrator review → `APPROVED`/
`REJECTED` → `ACTIVE`. No self-service SVMI password; no automatic
activation on first successful IdP login.
**Rationale:** Extends the "no self-service escalation" principle
already implicit in the pilot's admin-email-list model into a
documented, auditable workflow.
**Impact:** A future implementation must not grant `ACTIVE` status
automatically on first IdP login. This directly supersedes the pilot's
current behavior (any guest-password holder gets full non-admin access
immediately, no approval step) — see `reviews/004` §11 for this named as
a candidate future fix, not yet scheduled or approved for implementation.

### D-019 — Account lifecycle states
**Status:** Settled (target architecture) — **the specific 7-state list
below is superseded by D-027's binding Phase 1H-C list; the underlying
principle (distinct, non-collapsed states; historical records survive
status change) is unchanged.**
**Decision:** Target account statuses: `REQUESTED`, `VERIFIED`,
`PENDING_APPROVAL`, `ACTIVE`, `SUSPENDED`, `DISABLED`, `REJECTED`.
Historical business records must remain intact when an account becomes
inactive.
**Rationale:** Mirrors D-004 (historical fact vs. current operational
status are separate questions), applied to user accounts instead of
Purposes.
**Impact:** A future deactivation feature must never delete or
reattribute historical records (e.g. `MASTER_LOG` attribution) tied to
that user. Do not collapse `SUSPENDED`/`DISABLED`/`REJECTED` into one
"inactive" flag — they are distinct states with distinct meaning. **See
D-027 for the exact state list Phase 1H-C implements.**

### D-020 — Extensible RBAC; current roles remain ADMIN/USER
**Status:** Settled (target architecture)
**Decision:** Current roles stay `ADMIN` and `USER`. The architecture
must allow additional roles later without redesigning authentication.
**Rationale:** Follows from D-016 — decoupling authentication from
authorization means role granularity can grow independently of how
people sign in.
**Impact:** Do not hardcode a binary admin/non-admin assumption into any
new identity-layer design; role is a data attribute checked at
authorization time. Specific roles beyond `ADMIN`/`USER` are **PENDING
DECISION**.

### D-021 — MFA is an identity-provider responsibility; mandatory for future Admin accounts
**Status:** Settled (target architecture), partially open
**Decision:** MFA enforcement belongs to the identity provider, not to
SVMI's own code. Future production policy: Admin accounts require MFA.
User-role MFA policy is an explicit, separate future decision.
**Rationale:** Consistent with D-015 — SVMI does not implement its own
second-factor verification.
**Impact:** Do not build SVMI-specific OTP/MFA code. Admin MFA
enforcement must be verified as achievable through the chosen provider's
own policy features once one is selected. Non-admin MFA policy is
**PENDING DECISION**.

### D-022 — Credential separation: no IdP credentials, MFA secrets, or OTPs in SVMI
**Status:** Settled (target architecture)
**Decision:** SVMI must not store identity-provider passwords, MFA
secrets, or OTP values. Provider refresh tokens may be stored only if a
future backend architecture explicitly requires it and can manage them
securely — never in Sheets or ordinary application configuration.
**Rationale:** Directly closes the risk class `reviews/003` documented
for the pilot (plaintext guest password in `SETTINGS!I2` and in browser
`localStorage`) — the target architecture does not carry that pattern
forward.
**Impact:** Reject any future design that stores a password, secret, or
OTP in Sheets, `CONFIG_SYSTEM`, Script Properties, or an unreviewed
database table. Refresh-token storage mechanism, if ever needed, is
**PENDING DECISION** — not authorized by this entry alone.

### D-023 — Identity/access audit domain is separate from CONFIG_AUDIT
**Status:** Settled (target architecture)
**Decision:** Future identity/access auditing (access requested/verified/
approved/rejected, login success/failure, logout, account suspended/
reactivated/disabled, role assigned/changed, administrator added/removed,
MFA state changes, privileged operation allowed/denied) is a distinct
audit domain from `CONFIG_AUDIT`, which stays scoped to `CONFIG_*`
configuration mutations only (`DATA_MODEL.md` §3). Secrets must never be
written to either audit log.
**Rationale:** `CONFIG_AUDIT`'s schema and purpose are specific to
versioned configuration changes (D-009's supersede model); identity/access
events are a different domain with different actors and sensitivity —
`reviews/003` already found zero auth events logged anywhere today.
**Impact:** A future implementation must not bolt identity/access events
onto the existing `CONFIG_AUDIT` sheet/table. Exact storage mechanism is
**PENDING DECISION**.

---

## Phase 1H-C — Approved implementation scope

The following decisions (D-024–D-030) record the project owner's approved
Phase 1H-C scope: implementing the registration/approval/RBAC/scope/MFA
identity foundation now, while explicitly deferring external-IdP
selection. Full narrative and implementation plan:
`reviews/006-phase-1h-c-planning.md`.

### D-024 — SVMI-native registration is the bridge identity provider until an external IdP is selected
**Status:** Settled (Phase 1H-C)
**Decision:** For Phase 1H-C, SVMI implements its own registration/
email-verification mechanism (full name, email, department; one-time
email verification code) as the active occupant of the "Identity
Provider" slot behind the provider-neutral authentication boundary
(D-015). No external OIDC/SAML provider is selected or integrated. Any
syntactically valid email address may register — SVMI does not require a
Google Workspace account or restrict registration to Google-authenticated
identities.
**Rationale:** D-015 deferred the specific IdP choice; this implements
the authentication-vs-authorization boundary (D-016) now, using SVMI's
own registration flow as a real, working (if temporary) identity source,
so accounts/roles/approval discipline exist before a real IdP is chosen.
**Impact:** A user's `auth_provider` value of `native` (or equivalent) is
a legitimate, first-class state, not a placeholder to special-case away.
A future IdP integration replaces the authentication mechanism behind
this boundary; it does not require redesigning the account/role/
permission/scope model built in this phase.

### D-025 — Pilot hosting layer: Google sign-in remains the outer Web-App access gate, decoupled from SVMI identity
**Status:** Settled (Phase 1H-C), disclosed limitation
**Decision:** The Apps Script Web App's platform-level Google sign-in
requirement (`appsscript.json` `access:"ANYONE"`) is not removed or
reconfigured by Phase 1H-C — it remains the outer "can this browser reach
the app at all" gate, unchanged since before Phase 1H-B.1. SVMI's own
registration/account system is layered on top of it, not a replacement
for it, exactly as the approved scope authorizes keeping the guest
password "as a documented transitional mechanism."
**Rationale:** Changing the Web App's `access`/`executeAs` deployment
mode is a deployment-configuration decision outside this phase's approved
scope, and would break every existing `Session.getActiveUser()`-based
admin check (Phase 1H-B.1 and earlier) as a side effect.
**Impact — disclosed limitation:** `getCurrentUser()`/`getAccessState()`
resolve "who is this" by matching `Session.getActiveUser().getEmail()`
(the Google account that reached this deployment) against
`IDENTITY_USERS.email`. Someone who registers with a different email than
the Google account they use to reach this specific pilot deployment will
not resolve to their SVMI identity here, even though neither the data
model nor the registration form restrict which email they may register
with. This is a pilot-hosting-layer constraint, not an SVMI identity-model
constraint, and is expected to disappear once SVMI runs behind a real
API/frontend not bound to Apps Script Web App hosting rules.

### D-026 — Logical identity model: seven distinct, independently extensible concepts
**Status:** Settled (Phase 1H-C)
**Decision:** The identity model separates: User (immutable ID + email +
profile + account status), Role (a named label), Permission (a named
capability), Role↔Permission (which permissions a role grants),
User↔Role (which roles a user holds), User↔Scope (system/region/store
access grants), and MFA state — each its own table/sheet, never collapsed
into a user record with an `isAdmin` boolean.
**Rationale:** Directly implements the approved scope's "User → Role →
Permissions → Access Scope" separation and "must not be hard-coded around
only ADMIN/USER" requirement — a new role is new rows in `IDENTITY_ROLES`/
`IDENTITY_ROLE_PERMISSIONS`, never a code change.
**Impact:** New identity/registration/approval surface authorizes by
resolving permissions, not roles, wherever practical. `sl_isAdmin()` and
the 45+ existing `CONFIG_*`/rebuild-engine call sites (Phase 1H-B.1 and
earlier) are **not** retroactively rewired onto the new permission model
in this phase — that would be unrelated refactoring, explicitly out of
scope. The two systems coexist: `sl_isAdmin()` continues gating existing
pilot operations; the new permission model gates the new identity surface.

### D-027 — Account lifecycle: the binding Phase 1H-C state list
**Status:** Settled (Phase 1H-C) — supersedes D-019's illustrative 7-state list
**Decision:** `PENDING_VERIFICATION` → `PENDING_APPROVAL` → `ACTIVE` →
(`SUSPENDED` | `DISABLED`), plus `REJECTED` as a terminal non-approval
outcome. Six states, not D-019's original seven (`REQUESTED`/`VERIFIED`
collapse into `PENDING_VERIFICATION`, covering both "just registered" and
"verifying now").
**Rationale:** The Phase 1H-C approval message defines this list
directly as binding; reconciling it with D-019's earlier, more
provisional list avoids two documents each claiming to be "the"
lifecycle (D-014 governance).
**Impact:** Implementation uses exactly this six-state list. A
non-`ACTIVE` account must not receive normal protected application
access — enforced server-side in `getAccessState()`, never inferred
client-side. Valid transitions are enforced server-side (e.g. `ACTIVE`
cannot be reached except via `PENDING_APPROVAL` → admin-approve, or
`SUSPENDED` → admin-reactivate).

### D-028 — MFA implemented natively now (TOTP) — a documented, temporary exception to D-022
**Status:** Settled (Phase 1H-C), documented temporary exception
**Decision:** Phase 1H-C implements authenticator-app TOTP (RFC
6238-style, via `Utilities.computeHmacSha1Signature`) as SVMI's own
second factor, required for all `ACTIVE` users. SVMI necessarily stores
each user's TOTP shared secret itself, in a dedicated sheet never
included in any general user-listing read path, because no external IdP
exists yet to own it.
**Rationale:** D-022 ("SVMI must not store... MFA secrets") was written
for the target state where an external IdP owns authentication entirely
(D-021: "MFA belongs to the identity provider"). With no IdP selected
(D-024), honoring the approved scope's "MFA is required for all Active
users" requires either not implementing MFA at all, or storing the secret
natively for now. The approval message's own instruction — "do not invent
an insecure custom MFA implementation if the pilot platform cannot safely
support it" — is honored by using a standard, reviewed algorithm rather
than a bespoke scheme, and by isolating the secret from every general
read path.
**Impact:** Same category of disclosed, temporary limitation as the
guest password remaining plaintext in `SETTINGS!I2` (`reviews/003`) — not
hidden, not treated as final. D-022 remains the rule for the target
state; once an external IdP is adopted (D-015), MFA responsibility
transfers to it and this native TOTP storage is retired. Do not add
further native-secret features beyond this one, narrowly-scoped exception
without a new decision.

### D-029 — Identity/access audit implemented as `IDENTITY_AUDIT`
**Status:** Settled (Phase 1H-C) — implements D-023
**Decision:** `IDENTITY_AUDIT` (new, append-only sheet; the pilot-storage
analog of a future `identity_audit_log` Postgres table) records
registration submitted/email verified/registration approved/rejected,
account activated/suspended/disabled, role/permission/scope changed, MFA
enrolled/reset, and other administrative identity actions. It stays
separate from `CONFIG_AUDIT`, never merged into it.
**Rationale:** Directly implements D-023 now that a concrete identity
system exists to generate these events.
**Impact:** Every identity-service mutation writes an `IDENTITY_AUDIT`
row before returning success. No secret value (verification code, MFA
secret, or equivalent) is ever written to this log — enforced by
construction, via a shared audit-writer helper that only accepts a fixed
set of non-secret fields.

### D-030 — Postgres identity schema extended via a new migration, not an edit to `002_users_roles.sql`
**Status:** Settled (Phase 1H-C)
**Decision:** `database/migrations/002_users_roles.sql` is left as
originally written (its header comment corrected with a pointer, not a
rewrite). A new migration, `013_identity_extension.sql`, adds
account-status/email-verification/MFA columns to `users`, seeds `roles`
with `USER` alongside `ADMIN`, and adds `permissions`, `role_permissions`,
`user_scope`, and `identity_audit_log` tables.
**Rationale:** Applies this codebase's append-only-correction discipline
(D-009) to schema evolution. `002` was never applied to any real database
(`DATA_MODEL.md` §6 — no real SVMI data has ever been migrated into this
schema), so there is no live-data risk either way, but extending forward
keeps the migration sequence an honest, ordered history rather than
rewriting an already-numbered file.
**Impact:** `002`'s header comment gets a pointer to `013` (the same
"historical, corrected via a pointer" pattern used for `DEPLOY.md`/
`README.txt` in the documentation-reconciliation pass), not a rewrite. No
production Postgres cutover occurs in Phase 1H-C — unchanged from D-011.

---

## Phase 1H-C Security Fix R1 — MFA is now an enforced access requirement

### D-031 — Server-authoritative MFA satisfaction gate, backed by `PropertiesService`, not a general session
**Status:** Settled (Phase 1H-C Security Fix R1)
**Decision:** `verifyMfa()` success now records a bounded (12-hour,
`IDENTITY_MFA_GATE_TTL_MINUTES`), server-side "MFA satisfied" credential
via `PropertiesService.getUserProperties()` — scoped by Apps Script
itself to the executing Google identity, the same trust primitive
`Session.getActiveUser()` already provides everywhere else in this
codebase, never readable or writable by any client. The central identity
authorization function, `_identity_authorizeCurrentUser_()`
(`SVMKPI_IDENTITY_CORE.gs`), now refuses any ACTIVE, otherwise-permitted
user who has not satisfied this credential — the single choke point
every protected identity function (`approveRegistration`, `assignRole`,
`assignPermissions`, `assignScope`, `suspendAccount`, `reactivateAccount`,
`disableAccount`, `identityAudit_list`) already called, so none needed
its own edit. TOTP verification also gained anti-replay protection: a
given time-step can satisfy at most one `verifyMfa()` call
(`IDENTITY_MFA_COL.LAST_USED_STEP`).
**Rationale:** Closes the gap the Phase 1H-C implementation review
(`reviews/007-...md`) itself disclosed: MFA was enrollment-time proof of
possession only, not an actual access requirement, which did not satisfy
the approved requirement ("MFA is required for every Active user").
Building a general session mechanism was explicitly out of scope for
this fix; `PropertiesService.getUserProperties()` is a native Apps
Script primitive tied to the same server-verified identity already
trusted throughout this codebase, not a client-held token or cookie — it
carries exactly one fact (MFA satisfied until time T), not roles,
permissions, or identity data, all of which continue to be re-read fresh
from the `IDENTITY_*` sheets on every call. This is deliberately NOT
called a session anywhere in code or docs, to avoid contradicting the
"no session redesign" constraint both Phase 1H-C and this fix operated
under.
**Impact:** `getAccessState().isActive` now requires both `ACTIVE`
account status and a satisfied MFA credential — `accountStatus` is
reported separately so the UI can still distinguish "not yet ACTIVE"
from "ACTIVE, MFA not yet completed this cycle." A reset or fresh
`enrollMfa()` call clears any standing satisfaction (a stale credential
from an old secret can never carry over to a new one). The 12-hour TTL
is a tunable policy constant, not itself a security boundary — do not
extend it without a new decision if a shorter/longer window is later
required. The 45+ pre-existing `sl_isAdmin()`-gated call sites are
unaffected (D-025/D-026 — separate systems, not rewired here).
