# SVMI — Project Status

Last updated: 2026-09-25, recording the Phase 1H-A security/identity
audit (see `reviews/003-phase-1h-security-identity-audit.md`). See
`PROJECT_MEMORY.md` for orientation and `IMPLEMENTATION_LOG.md` for the
full phase-by-phase history behind this summary.

## What is SVMI?

A Google Sheets + Apps Script application for logging store visits and
administering the rules (risk scoring, compliance cadence, KPI tracking,
reporting) that govern how those visits are evaluated — with a growing,
versioned, audited Admin Configuration layer replacing informal
spreadsheet edits. See `REQUIREMENTS.md`.

## What architecture is currently live?

The Apps Script Web App in `SVMI_Project/Apps Script/` (see
`ARCHITECTURE.md`). `MASTER_LOG` (permanent visit history) and `SETTINGS`
(now a generated compatibility mirror for Stores/Visitors/Purposes, still
independently authoritative for admin access — see `DATA_MODEL.md`) are
the live storage. **No PostgreSQL database is live for the application** —
`database/` is a DEV-only, unproven-in-production migration target.

## What has been completed

**Apps Script track** (chronological; full detail in `IMPLEMENTATION_LOG.md`):
Phase 0/0.5 hardening → Phase 1A configuration engine → Phase 1B Store ID
identity → Phase 1C reporting-year abstraction → Phase 1D Risk/Compliance/KPI
configuration → Phase 1E report snapshots → Phase 1F Admin/Snapshot UI →
**Phase 1G: Admin Configuration made the sole authoritative path for
Stores/Visitors/Purposes; "Store & Roster Manager" removed** → a read-only
System Peripherals architectural audit → **Phase 1H-A: a read-only
authentication/identity/authorization audit** (see
`reviews/003-phase-1h-security-identity-audit.md` — full findings in
"What remains unresolved" below). **The application itself has not
changed since Phase 1G** — everything below this point, including
Phase 1H-A, is documentation/audit-only work; no code was touched.

**Documentation track** (also complete, both passes pushed):
1. **Documentation foundation** (commit `a84074b`) — created the 8 root
   docs (`PROJECT_MEMORY.md` through `TESTING_LOG.md`) plus
   `reviews/001-workflow-documentation-compliance.md`, none of which
   existed before.
2. **Documentation reconciliation** (commit `f96b2d8`) — created
   `CLAUDE.md`; established the Documentation Authority Model in
   `PROJECT_MEMORY.md`; reconciled the three legacy docs the first pass
   had flagged but not fixed (`SVMI_Project/DEPLOY.md`,
   `SVMI_Project/README.txt`, `database/dryrun/README.md`).
3. **Workflow-readiness gap-fix** — a follow-up audit found
   `PROJECT_STATUS.md` and `IMPLEMENTATION_LOG.md` had not been updated
   after pass 2 landed, producing a real conflicting-source-of-truth
   gap; this pass corrects both and adds
   `reviews/002-documentation-reconciliation.md`, the review artifact
   pass 2 itself should have produced. See that review and
   `reviews/001-...md` (preserved unedited as the historical record of
   the first pass) for full detail.

**Documentation foundation and reconciliation are both complete.**
`CLAUDE.md` now exists at the repo root.

**Security/identity track** (read-only audit, no code changed):
1. **Phase 1H-A — Authentication/Identity/Authorization audit**
   (`reviews/003-phase-1h-security-identity-audit.md`) — traced the full
   login → session → authorization flow, inventoried all 45
   server-gated privileged functions plus every function found NOT
   gated, the guest-password/admin-email secret lifecycle, and mapped
   current concepts against a future Identity-Provider/role/permission
   model. Found 3 Required findings (most notably: two "private" helper
   functions that return the guest password and the full admin email
   list have no access check of their own), 4 Recommended, 3 Future, and
   3 Unknown/Not-Verifiable-From-Repository items — see that review for
   full detail. **Audit only — nothing was fixed.** Phase 1H-B
   (designing the enterprise identity architecture) has explicitly not
   started and awaits review of this audit.

