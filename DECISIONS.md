# SVMI — Decisions

Durable architectural/business decisions. A future AI session must not
reverse a `Status: Settled` decision without an explicit new instruction
from the project owner acknowledging the reversal.

This file was created on `main` to record Decision A below. It is a new
file on this branch — `main` had no `DECISIONS.md` prior to this entry.
A separate, much larger `DECISIONS.md` (D-001–D-037) exists on
`origin/claude/svmi-reports-source-of-truth`; reconciling the two files
is itself part of what Decision A's outcome will determine, and is not
attempted here.

---

## Decision A — SVMI Reference Branch

**Decision ID:** D-A-REF-BRANCH
**Project:** SVMI
**Repository:** `lheiiyy/TddProjectai`
**Area:** `SVMI_Project/`
**Status:** Settled — Option A selected
**Decision Type:** Branch / Development-State Governance
**Date:** 2026-09-29

### 1. Decision

Determine which development line will serve as the reference branch for
future SVMI planning, implementation, testing, review, and repository
records.

**Candidate A — `main`**
Commit: `d70d4af0609f54688456658b45466b367ff36bf9`

**Candidate B — `claude/svmi-reports-source-of-truth`**
Commit: `c078be5d4dc5dcd916f508380fd11f612baa09ff`

**Candidate C — Reconciliation / Canonicalization Branch**
Create a new controlled branch after the Product Owner selects the
reference strategy, bringing forward the required work from both
development lines. This option does not mean merging both branches
automatically. Any reconciliation must first be planned, reviewed,
tested, and recorded.

### 2. Evidence

**`main` contains important SVMI work not present on the candidate branch.**
Verified examples include:
- Phase 2A Location+Brand canonical identity reconciliation tooling.
- Historical identity classification.
- Visitor identity reconciliation tooling.
- Purpose/CAPAR reconciliation dry-run tooling.
- Approximately 17 relevant `database/dryrun/` scripts.

This work must not be lost regardless of the reference-branch decision.

**`claude/svmi-reports-source-of-truth` contains important SVMI work not
present on `main`.** Verified examples include:
- Complete SVMI governance documentation.
- Reviews 001–013.
- Phase 1H identity/security architecture.
- Registration and approval flow.
- RBAC/permission/scope architecture.
- TOTP MFA infrastructure.
- D-033 pilot MFA enforcement toggle.
- D-034/D-035 migration performance and idempotency improvements.
- Settings migration invocation layer.
- Visitor configuration architecture.
- D-036 Reports source-of-truth correction.
- D-037 Reports presentation changes.
- Associated tests.
- PostgreSQL identity migration 013 and rollback.

The D-034/D-035 migration implementation has additionally been
live-verified against real production-scale data.

**Deployment note (as of this entry):** the test-copy's current content
(as of its v19 state) has since been pushed to the live production Apps
Script script (`1QHHyLl8...`) at the Product Owner's explicit direction,
with a pre-push backup taken and committed to `main`
(`SVMI_Project/live-backup-20260929/`). This deployment action does not
settle Decision A — it makes the candidate branch's code live in
production ahead of this decision being recorded, which the Product
Owner should weigh when selecting below.

### 3. Important State Differences

The candidate branch is more completely documented and contains a larger
set of reviewed SVMI implementation work. However, it is not a complete
replacement for `main`. Neither branch independently contains all
currently identified SVMI work.

The candidate branch also contains unrelated `Hub_Project/` and TLM
changes. These are separate top-level projects and do not currently
establish an SVMI functional conflict.

### 4. Reports State

The candidate branch contains the D-036/D-037 Reports implementation.
For Executive Summary, the following are verified:
- `MASTER_LOG` is the authoritative source.
- Report calculations read `MASTER_LOG` directly.
- Reporting year is selectable.
- Year selection does not mutate `MASTER_LOG`.
- Additional Purpose is calculated from data.
- Visitor, Brand, and Store are represented in the report dataset.
- `records[]` provides the per-visit dataset.
- `EXECUTIVE SUMMARY` is no longer used as the authoritative source.

However:
- D-036/D-037 have not yet been live-verified against the deployed
  test-copy.
- KPI 2026 and Store Health remain outside this correction and continue
  to use their existing report-sheet-backed mechanisms, as explicitly
  deferred in Review 013.

Therefore the Reports work is not being treated as universally complete
across all report types.

### 5. Deployment Configuration Issue

A separate deployment issue remains documented. Committed repository
manifests on both branches contain:
```
executeAs: USER_ACCESSING
access: ANYONE
```
The actually deployed Apps Script projects were verified as:
```
executeAs: USER_DEPLOYING
access: ANYONE_ANONYMOUS
```
The live drift is verified. The repository evidence does not establish
how or why the live configuration changed, nor does it identify an
authorized decision approving that change. This issue must remain
separately tracked and must not be silently resolved through branch
selection.

### 6. Consequences of Selecting Each Option

**Option A — Use `main` as the reference.**
Advantages: retains the current `main` development line; preserves
Phase 2A/Purpose/CAPAR reconciliation work as the immediate reference;
avoids immediately adopting the candidate branch's identity/RBAC/MFA
architecture.
Consequences: candidate-branch identity/security work would need to be
deliberately brought forward if retained; D-034/D-035's more mature
migration implementation would need to be reconciled; Reports D-036/D-037
would need to be brought forward; governance records would need to be
brought forward; risk of recreating already-developed functionality must
be controlled. **Additionally note:** production is currently running the
candidate branch's code (see §2), so this option would leave `main` and
the live deployment out of sync.

**Option B — Use `claude/svmi-reports-source-of-truth` as the reference.**
Advantages: provides the most complete documented SVMI state currently
identified; provides the strongest existing governance/review trail;
provides the live-validated D-034/D-035 migration implementation;
provides the Phase 1H identity/security architecture; provides the
Executive Summary source-of-truth correction.
Consequences: `main`'s Phase 2A/Purpose/CAPAR reconciliation work remains
to be deliberately brought forward; D-036/D-037 still require live
verification; deployment-manifest drift remains unresolved; unrelated
`Hub_Project`/TLM content remains in the repository; selecting this
branch does not mean all of its current implementation is automatically
approved as final architecture.

**Option C — Establish a reconciliation/canonicalization branch.**
Advantages: explicitly recognizes that both development lines contain
valuable work; allows the Product Owner to preserve both the Phase 2
reconciliation work and the Phase 1H/Reports/migration work; can prevent
either branch from being treated as a complete replacement for the other.
Consequences: requires a controlled reconciliation plan; requires
conflict analysis at file, architecture, database, deployment, and test
levels; requires additional verification before implementation resumes;
must not become an uncontrolled "merge everything" operation.

### 7. What This Decision Does Not Approve

Selecting a reference branch does not automatically approve:
- Deployment configuration changes.
- MFA enforcement.
- New identity/security behavior for production.
- Unmapped Store reconciliation UI.
- KPI 2026 report redesign.
- Store Health report redesign.
- Database migration execution.
- Production deployment. *(Note: partially overtaken by the deployment
  recorded in §2 above — that action was separately, explicitly directed
  and confirmed by the Product Owner at the time, and is disclosed here
  rather than silently reconciled with this clause.)*
- Merging branches.
- Deleting either branch.
- Removing unrelated projects.

Those require their own decisions or approved implementation scope.

### 8. Relationship to Decisions B–D

Decision A is the prerequisite reference-state decision. After Decision A
is settled:
- **Decision B — Deployment Configuration.** Determine the intended Apps
  Script execution/access model and reconcile the repository manifest
  with the approved deployment model.
- **Decision C — Identity Architecture.** Confirm whether Phase 1H
  identity/RBAC/MFA remains the intended SVMI security architecture,
  subject to the approved deployment model.
- **Decision D — Unmapped Store / FIX-002 / FIX-014.** Determine whether
  the reconciliation UI remains deferred or becomes scheduled work
  against the approved canonical migration implementation.

### 9. Product Owner Decision

**Selected: A — `main`** (`d70d4af0609f54688456658b45466b367ff36bf9`).
`main` is the SVMI reference branch for future planning, implementation,
testing, review, and repository records.

**Product Owner Notes:** None recorded beyond the selection itself.