**Database track**: PostgreSQL DEV schema (13 migrations + rollback
scripts), proven against a local ephemeral instance, including verified
column-level grant enforcement. Phase 2 real-data migration dry-run
tooling (Store/Visitor/Purpose identity reconciliation, operational
readiness, snapshot/integrity validation) built and unit-tested against
synthetic data — **158/158 passing** as of this check.

## What is currently being worked on

Nothing is mid-implementation, and nothing documentation- or audit-related
is in-flight either. The most recent application work (Phase 1G), all
three documentation passes, and the Phase 1H-A security audit above are
complete, verified, and pushed. Phase 1H-B (enterprise identity design)
has not been started — it explicitly awaits review and decisions on the
Phase 1H-A findings.

## What remains unresolved

**Security/identity (Phase 1H-A, see `reviews/003-phase-1h-security-identity-audit.md`
for full detail — Required findings):**
- `_getAdminEmails()` and `_getGuestPassword()` have no access check of
  their own; either is directly callable by any signed-in user who has
  loaded the real portal page, exposing the guest password and the full
  admin email list.
- Five report-rebuild engine functions (`buildExecutiveSummaryLayout`,
  `refreshRiskEngine`, `buildKPI2026`, `rebuildDataSheetHeaders`,
  `rebuildStoreMasterInsight`) have no admin check of their own — only
  their `portal_*` wrappers do; directly callable, bypassing the check.
- The Sheets-menu rebuild handlers reach the same engine functions,
  gated only by Google Sheet Editor/Viewer sharing, never by
  `SETTINGS!G` — a second, independent privilege boundary for the same
  operations.

**System Peripherals (Phase 1G follow-up, see `reviews/001`/`002`):**
- **No Admin Configuration screen for admin access** — guest password
  (`SETTINGS!I2`) and admin email list (`SETTINGS!G2:G`) are edited only
  by direct cell edit or a one-time Sheets-menu bootstrap (D-007).
- **Approved Brands/Regions/Categories are hardcoded** JS constants with
  no configuration screen; Brand is additionally embedded in Executive
  Summary's fixed row layout (D-013).
- **`CONFIG_KPI` is unwired** — target/weight/type fields are stored,
  validated, and editable, but no KPI calculation reads any of them.
- **`CONFIG_RISK`'s Low Threshold is a dead field** — stored and
  validated, never compared against by the scoring algorithm.
- **Two dropdown-sourcing rules disagree within the same Admin Store
  form**: Region/Category use the full approved list; Brand uses only
  "brands currently in use by some store," inherited unmodified from the
  removed Store & Roster Manager.
- **Store Category and Compliance's category key are only loosely
  linked** — nothing enforces that a Compliance rule's category string
  corresponds to a selectable Store category.
- Legacy dead code: `_countIfs()` and the `DATA_YEAR` literal it uses have
  no live caller.

## What is explicitly deferred

- **Phase 1H-B — designing the enterprise identity architecture**
  (Identity Provider, real user IDs, roles/permissions, sessions,
  registration/approval) — explicitly not started; awaits project-owner
  review of `reviews/003-phase-1h-security-identity-audit.md` per that
  review's own stop condition.
- Fixing any of the Phase 1H-A Required findings themselves — this was
  an audit only; nothing was remediated (see that review, Section J).
- Moving admin access into `CONFIG_SYSTEM` (D-007).
- Making Brand/Region/Category admin-configurable (D-013) — deferred
  until after the admin-access gap, given Brand's larger blast radius.
- Wiring `CONFIG_KPI` into an actual calculation.
- A real PostgreSQL production deployment or any real-data migration
  (D-011) — paused pending a direct data export from the project owner.
- A separate `location_id` concept (D-002).

## Immediate next task

**Project-owner review of `reviews/003-phase-1h-security-identity-audit.md`.**
That review's own stop condition governs: Phase 1H-B (enterprise
identity design) is deliberately not started until this audit is
reviewed and its direction decided. This supersedes the previously-stated
next step (an Admin Configuration screen for admin access,
`reviews/001`/`002`, `DECISIONS.md` D-007) only in sequencing — that item
remains valid and relevant, and the security audit's findings on the
same guest-password/admin-email mechanism (Section H, Required items 1
and 4) may inform its eventual scope. No application work has begun on
either.