**Approved By:**
Product Owner: (confirmed via this session's decision prompt)
Date: 2026-09-29
Decision Status: **Settled**

### 9a. Immediate Consequence Requiring Follow-Up (disclosed, not resolved here)

Selecting `main` as the reference branch creates an **immediate,
concrete mismatch** with current deployed reality: the live production
Apps Script script (`1QHHyLl8...`) is, as of this same date, running the
candidate branch's code (pushed per a separate, explicit prior
instruction — see §2 above), not `main`'s. `main`'s own
`SVMI_Project/Apps Script/` content does not contain the Store ID
architecture, versioned configuration engine, identity/MFA/RBAC system,
Settings Migration invocation layer, or the D-036/D-037 Reports fix that
are now live in production.

This decision (which branch is the *reference*) does not by itself
determine what should happen to that mismatch — options include (a)
reverting production to match `main`, (b) bringing `main` forward to
match what's now live (per §6's "Option A" consequence list — candidate-
branch work "would need to be deliberately brought forward if
retained"), or (c) leaving the mismatch in place temporarily while
reconciliation work is scoped. None of these is decided by this entry.
Per §10's implementation gate, no merge, cherry-pick, or further
deployment change should proceed until that follow-up is explicitly
directed.

### 9b. Second Immediate Consequence: Production Manifest Changed By The D-038 Deploy (disclosed, left as-is by explicit instruction)

On 2026-09-29, a live production bug was reported and fixed (D-038 on
`claude/svmi-reports-source-of-truth` — Input Portal's Stores/Visitors
dropdowns not appearing / very slow to appear, an O(n²) full-sheet-read
defect in `store_getOperationalList()`/`visitor_getOperationalList()`,
same class as D-034/D-035 but in the read path; see
`reviews/014-input-portal-load-perf.md` on that branch). Deploying the
fix required rebuilding the full push payload from that branch's
`SVMI_Project/Apps Script/` source, which includes `appsscript.json`.

That file's committed value (`executeAs: USER_ACCESSING`, `access:
ANYONE`) does **not** match what §5 above already established was
actually live (`executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`).
Pushing the full payload therefore also pushed the manifest, changing the
**live** access model from `ANYONE_ANONYMOUS`/`USER_DEPLOYING` to
`ANYONE`/`USER_ACCESSING` as an unintended side effect of the D-038 code
deploy — not a considered change to deployment configuration.

This was caught immediately after deploy (fresh `clasp pull` diff against
a pre-deploy backup), and an attempt to revert the manifest back to the
prior live values was made but blocked by this session's own permission
controls as a security-sensitive change. The Product Owner was asked how
to proceed and **explicitly chose to leave the manifest as `ANYONE`/
`USER_ACCESSING`** (i.e., matching what's committed in source) rather
than reverting it, for now.

**What this does and does not mean:**
- It does **not** settle Decision B (§8) — the Product Owner has not
  stated a considered position on which access model SVMI's Web App
  should use; this is an interim "leave it as it now happens to be,"
  not a chosen target state.
- It **does** mean the D-025 manifest drift described in §5 is, as of
  this date, no longer present in one direction: committed and live now
  agree (`ANYONE`/`USER_ACCESSING`). Whether that agreement should
  persist, or whether `ANYONE_ANONYMOUS`/`USER_DEPLOYING` should be
  restored and the repository's manifest updated to match instead, is
  exactly the kind of question Decision B should still resolve
  deliberately, not by accident of a code deploy.
- Any real-world access impact (e.g., a user who previously reached the
  app without a Google sign-in and now cannot, or a script-permission
  failure for a signed-in user without direct Sheet access under
  `USER_ACCESSING`) has not been separately verified in this session and
  should be watched for.

A pre-deploy backup of production (v8's exact 32 files) was taken and
committed to `main` at `SVMI_Project/live-backup-20260929-pre-d038/`
before the D-038 push, independent of this manifest note.

### 10. Implementation Gate

Until this decision is settled:
- Do not merge either branch.
- Do not cherry-pick SVMI implementation work.
- Do not rebase either branch.
- Do not implement FIX-014.
- Do not create a third implementation of the migration workflow.
- Do not alter deployment configuration further.
- Do not discard work from either development line.

After the decision, implementation should proceed only from the approved
reference state and with the required reconciliation work explicitly
identified.
